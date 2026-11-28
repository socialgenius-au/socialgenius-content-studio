"""Materialise explicitly selected project media through the Studio's existing asset store."""
from contextlib import asynccontextmanager
from pathlib import Path
from tempfile import TemporaryDirectory
from uuid import uuid4

import aiofiles
import httpx
from PIL import Image

from app.config import settings
from app.models.asset import Asset
from app.services.media_storage import upload_root
from app.services.reference_source import SourceUnavailable, _https_from
from app.services.virtual_assets import HOSTS

IMAGE_EXTENSIONS = {"JPEG": ("jpg", "image/jpeg"), "PNG": ("png", "image/png"), "WEBP": ("webp", "image/webp")}


async def fetch_media(details: dict, destination: Path) -> tuple[int, str, str]:
    url = details["media"]
    if not _https_from(url, HOSTS[details["provider"]]):
        raise SourceUnavailable("Invalid provider media URL")
    limit = min(settings.MAX_UPLOAD_SIZE_MB, 100) * 1024 * 1024
    size = 0
    async with httpx.AsyncClient(timeout=30, follow_redirects=False) as client:
        async with client.stream("GET", url) as response:
            response.raise_for_status()
            async with aiofiles.open(destination, "wb") as output:
                async for chunk in response.aiter_bytes(65536):
                    size += len(chunk)
                    if size > limit:
                        raise SourceUnavailable("Provider media exceeds the import limit")
                    await output.write(chunk)
    if details["kind"] == "video":
        with destination.open("rb") as stream:
            if stream.read(12)[4:8] != b"ftyp":
                raise SourceUnavailable("Provider media is not an MP4")
        return size, "mp4", "video/mp4"
    try:
        with Image.open(destination) as image:
            extension, mime = IMAGE_EXTENSIONS[image.format]
            image.verify()
    except (OSError, KeyError, Image.DecompressionBombError) as exc:
        raise SourceUnavailable("Provider media is not a supported image") from exc
    return size, extension, mime


@asynccontextmanager
async def stage_project_media(details: dict, user_id: int):
    """Keep scratch files outside /uploads. Commit at the caller's transaction boundary."""
    user_dir = upload_root() / str(user_id)
    user_dir.mkdir(parents=True, exist_ok=True)
    destination = None
    try:
        with TemporaryDirectory(prefix="sg-virtual-asset-") as temporary:
            temporary_file = Path(temporary) / "media"
            size, extension, mime = await fetch_media(details, temporary_file)
            filename = f"{uuid4().hex}.{extension}"
            destination = user_dir / filename
            # Copy to a private temporary name on the destination filesystem before publishing.
            import shutil
            staging = user_dir / f".{filename}.part"
            try:
                shutil.copyfile(temporary_file, staging)
                staging.replace(destination)
            finally:
                staging.unlink(missing_ok=True)
        yield Asset(user_id=user_id, original_filename=f"{details['title']}.{extension}",
                    stored_filename=filename, file_path=str(destination), file_type=details["kind"],
                    mime_type=mime, file_size=size)
    except BaseException:
        if destination:
            destination.unlink(missing_ok=True)
        raise
