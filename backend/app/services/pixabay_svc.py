"""Pixabay free stock image/video search."""
import httpx

from app.config import settings

IMAGE_URL = "https://pixabay.com/api/"
VIDEO_URL = "https://pixabay.com/api/videos/"


async def search_images(
    query: str,
    image_type: str = "all",  # photo | illustration | vector | all
    per_page: int = 20,
    page: int = 1,
    safesearch: bool = True,
) -> dict:
    if not settings.PIXABAY_API_KEY:
        raise ValueError("PIXABAY_API_KEY must be set")

    params = {
        "key": settings.PIXABAY_API_KEY,
        "q": query,
        "image_type": image_type,
        "per_page": min(per_page, 200),
        "page": page,
        "safesearch": "true" if safesearch else "false",
    }
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(IMAGE_URL, params=params)
        r.raise_for_status()
        data = r.json()

    return {
        "total": data.get("total", 0),
        "total_hits": data.get("totalHits", 0),
        "hits": data.get("hits", []),
    }


async def search_videos(query: str, per_page: int = 20, page: int = 1) -> dict:
    if not settings.PIXABAY_API_KEY:
        raise ValueError("PIXABAY_API_KEY must be set")

    params = {
        "key": settings.PIXABAY_API_KEY,
        "q": query,
        "per_page": min(per_page, 200),
        "page": page,
    }
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(VIDEO_URL, params=params)
        r.raise_for_status()
        data = r.json()

    return {
        "total": data.get("total", 0),
        "total_hits": data.get("totalHits", 0),
        "hits": data.get("hits", []),
    }
