"""Async FFmpeg operations via subprocess — never blocks the event loop.

STEP 7.15F: this file's functions were always correctly written, but every one of them shelled
out to the bare string "ffmpeg" — and this machine has no ffmpeg (or ffprobe) on PATH at all
(confirmed via `shutil.which`), so every single function here has always raised immediately at
runtime. That's *why* Video Studio V2's Export button was implemented as a bare "flash a toast"
placeholder in ReviewTab.tsx: there was never a working renderer underneath it to call.
`imageio_ffmpeg` bundles a real, static, cross-platform ffmpeg binary as its own pip package
data (no system install, no PATH changes) — FFMPEG_BIN below resolves straight to that binary,
so `_run` and every function in this file are now genuinely executable. It does not bundle
ffprobe, so `_probe_duration`/`_probe_dimensions` below get the same information by parsing
ffmpeg's own stderr (`ffmpeg -i <file>` always prints stream info to stderr, ffprobe or not) —
a long-standing, reliable technique, not a workaround unique to this fix.
"""
import asyncio
import re
import uuid
from pathlib import Path

import imageio_ffmpeg
import numpy as np
from PIL import Image

from app.config import settings

FFMPEG_BIN = imageio_ffmpeg.get_ffmpeg_exe()


async def _run(cmd: list[str]) -> str:
    """Runs an ffmpeg (or ffmpeg-adjacent) command; returns decoded stderr (ffmpeg's own log/
    stream-info output always goes to stderr, success or failure) for callers that need to
    parse it (see _probe_duration/_probe_dimensions)."""
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await proc.communicate()
    text = stderr.decode(errors="replace")
    if proc.returncode != 0:
        raise RuntimeError(f"FFmpeg failed (code {proc.returncode}): {text[-800:]}")
    return text


def _out(user_id: int, suffix: str) -> Path:
    d = Path(settings.UPLOAD_DIR) / str(user_id)
    d.mkdir(parents=True, exist_ok=True)
    return d / f"{uuid.uuid4().hex}.{suffix}"


async def extract_audio(input_path: str, user_id: int) -> Path:
    out = _out(user_id, "mp3")
    await _run([FFMPEG_BIN, "-y", "-i", input_path, "-vn", "-acodec", "libmp3lame", "-ab", "192k", str(out)])
    return out


async def add_subtitles(input_path: str, srt_path: str, user_id: int) -> Path:
    out = _out(user_id, "mp4")
    # subtitles filter requires escaped path on some platforms
    safe = srt_path.replace("\\", "/").replace(":", "\\:")
    await _run([
        FFMPEG_BIN, "-y", "-i", input_path,
        "-vf", f"subtitles={safe}",
        "-c:a", "copy",
        str(out),
    ])
    return out


async def resize(input_path: str, width: int, height: int, user_id: int) -> Path:
    out = _out(user_id, "mp4")
    # Force divisible-by-2 dimensions required by libx264
    vf = f"scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2"
    await _run([FFMPEG_BIN, "-y", "-i", input_path, "-vf", vf, "-c:a", "copy", str(out)])
    return out


async def trim(input_path: str, start: float, end: float, user_id: int) -> Path:
    out = _out(user_id, "mp4")
    await _run([
        FFMPEG_BIN, "-y",
        "-ss", str(start),
        "-to", str(end),
        "-i", input_path,
        "-c", "copy",
        str(out),
    ])
    return out


async def convert(input_path: str, output_format: str, user_id: int) -> Path:
    out = _out(user_id, output_format.lstrip("."))
    await _run([FFMPEG_BIN, "-y", "-i", input_path, str(out)])
    return out


