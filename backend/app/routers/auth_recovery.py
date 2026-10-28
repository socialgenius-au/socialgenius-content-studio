"""Forgot Password and email-ownership verification.

  POST /auth/password-reset/request     username or email -> ALWAYS the same 202 reply; the work happens after the response is sent
  POST /auth/password-reset/validate    is this link still usable? (never consumes it)
  POST /auth/password-reset/confirm     token + new password -> sets the password, signs out every existing session
  POST /auth/email/verification/request signed-in user -> emails a verification link to their address of record
  POST /auth/email/verification/confirm token -> marks that address as verified

Design rules (see docs/FORGOT_PASSWORD.md)
  * No account enumeration: the request endpoint does no database work before it answers, so unknown / disabled / unverified / capped /
    sendable accounts are indistinguishable by body, status or timing. Reasons are visible only in server logs, by user id.
  * A reset link is only ever sent to an address whose ownership has been verified (users.email_verified_at).
  * Errors use 400, never 401: the frontend's axios interceptor treats every 401 as "session expired" and hard-redirects to /login.
  * Nothing sensitive is logged: no token, link, password, hash, or email address.
"""
from __future__ import annotations

import logging
from datetime import timedelta

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response, status
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import AsyncSessionLocal, get_db
from app.deps import current_user
from app.limiter import limiter
from app.models.user import User
from app.schemas.auth_recovery import PasswordResetConfirm, PasswordResetRequest, TokenBody
from app.services import auth_mail, auth_tokens
from app.services.auth import hash_password
from app.services.password_policy import validate_new_password

logger = logging.getLogger("app.auth_recovery")
router = APIRouter()


def _generic_request_message() -> str:
    return f"If an account matches, a reset link is on its way. The link expires in {settings.PASSWORD_RESET_TOKEN_TTL_MINUTES} minutes."


def _invalid_link() -> HTTPException:
    return HTTPException(status.HTTP_400_BAD_REQUEST, detail={"code": "invalid_token", "message": "This link is invalid or has expired."})


def _client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


# ── Request a reset ───────────────────────────────────────────────────────────────────────────────────────────────────────────

async def _find_user(db: AsyncSession, identifier: str) -> User | None:
    ident = identifier.strip()
    if not ident:
        return None
    stmt = select(User).where(func.lower(User.email) == ident.lower()) if "@" in ident else select(User).where(User.username == ident)
    users = (await db.execute(stmt.limit(2))).scalars().all()
    return users[0] if len(users) == 1 else None            # ambiguous (two accounts share a case-folded email) -> send nothing


async def _process_reset_request(identifier: str, ip: str | None) -> None:
    try:
        async with AsyncSessionLocal() as db:
            user = await _find_user(db, identifier)
            if user is None:
                return
            if not user.is_active or not user.email:
                logger.info("password reset not sent: account inactive or has no email (user_id=%s)", user.id)
                return
            if user.email_verified_at is None:
                logger.info("password reset not sent: email address not verified (user_id=%s)", user.id)
                return
            ttl = timedelta(minutes=settings.PASSWORD_RESET_TOKEN_TTL_MINUTES)
            raw = await auth_tokens.issue_token(db, user, auth_tokens.PURPOSE_RESET, ttl, ip)
            if raw is None:
                logger.info("password reset not sent: hourly limit reached (user_id=%s)", user.id)
                return
            link = auth_tokens.build_link("reset-password", raw)
            if link is None:
                await db.rollback()
                logger.warning("password reset not sent: FRONTEND_BASE_URL is not configured")
                return
            await db.commit()
            to_email, username, user_id = user.email, user.username, user.id
        sent = await auth_mail.send_password_reset(to_email, username, link, settings.PASSWORD_RESET_TOKEN_TTL_MINUTES)
        logger.info("password reset email %s (user_id=%s)", "sent" if sent else "FAILED to send", user_id)
    except Exception as exc:                                  # never leak: SQLAlchemy errors can carry bound parameters
        logger.error("password reset processing failed (%s)", type(exc).__name__)


@router.post("/password-reset/request", status_code=status.HTTP_202_ACCEPTED)
@limiter.limit("5/hour")
async def request_password_reset(request: Request, body: PasswordResetRequest, background: BackgroundTasks):
    background.add_task(_process_reset_request, body.identifier, _client_ip(request))
    return {"message": _generic_request_message()}


# ── Check / use a reset link ──────────────────────────────────────────────────────────────────────────────────────────────────

