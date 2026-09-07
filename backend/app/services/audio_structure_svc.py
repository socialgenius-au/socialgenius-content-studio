"""Video Deconstructor — Stage 7 (Audio / Speech / Transcript), Phase D: deterministic audio-
structure evidence via FFmpeg's own `silencedetect` filter. Pure input (a file path) -> output (a
plain dict) function — no SQLAlchemy, no ReferenceVideo/VideoAnalysis awareness, no database
access, no frontend/editor dependency. A peer of `ocr_svc.py`/`speech_analysis_svc.py` (Stage 6/7's
own analogous "pure engine call, no DB knowledge" services), not a caller of either and not called
by either.

Deliberately its OWN, independent bundled-ffmpeg resolution (`_resolve_ffmpeg_exe`, imported
directly from `imageio_ffmpeg`) rather than importing `ffmpeg_svc.FFMPEG_BIN` — same functional-
isolation reasoning `speech_analysis_svc.py` already established for itself: never depends on
system PATH, and this module can be understood/tested/changed without touching the shared,
Stage-1-through-6 `ffmpeg_svc.py` file at all. `_looks_like_probe_failure` below is a direct,
independent re-implementation of `ffmpeg_svc.py`'s own proven heuristic (checked directly against
this project's own installed ffmpeg binary — a genuinely missing file produces no "Input #0" line
and an explicit "Error opening input" message) — duplicated on purpose, not imported, for the
same isolation reason.

Purpose discipline (the reason this exists as its own module): the goal is to OBSERVE where
silence begins/ends/how long it lasts — never to decide what a silence means (a pause for effect?
a genuine gap? part of the "hook"?). Every returned interval is a plain fact: `silencedetect`'s own
threshold/duration parameters were met over this exact time range. No semantic labeling, no
pacing/rhythm/hook interpretation happens here — that is explicitly future-stage scope.

Confidence discipline: `silencedetect` is a deterministic amplitude-threshold filter, not a
probabilistic model — there is no "confidence" concept to report at all (unlike Whisper's own
uncalibrated decoding diagnostics in speech_analysis_svc.py, there isn't even a raw diagnostic
signal here worth preserving beyond the interval itself and the parameters used to find it). This
module never introduces a confidence_score-shaped value of any kind.

Audio-active vs. speech: this module never labels non-silent time as "speech" — active audio may
be music, SFX, ambience, speech, or any combination. See `derive_active_audio_intervals` below,
which labels its output `audio_active`, never `speech`, and is a pure complement-of-silence
computation over a known media duration — never persisted by Phase D itself (see the Phase D
router's own docstring for why: raw observed silence is the primary evidence; the complementary
active intervals are a cheap derived view, not a second source of truth to keep in sync).

Chosen defaults (documented per this stage's own requirement to explain them, not just assert
them): FFmpeg's `silencedetect` filter takes two parameters — `noise` (a dB threshold: audio at or
below this level counts as silence) and `d` (a minimum duration: a quiet stretch shorter than this
is not reported as a "silence" at all, only genuinely sustained quiet is). `-40dB` and `0.5s` are
a conservative, commonly-used starting point for spoken/social video specifically because: -40dB
is quiet enough to exclude normal room tone/mic noise floor from being misdetected as "silence"
(typical spoken dialogue peaks well above -20dB; -40dB sits comfortably below even a quiet speaker
but above genuine near-silence) while still catching a real pause; 0.5s excludes the brief,
sub-half-second gaps that occur naturally between words/syllables (which are not meaningful
"silence" for pacing/structure purposes) while still catching a genuine pause, breath, or edit
gap. Neither value is empirically tuned against this project's own real reference video the way
Stage 6's OCR thresholds were — they are a documented, deliberately conservative starting point,
kept configurable per-call (never a hardcoded constant baked into the detection command) so a
future recalibration against real data never requires a code change to this function's own
signature, only a different argument.
"""
import asyncio
import re

DEFAULT_NOISE_THRESHOLD_DB = -40.0
DEFAULT_MIN_SILENCE_DURATION_SECONDS = 0.5

