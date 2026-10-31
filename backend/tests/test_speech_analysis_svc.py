"""
Video Deconstructor — Stage 7 (Audio / Speech / Transcript), Phase B tests.

`speech_analysis_svc.py` is a pure input(file path)->output(dict) service with no SQLAlchemy/DB
dependency at all (see its own module docstring) — these tests exercise it in complete isolation,
with both Whisper and the bundled-ffmpeg decode step mocked out, the same
`unittest.mock.patch.object(..., new=AsyncMock(...))` convention test_reference_video_text.py's
own `test_forced_failure_leaves_no_orphaned_files_then_retries_cleanly` already established for
mocking an engine call in this codebase. No database, no real Whisper model load, no real
subprocess, in the mocked tests below — see the bottom of this file for the one, separate,
real-local-validation check.

Covers the requested checks: 1 (structured result contract), 2 (segment timing mapping), 3
(full_text mapping), 4 (detected language mapping), 5 (raw diagnostic preservation), 6 (missing
optional diagnostics don't crash), 7 (confidence_score is never fabricated), 8 (language=None
passes through), 9 (explicit language passes through), 10 (no-speech/no-segment result is valid),
11 (a genuine Whisper error propagates, never a fake success), 12 (model caching), 13 (bundled
imageio-ffmpeg executable is used explicitly, never a bare "ffmpeg" name), 14 (Whisper receives a
decoded array, never a source file path), 15 (audio normalization/dtype/shape matches Whisper's
own load_audio() convention exactly), 16 (a genuine decoding failure propagates honestly, distinct
from a Whisper failure).
"""
import subprocess
import sys
from unittest.mock import AsyncMock, MagicMock, patch

import numpy as np
import pytest

from app.services import speech_analysis_svc
from app.services.speech_analysis_svc import analyze_speech, _decode_audio_to_array, _get_model

# A small, fixed sentinel array standing in for "whatever _decode_audio_to_array would have
# produced" — every test below that only cares about Whisper-side behavior mocks the decode step
# out entirely with this, so it never touches subprocess/ffmpeg/the filesystem at all.
_FAKE_DECODED_AUDIO = np.array([0.0, 0.1, -0.1], dtype=np.float32)


def _fake_model(transcribe_result: dict) -> MagicMock:
    model = MagicMock()
    model.transcribe = MagicMock(return_value=transcribe_result)
    return model


def _patched_decode():
    """Standard patch for every test that only exercises analyze_speech's own Whisper-facing
    logic — decoding itself is covered separately, below, by its own dedicated tests."""
    return patch.object(speech_analysis_svc, "_decode_audio_to_array", return_value=_FAKE_DECODED_AUDIO)


# ---------------------------------------------------------------------------
# 1/2/3/4. Structured result contract: full_text, detected_language, model_used, segment timing.
# ---------------------------------------------------------------------------

async def test_result_contract_maps_whisper_output_correctly():
    fake_result = {
        "text": "  hello there, this is a test.  ",
        "language": "en",
        "segments": [
            {"id": 0, "seek": 0, "start": 0.0, "end": 1.5, "text": " hello there,", "tokens": [1, 2, 3],
             "temperature": 0.0, "avg_logprob": -0.2, "compression_ratio": 1.3, "no_speech_prob": 0.01},
            {"id": 1, "seek": 150, "start": 1.5, "end": 3.0, "text": " this is a test. ", "tokens": [4, 5],
             "temperature": 0.0, "avg_logprob": -0.35, "compression_ratio": 1.1, "no_speech_prob": 0.02},
        ],
    }
    model = _fake_model(fake_result)
    with _patched_decode(), patch.object(speech_analysis_svc, "_get_model", new=AsyncMock(return_value=model)):
        result = await analyze_speech("some/file.mp4", language="en")

    assert result["full_text"] == "hello there, this is a test."
    assert result["detected_language"] == "en"
    assert result["model_used"] == "base"
    assert len(result["segments"]) == 2

    first = result["segments"][0]
    assert first["start_time"] == 0.0
    assert first["end_time"] == 1.5
    assert first["text"] == "hello there,"  # whitespace-stripped only, no other change
    second = result["segments"][1]
    assert second["start_time"] == 1.5
    assert second["end_time"] == 3.0
    assert second["text"] == "this is a test."

    assert isinstance(result["analysis_metadata"], dict)
    assert result["analysis_metadata"]["engine"] == "whisper"
    assert result["analysis_metadata"]["model_used"] == "base"
    assert result["analysis_metadata"]["language_requested"] == "en"


