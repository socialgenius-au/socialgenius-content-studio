"""Google Business Profile (formerly My Business) post creation."""
import httpx

from app.config import settings

BASE = "https://mybusiness.googleapis.com/v4"


def _headers() -> dict:
    return {
        "Authorization": f"Bearer {settings.GMB_ACCESS_TOKEN}",
        "Content-Type": "application/json",
    }


async def create_local_post(
    text: str,
    call_to_action_type: str = "LEARN_MORE",
    call_to_action_url: str | None = None,
    media_url: str | None = None,
) -> dict:
    if not settings.GMB_ACCESS_TOKEN or not settings.GMB_LOCATION_NAME:
        raise ValueError("GMB_ACCESS_TOKEN and GMB_LOCATION_NAME must be set")

    payload: dict = {
        "languageCode": "en",
        "summary": text,
        "topicType": "STANDARD",
    }

    if call_to_action_url:
        payload["callToAction"] = {
            "actionType": call_to_action_type,
            "url": call_to_action_url,
        }

    if media_url:
        payload["media"] = [{"mediaFormat": "PHOTO", "sourceUrl": media_url}]

    url = f"{BASE}/{settings.GMB_LOCATION_NAME}/localPosts"
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(url, json=payload, headers=_headers())
        r.raise_for_status()
        data = r.json()

    return {
        "post_name": data.get("name", ""),
        "state": data.get("state", "LIVE"),
        "create_time": data.get("createTime"),
    }
