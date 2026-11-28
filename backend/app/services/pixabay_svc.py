"""Official Pixabay search with a shared 24-hour response cache."""
import asyncio
import time

import httpx

from app.config import settings

IMAGE_URL = "https://pixabay.com/api/"
VIDEO_URL = "https://pixabay.com/api/videos/"
_cache: dict[tuple, tuple[float, dict]] = {}
_lock = asyncio.Lock()


async def lookup(url: str, **params) -> dict:
    if not settings.PIXABAY_API_KEY:
        raise ValueError("PIXABAY_API_KEY must be set")
    key = (url, tuple(sorted(params.items())))
    async with _lock:
        now = time.monotonic()
        hit = _cache.get(key)
        if hit and hit[0] > now:
            return hit[1]
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.get(url, params={**params, "key": settings.PIXABAY_API_KEY})
            if response.is_error:
                raise ValueError(f"Pixabay API returned HTTP {response.status_code}")
            data = response.json()
        for expired in [entry for entry, value in _cache.items() if value[0] <= now]:
            del _cache[expired]
        if len(_cache) >= 4096:
            raise ValueError("Pixabay search cache is full. Try again later.")
        result = {"total": data.get("total", 0), "total_hits": data.get("totalHits", 0), "hits": data.get("hits", [])}
        _cache[key] = (time.monotonic() + 86400, result)
        return result


async def search_images(query: str, image_type: str = "all", per_page: int = 20,
                        page: int = 1, safesearch: bool = True) -> dict:
    return await lookup(IMAGE_URL, q=query, image_type=image_type, per_page=min(per_page, 200),
                        page=page, safesearch=str(safesearch).lower())


async def search_videos(query: str, per_page: int = 20, page: int = 1) -> dict:
    return await lookup(VIDEO_URL, q=query, per_page=min(per_page, 200), page=page, safesearch="true")