async def extract_thumbnail(input_path: str, user_id: int, timestamp: float = 3.0) -> Path:
    """Extract a single JPEG frame from a video at `timestamp` seconds."""
    out = _out(user_id, "jpg")
    await _run([
        FFMPEG_BIN, "-y",
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


async def _probe(path: str) -> str:
    """ffmpeg with no output prints full stream info (duration, resolution, codecs) to stderr
    and exits non-zero (no output file was requested) — that's expected here, not a failure, so
    this bypasses `_run`'s error-on-nonzero-exit check and just returns the raw text."""
    proc = await asyncio.create_subprocess_exec(
        FFMPEG_BIN, "-i", path,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await proc.communicate()
    return stderr.decode(errors="replace")


async def _get_duration(path: str) -> float:
    text = await _probe(path)
    m = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", text)
    if not m:
        raise RuntimeError(f"Could not determine duration of {path!r} from ffmpeg output: {text[-300:]}")
    h, mi, s = m.groups()
    return int(h) * 3600 + int(mi) * 60 + float(s)


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
        # The concat demuxer resolves relative paths against the list file's own
        # directory, not the process cwd — write absolute paths to avoid that.
        list_file.write_text("\n".join(f"file '{Path(p).resolve()}'" for p in clip_paths))
        await _run([
            FFMPEG_BIN, "-y", "-f", "concat", "-safe", "0",
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
        FFMPEG_BIN, "-y", *inputs,
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
        FFMPEG_BIN, "-y", "-i", input_path,
        "-vf", vf,
        "-c:a", "copy",
        str(out),
    ])
    return out


async def _get_video_dimensions(path: str) -> tuple[int, int]:
    text = await _probe(path)
    m = re.search(r"Video:.*?(\d{2,5})x(\d{2,5})", text)
    if not m:
        raise RuntimeError(f"Could not determine dimensions of {path!r} from ffmpeg output: {text[-300:]}")
    return int(m.group(1)), int(m.group(2))


async def _has_audio_stream(path: str) -> bool:
    text = await _probe(path)
    return "Audio:" in text


async def add_media_overlays(
    input_path: str,
    overlays: list[dict],
    user_id: int,
) -> Path:
    """Composite one or more timed image/video overlays onto a base video.

    Each overlay dict: {path, is_image, start, end, x, y, width, height, opacity}.
    x/y/width/height are percentages (0-100) of the base video's frame, matching
    the editor's percentage-based positioning.
    """
    if not overlays:
        raise RuntimeError("add_media_overlays requires at least one overlay")

    base_w, base_h = await _get_video_dimensions(input_path)
    out = _out(user_id, "mp4")

    inputs: list[str] = ["-i", input_path]
    for ov in overlays:
        # Images have no intrinsic duration — loop them so they persist through
        # their enable window. -loop without -t never reaches EOF, which stalls
        # the encoder forever even though the base video is finite, so bound it
        # to the overlay's own end time (the enable gate hides it after that).
        if ov.get("is_image"):
            inputs += ["-loop", "1", "-t", str(max(ov["end"], 0.1)), "-i", ov["path"]]
        else:
            inputs += ["-i", ov["path"]]

    filter_parts = []
    base_label = "0:v"
    for i, ov in enumerate(overlays, start=1):
        w = max(2, round(base_w * ov.get("width", 30) / 100 / 2) * 2)
        h = max(2, round(base_h * ov.get("height", 30) / 100 / 2) * 2)
        x = round(base_w * ov.get("x", 0) / 100)
        y = round(base_h * ov.get("y", 0) / 100)
        opacity = max(0.0, min(1.0, ov.get("opacity", 1.0)))
        start, end = ov["start"], ov["end"]

        scaled, faded, merged = f"ov{i}s", f"ov{i}a", f"merged{i}"
        filter_parts.append(f"[{i}:v]scale={w}:{h}[{scaled}]")
        filter_parts.append(f"[{scaled}]format=rgba,colorchannelmixer=aa={opacity}[{faded}]")
        filter_parts.append(
            f"[{base_label}][{faded}]overlay=x={x}:y={y}:enable='between(t,{start},{end})'[{merged}]"
        )
        base_label = merged

    filter_complex = ";".join(filter_parts)

    await _run([
        FFMPEG_BIN, "-y", *inputs,
        "-filter_complex", filter_complex,
        "-map", f"[{base_label}]", "-map", "0:a?",
        "-c:v", "libx264", "-c:a", "aac",
        "-shortest",
        str(out),
    ])
    return out


async def composite_media_overlays(
    input_path: str,
    overlays: list[dict],
    user_id: int,
) -> Path:
    """STEP 7.15H: same visual compositing as add_media_overlays above, but ALSO mixes in each
    video-backed overlay's own audio (Instruction 5) — add_media_overlays only ever mapped the
    base's own audio (`0:a?`) and silently discarded every overlay's audio input entirely, so no
    overlay could ever have been audible in an export, muted or not. This is a separate function
    (not a change to add_media_overlays itself) because that function is also used by the older
    /process/export endpoint, which this step must not touch.

    Each overlay dict adds `muted`/`volume` to add_media_overlays' own shape. A muted overlay,
    or one with volume<=0, or an image (no audio stream to mix), contributes nothing — exactly
    Instruction 5's "muted -> exclude/silence it" and "respect Overlay Volume".
    """
    if not overlays:
        raise RuntimeError("composite_media_overlays requires at least one overlay")

    base_w, base_h = await _get_video_dimensions(input_path)
    out = _out(user_id, "mp4")

    inputs: list[str] = ["-i", input_path]
    for ov in overlays:
        if ov.get("is_image"):
            inputs += ["-loop", "1", "-t", str(max(ov["end"], 0.1)), "-i", ov["path"]]
        else:
            inputs += ["-i", ov["path"]]

    filter_parts = []
    base_label = "0:v"
    for i, ov in enumerate(overlays, start=1):
        w = max(2, round(base_w * ov.get("width", 30) / 100 / 2) * 2)
        h = max(2, round(base_h * ov.get("height", 30) / 100 / 2) * 2)
        x = round(base_w * ov.get("x", 0) / 100)
        y = round(base_h * ov.get("y", 0) / 100)
        opacity = max(0.0, min(1.0, ov.get("opacity", 1.0)))
        start, end = ov["start"], ov["end"]

        scaled, faded, merged = f"ov{i}s", f"ov{i}a", f"merged{i}"
        filter_parts.append(f"[{i}:v]scale={w}:{h}[{scaled}]")
        filter_parts.append(f"[{scaled}]format=rgba,colorchannelmixer=aa={opacity}[{faded}]")
        filter_parts.append(
            f"[{base_label}][{faded}]overlay=x={x}:y={y}:enable='between(t,{start},{end})'[{merged}]"
        )
        base_label = merged

    # Real overlay-audio mixing: each qualifying overlay's OWN audio, trimmed to its own
    # [start,end) window duration and delayed to that exact same position on the output
    # timeline the visual overlay already uses (no independent trimIn — MediaOverlay has none;
    # it always plays its source from the beginning, same convention the live preview's own
    # overlay-audio sync effect already uses), scaled by its own saved volume.
    audio_labels = ["0:a"]
    for i, ov in enumerate(overlays, start=1):
        if ov.get("is_image") or ov.get("muted"):
            continue
        volume = ov.get("volume", 1.0)
        if volume <= 0:
            continue
        dur = max(0.05, ov["end"] - ov["start"])
        delay_ms = max(0, round(ov["start"] * 1000))
        label = f"oa{i}"
        filter_parts.append(
            f"[{i}:a]atrim=start=0:duration={dur},asetpts=PTS-STARTPTS,"
            f"volume={volume},adelay={delay_ms}|{delay_ms}[{label}]"
        )
        audio_labels.append(label)

    maps = ["-map", f"[{base_label}]"]
    if len(audio_labels) > 1:
        # normalize=0 for the same reason as mix_audio_tracks — every source's own level is
        # already deliberately set by its own `volume=` filter above; ffmpeg must not silently
        # re-scale the combined result a second time (Step 7.15H's own audio-mixing defect).
        filter_parts.append(
            "".join(f"[{l}]" for l in audio_labels)
            + f"amix=inputs={len(audio_labels)}:duration=first:dropout_transition=0:normalize=0[aout]"
        )
        maps += ["-map", "[aout]"]
    else:
        maps += ["-map", "0:a?"]

    filter_complex = ";".join(filter_parts)

    await _run([
        FFMPEG_BIN, "-y", *inputs,
        "-filter_complex", filter_complex,
        *maps,
        "-c:v", "libx264", "-c:a", "aac",
        "-shortest",
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
            FFMPEG_BIN, "-y",
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
            FFMPEG_BIN, "-y",
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


# ============================================================================
# STEP 7.15F: real Video Studio V2 timeline export.
#
# Everything above this line pre-existed and operates on one asset (or a flat list of assets)
# at a time. A Video Studio V2 project is a full timeline — per-clip trim/speed/color, text and
# media overlays positioned in canvas percent, and one or more separately-editable A1 audio
# tracks with their own volume — so this section is new orchestration built specifically for
# that shape, reusing add_text_overlays/add_media_overlays above as-is (their existing percent-
# based-position contracts already match the editor's own model exactly) and following the same
# _run/_out/subprocess conventions as everything above it.
# ============================================================================

_COLOR_PRESETS: dict[str, str] = {
    # Approximate, real (not fabricated) per-preset looks — visibly distinct output, not
    # pixel-matched to the editor's live CSS-filter preview (out of scope for this step).
    "warm": "eq=gamma_r=1.12:gamma_b=0.9",
    "cool": "eq=gamma_r=0.9:gamma_b=1.12",
    "cinematic": "eq=contrast=1.15:saturation=0.9",
    "bw": "hue=s=0",
    "high_contrast": "eq=contrast=1.5",
    "desaturated": "eq=saturation=0.4",
    "sepia": "colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131:0",
}


def _atempo_chain(speed: float) -> str:
    """ffmpeg's atempo filter only accepts 0.5–2.0 per stage. Video Studio V2's speed enum is
    fixed (0.25/0.5/0.75/1/1.25/1.5/2), so at most two chained stages are ever needed to reach
    the exact requested factor — this isn't a general-purpose arbitrary-speed solution, just
    enough to exactly cover that fixed set."""
    if speed < 0.5:
        return "atempo=0.5,atempo={:.6f}".format(speed / 0.5)
    if speed > 2.0:
        return "atempo=2.0,atempo={:.6f}".format(speed / 2.0)
    return f"atempo={speed}"


async def build_clip_segment(
    input_path: str,
    trim_in: float,
    source_duration: float,
    speed: float,
    color_grade: str,
    brightness: float,
    contrast: float,
    saturation: float,
    canvas_w: int,
    canvas_h: int,
    keep_audio: bool,
    volume: float,
    user_id: int,
    fit_mode: str = "fit",
    crop_x: float = 50.0,
    crop_y: float = 50.0,
) -> Path:
    """One clip's [trimIn, trimIn+sourceDuration) source range → a single normalized segment:
    speed-adjusted, colour/brightness/contrast/saturation applied, scaled onto the project's
    canvas size per this clip's own fit_mode, re-encoded to one common codec/framerate/audio
    format so segments can be crossfaded together afterward regardless of their original,
    possibly-differing source formats.

    STEP 7 (Platform Canvas / Full-Screen Video Acceptance): fit_mode is now a genuine per-clip
    choice mirroring the live Create/Edit preview's own `.real-video-el` CSS exactly, closing
    the gap Step 7.15H's own note here used to flag ("a mismatched-aspect clip's export will
    visually differ from its own Create/Edit preview ... until/unless the preview is updated to
    match") — the preview now uses this same fit_mode/crop_x/crop_y per clip (object-fit /
    object-position), so what's previewed is what exports.
      - "fit" (`force_original_aspect_ratio=decrease` + centred `pad`): shows the whole source
        frame, centred, letterboxed/pillarboxed where the ratios differ — never stretches,
        never crops. This is every clip's default (matches the CSS default too), so a clip
        authored before this feature renders exactly as it always did.
      - "fill" (`force_original_aspect_ratio=increase` + `crop`): scales up until the source
        fully covers the canvas on both axes, cropping only the overflow — never stretches,
        never shows bars. crop_x/crop_y (0-100, CSS object-position's own convention — 50/50 is
        centred, matching the previous hardcoded-centre behaviour exactly when left at default)
        choose WHICH part of the overflow is kept, so a subject near one edge of the source
        isn't forced to be cropped off: `x = (in_w-out_w) * crop_x/100`, `y` likewise — the
        direct ffmpeg-`crop`-filter equivalent of CSS's own object-position formula.

    keep_audio=False (this clip's audio has been separated to its own A1 track — Step 7.6A's
    "V1 is muted once separated" rule — OR the clip's own Original Audio toggle is off, OR its
    own volume is 0 — the router folds all three into this one flag before calling here) still
    produces a real (silent) audio stream rather than none at all, so every segment has a
    uniform [v][a] shape for the concat/crossfade step below.

    STEP 7 (Original Video Audio controls): `volume` only applies when keep_audio is True — the
    clip's own saved volume (Properties → Audio → Volume), independent of A1's own volume,
    other clips, and overlay audio. Applied via the same `volume=` filter approach already used
    for A1/overlay audio, not ffmpeg's own automatic mixing normalization (not relevant here —
    there's only one audio input in this specific command either way).
    """
    out = _out(user_id, "mp4")

    vf_parts: list[str] = []
    preset = _COLOR_PRESETS.get(color_grade)
    if preset:
        vf_parts.append(preset)
    if brightness or contrast or saturation:
        b = max(-1.0, min(1.0, brightness / 100))
        c = max(0.1, 1 + contrast / 100)
        s = max(0.0, 1 + saturation / 100)
        vf_parts.append(f"eq=brightness={b:.4f}:contrast={c:.4f}:saturation={s:.4f}")
    if speed != 1:
        vf_parts.append(f"setpts=PTS/{speed}")
    if fit_mode == "fit":
        vf_parts.append(
            f"scale={canvas_w}:{canvas_h}:force_original_aspect_ratio=decrease,"
            f"pad={canvas_w}:{canvas_h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1"
        )
    else:
        crop_x_frac = max(0.0, min(1.0, crop_x / 100))
        crop_y_frac = max(0.0, min(1.0, crop_y / 100))
        vf_parts.append(
            f"scale={canvas_w}:{canvas_h}:force_original_aspect_ratio=increase,"
            f"crop={canvas_w}:{canvas_h}:(in_w-out_w)*{crop_x_frac:.4f}:(in_h-out_h)*{crop_y_frac:.4f},setsar=1"
        )
    vf = ",".join(vf_parts)

    common_out = ["-r", "30", "-pix_fmt", "yuv420p", "-c:v", "libx264",
                  "-ar", "44100", "-ac", "2", "-c:a", "aac"]

    if keep_audio:
        cmd = [FFMPEG_BIN, "-y", "-ss", str(trim_in), "-t", str(source_duration), "-i", input_path, "-vf", vf]
        af_parts = []
        if speed != 1:
            af_parts.append(_atempo_chain(speed))
        if volume != 1:
            af_parts.append(f"volume={volume}")
        if af_parts:
            cmd += ["-af", ",".join(af_parts)]
        cmd += common_out + [str(out)]
    else:
        out_duration = source_duration / speed
        cmd = [
            FFMPEG_BIN, "-y",
            "-ss", str(trim_in), "-t", str(source_duration), "-i", input_path,
            "-f", "lavfi", "-t", str(out_duration), "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
            "-vf", vf, "-map", "0:v", "-map", "1:a",
        ] + common_out + ["-shortest", str(out)]

    await _run(cmd)
    return out


# Reuses TRANSITION_MAP's xfade names but adds an explicit entry for "cut" (a near-zero-duration
# crossfade — visually indistinguishable from a hard cut) so a plain cut and a real transition
# share the exact same filter-graph code path below instead of needing two.
_XFADE_NAMES: dict[str, str] = {**TRANSITION_MAP, "cut": "fade", "fade_black": "fadeblack"}


async def concat_segments_with_transitions(
    segment_paths: list[str],
    transitions: list[str],
    transition_durations: list[float],
    segment_durations: list[float],
    user_id: int,
) -> Path:
    """Joins 1+ already-normalized segments (see build_clip_segment) end to end.
    transitions/transition_durations: length len(segment_paths)-1, one entry per junction
    (segment i to i+1) — this is Video Studio V2's own per-clip `transition`/`transitionDuration`
    fields, not the older /process/export API's single-transition-for-everything shape.
    segment_durations[i]: segment i's own OUTPUT-timeline length (== its endTime-startTime,
    since build_clip_segment already made the segment run at exactly that speed-adjusted rate).
    """
    if len(segment_paths) == 1:
        out = _out(user_id, "mp4")
        await _run([FFMPEG_BIN, "-y", "-i", segment_paths[0], "-c", "copy", str(out)])
        return out

    inputs: list[str] = []
    for p in segment_paths:
        inputs += ["-i", p]

    filter_parts = []
    running = segment_durations[0]
    v_label, a_label = "0:v", "0:a"
    for i in range(1, len(segment_paths)):
        xfade_name = _XFADE_NAMES.get(transitions[i - 1], "fade")
        # "cut" ignores whatever transitionDuration happens to be stored (the editor's own UI
        # never shows/edits a duration for "cut" — see CreateEditTab's Transition Duration
        # field, only rendered for "fade_black") and always uses a fixed, near-instant value.
        td = 0.05 if transitions[i - 1] == "cut" else max(0.05, transition_durations[i - 1])
        offset = max(0.0, running - td)
        next_v, next_a = f"v{i}", f"a{i}"
        filter_parts.append(f"[{v_label}][{i}:v]xfade=transition={xfade_name}:duration={td}:offset={offset}[{next_v}]")
        filter_parts.append(f"[{a_label}][{i}:a]acrossfade=d={td}[{next_a}]")
        v_label, a_label = next_v, next_a
        running = running + segment_durations[i] - td

    filter_complex = ";".join(filter_parts)
    out = _out(user_id, "mp4")
    await _run([
        FFMPEG_BIN, "-y", *inputs,
        "-filter_complex", filter_complex,
        "-map", f"[{v_label}]", "-map", f"[{a_label}]",
        "-c:v", "libx264", "-c:a", "aac",
        str(out),
    ])
    return out


async def mix_audio_tracks(base_video_path: str, tracks: list[dict], user_id: int) -> Path:
    """Overlays one or more separated A1 audio tracks onto the base timeline's own audio bed,
    each positioned at its own [start_time, end_time) window (adelay) and scaled by its own
    saved volume (Instruction 6/7 — this is the clip's *saved* volume property, nothing to do
    with the preview-only mute button). A track at volume 0 is Requirement 5's "0% = complete
    silence" — simply excluded rather than mixed in at zero, which is equivalent but cheaper.

    Each dict: {path, trim_in, start_time, end_time, volume}.
    """
    active = [t for t in tracks if t.get("volume", 1) > 0]
    if not active:
        return Path(base_video_path)

    inputs = ["-i", base_video_path]
    for t in active:
        inputs += ["-i", t["path"]]

    filter_parts = []
    mix_labels = ["0:a"]
    for idx, t in enumerate(active, start=1):
        dur = max(0.05, t["end_time"] - t["start_time"])
        delay_ms = max(0, round(t["start_time"] * 1000))
        label = f"ta{idx}"
        filter_parts.append(
            f"[{idx}:a]atrim=start={t['trim_in']}:duration={dur},asetpts=PTS-STARTPTS,"
            f"volume={t['volume']},adelay={delay_ms}|{delay_ms}[{label}]"
        )
        mix_labels.append(label)

    # STEP 7.15H defect fix: ffmpeg's amix defaults to normalize=1, which auto-attenuates the
    # *combined* output by roughly 1/inputs to guard against clipping — even here, where one of
    # those "inputs" is the base timeline's own silent track (every clip with separated audio
    # produces one, per Step 7.6A/build_clip_segment) contributing nothing to sum against. That
    # silently cut the real A1 track's level by ~2x on top of its own saved volume, with no
    # trace of it anywhere in the editor's own volume model — confirmed by direct A/B render
    # (same real draft, same everything else): normalize=1 measured RMS ≈1245, normalize=0
    # ≈2489, exactly the 2x this filter's own default describes. Since this track's own level
    # is already explicitly set by the `volume=` filter above (Instruction 6/7 — the clip's
    # saved property), ffmpeg must not silently re-scale it a second time.
    filter_parts.append("".join(f"[{l}]" for l in mix_labels) + f"amix=inputs={len(mix_labels)}:duration=first:dropout_transition=0:normalize=0[aout]")
    filter_complex = ";".join(filter_parts)

    out = _out(user_id, "mp4")
    await _run([
        FFMPEG_BIN, "-y", *inputs,
        "-filter_complex", filter_complex,
        "-map", "0:v", "-map", "[aout]",
        "-c:v", "copy", "-c:a", "aac",
        str(out),
    ])
    return out


async def render_project(project: dict, user_id: int) -> Path:
    """The single entry point the router calls. `project` shape (all paths already resolved to
    real files on disk by the router, via each item's assetId — this function never touches the
    database):

    {
      "canvas_width": int, "canvas_height": int,
      "video_clips": [{path, trim_in, start_time, end_time, speed, color_grade,
                        brightness, contrast, saturation, transition, transition_duration,
                        has_separated_audio}],   # ordered by start_time
      "text_overlays": [{text, start, end, x, y, font_size, font_color}],
      "media_overlays": [{path, is_image, start, end, x, y, width, height, opacity}],
      "audio_tracks": [{path, trim_in, start_time, end_time, volume}],
    }
    """
    clips = project["video_clips"]
    if not clips:
        raise RuntimeError("Add at least one video clip to the timeline before exporting.")

    cw, ch = project["canvas_width"], project["canvas_height"]

    segment_paths: list[str] = []
    for c in clips:
        # STEP 7 (Original Video Audio controls): three independent reasons a clip's own
        # embedded audio should be dropped entirely — separated to A1 (Step 7.6A), the clip's
        # own Original Audio toggle switched off, or its own volume at 0% (equivalent to off).
        # Any one of them is enough; none of them affect A1, other clips, or overlay audio.
        clip_volume = c.get("volume", 1.0)
        keep_audio = not (c["has_separated_audio"] or c.get("muted") or clip_volume <= 0)
        # STEP 7 (Platform Canvas / Full-Screen Video Acceptance): "fit" here is a deliberate
        # default CHANGE from this function's previous always-FILL behaviour (Step 7.15H) —
        # matching the frontend VideoClip type's own "undefined == fit" convention, which is
        # itself unchanged from the CSS default the live preview has always used
        # (.real-video-el{object-fit:contain}). This is the fix for exactly the divergence Step
        # 7.15H's own docstring flagged as future work: preview defaulted to fit, export
        # defaulted to fill, so a clip nobody had touched this control for would visually differ
        # between the two. A project saved before this feature existed has no fit_mode/crop_x/
        # crop_y keys at all and now exports exactly what its own preview already shows.
        seg = await build_clip_segment(
            c["path"], c["trim_in"], (c["end_time"] - c["start_time"]) * c["speed"], c["speed"],
            c["color_grade"], c["brightness"], c["contrast"], c["saturation"],
            cw, ch, keep_audio=keep_audio, volume=clip_volume, user_id=user_id,
            fit_mode=c.get("fit_mode", "fit"), crop_x=c.get("crop_x", 50.0), crop_y=c.get("crop_y", 50.0),
        )
        segment_paths.append(str(seg))

    if len(segment_paths) == 1:
        base = Path(segment_paths[0])
    else:
        transitions = [c["transition"] for c in clips[:-1]]
        transition_durations = [c["transition_duration"] for c in clips[:-1]]
        segment_durations = [c["end_time"] - c["start_time"] for c in clips]
        base = await concat_segments_with_transitions(segment_paths, transitions, transition_durations, segment_durations, user_id)

    current = base
    intermediates = [p for p in segment_paths if p != str(base)]

    if project.get("text_overlays"):
        next_path = await add_text_overlays(str(current), project["text_overlays"], user_id)
        intermediates.append(str(current))
        current = next_path

    if project.get("media_overlays"):
        # STEP 7.15H: composite_media_overlays (not add_media_overlays) — the only difference is
        # that this one also mixes in each overlay's own audio, muted/volume-aware.
        next_path = await composite_media_overlays(str(current), project["media_overlays"], user_id)
        intermediates.append(str(current))
        current = next_path

    if project.get("audio_tracks"):
        next_path = await mix_audio_tracks(str(current), project["audio_tracks"], user_id)
        if next_path != current:
            intermediates.append(str(current))
            current = next_path

    # Best-effort cleanup of intermediate render steps — never let a cleanup failure mask an
    # otherwise-successful export.
    for p in intermediates:
        try:
            Path(p).unlink(missing_ok=True)
        except OSError:
            pass

    return current


# ============================================================================
# Video Deconstructor — Stage 3 (Reference Video Technical Analysis) ONLY.
#
# Deterministic container/stream fact extraction — no AI, no scene/shot segmentation, no
# analysis of any content beyond what ffmpeg's own demuxer reports about the file's technical
# shape. Reuses `_probe` (above) exactly as every other technical-fact function in this file
# already does; adds nothing to the ffmpeg command surface itself, only new *parsing* of the
# same kind of stderr text `_get_duration`/`_get_video_dimensions`/`_has_audio_stream` already
# rely on. See the Stage 3 design-review report for the full rationale; this docstring covers
# only the mechanics.
# ============================================================================

TECHNICAL_DETAILS_SCHEMA_VERSION = 1


class TechnicalProbeError(RuntimeError):
    """Raised when the input cannot be read as a video at all (corrupt/malformed/truncated) —
    distinct from a normal RuntimeError so the router can map it to VideoAnalysis status
    "failed" without mistaking it for a programming error."""


def _empty_technical_details() -> dict:
    """The full, stable key shape technical_details always has — every key always present, so
    calling code never needs defensive `.get()` chains to know what *could* exist. A value stays
    None precisely when this probe mechanism could not reliably determine it — see each field's
    own comment in probe_technical_metadata below for why. This function alone defines the
    schema; nothing else in this codebase should construct a technical_details dict by hand.
    """
    return {
        "schema_version": TECHNICAL_DETAILS_SCHEMA_VERSION,
        "probe": {
            "mechanism": "ffmpeg_stderr_probe",  # names the deterministic method — never "ai"
            "ffmpeg_build": None,
        },
        "container": {
            "format_name": None,
            # Not derivable from `ffmpeg -i` output without a hardcoded format_name -> long_name
            # lookup table, which would itself be a fixed string ffmpeg never actually reported
            # for this file — left None rather than guess.
            "format_long_name": None,
            "duration_seconds": None,
            # Sourced from the already-known Asset.file_size, not re-measured by ffmpeg (ffmpeg
            # -i never reports on-disk file size) — see probe_technical_metadata's docstring.
            "size_bytes": None,
            "bitrate_kbps": None,
        },
        "video": {
            "codec_name": None,
            "codec_long_name": None,  # same reasoning as format_long_name above
            "profile": None,
            "width": None,
            "height": None,
            # ffmpeg -i's plain text never distinguishes macroblock-aligned "coded" dimensions
            # from display dimensions (that split needs ffprobe's own coded_width/coded_height
            # fields) — always None here, never assumed equal to width/height.
            "coded_width": None,
            "coded_height": None,
            "pixel_format": None,
            # Populated ONLY when ffmpeg's own "[SAR a:b DAR c:d]" bracket is present in the
            # stream line — i.e. only when the container itself carries this as real metadata.
            # When the bracket is absent, DAR is implicitly 1:1-pixel width:height, but that is
            # an ARITHMETIC fact about width/height, not something ffmpeg observed and reported
            # — computing and storing it here would misrepresent a derived value as an observed
            # one (see the Stage 3 design review, certainty/evidence section). Deriving a
            # display aspect-ratio LABEL from width/height for UI purposes happens only in the
            # API response / frontend, never here.
            "sample_aspect_ratio": None,
            "display_aspect_ratio": None,
            "frame_rate": None,
            # ffmpeg's plain-text output gives "fps" and "tbr" (a timing-derived guess), but not
            # ffprobe's own distinct r_frame_rate vs avg_frame_rate split — for genuinely
            # variable-frame-rate content these differ and we cannot tell them apart from this
            # text alone. Always None: never copies frame_rate into this field to "fill" it.
            "average_frame_rate": None,
            "time_base": None,
            # Never computed as duration x frame_rate — that is an ESTIMATE, wrong for VFR
            # content, and `ffmpeg -i` never prints a real decoded frame count (that needs a
            # full decode pass, e.g. ffprobe -count_frames, which this probe deliberately never
            # runs — Stage 3 must stay a header-read, not a decode). Only ever None.
            "frame_count": None,
            "bitrate_kbps": None,
            # Populated ONLY from an explicit `rotate` metadata tag or a `displaymatrix`
            # side-data line if either is present in ffmpeg's own output. Absence of either is
            # recorded as None ("no rotation metadata found") — never assumed to mean 0 degrees
            # (a file can be physically rotated without any metadata tag saying so).
            "rotation_degrees": None,
            # Not independently reported per-stream by `ffmpeg -i` for muxed streams sharing one
            # container timeline — left None rather than copying container.duration_seconds,
            # which would misrepresent it as an independent per-stream measurement.
            "duration_seconds": None,
        },
        "audio": {
            "present": False,
            "codec_name": None,
            "codec_long_name": None,
            "sample_rate_hz": None,
            "channels": None,
            "channel_layout": None,
            "bitrate_kbps": None,
            "duration_seconds": None,  # same reasoning as video.duration_seconds above
        },
        "streams": {
            "count": 0,
            "video_count": 0,
            "audio_count": 0,
        },
    }


_CHANNEL_LAYOUT_COUNTS: dict[str, int] = {
    "mono": 1, "stereo": 2, "2.1": 3, "3.0": 3, "quad": 4, "4.0": 4,
    "5.0": 5, "5.1": 6, "6.1": 7, "7.1": 8,
}


def _parse_video_stream(line: str) -> dict:
    """`line` is everything after "Video: " on a Stream line, e.g.
    "h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709, progressive), 480x864, 1418 kb/s,
    30 fps, 30 tbr, 90k tbn (default)". Every extraction below is independent and best-effort —
    one field failing to match never blocks another."""
    out: dict = {}

    m = re.match(r"([a-zA-Z0-9_]+)", line)
    if m:
        out["codec_name"] = m.group(1)

    # The profile paren (e.g. "(High)") is distinguished from the fourcc paren (e.g.
    # "(avc1 / 0x31637661)") by the fourcc always containing a "/" — excluded from this class.
    m = re.match(r"[a-zA-Z0-9_]+\s*\(([^()/]+)\)", line)
    if m:
        out["profile"] = m.group(1).strip()

    m = re.search(r",\s*([a-z][a-z0-9_]*)\s*(?:\([^)]*\))?,\s*(\d{2,5})x(\d{2,5})", line)
    if m:
        out["pixel_format"] = m.group(1)
        out["width"] = int(m.group(2))
        out["height"] = int(m.group(3))

    m = re.search(r"\[SAR (\d+:\d+) DAR (\d+:\d+)\]", line)
    if m:
        out["sample_aspect_ratio"] = m.group(1)
        out["display_aspect_ratio"] = m.group(2)

    m = re.search(r",\s*(\d+) kb/s,\s*[\d.]+ fps", line)
    if m:
        out["bitrate_kbps"] = int(m.group(1))

    m = re.search(r"([\d.]+) fps", line)
    if m:
        out["frame_rate"] = float(m.group(1))

    m = re.search(r"(\d+)(k)?\s*tbn", line)
    if m:
        denom = int(m.group(1)) * (1000 if m.group(2) else 1)
        out["time_base"] = f"1/{denom}"

    return out


def _parse_audio_stream(line: str) -> dict:
    """`line` is everything after "Audio: " on a Stream line, e.g.
    "aac (LC) (mp4a / 0x6134706D), 44100 Hz, stereo, fltp, 127 kb/s (default)"."""
    out: dict = {"present": True}

    m = re.match(r"([a-zA-Z0-9_]+)", line)
    if m:
        out["codec_name"] = m.group(1)

    m = re.search(r"(\d+) Hz", line)
    if m:
        out["sample_rate_hz"] = int(m.group(1))

    m = re.search(r"Hz,\s*([a-zA-Z0-9._]+)\s*,", line)
    if m:
        layout = m.group(1)
        out["channel_layout"] = layout
        if layout in _CHANNEL_LAYOUT_COUNTS:
            out["channels"] = _CHANNEL_LAYOUT_COUNTS[layout]
    if "channels" not in out:
        m = re.search(r"(\d+) channels?\b", line)
        if m:
            out["channels"] = int(m.group(1))

    bitrates = re.findall(r"(\d+) kb/s", line)
    if bitrates:
        out["bitrate_kbps"] = int(bitrates[-1])

    return out


def _looks_like_probe_failure(text: str) -> bool:
    """A normal, successful probe always contains an "Input #0" line (even though the process
    still exits non-zero, because no output file was requested — see `_probe`'s own docstring).
    Its absence, or an explicit "Invalid data found" / "Error opening input" message, is
    ffmpeg's own signal that the file could not be read as a video at all — verified directly
    against a genuinely corrupt file during this stage's own design/implementation work."""
    if "Input #0" not in text:
        return True
    if "Invalid data found when processing input" in text:
        return True
    if "Error opening input" in text:
        return True
    return False


async def probe_technical_metadata(path: str, file_size_bytes: int | None = None, timeout: float = 30.0) -> dict:
    """The Stage 3 entry point. Runs the existing `_probe` (bare `ffmpeg -i`, no decode — a
    header read, not a transcode, so this is fast regardless of file length) with a hard
    timeout, then parses its stderr text into the stable shape `_empty_technical_details`
    defines. Every field is either a value ffmpeg's own container/stream metadata directly
    reported, or None ("not reliably determined by this probe mechanism") — never a guess, never
    interpreted, never AI-derived. `file_size_bytes` (from the caller's own Asset.file_size) is
    the one field placed here that ffmpeg itself never reports.

    Raises TechnicalProbeError if the file cannot be read as a video at all (corrupt, truncated,
    wrong format) or if the probe subprocess doesn't finish within `timeout` seconds (a
    defensive guard `_probe`/`_run` don't otherwise have — added here rather than there so this
    Stage-3-only guard cannot change behaviour for any of this module's existing, already-
    approved callers).
    """
    try:
        text_out = await asyncio.wait_for(_probe(path), timeout=timeout)
    except asyncio.TimeoutError as exc:
        raise TechnicalProbeError(f"ffmpeg probe did not complete within {timeout}s") from exc

    if _looks_like_probe_failure(text_out):
        raise TechnicalProbeError(f"Could not read {path!r} as a video: {text_out[-400:]}")

    details = _empty_technical_details()

    m = re.search(r"ffmpeg version (\S+)", text_out)
    if m:
        details["probe"]["ffmpeg_build"] = m.group(1)

    m = re.search(r"Input #0,\s*(.+?),\s*from ['\"]", text_out)
    if m:
        details["container"]["format_name"] = m.group(1).strip()

    m = re.search(r"Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?),\s*start:\s*[\d.]+,\s*bitrate:\s*(\d+) kb/s", text_out)
    if m:
        h, mi, s, br = m.groups()
        details["container"]["duration_seconds"] = int(h) * 3600 + int(mi) * 60 + float(s)
        details["container"]["bitrate_kbps"] = int(br)
    else:
        m = re.search(r"Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)", text_out)
        if m:
            h, mi, s = m.groups()
            details["container"]["duration_seconds"] = int(h) * 3600 + int(mi) * 60 + float(s)

    if file_size_bytes is not None:
        details["container"]["size_bytes"] = file_size_bytes

    video_lines = re.findall(r"Stream #\d+:\d+[^\n]*: Video: ([^\n]+)", text_out)
    if video_lines:
        details["video"].update(_parse_video_stream(video_lines[0]))

    audio_lines = re.findall(r"Stream #\d+:\d+[^\n]*: Audio: ([^\n]+)", text_out)
    if audio_lines:
        details["audio"].update(_parse_audio_stream(audio_lines[0]))

    m = re.search(r"\brotate\s*:\s*(-?\d+)", text_out)
    if m:
        details["video"]["rotation_degrees"] = float(m.group(1))
    else:
        m = re.search(r"rotation of (-?[\d.]+) degrees", text_out)
        if m:
            details["video"]["rotation_degrees"] = float(m.group(1))

    details["streams"]["video_count"] = len(video_lines)
    details["streams"]["audio_count"] = len(audio_lines)
    details["streams"]["count"] = len(re.findall(r"Stream #\d+:\d+", text_out))

    return details


def summarize_technical_facts(details: dict) -> dict:
    """Extracts the subset of `technical_details` that maps onto ReferenceVideo's own six
    pre-existing scalar columns (duration/width/height/fps/codec/has_audio) — the single source
    of truth is `details` itself, so these columns and technical_details can never disagree.
    """
    return {
        "duration": details["container"]["duration_seconds"],
        "width": details["video"]["width"],
        "height": details["video"]["height"],
        "fps": details["video"]["frame_rate"],
        "codec": details["video"]["codec_name"],
        "has_audio": details["audio"]["present"],
    }


# ============================================================================
# Video Deconstructor — Stage 4 (Deterministic Shot/Cut Boundary Detection) ONLY.
#
# Detects hard visual cuts via ffmpeg's own built-in `scene` frame-difference score — no AI, no
# new dependency, the same bundled `imageio_ffmpeg` binary Stage 3 already uses, now actually
# decoding the stream (Stage 3's probe never did) rather than just reading headers. This ONLY
# detects that a visual break occurred and roughly how strong it looked to a pixel-difference
# metric — it never claims to know it is a semantically meaningful "scene" (see shot.py's own
# module docstring for the MEASURED-vs-INFERRED distinction this is built on).
#
# SHOT_DETECTION_THRESHOLD was chosen from real, empirical evidence gathered during this stage's
# own design review, not guessed:
#   - Sameena's real 34s reference video: one unambiguous cut at t=30.100s, score=0.3843 — every
#     other one of its 1020 frames scored under 0.01.
#   - A textured synthetic fixture with cuts deliberately placed at exactly 2.0s/4.0s: detected
#     at exactly those timestamps, scores 0.844/0.751, against a noise floor under 0.03.
#   - A flat-solid-color synthetic fixture (red->green->blue) scored the red->green cut at
#     exactly 0.0 — a genuine, documented weakness of simple pixel-difference scene detection on
#     texture-less content; harmless for real camera footage (confirmed above) but the reason
#     this project's own Stage-4 tests use textured fixtures, never flat colors.
# 0.3 sits comfortably below every real detected cut in that evidence and roughly 10x above every
# observed noise-floor score — configurable per call, never hardcoded silently.
# ============================================================================

SHOT_DETECTION_PASS_NAME = "scene_cut_detection_v1"
SHOT_DETECTION_THRESHOLD = 0.3


async def detect_shot_boundary_candidates(path: str, threshold: float = SHOT_DETECTION_THRESHOLD, timeout: float = 120.0) -> list[dict]:
    """Runs `ffmpeg -i <path> -vf select='gte(scene,threshold)',metadata=print -f null -` — a
    full decode (unlike Stage 3's header-only probe), so this can take real time on long/large
    files; `timeout` (seconds) bounds it and raises TechnicalProbeError rather than hanging
    forever on a malformed or pathological input.

    Returns an ascending-by-timestamp list of {"timestamp": float, "score": float} — one entry
    per frame whose scene-difference score met `threshold`, each a genuine candidate shot
    boundary. Never includes frame 0 (ffmpeg always reports its own score as 0.0 — there is no
    prior frame to differ against). Deterministic: the same file and threshold always produce
    the exact same result, verified directly against real output during this stage's own design
    review — never AI, never randomized.
    """
    cmd = [FFMPEG_BIN, "-i", path, "-vf", f"select='gte(scene,{threshold})',metadata=print", "-f", "null", "-"]
    proc = await asyncio.create_subprocess_exec(*cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    try:
        _, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError as exc:
        try:
            proc.kill()
        except ProcessLookupError:
            pass
        raise TechnicalProbeError(f"Shot-boundary detection did not complete within {timeout}s") from exc

    text_out = stderr.decode(errors="replace")
    if _looks_like_probe_failure(text_out):
        raise TechnicalProbeError(f"Could not read {path!r} as a video for shot-boundary detection: {text_out[-400:]}")

    boundaries: list[dict] = []
    lines = text_out.splitlines()
    for i, line in enumerate(lines):
        m = re.search(r"pts_time:\s*([\d.]+)", line)
        if not m or i + 1 >= len(lines):
            continue
        score_m = re.search(r"lavfi\.scene_score=([\d.]+)", lines[i + 1])
        if score_m:
            boundaries.append({"timestamp": float(m.group(1)), "score": float(score_m.group(1))})
    boundaries.sort(key=lambda b: b["timestamp"])
    return boundaries


def build_shot_segments(boundaries: list[dict], total_duration: float) -> list[dict]:
    """Turns a list of candidate cut timestamps into a gap-free, overlap-free, chronologically
    ordered list of shot segments spanning exactly [0, total_duration] — items 9/10 of the
    Stage 4 spec (correct first/last segment handling; zero unexplained gaps or overlaps; a
    video with zero detected cuts correctly yields exactly one segment spanning the whole
    duration, with no special-casing needed).

    No minimum-duration merging is applied, deliberately: a genuinely rapid cut produces a
    genuinely short segment, reported exactly as detected — silently merging short segments away
    would be an interpretive judgment this deterministic pass does not make.

    Returns: [{"order": int, "start_time": float, "end_time": float, "boundary_score": float | None}],
    where boundary_score is the detector's score for the cut that STARTS this segment (None for
    the first segment, which starts at the reference video's own beginning with no preceding cut
    to score).
    """
    cut_times = sorted({b["timestamp"] for b in boundaries if 0.0 < b["timestamp"] < total_duration})
    score_by_time = {b["timestamp"]: b["score"] for b in boundaries}
    edges = [0.0, *cut_times, total_duration]

    segments: list[dict] = []
    for i in range(len(edges) - 1):
        start, end = edges[i], edges[i + 1]
        if end <= start:
            continue  # a duplicate/degenerate timestamp collapsed to zero length — skip it
        segments.append({
            "order": len(segments),
            "start_time": start,
            "end_time": end,
            "boundary_score": score_by_time.get(start) if i > 0 else None,
        })
    return segments


# ─── Stage 5 — Visual Evidence / Representative Frames ──────────────────────────────────────
#
# Deterministic, local-only (ffmpeg + Pillow + numpy, all already installed — no new dependency)
# extraction of a SMALL representative-frame set per Shot, per the approved Stage-5 design
# review. Every value computed here is MEASURED — a direct, pixel-level fact about the extracted
# image itself — never an interpretation of what the frame shows (no OCR, no object/person/
# text/logo detection: that is explicitly out of scope, see the design review's own section 20).

FRAME_EXTRACTION_PASS_NAME = "representative_frame_extraction_v1"

# Frame-count strategy — see the approved design review's section E for the full trade-off
# discussion (this fixed, time-based rule now; perceptual-change-within-shot sampling deferred
# until a real long-form video actually needs it).
FRAME_SHORT_SHOT_SECONDS = 1.0          # below this: a single midpoint frame only
FRAME_LONG_SHOT_SECONDS = 6.0           # above this: extra evenly-spaced frames are added
FRAME_EXTRA_INTERVAL_SECONDS = 5.0      # one more frame per additional interval beyond the above
FRAME_MAX_PER_SHOT = 8                  # hard cap regardless of duration
FRAME_EPSILON_FRACTION = 0.05           # start/end offset, as a fraction of shot duration
FRAME_EPSILON_MAX_SECONDS = 0.15        # ...capped in absolute terms for very long shots

# Near-duplicate suppression (dHash Hamming distance out of 64 bits) — a low-cost, well-known
# perceptual-hash cutoff; frames closer than this are visually indistinguishable and never
# stored, so a static/near-static shot doesn't produce redundant evidence files.
FRAME_DUPLICATE_HAMMING_THRESHOLD = 4

# Empirically justified (verified directly against this project's own real reference video, a
# 34.146875s file): ffmpeg's own `-ss <t> -frames:v 1` single-frame mjpeg extraction can fail to
# produce ANY output within roughly the last ~0.2s of a file's own probed duration (33.95s
# succeeded, 33.99s failed against that exact file) — almost certainly too little decodable video
# left after the seek point to complete even one frame. Clamping every candidate at least this far
# before the file's own end avoids that failure mode entirely, at the cost of at most this many
# seconds of temporal precision on a shot whose own end coincides with the file's last instant.
END_OF_FILE_SAFETY_SECONDS = 0.25

# A frame whose mean luminance (0-255 grayscale) is at or below this is flagged is_black_frame —
# a signal that an extraction landed on a genuinely blank/transitional instant (a hard cut, a
# fade), not a real evidence frame; still stored (dropping it silently would be its own kind of
# interpretive judgment), just honestly flagged for whatever later stage consumes it.
FRAME_BLACK_LUMINANCE_THRESHOLD = 10.0


def plan_representative_frame_timestamps(start_time: float, end_time: float) -> list[dict]:
    """Deterministic, duration-based representative-frame plan for ONE Shot.

    Returns an ascending-by-timestamp list of
    {"timestamp": float, "extraction_method": str} — always non-empty for any Shot with
    end_time > start_time (a malformed/zero-length Shot yields an empty list; callers treat that
    as nothing-to-extract, not an error, since it can only happen for already-invalid input).

    Rule:
      - duration < 1.0s  -> 1 frame: the midpoint ("shot_midpoint")
      - 1.0s - 6.0s      -> 3 frames: start+epsilon, midpoint, end-epsilon
      - > 6.0s           -> the same 3, plus one more frame per additional 5s beyond 6.0s, capped
                            at FRAME_MAX_PER_SHOT total — each extra frame subdivides the CURRENT
                            largest gap between already-planned points (start with [start, mid,
                            end], repeatedly bisect the widest remaining interval); this is
                            deliberately not "evenly spaced across the whole span" naively — that
                            formula can land an extra point exactly ON an already-planned point
                            (e.g. duration=12.0s's one extra frame at duration/2 exactly equals
                            the midpoint already-planned above), producing a collided/duplicate
                            timestamp. Bisecting the largest gap is collision-free by construction
                            (a gap's midpoint is always strictly between two distinct existing
                            points) and still yields even, deterministic coverage.

    epsilon keeps the start/end samples just inside the shot's own boundary (never exactly on
    the detected cut frame, where a hard cut can occasionally still show a sliver of the
    previous/next shot) — min(0.15s, 5% of duration), always well inside the midpoint for any
    duration this branch can be reached with (>= 1.0s).
    """
    duration = end_time - start_time
    if duration <= 0:
        return []

    if duration < FRAME_SHORT_SHOT_SECONDS:
        return [{"timestamp": start_time + duration / 2, "extraction_method": "shot_midpoint"}]

    epsilon = min(FRAME_EPSILON_MAX_SECONDS, duration * FRAME_EPSILON_FRACTION)
    points: list[tuple[str, float]] = [
        ("shot_start", start_time + epsilon),
        ("shot_midpoint", start_time + duration / 2),
        ("shot_end", end_time - epsilon),
    ]

    if duration > FRAME_LONG_SHOT_SECONDS:
        extra_count = min(
            FRAME_MAX_PER_SHOT - len(points),
            int((duration - FRAME_LONG_SHOT_SECONDS) // FRAME_EXTRA_INTERVAL_SECONDS),
        )
        timestamps = sorted(t for _, t in points)
        for i in range(extra_count):
            gaps = [(timestamps[j + 1] - timestamps[j], j) for j in range(len(timestamps) - 1)]
            _, widest_j = max(gaps)
            new_t = (timestamps[widest_j] + timestamps[widest_j + 1]) / 2
            timestamps.insert(widest_j + 1, new_t)
            points.append((f"shot_interval_{i + 1}", new_t))

    points.sort(key=lambda p: p[1])
    return [{"timestamp": t, "extraction_method": m} for m, t in points]


def compute_frame_measurements(image_path: str) -> dict:
    """Deterministic, local, pixel-only measurements for one extracted frame image — Pillow +
    numpy only (both already installed; no OpenCV, no new dependency). Every value here is a
    direct fact about the image's own pixels — nothing interprets or names what the frame shows.

    Returns {"width", "height", "luminance_mean", "is_black_frame", "sharpness_score"}.

    sharpness_score is a discrete-Laplacian (edge-energy) variance — a standard, well-known
    blur/sharpness proxy: a sharp image has strong local intensity changes (high-variance
    Laplacian response); a blurred one is smooth (low-variance). Computed directly with numpy
    slicing (edge-padded, no wraparound artifacts) — no scipy/OpenCV dependency needed.
    """
    img = Image.open(image_path)
    width, height = img.size
    gray = np.asarray(img.convert("L"), dtype=np.float64)

    luminance_mean = float(gray.mean())

    padded = np.pad(gray, 1, mode="edge")
    laplacian = (
        -4 * padded[1:-1, 1:-1]
        + padded[:-2, 1:-1] + padded[2:, 1:-1]
        + padded[1:-1, :-2] + padded[1:-1, 2:]
    )
    sharpness_score = float(laplacian.var())

    return {
        "width": width,
        "height": height,
        "luminance_mean": round(luminance_mean, 2),
        "is_black_frame": luminance_mean <= FRAME_BLACK_LUMINANCE_THRESHOLD,
        "sharpness_score": round(sharpness_score, 2),
    }


_DHASH_SIZE = 8  # -> a 9x8 grayscale thumbnail -> a 64-bit hash


def compute_dhash(image_path: str) -> int:
    """Difference hash (dHash) — Pillow + numpy only, no new dependency (no `imagehash` package
    installed or needed). Resizes to a tiny 9x8 grayscale thumbnail and encodes whether each
    pixel is brighter than its right neighbour as one bit; visually near-identical frames produce
    identical or near-identical hashes, robust to the small compression/timing noise between two
    ffmpeg extractions of almost the same instant. Used ONLY to decide whether to skip storing a
    near-duplicate candidate frame — never used to interpret content."""
    img = Image.open(image_path).convert("L").resize((_DHASH_SIZE + 1, _DHASH_SIZE), Image.LANCZOS)
    pixels = np.asarray(img, dtype=np.int16)
    diff = pixels[:, 1:] > pixels[:, :-1]
    bits = 0
    for bit in diff.flatten():
        bits = (bits << 1) | int(bit)
    return bits


def hamming_distance(a: int, b: int) -> int:
    return bin(a ^ b).count("1")


async def extract_representative_frames_for_shot(
    video_path: str, shot_start: float, shot_end: float, user_id: int, total_duration: float | None = None,
) -> list[dict]:
    """Extracts one Shot's full representative-frame candidate set (see
    plan_representative_frame_timestamps), skipping any candidate whose dHash is a near-duplicate
    of the immediately-preceding ACCEPTED frame in this same shot — comparison is always against
    the last frame actually KEPT, not the last candidate tried, so a run of several near-identical
    candidates collapses to just the first one, not every-other-one.

    `total_duration` (the ReferenceVideo's own probed container duration, from Stage 3) clamps
    every candidate timestamp to stay at least END_OF_FILE_SAFETY_SECONDS before it — see that
    constant's own docstring for why. Pass None only when no known total duration exists (never
    true at this app's own real call site).

    A skipped duplicate's temporary file is deleted immediately — it is never persisted, never
    becomes an Asset row, and never appears in the returned list.

    Returns only the accepted frames, in chronological order, each as
    {"timestamp", "extraction_method", "order", "file_path", "measurements"} — `order` is
    renumbered densely (0..N-1) over the accepted set only, so a skipped duplicate never leaves a
    gap in the sequence a caller will persist.

    If any candidate's extraction/measurement raises partway through this shot's own plan, every
    file this call has written so far (accepted or already-skipped-as-duplicate) is unlinked
    before the exception propagates — nothing from a call that never returns is left on disk with
    no return value (and therefore no DB row) to ever reference it.
    """
    plan = plan_representative_frame_timestamps(shot_start, shot_end)
    if total_duration is not None:
        safe_limit = max(0.0, total_duration - END_OF_FILE_SAFETY_SECONDS)
        for point in plan:
            point["timestamp"] = min(point["timestamp"], safe_limit)

    accepted: list[dict] = []
    all_written: list[Path] = []
    last_hash: int | None = None
    try:
        for point in plan:
            out_path = await extract_thumbnail(video_path, user_id, timestamp=point["timestamp"])
            all_written.append(out_path)
            digest = compute_dhash(str(out_path))
            if last_hash is not None and hamming_distance(digest, last_hash) <= FRAME_DUPLICATE_HAMMING_THRESHOLD:
                out_path.unlink(missing_ok=True)
                continue
            measurements = compute_frame_measurements(str(out_path))
            accepted.append({
                "timestamp": point["timestamp"],
                "extraction_method": point["extraction_method"],
                "order": len(accepted),
                "file_path": str(out_path),
                "measurements": measurements,
            })
            last_hash = digest
        return accepted
    except Exception:
        for p in all_written:
            try:
                p.unlink(missing_ok=True)
            except OSError:
                pass
        raise
