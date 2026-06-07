"""Async FFmpeg operations via subprocess — never blocks the event loop."""
import asyncio
import uuid
from pathlib import Path

from app.config import settings


async def _run(cmd: list[str]) -> None:
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(f"FFmpeg failed (code {proc.returncode}): {stderr.decode()[-500:]}")


def _out(user_id: int, suffix: str) -> Path:
    d = Path(settings.UPLOAD_DIR) / str(user_id)
    d.mkdir(parents=True, exist_ok=True)
    return d / f"{uuid.uuid4().hex}.{suffix}"


async def extract_audio(input_path: str, user_id: int) -> Path:
    out = _out(user_id, "mp3")
    await _run(["ffmpeg", "-y", "-i", input_path, "-vn", "-acodec", "libmp3lame", "-ab", "192k", str(out)])
    return out


async def add_subtitles(input_path: str, srt_path: str, user_id: int) -> Path:
    out = _out(user_id, "mp4")
    # subtitles filter requires escaped path on some platforms
    safe = srt_path.replace("\\", "/").replace(":", "\\:")
    await _run([
        "ffmpeg", "-y", "-i", input_path,
        "-vf", f"subtitles={safe}",
        "-c:a", "copy",
        str(out),
    ])
    return out


async def resize(input_path: str, width: int, height: int, user_id: int) -> Path:
    out = _out(user_id, "mp4")
    # Force divisible-by-2 dimensions required by libx264
    vf = f"scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2"
    await _run(["ffmpeg", "-y", "-i", input_path, "-vf", vf, "-c:a", "copy", str(out)])
    return out


async def trim(input_path: str, start: float, end: float, user_id: int) -> Path:
    out = _out(user_id, "mp4")
    await _run([
        "ffmpeg", "-y",
        "-ss", str(start),
        "-to", str(end),
        "-i", input_path,
        "-c", "copy",
        str(out),
    ])
    return out


async def convert(input_path: str, output_format: str, user_id: int) -> Path:
    out = _out(user_id, output_format.lstrip("."))
    await _run(["ffmpeg", "-y", "-i", input_path, str(out)])
    return out