# ---------------------------------------------------------------------------
# 5. Raw diagnostics are preserved verbatim, per segment.
# ---------------------------------------------------------------------------

async def test_raw_diagnostics_are_preserved_verbatim_per_segment():
    fake_result = {
        "text": "x", "language": "en",
        "segments": [
            {"start": 0.0, "end": 1.0, "text": "x",
             "avg_logprob": -0.4123, "no_speech_prob": 0.0321, "compression_ratio": 1.789, "temperature": 0.2},
        ],
    }
    model = _fake_model(fake_result)
    with _patched_decode(), patch.object(speech_analysis_svc, "_get_model", new=AsyncMock(return_value=model)):
        result = await analyze_speech("some/file.mp4")

    details = result["segments"][0]["analysis_details"]
    assert details == {
        "avg_logprob": -0.4123, "no_speech_prob": 0.0321,
        "compression_ratio": 1.789, "temperature": 0.2,
    }


# ---------------------------------------------------------------------------
# 6. Missing optional diagnostics never crash the service.
# ---------------------------------------------------------------------------

async def test_missing_optional_diagnostics_do_not_crash():
    fake_result = {
        "text": "x", "language": "en",
        "segments": [
            {"start": 0.0, "end": 1.0, "text": "x"},  # no diagnostic keys at all
            {"start": 1.0, "end": 2.0, "text": "y", "avg_logprob": -0.5},  # only one diagnostic key
        ],
    }
    model = _fake_model(fake_result)
    with _patched_decode(), patch.object(speech_analysis_svc, "_get_model", new=AsyncMock(return_value=model)):
        result = await analyze_speech("some/file.mp4")

    assert result["segments"][0]["analysis_details"] == {}
    assert result["segments"][1]["analysis_details"] == {"avg_logprob": -0.5}


# ---------------------------------------------------------------------------
# 7. confidence_score is never fabricated anywhere in the result.
# ---------------------------------------------------------------------------

def _contains_confidence_key(obj) -> bool:
    if isinstance(obj, dict):
        if "confidence_score" in obj or "confidence" in obj:
            return True
        return any(_contains_confidence_key(v) for v in obj.values())
    if isinstance(obj, list):
        return any(_contains_confidence_key(v) for v in obj)
    return False


async def test_confidence_score_is_never_fabricated():
    fake_result = {
        "text": "x", "language": "en",
        "segments": [
            {"start": 0.0, "end": 1.0, "text": "x", "avg_logprob": -0.05, "no_speech_prob": 0.99},
        ],
    }
    model = _fake_model(fake_result)
    with _patched_decode(), patch.object(speech_analysis_svc, "_get_model", new=AsyncMock(return_value=model)):
        result = await analyze_speech("some/file.mp4")

    # Even with a very "confident-looking" avg_logprob and a very "confident-looking" (high)
    # no_speech_prob present, nothing in the result ever introduces a confidence-like key.
    assert not _contains_confidence_key(result)


# ---------------------------------------------------------------------------
# 8/9. language=None lets Whisper detect; an explicit language is passed through.
# ---------------------------------------------------------------------------

async def test_language_none_is_not_forced_into_the_whisper_call():
    model = _fake_model({"text": "", "language": "hi", "segments": []})
    with _patched_decode(), patch.object(speech_analysis_svc, "_get_model", new=AsyncMock(return_value=model)):
        result = await analyze_speech("some/file.mp4", language=None)

    call_kwargs = model.transcribe.call_args.kwargs
    assert "language" not in call_kwargs  # Whisper's own detection is left to run, unconstrained
    assert result["detected_language"] == "hi"  # honestly reports whatever Whisper detected
    assert result["analysis_metadata"]["language_requested"] is None


