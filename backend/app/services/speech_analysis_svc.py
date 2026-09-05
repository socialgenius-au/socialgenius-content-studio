"""Video Deconstructor — Stage 7 (Audio / Speech / Transcript), Phase B: an independent, local
speech-analysis service. Pure input (a file path) -> output (a plain dict) function — no
SQLAlchemy, no ReferenceVideo/VideoAnalysis awareness, no database access, no frontend/editor
dependency of any kind. This is deliberately a peer of `ocr_svc.py` (Stage 6's own analogous
"pure engine call, no DB knowledge" service), not a caller of it and not called by it.

Deliberately NOT a change to, or a shared abstraction with, `whisper_svc.py` — that file backs
Ayub's live, unrelated "Generate Captions from Audio" editor feature and is read here only as a
reference for the validated local-model-loading pattern (lazy singleton, dedicated thread pool,
`fp16=False`). This service owns its own, separate model cache and thread pool — functional
isolation is intentional while the Deconstructor side is still being built, not an oversight.

Audio decoding (post-real-validation fix): passing a file path straight to `model.transcribe()`
was tried first and found NOT safe in this environment — Whisper's own `load_audio()` (see
`whisper/audio.py`) shells out to a BARE `"ffmpeg"` command name via subprocess, and this
environment has no system `ffmpeg` on PATH at all (confirmed by a real local run: the model
downloaded and loaded successfully, only the decode step failed with
`FileNotFoundError: [WinError 2]`). Since `whisper.audio.log_mel_spectrogram` only ever calls
`load_audio()` when its input `isinstance(audio, str)` — an already-decoded numpy array skips
that code path entirely (verified by direct source inspection of the installed package) — this
module decodes the source media itself, through the project's own already-installed
`imageio_ffmpeg`-bundled binary (the same one `ffmpeg_svc.py` resolves via
`imageio_ffmpeg.get_ffmpeg_exe()` — imported directly from the `imageio_ffmpeg` package here,
NOT from `ffmpeg_svc.py` itself, so that file stays completely untouched), and passes the
resulting array to `model.transcribe()` instead of a path. The decode command and output format
below are an exact match of Whisper's own `load_audio()` (same `-nostdin -threads 0 -f s16le -ac
1 -acodec pcm_s16le -ar 16000` flags, same `int16 -> float32 / 32768.0` normalization) — the ONLY
difference from Whisper's own implementation is which literal ffmpeg executable path is invoked.

Confidence discipline (the reason this file exists as its own module rather than a copy-paste of
whisper_svc.py): Whisper's own per-segment decoding diagnostics (avg_logprob, no_speech_prob,
compression_ratio, temperature — confirmed present on every segment dict returned by the
currently-installed openai-whisper version's own `transcribe.py`, via direct source inspection)
are NOT a calibrated 0-1 probability of transcript correctness. This service NEVER converts them
into a confidence_score, a percentage, or any other invented precision — they are returned
verbatim, nested under each segment's own `analysis_details` key, named and shaped to drop
directly into `SpeechSegment.analysis_details` (Phase A) with zero transformation. Nothing in
this file computes, estimates, or infers a confidence value; "confidence unavailable" (simply
omitting the key) is always preferred over fabricating one.

Scope discipline: segment-level timestamps only (Whisper's own default) — word-level timestamps
are never requested from Whisper here (word_timestamps is never set to True), no word-alignment
logic exists, and no diarization/speaker-labeling of any kind is performed — every returned
segment is speaker-agnostic by design. No silence pre-filtering, no amplitude-based skipping —
the entire source is handed to Whisper as-is; silence/audio-structure analysis is explicitly a
separate, later capability (Phase D), not this file's concern.
"""
import asyncio
import subprocess
from concurrent.futures import ThreadPoolExecutor

import numpy as np

# Separate from whisper_svc.py's own executor/singleton — see this module's own docstring for why
# functional isolation is intentional here, not accidental duplication.
_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="speech_analysis")
_models: dict[str, "whisper.Model"] = {}  # noqa: F821 -- keyed by model name, see _get_model
_models_lock = asyncio.Lock()

