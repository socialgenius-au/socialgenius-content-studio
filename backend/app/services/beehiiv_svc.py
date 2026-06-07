"""Beehiiv newsletter publishing via their REST API v2."""
import httpx

from app.config import settings

BASE = "https://api.beehiiv.com/v2"


def _headers() -> dict:
    return {"Authorization": f"Bearer {settings.BEEHIIV_API_KEY}", "Content-Type": "application/json"}


async def create_post(
    title: str,
    content_html: str,
    subtitle: str = "",
    status: str = "draft",
    send_at: str | None = None,
) -> dict:
    if not settings.BEEHIIV_API_KEY or not settings.BEEHIIV_PUBLICATION_ID:
        raise ValueError("BEEHIIV_API_KEY and BEEHIIV_PUBLICATION_ID must be set")

    payload: dict = {
        "title": title,
        "subtitle": subtitle,
        "status": status,
        "content": {"html": content_html},
    }
    if send_at:
        payload["send_at"] = send_at

    url = f"{BASE}/publications/{settings.BEEHIIV_PUBLICATION_ID}/posts"
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(url, json=payload, headers=_headers())
        r.raise_for_status()
        data = r.json().get("data", {})

    return {
        "post_id": data.get("id", ""),
        "status": data.get("status", status),
        "web_url": data.get("web_url"),
    }
