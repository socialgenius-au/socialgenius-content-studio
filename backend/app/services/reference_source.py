"""Import a licensed Pexels video through its official API and fixed media hosts."""
import re
from urllib.parse import urlsplit

import aiofiles
import httpx

from app.config import settings

_MEDIA_HOSTS = {"videos.pexels.com", "static-videos.pexels.com"}


class SourceUnavailable(ValueError):
    pass


def _https_from(url: str, hosts: set[str]) -> bool:
    try:
        parsed = urlsplit(url)
        return parsed.scheme == "https" and parsed.netloc.lower() in hosts and not parsed.fragment
    except ValueError:
        return False


async def pexels_json(path: str, params=None) -> dict:
    if not settings.PEXELS_API_KEY:
        raise SourceUnavailable("Pexels needs an authorised PEXELS_API_KEY on this environment.")
    async with httpx.AsyncClient(follow_redirects=False, timeout=20, trust_env=False) as client:
        response = await client.get(
            f"https://api.pexels.com{path}",
            headers={"Authorization": settings.PEXELS_API_KEY}, params=params,
        )
        response.raise_for_status()
        return response.json()


def pexels_video_rendition(item: dict) -> dict:
    files = [
        entry for entry in item.get("video_files", [])
        if entry.get("file_type") == "video/mp4"
        and _https_from(entry.get("link") or "", _MEDIA_HOSTS)
    ]
    if not files:
        raise SourceUnavailable("Pexels did not supply a supported MP4 rendition.")
    return min(files, key=lambda entry: abs((entry.get("width") or 0) - 960))


async def download_published_video(url: str, destination) -> tuple[str, int, dict]:
    if not _https_from(url, {"pexels.com", "www.pexels.com"}):
        raise SourceUnavailable("Use a published Pexels video URL or upload your licensed video file.")
    match = re.fullmatch(r"/video/(?:[a-zA-Z0-9-]*-)?([1-9][0-9]{0,14})/?", urlsplit(url).path)
    if not match:
        raise SourceUnavailable("Use the Pexels video page URL.")
    video_id = match.group(1)
    item = await pexels_json(f"/v1/videos/videos/{video_id}")
    rendition = pexels_video_rendition(item)
    async with httpx.AsyncClient(follow_redirects=False, timeout=20, trust_env=False) as client:
        max_size = min(settings.MAX_UPLOAD_SIZE_MB, 100) * 1024 * 1024
        size = 0
        async with client.stream("GET", rendition["link"]) as media:
            media.raise_for_status()
            if media.headers.get("content-type", "").split(";")[0] not in {"video/mp4", "application/octet-stream"}:
                raise SourceUnavailable("The provider did not return an MP4.")
            async with aiofiles.open(destination, "wb") as output:
                async for chunk in media.aiter_bytes(65536):
                    size += len(chunk)
                    if size > max_size:
                        raise SourceUnavailable("The supplied rendition exceeds the import limit. Upload a smaller copy.")
                    await output.write(chunk)
        if not size:
            raise SourceUnavailable("The provider returned an empty file.")
    async with aiofiles.open(destination, "rb") as output:
        header = await output.read(12)
    if len(header) < 12 or header[4:8] != b"ftyp":
        raise SourceUnavailable("The provider rendition is not a supported MP4 container.")
    source = f"https://www.pexels.com/video/{video_id}/"
    published = {key: item[key] for key in ("title", "description", "published_at")
                 if isinstance(item.get(key), str) and item[key].strip()}
    published.update({key: item[key] for key in ("views", "likes", "comments", "shares")
                      if type(item.get(key)) is int and item[key] >= 0})
    if isinstance(item.get("hashtags"), list):
        published["hashtags"] = [tag for tag in item["hashtags"] if isinstance(tag, str) and tag.startswith("#")]
    return source, size, {
        **published,
        "provider": "Pexels",
        "provider_video_id": video_id,
        "creator": (item.get("user") or {}).get("name"),
        "provider_duration_seconds": item.get("duration"),
    }
