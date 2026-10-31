r"""Set an account's recovery email address and start proving ownership of it.   *** Run only after separate, explicit approval. ***

Run INSIDE the backend container (it needs that service's DATABASE_URL, RESEND_API_KEY and FRONTEND_BASE_URL), e.g.

  python scripts/set_recovery_email.py --username ayub --email someone@example.com                      # dry run: changes nothing
  python scripts/set_recovery_email.py --username ayub --email someone@example.com --apply --confirm-username ayub

What --apply does, in order
  1. Pre-flight: refuses unless email sending and the frontend link are configured (otherwise the address would change but could never
     be verified). Nothing is written if this fails.
  2. ONE transaction: lock the user's row, refuse if another account already uses that address, then
         UPDATE users SET email = <new>, email_verified_at = NULL WHERE id = <that user>
     and cancel any open reset/verification links (they were addressed to the old email). Nothing else is touched: not the password,
     role, active flag, username or any other user. If the address is already set and unverified, it skips the update and just resends.
  3. Emails a one-time verification link to the NEW address. The address stays UNVERIFIED (so no password-reset link can be sent to
     it) until its owner opens that link. Links are never printed.

It prints email addresses only in masked form (s***@gmail.com), and never a token, link, password or hash.
"""
from __future__ import annotations

import argparse
import asyncio
import re
import sys
from datetime import timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select, update                       # noqa: E402

from app.config import settings                              # noqa: E402
from app.models.user import User                             # noqa: E402
from app.services import auth_mail, auth_tokens              # noqa: E402

_EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,}$")


def mask(email: str | None) -> str:
    if not email or "@" not in email:
        return "<none>"
    local, domain = email.split("@", 1)
    return f"{local[:1]}***@{domain}"


async def run(args: argparse.Namespace, maker) -> int:
    new_email = args.email.strip().lower()
    if not _EMAIL_RE.match(new_email):
        print("ABORT: that is not a valid email address; nothing was changed.")
        return 2
    async with maker() as db:
        user = (await db.execute(select(User).where(User.username == args.username))).scalar_one_or_none()
        if user is None:
            print(f"ABORT: no user named {args.username!r}; nothing was changed.")
            return 2
        clash = (await db.execute(select(User.id).where(User.email == new_email, User.id != user.id))).first()
        print(f"user         : {user.username} (id {user.id}, role {user.role}, active={user.is_active})")
        print(f"current email: {mask(user.email)}  verified={user.email_verified_at is not None}")
        print(f"new email    : {mask(new_email)}")
        if clash:
            print("ABORT: another account already uses that address; nothing was changed.")
            return 2
        already_set = user.email == new_email
        if already_set and user.email_verified_at is not None:
            print("Nothing to do: that address is already set and verified.")
            return 0
        print("plan         : " + ("resend the verification link (address already set)" if already_set
                                   else "set the new address (unverified), cancel open links, send a verification link"))
        if not args.apply:
            print("DRY RUN - nothing was changed. Re-run with --apply --confirm-username <username> to proceed.")
            return 0
        if args.confirm_username != args.username:
            print("ABORT: --confirm-username must repeat the username exactly; nothing was changed.")
            return 2
        if not settings.RESEND_API_KEY or auth_tokens.build_link("verify-email", "x") is None:
            print("ABORT: email sending or FRONTEND_BASE_URL is not configured here, so the new address could not be verified; nothing was changed.")
            return 2

        if not already_set:
            locked = (await db.execute(select(User).where(User.id == user.id).with_for_update())).scalar_one()
            await db.execute(update(User).where(User.id == locked.id).values(email=new_email, email_verified_at=None))
            await auth_tokens.revoke_open_tokens(db, locked.id)
            await db.commit()
            await db.refresh(user)
            print("email updated (unverified); open links cancelled.")

        raw = await auth_tokens.issue_token(db, user, auth_tokens.PURPOSE_VERIFY, timedelta(hours=settings.EMAIL_VERIFY_TOKEN_TTL_HOURS), "ops-script")
        if raw is None:
            await db.rollback()
            print("NOT SENT: this account already received 3 verification links in the last hour; try again later.")
            return 1
        link = auth_tokens.build_link("verify-email", raw)
        await db.commit()
        username, to_email = user.username, user.email
    sent = await auth_mail.send_email_verification(to_email, username, link, settings.EMAIL_VERIFY_TOKEN_TTL_HOURS)
    print("verification email: " + ("SENT" if sent else "FAILED to send (the address is set but unverified; re-run to retry)"))
    return 0 if sent else 1


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--username", required=True)
    ap.add_argument("--email", required=True)
    ap.add_argument("--apply", action="store_true", help="actually make the change (default is a dry run)")
    ap.add_argument("--confirm-username", default="", help="with --apply: repeat the username as a typo guard")
    args = ap.parse_args()
    from app.database import AsyncSessionLocal
    return asyncio.run(run(args, AsyncSessionLocal))


if __name__ == "__main__":
    sys.exit(main())
