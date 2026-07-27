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


async def extract_thumbnail(input_path: str, user_id: int, timestamp: float = 3.0) -> Path:
    """Extract a single JPEG frame from a video at `timestamp` seconds."""
    out = _out(user_id, "jpg")
    await _run([
        "ffmpeg", "-y",
        "-ss", str(timestamp),
        "-i", input_path,
        "-frames:v", "1",
        "-q:v", "3",
        str(out),
    ])
    return out


TRANSITION_MAP = {
    "cut": None,
    "dissolve": "dissolve",
    "whip_pan": "wiperight",
    "fade_to_black": "fadeblack",
    "zoom_punch": "zoomin",
}


async def _get_duration(path: str) -> float:
    proc = await asyncio.create_subprocess_exec(
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", path,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    out, _ = await proc.communicate()
    return float(out.decode().strip())


async def merge_with_transitions(
    clip_paths: list[str],
    transition: str,
    transition_duration: float,
    user_id: int,
) -> Path:
    """Merge 2+ clips end-to-end with a transition between each pair."""
    if len(clip_paths) < 2:
        raise RuntimeError("merge requires at least 2 clips")

    xfade_name = TRANSITION_MAP.get(transition, "fade")
    out = _out(user_id, "mp4")

    if xfade_name is None:
        list_file = _out(user_id, "txt")
        list_file.write_text("\n".join(f"file '{p}'" for p in clip_paths))
        await _run([
            "ffmpeg", "-y", "-f", "concat", "-safe", "0",
            "-i", str(list_file), "-c", "copy", str(out),
        ])
        return out

    durations = [await _get_duration(p) for p in clip_paths]
    inputs: list[str] = []
    for p in clip_paths:
        inputs += ["-i", p]

    filter_parts = []
    running = durations[0]
    v_label = "0:v"
    a_label = "0:a"

    for i in range(1, len(clip_paths)):
        offset = running - transition_duration
        next_v = f"v{i}"
        next_a = f"a{i}"
        filter_parts.append(
            f"[{v_label}][{i}:v]xfade=transition={xfade_name}:"
            f"duration={transition_duration}:offset={offset}[{next_v}]"
        )
        filter_parts.append(
            f"[{a_label}][{i}:a]acrossfade=d={transition_duration}[{next_a}]"
        )
        v_label, a_label = next_v, next_a
        running = running + durations[i] - transition_duration

    filter_complex = ";".join(filter_parts)

    await _run([
        "ffmpeg", "-y", *inputs,
        "-filter_complex", filter_complex,
        "-map", f"[{v_label}]", "-map", f"[{a_label}]",
        "-c:v", "libx264", "-c:a", "aac",
        str(out),
    ])
    return out


def _escape_drawtext(text: str) -> str:
    """Escape characters that are special inside an ffmpeg drawtext argument."""
    return (
        text.replace("\\", "\\\\")
        .replace(":", "\\:")
        .replace("'", "\\'")
        .replace(",", "\\,")
    )


async def add_text_overlays(
    input_path: str,
    overlays: list[dict],
    user_id: int,
) -> Path:
    """Burn one or more timed text overlays into a video.

    Each overlay dict: {text, start, end, x?, y?, font_size?, font_color?}
    x/y default to horizontal-centered near the bottom of the frame.
    """
    if not overlays:
        raise RuntimeError("add_text_overlays requires at least one overlay")

    out = _out(user_id, "mp4")
    drawtext_filters = []
    for ov in overlays:
        text = _escape_drawtext(str(ov["text"]))
        start = ov["start"]
        end = ov["end"]
        x = ov.get("x", "(w-text_w)/2")
        y = ov.get("y", "h-th-40")
        font_size = ov.get("font_size", 42)
        font_color = ov.get("font_color", "white")
        drawtext_filters.append(
            f"drawtext=text='{text}':x={x}:y={y}:fontsize={font_size}:fontcolor={font_color}:"
            f"box=1:boxcolor=black@0.5:boxborderw=8:"
            f"enable='between(t,{start},{end})'"
        )
    vf = ",".join(drawtext_filters)

    await _run([
        "ffmpeg", "-y", "-i", input_path,
        "-vf", vf,
        "-c:a", "copy",
        str(out),
    ])
    return out


async def add_audio_track(
    input_path: str,
    audio_path: str,
    user_id: int,
    mode: str = "replace",
    original_volume: float = 0.0,
    audio_volume: float = 1.0,
) -> Path:
    """Attach a separate audio track to a video.

    mode="replace": drop the video's original audio, use only `audio_path`.
    mode="mix": mix the original audio with `audio_path` at the given volumes.
    Output duration is capped to the (shorter) video stream length.
    """
    out = _out(user_id, "mp4")

    if mode == "replace":
        await _run([
            "ffmpeg", "-y",
            "-i", input_path,
            "-i", audio_path,
            "-map", "0:v", "-map", "1:a",
            "-c:v", "copy", "-c:a", "aac",
            "-shortest",
            str(out),
        ])
    elif mode == "mix":
        filter_complex = (
            f"[0:a]volume={original_volume}[a0];"
            f"[1:a]volume={audio_volume}[a1];"
            f"[a0][a1]amix=inputs=2:duration=first:dropout_transition=0[aout]"
        )
        await _run([
            "ffmpeg", "-y",
            "-i", input_path,
            "-i", audio_path,
            "-filter_complex", filter_complex,
            "-map", "0:v", "-map", "[aout]",
            "-c:v", "copy", "-c:a", "aac",
            "-shortest",
            str(out),
        ])
    else:
        raise RuntimeError(f"unknown audio mode: {mode}")

    return out