DEFAULT_MODEL_NAME = "base"  # same default whisper_svc.py already uses; no established
# repository configuration exists for a different default (confirmed: no MODEL_NAME/whisper
# setting anywhere in app/config.py), so Phase B keeps the one already-validated choice.

# The exact set of raw Whisper segment-diagnostic keys this service knows to look for and
# preserve verbatim, confirmed present on every segment dict returned by the currently-installed
# openai-whisper version's own transcribe.py (new_segment(), see this module's own docstring).
# Read defensively (dict.get, never direct indexing) so a different Whisper version that omits
# one of these never crashes this service — see the module docstring's "missing optional
# diagnostics" requirement.
_RAW_DIAGNOSTIC_KEYS = ("avg_logprob", "no_speech_prob", "compression_ratio", "temperature")

# Whisper's own hard-coded expectation (whisper/audio.py's own SAMPLE_RATE) — matched exactly,
# never a different convention invented here.
_WHISPER_SAMPLE_RATE = 16000


def _resolve_ffmpeg_exe() -> str:
    """The project's own already-installed, bundled ffmpeg binary — never a bare "ffmpeg" name
    resolved off the system PATH (that is exactly what Whisper's own load_audio() does, and
    exactly what a real local run proved unsafe to rely on in this environment: the model itself
    loaded fine, only that PATH lookup failed). Imported directly from imageio_ffmpeg here, never
    via ffmpeg_svc.py — that file is intentionally left untouched by Phase B."""
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def _decode_audio_to_array(file_path: str) -> np.ndarray:
    """Decodes `file_path` (audio or video) into the exact array shape/dtype/sample-rate Whisper
    itself expects — an exact match of whisper/audio.py's own load_audio(), down to the same
    ffmpeg flags and the same int16->float32 normalization, with the one deliberate difference
    that the explicit bundled ffmpeg executable is invoked instead of a bare "ffmpeg" name. A
    real decoding failure (bad file, corrupt media, unsupported format) raises a genuine
    RuntimeError — never an empty/fabricated array — so it can never be mistaken for a
    successful "no speech detected" result downstream.
    """
    ffmpeg_exe = _resolve_ffmpeg_exe()
    cmd = [
        ffmpeg_exe,
        "-nostdin",
        "-threads", "0",
        "-i", file_path,
        "-f", "s16le",
        "-ac", "1",
        "-acodec", "pcm_s16le",
        "-ar", str(_WHISPER_SAMPLE_RATE),
        "-",
    ]
    try:
        completed = subprocess.run(cmd, capture_output=True, check=True)
    except subprocess.CalledProcessError as e:
        raise RuntimeError(f"Failed to decode media for speech analysis: {e.stderr.decode(errors='replace')}") from e
    except FileNotFoundError as e:
        # The bundled executable itself couldn't be found/run — a real environment problem,
        # never silently treated as "no speech."
        raise RuntimeError(f"Could not run the bundled ffmpeg executable for speech analysis: {e}") from e

    return np.frombuffer(completed.stdout, np.int16).flatten().astype(np.float32) / 32768.0


async def _get_model(model_name: str):
    """Lazy-loaded, cached per model_name — a repeated call with the same model_name never
    reloads it; a call with a different model_name (not used by Phase B today, but the parameter
    already exists per the service's own input contract) loads and caches that one separately."""
    if model_name not in _models:
        async with _models_lock:
            if model_name not in _models:
                import whisper  # local import: no hard Whisper-engine dependency for any caller
                # that only wants this module's own pure helpers without ever calling analyze_speech.
                loop = asyncio.get_event_loop()
                _models[model_name] = await loop.run_in_executor(_executor, lambda: whisper.load_model(model_name))
    return _models[model_name]


def _extract_raw_diagnostics(segment: dict) -> dict:
    """Every raw diagnostic key ACTUALLY present on this specific segment, verbatim, unmodified —
    never a fabricated default for a key Whisper didn't return. Returns {} (not a dict of Nones)
    when none of the expected keys are present, so a caller can always safely check truthiness
    rather than filter out None values itself."""
    return {key: segment[key] for key in _RAW_DIAGNOSTIC_KEYS if key in segment}