async def test_explicit_language_is_passed_through_to_whisper():
    model = _fake_model({"text": "", "language": "ur", "segments": []})
    with _patched_decode(), patch.object(speech_analysis_svc, "_get_model", new=AsyncMock(return_value=model)):
        await analyze_speech("some/file.mp4", language="ur")

    call_kwargs = model.transcribe.call_args.kwargs
    assert call_kwargs["language"] == "ur"


# ---------------------------------------------------------------------------
# 10. No-speech media is a valid, successful, empty result — never an error, never invented text.
# ---------------------------------------------------------------------------

async def test_no_speech_result_is_valid_and_empty_not_an_error():
    model = _fake_model({"text": "", "language": "en", "segments": []})
    with _patched_decode(), patch.object(speech_analysis_svc, "_get_model", new=AsyncMock(return_value=model)):
        result = await analyze_speech("silent/file.mp4")

    assert result["segments"] == []
    assert result["full_text"] == ""
    assert result["detected_language"] == "en"  # a real result, not an exception


# ---------------------------------------------------------------------------
# 11. A genuine Whisper failure propagates — never swallowed into a fake success.
# ---------------------------------------------------------------------------

async def test_genuine_whisper_failure_propagates():
    model = MagicMock()
    model.transcribe = MagicMock(side_effect=RuntimeError("simulated real decoding failure"))
    with _patched_decode(), patch.object(speech_analysis_svc, "_get_model", new=AsyncMock(return_value=model)):
        with pytest.raises(RuntimeError, match="simulated real decoding failure"):
            await analyze_speech("some/file.mp4")


async def test_model_loading_failure_propagates():
    with _patched_decode(), patch.object(speech_analysis_svc, "_get_model", new=AsyncMock(side_effect=OSError("model file missing"))):
        with pytest.raises(OSError, match="model file missing"):
            await analyze_speech("some/file.mp4")


# ---------------------------------------------------------------------------
# 12. Model lazy-loading/caching: a repeated call with the same model_name does not reload it.
# ---------------------------------------------------------------------------

async def test_model_is_cached_and_not_reloaded_on_repeated_calls():
    speech_analysis_svc._models.clear()  # isolate this test from any other test's cache state
    fake_whisper_module = MagicMock()
    fake_model_instance = MagicMock()
    fake_whisper_module.load_model = MagicMock(return_value=fake_model_instance)

    with patch.dict(sys.modules, {"whisper": fake_whisper_module}):
        first = await _get_model("base")
        second = await _get_model("base")

    assert first is second is fake_model_instance
    fake_whisper_module.load_model.assert_called_once_with("base")  # never reloaded
    speech_analysis_svc._models.clear()  # leave no cached state behind for other tests


# ---------------------------------------------------------------------------
# 13. The bundled imageio-ffmpeg executable is resolved and invoked explicitly — never a bare
#     "ffmpeg" name (that is exactly the system-PATH dependency a real local run proved unsafe).
# ---------------------------------------------------------------------------

def test_decode_audio_invokes_the_bundled_ffmpeg_executable_explicitly():
    fake_exe_path = r"C:\fake\bundled\ffmpeg.exe"
    fake_pcm_bytes = np.array([0], dtype=np.int16).tobytes()
    fake_completed = subprocess.CompletedProcess(args=[], returncode=0, stdout=fake_pcm_bytes, stderr=b"")

    with patch.object(speech_analysis_svc, "_resolve_ffmpeg_exe", return_value=fake_exe_path), \
         patch("app.services.speech_analysis_svc.subprocess.run", return_value=fake_completed) as mock_run:
        speech_analysis_svc._decode_audio_to_array("some/file.mp4")

    called_cmd = mock_run.call_args.args[0]
    assert called_cmd[0] == fake_exe_path  # the resolved bundled path, never the literal "ffmpeg"
    assert called_cmd[0] != "ffmpeg"


# ---------------------------------------------------------------------------
# 14. Whisper receives a decoded array, never the source file path.
# ---------------------------------------------------------------------------