_DURATION_RE = re.compile(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)")
_SILENCE_START_RE = re.compile(r"silence_start:\s*(-?[\d.]+)")
_SILENCE_END_RE = re.compile(r"silence_end:\s*(-?[\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)")


def _resolve_ffmpeg_exe() -> str:
    """The project's own already-installed, bundled ffmpeg binary — never a bare "ffmpeg" name
    resolved off the system PATH. See this module's own docstring for why this is a separate,
    independent resolution from ffmpeg_svc.FFMPEG_BIN."""
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def _looks_like_probe_failure(text: str) -> bool:
    """Independent re-implementation of ffmpeg_svc.py's own proven heuristic (see this module's
    own docstring for why it's duplicated, not imported) — verified directly against this
    project's own bundled ffmpeg binary: a genuinely unreadable/missing file produces no
    "Input #0" line at all, or an explicit "Error opening input" message."""
    if "Input #0" not in text:
        return True
    if "Error opening input" in text:
        return True
    if "Invalid data found when processing input" in text:
        return True
    return False


def _parse_media_duration(text: str) -> float | None:
    """Parses ffmpeg's own "Duration: HH:MM:SS.ss" line, already present in the SAME stderr
    output this module's own detection command produces — no separate probe call needed."""
    m = _DURATION_RE.search(text)
    if not m:
        return None
    hours, minutes, seconds = m.groups()
    return int(hours) * 3600 + int(minutes) * 60 + float(seconds)


def _has_audio_stream(text: str) -> bool:
    """Same blunt, already-proven-correct technique as ffmpeg_svc._has_audio_stream (duplicated
    independently here, not imported — see this module's own docstring): verified directly
    against a real video-only file that `-af silencedetect=...` silently produces NO error and NO
    silencedetect output lines at all for a file with no audio stream (ffmpeg just ignores an
    audio-only filter when there's nothing to apply it to) — so audio-stream presence must be
    checked explicitly; the mere absence of silence-detection output is otherwise ambiguous
    between "no audio stream" and "has audio, but zero silence detected"."""
    return "Audio:" in text


def _parse_silence_intervals(text: str, media_duration: float | None) -> list[dict]:
    """Walks silencedetect's own stderr lines in order, pairing each `silence_start` with its
    next `silence_end` (verified directly against this project's own bundled ffmpeg: every real
    silence_start line, INCLUDING one where the silence runs all the way to true end-of-file, is
    always followed by a matching silence_end line — libavfilter flushes and reports the pending
    region at EOF on its own). The defensive fallback below (closing an unmatched trailing
    silence_start using the parsed media duration) exists only for a hypothetical different
    ffmpeg build/version that doesn't do this flush — if that ever occurs AND no media duration
    is available to close it honestly, the incomplete trailing interval is dropped entirely rather
    than fabricating an end_time (see this module's own docstring: never fabricate a missing
    endpoint).

    Returns intervals in ascending start_time order, each {"start_time", "end_time", "duration"}
    — `duration` is ffmpeg's own reported `silence_duration` value, not independently recomputed,
    so it always matches exactly what the detector itself measured.
    """
    intervals: list[dict] = []
    pending_start: float | None = None
    for line in text.splitlines():
        start_match = _SILENCE_START_RE.search(line)
        if start_match:
            pending_start = float(start_match.group(1))
            continue
        end_match = _SILENCE_END_RE.search(line)
        if end_match and pending_start is not None:
            intervals.append({
                "start_time": pending_start,
                "end_time": float(end_match.group(1)),
                "duration": float(end_match.group(2)),
            })
            pending_start = None

    if pending_start is not None and media_duration is not None and media_duration > pending_start:
        intervals.append({
            "start_time": pending_start,
            "end_time": media_duration,
            "duration": media_duration - pending_start,
        })

    return intervals