async def _user_for_reset(db: AsyncSession, user_id: int, token_email: str | None) -> User | None:
    user = await db.get(User, user_id)
    if not user or not user.is_active or user.email_verified_at is None or not user.email or user.email != token_email:
        return None
    return user


@router.post("/password-reset/validate")
@limiter.limit("20/hour")
async def validate_reset_token(request: Request, body: TokenBody, db: AsyncSession = Depends(get_db)):
    row = await auth_tokens.peek_token(db, body.token, auth_tokens.PURPOSE_RESET)
    valid = bool(row and await _user_for_reset(db, row.user_id, row.email))
    return {"valid": valid}


async def _notify_password_changed(to_email: str, username: str) -> None:
    try:
        await auth_mail.send_password_changed(to_email, username)
    except Exception as exc:
        logger.error("password-changed notice failed (%s)", type(exc).__name__)


@router.post("/password-reset/confirm")
@limiter.limit("10/hour")
async def confirm_password_reset(request: Request, body: PasswordResetConfirm, background: BackgroundTasks, db: AsyncSession = Depends(get_db)):
    consumed = await auth_tokens.consume_token(db, body.token, auth_tokens.PURPOSE_RESET)
    if consumed is None:
        raise _invalid_link()
    user = await _user_for_reset(db, *consumed)
    if user is None:
        await db.rollback()
        raise _invalid_link()
    errors = validate_new_password(body.new_password, user.username, user.email)
    if errors:
        await db.rollback()                                   # the link is NOT used up by a too-weak password: the user can try again
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail={"code": "weak_password", "message": errors[0], "errors": errors})

    user.hashed_password = hash_password(body.new_password)
    user.token_version = user.token_version + 1               # every JWT issued before this carries the old value and is now rejected
    await auth_tokens.revoke_open_tokens(db, user.id, auth_tokens.PURPOSE_RESET)
    await db.commit()
    logger.info("password reset completed (user_id=%s)", user.id)
    background.add_task(_notify_password_changed, user.email, user.username)
    return {"message": "Your password has been updated. Please sign in with your new password."}


# ── Email ownership verification ──────────────────────────────────────────────────────────────────────────────────────────────

async def _process_verification_request(user_id: int, ip: str | None) -> None:
    try:
        async with AsyncSessionLocal() as db:
            user = await db.get(User, user_id)
            if user is None or not user.is_active or not user.email or user.email_verified_at is not None:
                return
            raw = await auth_tokens.issue_token(db, user, auth_tokens.PURPOSE_VERIFY, timedelta(hours=settings.EMAIL_VERIFY_TOKEN_TTL_HOURS), ip)
            if raw is None:
                logger.info("verification email not sent: hourly limit reached (user_id=%s)", user.id)
                return
            link = auth_tokens.build_link("verify-email", raw)
            if link is None:
                await db.rollback()
                logger.warning("verification email not sent: FRONTEND_BASE_URL is not configured")
                return
            await db.commit()
            to_email, username = user.email, user.username
        sent = await auth_mail.send_email_verification(to_email, username, link, settings.EMAIL_VERIFY_TOKEN_TTL_HOURS)
        logger.info("verification email %s (user_id=%s)", "sent" if sent else "FAILED to send", user_id)
    except Exception as exc:
        logger.error("verification processing failed (%s)", type(exc).__name__)


@router.post("/email/verification/request", status_code=status.HTTP_202_ACCEPTED)
@limiter.limit("5/hour")
async def request_email_verification(request: Request, response: Response, background: BackgroundTasks, user: User = Depends(current_user)):
    if user.email_verified_at is not None:
        response.status_code = status.HTTP_200_OK
        return {"message": "Your email address is already verified.", "verified": True}
    background.add_task(_process_verification_request, user.id, _client_ip(request))
    return {"message": "A confirmation link is on its way to the email address on your account.", "verified": False}


@router.post("/email/verification/confirm")
@limiter.limit("10/hour")
async def confirm_email_verification(request: Request, body: TokenBody, db: AsyncSession = Depends(get_db)):
    consumed = await auth_tokens.consume_token(db, body.token, auth_tokens.PURPOSE_VERIFY)
    if consumed is None:
        raise _invalid_link()
    user_id, token_email = consumed
    user = await db.get(User, user_id)
    if not user or not user.is_active or not user.email or user.email != token_email:     # the address changed after this link was sent
        await db.rollback()
        raise _invalid_link()
    if user.email_verified_at is None:
        await db.execute(update(User).where(User.id == user.id).values(email_verified_at=func.now()))
    await db.commit()
    logger.info("email address verified (user_id=%s)", user.id)
    return {"message": "Your email address is verified.", "verified": True}
