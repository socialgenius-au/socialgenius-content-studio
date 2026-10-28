"""Issue / check / consume the one-time tokens behind Forgot Password and email verification (model: app/models/auth_token.py).

Security properties
  * 256-bit random tokens (secrets.token_urlsafe(32)); only the SHA-256 hash is stored.
  * Expiry and "already used" are judged by the DATABASE clock inside a single atomic UPDATE ... RETURNING, so a token can be consumed at
    most once even under concurrent requests, and application clock skew cannot extend it.
  * Issuing a new token supersedes the user's earlier unused tokens of the same purpose, and each account is capped at
    MAX_TOKENS_PER_HOUR per purpose (callers treat "capped" exactly like "no such user" so nothing is revealed).
  * Links are built from the configured FRONTEND_BASE_URL only (never from a request header). The token travels in the URL fragment, which
    browsers never send to servers, so it stays out of access logs and Referer headers; the frontend POSTs it in a request body.
"""
from __future__ import annotations

import hashlib
import re
import secrets
from datetime import timedelta

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.auth_token import AuthToken
from app.models.user import User

PURPOSE_RESET = "password_reset"
PURPOSE_VERIFY = "email_verify"
MAX_TOKENS_PER_HOUR = 3
_TOKEN_SHAPE = re.compile(r"^[A-Za-z0-9_-]{20,200}$")


def new_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def build_link(path: str, raw_token: str) -> str | None:
    """https://frontend/<path>#token=<raw>. None while FRONTEND_BASE_URL is not configured (then no email is sent)."""
    base = (settings.FRONTEND_BASE_URL or "").strip().rstrip("/")
    if not base.startswith(("https://", "http://")):
        return None
    return f"{base}/{path.lstrip('/')}#token={raw_token}"


async def issue_token(db: AsyncSession, user: User, purpose: str, ttl: timedelta, ip: str | None = None) -> str | None:
    """Returns the raw token (to be emailed), or None if this account already hit its hourly cap. Caller commits."""
    recent = (await db.execute(
        select(func.count()).select_from(AuthToken).where(
            AuthToken.user_id == user.id, AuthToken.purpose == purpose, AuthToken.created_at > func.now() - timedelta(hours=1)
        )
    )).scalar_one()
    if recent >= MAX_TOKENS_PER_HOUR:
        return None
    await db.execute(
        update(AuthToken).where(AuthToken.user_id == user.id, AuthToken.purpose == purpose, AuthToken.used_at.is_(None)).values(used_at=func.now())
    )
    raw = new_token()
    db.add(AuthToken(
        user_id=user.id, purpose=purpose, token_hash=hash_token(raw), email=user.email,
        expires_at=func.now() + ttl, request_ip=(ip or None) and ip[:45],
    ))
    await db.flush()
    return raw


async def peek_token(db: AsyncSession, raw: str, purpose: str) -> AuthToken | None:
    """Read-only check (does NOT consume): is this token currently usable?"""
    if not _TOKEN_SHAPE.match(raw or ""):
        return None
    return (await db.execute(
        select(AuthToken).where(
            AuthToken.token_hash == hash_token(raw), AuthToken.purpose == purpose,
            AuthToken.used_at.is_(None), AuthToken.expires_at > func.now(),
        )
    )).scalar_one_or_none()


async def consume_token(db: AsyncSession, raw: str, purpose: str) -> tuple[int, str | None] | None:
    """Atomically mark the token used. Returns (user_id, email_it_was_sent_to), or None if unknown / expired / already used.
    Runs inside the caller's transaction: roll back and the token is usable again."""
    if not _TOKEN_SHAPE.match(raw or ""):
        return None
    row = (await db.execute(
        update(AuthToken)
        .where(AuthToken.token_hash == hash_token(raw), AuthToken.purpose == purpose,
               AuthToken.used_at.is_(None), AuthToken.expires_at > func.now())
        .values(used_at=func.now())
        .returning(AuthToken.user_id, AuthToken.email)
    )).first()
    return (row.user_id, row.email) if row else None


async def revoke_open_tokens(db: AsyncSession, user_id: int, purpose: str | None = None) -> None:
    stmt = update(AuthToken).where(AuthToken.user_id == user_id, AuthToken.used_at.is_(None))
    if purpose:
        stmt = stmt.where(AuthToken.purpose == purpose)
    await db.execute(stmt.values(used_at=func.now()))