async def analyze_speech(file_path: str, *, language: str | None = None, model_name: str = DEFAULT_MODEL_NAME) -> dict:
    """Runs local Whisper speech recognition against one local media file (audio or video). The
    source is first decoded to a 16kHz mono float32 array via the project's own bundled ffmpeg
    binary (see _decode_audio_to_array's own docstring for exactly why — a real local run proved
    handing Whisper a bare file path unsafe in this environment, since Whisper's own internal
    load_audio() depends on a system-PATH "ffmpeg" this environment doesn't have), then that
    array — never a path — is what Whisper itself actually decodes.

    Args:
        file_path: path to a local audio or video file. This function does not know or care
            whether it came from a ReferenceVideo, an Asset, or anything else — that mapping is
            entirely the caller's responsibility (a future Stage 7 router, not built in Phase B).
        language: an ISO-639-1-ish language code hint (e.g. "en", "hi", "ur", "ar") Whisper
            already supports via its own `language=` decoding option, or None to let Whisper
            perform its own language detection. This service builds no language-detection logic
            of its own — whatever Whisper reports is returned honestly as `detected_language`,
            including its own known accuracy limitations on mixed-language/code-switched audio.
        model_name: which local Whisper model size to load (default "base", matching the one
            already validated elsewhere in this project). Loading a new model_name for the first
            time is real cost (a model load); every call after that first one for the SAME
            model_name reuses the cached instance.

    Returns a dict:
        {
            "full_text": str,                    # Whisper's own full decoded text, stripped
            "detected_language": str | None,      # Whisper's own reported language for this run
            "model_used": str,                    # the model_name actually used
            "segments": [
                {
                    "start_time": float,
                    "end_time": float,
                    "text": str,                  # stripped of accidental surrounding whitespace
                                                   # only — no grammar/spelling/punctuation changes
                    "analysis_details": dict,     # raw Whisper diagnostics present on this
                                                   # segment, verbatim (see module docstring) —
                                                   # never includes a confidence_score
                },
                ...
            ],  # empty list is a normal, valid, successful result for genuinely no-speech media
            "analysis_metadata": {
                "engine": "whisper",
                "model_used": model_name,
                "language_requested": language,   # exactly what the caller asked for (or None)
            },
        }

    A genuine failure — a media-decoding failure (bad file, corrupt media, unsupported format, or
    the bundled ffmpeg executable itself failing to run) OR a genuine Whisper/model failure —
    propagates as a real exception (RuntimeError for a decode failure, whatever Whisper/Python
    itself raises for a model failure). This function never catches and swallows either kind of
    error, and never fabricates a fallback transcript or an empty "no speech" result in their
    place — an empty result only ever means media decoded successfully and Whisper itself found
    no usable speech in it. A future router is responsible for turning any raised exception into
    a "failed" pass_status; this service's own contract is simply: return a real result, or raise
    a real error, never a plausible-looking fake result.
    """
    model = await _get_model(model_name)
    kwargs = {"fp16": False}
    if language:
        kwargs["language"] = language

    loop = asyncio.get_event_loop()
    audio_array = await loop.run_in_executor(_executor, _decode_audio_to_array, file_path)
    result = await loop.run_in_executor(_executor, lambda: model.transcribe(audio_array, **kwargs))

    segments = [
        {
            "start_time": float(s["start"]),
            "end_time": float(s["end"]),
            "text": str(s["text"]).strip(),
            "analysis_details": _extract_raw_diagnostics(s),
        }
        for s in result.get("segments", [])
    ]

    return {
        "full_text": str(result.get("text", "")).strip(),
        "detected_language": result.get("language"),
        "model_used": model_name,
        "segments": segments,
        "analysis_metadata": {
            "engine": "whisper",
            "model_used": model_name,
            "language_requested": language,
        },
    }