async def test_whisper_receives_decoded_array_not_a_filepath():
    sentinel_array = np.array([0.5, -0.5, 0.0], dtype=np.float32)
    model = _fake_model({"text": "", "language": "en", "segments": []})
    with patch.object(speech_analysis_svc, "_decode_audio_to_array", return_value=sentinel_array), \
         patch.object(speech_analysis_svc, "_get_model", new=AsyncMock(return_value=model)):
        await analyze_speech("some/file.mp4")

    passed_audio = model.transcribe.call_args.args[0]
    assert passed_audio is sentinel_array  # the exact decoded array, not a string path
    assert not isinstance(passed_audio, str)


# ---------------------------------------------------------------------------
# 15. Audio normalization/dtype/shape matches Whisper's own load_audio() convention exactly.
# ---------------------------------------------------------------------------

def test_decoded_audio_matches_whisper_load_audio_convention():
    # int16 PCM samples chosen to make the expected float32 normalization exact and checkable:
    # 16384 / 32768 = 0.5, -16384 / 32768 = -0.5, 0 / 32768 = 0.0.
    raw_pcm = np.array([16384, -16384, 0], dtype=np.int16).tobytes()
    fake_completed = subprocess.CompletedProcess(args=[], returncode=0, stdout=raw_pcm, stderr=b"")

    with patch.object(speech_analysis_svc, "_resolve_ffmpeg_exe", return_value="fake_ffmpeg"), \
         patch("app.services.speech_analysis_svc.subprocess.run", return_value=fake_completed) as mock_run:
        array = speech_analysis_svc._decode_audio_to_array("some/file.mp4")

    assert array.dtype == np.float32
    assert array.ndim == 1  # flattened, mono
    np.testing.assert_allclose(array, np.array([0.5, -0.5, 0.0], dtype=np.float32))

    # Same ffmpeg flags Whisper's own load_audio() uses (mono, pcm_s16le, 16kHz raw output to stdout).
    called_cmd = mock_run.call_args.args[0]
    assert "-ac" in called_cmd and called_cmd[called_cmd.index("-ac") + 1] == "1"
    assert "-acodec" in called_cmd and called_cmd[called_cmd.index("-acodec") + 1] == "pcm_s16le"
    assert "-ar" in called_cmd and called_cmd[called_cmd.index("-ar") + 1] == "16000"
    assert "-f" in called_cmd and called_cmd[called_cmd.index("-f") + 1] == "s16le"


# ---------------------------------------------------------------------------
# 16. A genuine decoding failure propagates honestly — distinct from a Whisper failure, never an
#     empty/fabricated array and never mistaken for "no speech."
# ---------------------------------------------------------------------------

def test_decode_failure_from_bad_media_propagates():
    with patch.object(speech_analysis_svc, "_resolve_ffmpeg_exe", return_value="fake_ffmpeg"), \
         patch(
             "app.services.speech_analysis_svc.subprocess.run",
             side_effect=subprocess.CalledProcessError(1, ["fake_ffmpeg"], stderr=b"Invalid data found"),
         ):
        with pytest.raises(RuntimeError, match="Failed to decode media"):
            speech_analysis_svc._decode_audio_to_array("corrupt/file.mp4")


def test_decode_failure_when_bundled_executable_itself_is_missing():
    with patch.object(speech_analysis_svc, "_resolve_ffmpeg_exe", return_value="missing_ffmpeg"), \
         patch("app.services.speech_analysis_svc.subprocess.run", side_effect=FileNotFoundError("no such file")):
        with pytest.raises(RuntimeError, match="Could not run the bundled ffmpeg executable"):
            speech_analysis_svc._decode_audio_to_array("some/file.mp4")


async def test_decode_failure_propagates_through_analyze_speech_and_never_produces_a_result():
    with patch.object(speech_analysis_svc, "_decode_audio_to_array", side_effect=RuntimeError("Failed to decode media for speech analysis: bad input")):
        with pytest.raises(RuntimeError, match="Failed to decode media"):
            await analyze_speech("corrupt/file.mp4")
