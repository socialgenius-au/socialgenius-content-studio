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
    user_id: int,
) -> Path:
    """One clip's [trimIn, trimIn+sourceDuration) source range → a single normalized segment:
    speed-adjusted, colour/brightness/contrast/saturation applied, scaled to FILL the project's
    canvas size (see Step 7.15H's own "FILL" note below), re-encoded to one common codec/
    framerate/audio format so segments can be crossfaded together afterward regardless of their
    original, possibly-differing source formats.

    STEP 7.15H (canvas-fill defect): this used to be FIT (`force_original_aspect_ratio=decrease`
    + `pad`) — mathematically correct, but for any source whose aspect ratio doesn't already
    match the selected canvas (portrait footage exported to a 16:9 canvas, the exact reported
    case) that produces heavy letterboxing/pillarboxing: verified directly, a 480x864 source
    fit into a 1920x1080 canvas rendered at only ~600px wide (≈31% of the frame) surrounded by
    black — correct FIT math, but exactly the "very small ... excessive black space" defect
    reported. Switched to FILL (`force_original_aspect_ratio=increase` + centre `crop`): the
    source is scaled up until it fully covers the canvas on both axes, with any overflow beyond
    the canvas centre-cropped away — genuinely occupies the full canvas, never stretches/
    distorts (only ever crops), and there is no per-clip crop/transform/pan setting anywhere in
    the data model yet to otherwise decide "which part remains visible", so a plain centre-crop
    is the complete, correct implementation for now. NOTE: the live Create/Edit preview's own
    canvas (`.real-video-el { object-fit: contain }` in VideoStudioV2.css) still uses FIT/
    letterbox and was deliberately left untouched by this fix (out of this defect's scope, and
    changing previously-approved preview rendering needs its own sign-off) — so after this
    change, a mismatched-aspect clip's export will visually differ from its own Create/Edit
    preview (filled vs. letterboxed) until/unless the preview is updated to match.

    keep_audio=False (this clip's audio has been separated to its own A1 track — Step 7.6A's
    "V1 is muted once separated" rule applies here too, so the base timeline must not carry a
    second copy of that audio) still produces a real (silent) audio stream rather than none at
    all, so every segment has a uniform [v][a] shape for the concat/crossfade step below.
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
    vf_parts.append(
        f"scale={canvas_w}:{canvas_h}:force_original_aspect_ratio=increase,"
        f"crop={canvas_w}:{canvas_h},setsar=1"
    )
    vf = ",".join(vf_parts)

    common_out = ["-r", "30", "-pix_fmt", "yuv420p", "-c:v", "libx264",
                  "-ar", "44100", "-ac", "2", "-c:a", "aac"]

    if keep_audio:
        cmd = [FFMPEG_BIN, "-y", "-ss", str(trim_in), "-t", str(source_duration), "-i", input_path, "-vf", vf]
        if speed != 1:
            cmd += ["-af", _atempo_chain(speed)]
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
        seg = await build_clip_segment(
            c["path"], c["trim_in"], (c["end_time"] - c["start_time"]) * c["speed"], c["speed"],
            c["color_grade"], c["brightness"], c["contrast"], c["saturation"],
            cw, ch, keep_audio=not c["has_separated_audio"], user_id=user_id,
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
