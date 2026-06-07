"""Job completion/failure email notifications via Resend (best-effort, silently no-ops when unconfigured)."""
import httpx

from app.config import settings

_RESEND_URL = "https://api.resend.com/emails"


async def send_job_notification(to_email: str, job_title: str, status: str, job_id: int) -> None:
    if not settings.RESEND_API_KEY or not to_email:
        return

    icon = "✅" if status == "done" else "❌"
    subject = f"{icon} Job {status.capitalize()}: {job_title}"

    html = f"""
<div style="font-family:Inter,sans-serif;max-width:540px;margin:0 auto;padding:32px;background:#F5F0E8;border-radius:12px;">
  <h2 style="color:#1E3D2A;margin:0 0 8px;">SocialGenius Content Studio</h2>
  <p style="color:#888;margin:0 0 24px;font-size:13px;">Job notification</p>
  <div style="background:#fff;border-radius:8px;padding:24px;border:1px solid #ede9e0;">
    <p style="margin:0 0 8px;font-size:16px;font-weight:700;color:#1E3D2A;">{job_title}</p>
    <p style="margin:0;font-size:14px;color:#555;">Status: <strong style="color:{'#27ae60' if status == 'done' else '#c0392b'};">{status}</strong></p>
  </div>
  <p style="margin:24px 0 0;font-size:12px;color:#aaa;text-align:center;">Job #{job_id} · SocialGenius</p>
</div>
"""

    try:
        async with httpx.AsyncClient(timeout=8) as client:
            await client.post(
                _RESEND_URL,
                headers={
                    "Authorization": f"Bearer {settings.RESEND_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "from": settings.NOTIFY_FROM_EMAIL,
                    "to": [to_email],
                    "subject": subject,
                    "html": html,
                },
            )
    except Exception:
        pass  # notifications are best-effort — never let a send failure crash the job