def derive_active_audio_intervals(silence_intervals: list[dict], media_duration: float) -> list[dict]:
    """Pure complement-of-silence computation over [0, media_duration) — the audio-active regions
    implied BETWEEN observed silence intervals. Deliberately labeled `audio_active`, never
    `speech` (see this module's own docstring: active audio may be music, SFX, ambience, speech,
    or any combination — this function has no way to know which, and does not guess). Not
    persisted by Phase D's own router pass; a cheap derived view computed on demand, never a
    second source of truth requiring its own sync/cleanup logic."""
    sorted_silence = sorted(silence_intervals, key=lambda s: s["start_time"])
    active: list[dict] = []
    cursor = 0.0
    for s in sorted_silence:
        if s["start_time"] > cursor:
            active.append({"start_time": cursor, "end_time": s["start_time"], "duration": s["start_time"] - cursor})
        cursor = max(cursor, s["end_time"])
    if media_duration > cursor:
        active.append({"start_time": cursor, "end_time": media_duration, "duration": media_duration - cursor})
    return active


async def analyze_audio_structure(
    file_path: str,
    *,
    noise_threshold_db: float = DEFAULT_NOISE_THRESHOLD_DB,
    min_silence_duration_seconds: float = DEFAULT_MIN_SILENCE_DURATION_SECONDS,
    timeout: float = 120.0,
) -> dict:
    """Runs `ffmpeg -i <path> -af silencedetect=noise=<db>dB:d=<seconds> -f null -` — a full
    decode (like Stage 4's own shot-boundary detection), so `timeout` bounds it.

    Args:
        file_path: local audio or video file path. No knowledge of ReferenceVideo/VideoAnalysis —
            entirely the caller's responsibility.
        noise_threshold_db: silencedetect's own `noise=` parameter — audio at or below this dB
            level counts as silence. Default -40.0 (see this module's own docstring for why).
        min_silence_duration_seconds: silencedetect's own `d=` parameter — a quiet stretch
            shorter than this is never reported as a silence interval at all. Default 0.5.
        timeout: seconds before a hung/pathological run is aborted (mirrors
            ffmpeg_svc.detect_shot_boundary_candidates' own timeout convention).

    Returns a dict:
        {
            "audio_stream_present": bool,
            "media_duration": float | None,       # parsed from ffmpeg's own Duration line
            "silence_intervals": [{"start_time", "end_time", "duration"}, ...],
            "detector": "ffmpeg_silencedetect",
            "noise_threshold_db": float,           # echoes the parameters actually used
            "minimum_duration_seconds": float,
        }
        `silence_intervals` is always `[]` when `audio_stream_present` is False — "no audio
        track" and "an audio track that happens to contain silence" are kept as distinct facts,
        never conflated (see this module's own docstring).

    A genuine failure (missing/corrupt file, unreadable format, the bundled ffmpeg executable
    itself failing to run, or a timeout) raises a real RuntimeError — never a fabricated empty
    result passed off as "no silence found."
    """
    ffmpeg_exe = _resolve_ffmpeg_exe()
    cmd = [
        ffmpeg_exe, "-i", file_path,
        "-af", f"silencedetect=noise={noise_threshold_db}dB:d={min_silence_duration_seconds}",
        "-f", "null", "-",
    ]
    try:
        proc = await asyncio.create_subprocess_exec(*cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    except FileNotFoundError as e:
        raise RuntimeError(f"Could not run the bundled ffmpeg executable for audio-structure analysis: {e}") from e

    try:
        _, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError as exc:
        try:
            proc.kill()
        except ProcessLookupError:
            pass
        raise RuntimeError(f"Audio-structure detection did not complete within {timeout}s") from exc

    text_out = stderr.decode(errors="replace")
    if _looks_like_probe_failure(text_out):
        raise RuntimeError(f"Could not read {file_path!r} for audio-structure analysis: {text_out[-500:]}")

    audio_present = _has_audio_stream(text_out)
    media_duration = _parse_media_duration(text_out)
    silence_intervals = _parse_silence_intervals(text_out, media_duration) if audio_present else []

    return {
        "audio_stream_present": audio_present,
        "media_duration": media_duration,
        "silence_intervals": silence_intervals,
        "detector": "ffmpeg_silencedetect",
        "noise_threshold_db": noise_threshold_db,
        "minimum_duration_seconds": min_silence_duration_seconds,
    }
