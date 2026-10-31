"""The three security emails, in the same brand look as the existing job-notification email (cream card, deep-green headings).
Each returns True only if Resend accepted the message (see email.send_auth_email). Links are passed in already-built; nothing here logs them."""
from __future__ import annotations

import html
from datetime import datetime, timezone

from app.services import email as email_svc

_GREEN, _GOLD, _CREAM = "#1E3D2A", "#C89A2E", "#F5F0E8"


def _wrap(heading: str, body_html: str, button_label: str | None = None, link: str | None = None, footer: str = "") -> str:
    button = (
        f'<p style="margin:24px 0;"><a href="{html.escape(link, quote=True)}" style="display:inline-block;background:{_GREEN};color:{_CREAM};'
        f'text-decoration:none;font-weight:700;padding:13px 22px;border-radius:8px;">{html.escape(button_label)}</a></p>'
        if link and button_label else ""
    )
    return (
        f'<div style="font-family:Inter,Arial,sans-serif;max-width:540px;margin:0 auto;padding:32px;background:{_CREAM};border-radius:12px;">'
        f'<h2 style="color:{_GREEN};margin:0 0 4px;">SocialGenius</h2>'
        f'<p style="color:{_GOLD};margin:0 0 24px;font-size:12px;font-weight:700;letter-spacing:3px;text-transform:uppercase;">Content Studio</p>'
        f'<div style="background:#fff;border-radius:8px;padding:24px;border:1px solid #ede9e0;">'
        f'<p style="margin:0 0 12px;font-size:17px;font-weight:700;color:{_GREEN};">{html.escape(heading)}</p>{body_html}{button}</div>'
        f'<p style="margin:20px 0 0;font-size:12px;color:#888;text-align:center;">{html.escape(footer)}</p></div>'
    )


async def send_password_reset(to_email: str, username: str, link: str, ttl_minutes: int) -> bool:
    body = (f'<p style="margin:0 0 8px;color:#444;font-size:14px;">Hi {html.escape(username)}, we received a request to reset your Content Studio '
            f'password. This link works once and expires in {ttl_minutes} minutes.</p>')
    text = (f"Hi {username},\n\nWe received a request to reset your SocialGenius Content Studio password.\n"
            f"Open this link (works once, expires in {ttl_minutes} minutes):\n{link}\n\n"
            "If you didn't ask for this, you can ignore this email; your password has not changed.\n")
    return await email_svc.send_auth_email(
        to_email, "Reset your SocialGenius password",
        _wrap("Reset your password", body, "Choose a new password", link, "If you didn't request this, you can safely ignore this email."),
        text,
    )


async def send_password_changed(to_email: str, username: str) -> bool:
    when = datetime.now(timezone.utc).strftime("%d %b %Y, %H:%M UTC")
    body = (f'<p style="margin:0;color:#444;font-size:14px;">Hi {html.escape(username)}, your Content Studio password was changed on {when}. '
            "You have been signed out everywhere. If this wasn't you, contact your administrator straight away.</p>")
    text = (f"Hi {username},\n\nYour SocialGenius Content Studio password was changed on {when}.\n"
            "You have been signed out of all devices. If this wasn't you, contact your administrator straight away.\n")
    return await email_svc.send_auth_email(to_email, "Your SocialGenius password was changed", _wrap("Password changed", body, footer="Security notice"), text)


async def send_email_verification(to_email: str, username: str, link: str, ttl_hours: int) -> bool:
    body = (f'<p style="margin:0 0 8px;color:#444;font-size:14px;">Hi {html.escape(username)}, confirm that this is your email address so we can '
            f'send you password-reset links. This link works once and expires in {ttl_hours} hours.</p>')
    text = (f"Hi {username},\n\nConfirm your email address for SocialGenius Content Studio (works once, expires in {ttl_hours} hours):\n{link}\n\n"
            "If you didn't expect this, you can ignore this email.\n")
    return await email_svc.send_auth_email(
        to_email, "Confirm your SocialGenius email address",
        _wrap("Confirm your email address", body, "Confirm email address", link, "If you didn't expect this, you can safely ignore this email."),
        text,
    )
