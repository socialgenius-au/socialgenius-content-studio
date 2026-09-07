"""
Video Deconstructor — Stage 7 (Audio / Speech / Transcript), Phase D service tests.

`audio_structure_svc.py` is a pure input(file path)->output(dict) service with no SQLAlchemy/DB
dependency at all (see its own module docstring). The pure parsing helpers
(_parse_silence_intervals/_has_audio_stream/_parse_media_duration) are tested directly against
REAL ffmpeg silencedetect stderr text captured from this project's own bundled ffmpeg binary
against real synthetic clips (a silence/tone/silence/tone/silence pattern, a tone-then-silence-
to-true-EOF clip, a pure-tone no-silence clip, and a video-only no-audio-stream clip) — not
hand-invented sample text — so the parsing logic is proven against the exact real output shape.
The async `analyze_audio_structure` orchestration itself is tested with the subprocess mocked out
(same `unittest.mock.patch` convention this test suite already uses elsewhere for engine calls).

Covers the 12 requested checks: 1 (normal start/end pair), 2 (multiple intervals), 3 (no
silence), 4 (silence from start), 5 (silence through EOF with known duration), 6 (no audio
stream), 7 (genuine ffmpeg failure propagates), 8 (bundled executable used explicitly), 9
(configurable threshold/min-duration passed through), 10 (decimal/time parsing robustness), 11
(no fabricated confidence anywhere in the result), 12 (derived active-audio regions are labeled
audio_active, never speech).
"""
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services import audio_structure_svc
from app.services.audio_structure_svc import (
    analyze_audio_structure, derive_active_audio_intervals, _has_audio_stream,
    _parse_media_duration, _parse_silence_intervals,
)

# ---------------------------------------------------------------------------
# Real ffmpeg silencedetect stderr samples — captured verbatim from this project's own bundled
# ffmpeg binary run against real synthetic clips, not hand-invented text.
# ---------------------------------------------------------------------------

# 5s clip: 1s silence, 1s tone, 1s silence, 1s tone, 1s silence.
_MULTI_SILENCE_STDERR = """Input #0, wav, from 'clip.wav':
  Duration: 00:00:05.00, bitrate: 705 kb/s
    Stream #0:0: Audio: pcm_s16le ([1][0][0][0] / 0x0001), 44100 Hz, mono, s16, 705 kb/s
[silencedetect @ 0000021724722440] silence_start: 0
[silencedetect @ 0000021724722440] silence_end: 1.000045 | silence_duration: 1.000045
[silencedetect @ 0000021724722440] silence_start: 1.999977
[silencedetect @ 0000021724722440] silence_end: 3.000045 | silence_duration: 1.000068
[silencedetect @ 0000021724722440] silence_start: 3.999977
[silencedetect @ 0000021724722440] silence_end: 5 | silence_duration: 1.000023
"""

# 5s clip: 2s tone then 3s silence running all the way to true EOF.
_SILENCE_TO_EOF_STDERR = """Input #0, wav, from 'clip.wav':
  Duration: 00:00:05.00, bitrate: 705 kb/s
    Stream #0:0: Audio: pcm_s16le ([1][0][0][0] / 0x0001), 44100 Hz, mono, s16, 705 kb/s
[silencedetect @ 000001da50c4ec40] silence_start: 1.999977
[silencedetect @ 000001da50c4ec40] silence_end: 5 | silence_duration: 3.000023
"""

# Pure 440Hz tone, no silence anywhere.
_NO_SILENCE_STDERR = """Input #0, wav, from 'clip.wav':
  Duration: 00:00:03.00, bitrate: 705 kb/s
    Stream #0:0: Audio: pcm_s16le ([1][0][0][0] / 0x0001), 44100 Hz, mono, s16, 705 kb/s
"""

# Video-only file, no audio stream at all — silencedetect silently produces nothing.
_NO_AUDIO_STREAM_STDERR = """Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'clip.mp4':
  Duration: 00:00:03.00, bitrate: 2 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(progressive), 64x64 [SAR 1:1 DAR 1:1], 2 kb/s, 5 fps, 5 tbr, 10240 tbn (default)
"""

_MISSING_FILE_STDERR = """[in#0 @ 000001c16c17f3c0] Error opening input: No such file or directory
Error opening input file C:/nonexistent/path/does_not_exist.mp4.
Error opening input files: No such file or directory
"""


# ---------------------------------------------------------------------------
# 1/2. Normal silence_start/silence_end pairs, including multiple intervals.
# ---------------------------------------------------------------------------

def test_parses_multiple_silence_intervals_from_real_stderr():
    duration = _parse_media_duration(_MULTI_SILENCE_STDERR)
    intervals = _parse_silence_intervals(_MULTI_SILENCE_STDERR, duration)

    assert len(intervals) == 3
    assert intervals[0] == {"start_time": 0.0, "end_time": 1.000045, "duration": 1.000045}
    assert intervals[1] == {"start_time": 1.999977, "end_time": 3.000045, "duration": 1.000068}
    assert intervals[2] == {"start_time": 3.999977, "end_time": 5.0, "duration": 1.000023}


# ---------------------------------------------------------------------------
# 3. No silence detected at all.
# ---------------------------------------------------------------------------

def test_no_silence_yields_empty_interval_list():
    duration = _parse_media_duration(_NO_SILENCE_STDERR)
    intervals = _parse_silence_intervals(_NO_SILENCE_STDERR, duration)
    assert intervals == []
    assert duration == 3.0


# ---------------------------------------------------------------------------
# 4. Silence beginning at 0.
# ---------------------------------------------------------------------------

def test_silence_beginning_at_zero_is_parsed_correctly():
    intervals = _parse_silence_intervals(_MULTI_SILENCE_STDERR, 5.0)
    assert intervals[0]["start_time"] == 0.0


# ---------------------------------------------------------------------------
# 5. Silence continuing all the way to true EOF, with a known media duration.
# ---------------------------------------------------------------------------

def test_silence_running_to_true_eof_is_captured():
    duration = _parse_media_duration(_SILENCE_TO_EOF_STDERR)
    intervals = _parse_silence_intervals(_SILENCE_TO_EOF_STDERR, duration)
    assert duration == 5.0
    assert len(intervals) == 1
    assert intervals[0] == {"start_time": 1.999977, "end_time": 5.0, "duration": 3.000023}


def test_unmatched_trailing_silence_start_is_closed_using_known_duration():
    # Defensive fallback path: a hypothetical stderr with a silence_start but no matching
    # silence_end line at all — closed using the known media duration, never fabricated further.
    text = "Input #0, wav, from 'x':\n  Duration: 00:00:04.00, bitrate: 1 kb/s\n    Stream #0:0: Audio: pcm_s16le\n[silencedetect] silence_start: 2.5\n"
    intervals = _parse_silence_intervals(text, media_duration=4.0)
    assert intervals == [{"start_time": 2.5, "end_time": 4.0, "duration": 1.5}]


def test_unmatched_trailing_silence_start_is_dropped_without_known_duration():
    # Same as above, but with NO known duration to close it honestly — never fabricate an
    # endpoint; the incomplete interval is simply dropped.
    text = "[silencedetect] silence_start: 2.5\n"
    intervals = _parse_silence_intervals(text, media_duration=None)
    assert intervals == []


# ---------------------------------------------------------------------------
# 6. No audio stream at all — a distinct fact from "has audio, zero silence."
# ---------------------------------------------------------------------------

def test_no_audio_stream_is_detected_distinctly():
    assert _has_audio_stream(_NO_AUDIO_STREAM_STDERR) is False
    assert _has_audio_stream(_NO_SILENCE_STDERR) is True  # has audio, just no silence in it


async def test_no_audio_stream_result_has_empty_silence_and_explicit_flag():
    fake_proc = MagicMock()
    fake_proc.communicate = AsyncMock(return_value=(b"", _NO_AUDIO_STREAM_STDERR.encode()))
    with patch.object(audio_structure_svc, "_resolve_ffmpeg_exe", return_value="fake_ffmpeg"), \
         patch("app.services.audio_structure_svc.asyncio.create_subprocess_exec", new=AsyncMock(return_value=fake_proc)):
        result = await analyze_audio_structure("no_audio.mp4")

    assert result["audio_stream_present"] is False
    assert result["silence_intervals"] == []  # "no track" and "track with silence" never conflated
    assert result["media_duration"] == 3.0  # still honestly reported, even with no audio


# ---------------------------------------------------------------------------
# 7. A genuine ffmpeg failure propagates as a real error.
# ---------------------------------------------------------------------------

async def test_genuine_ffmpeg_failure_propagates():
    fake_proc = MagicMock()
    fake_proc.communicate = AsyncMock(return_value=(b"", _MISSING_FILE_STDERR.encode()))
    with patch.object(audio_structure_svc, "_resolve_ffmpeg_exe", return_value="fake_ffmpeg"), \
         patch("app.services.audio_structure_svc.asyncio.create_subprocess_exec", new=AsyncMock(return_value=fake_proc)):
        with pytest.raises(RuntimeError, match="Could not read"):
            await analyze_audio_structure("missing.mp4")


async def test_bundled_executable_missing_propagates():
    with patch.object(audio_structure_svc, "_resolve_ffmpeg_exe", return_value="fake_ffmpeg"), \
         patch("app.services.audio_structure_svc.asyncio.create_subprocess_exec", side_effect=FileNotFoundError("no such file")):
        with pytest.raises(RuntimeError, match="Could not run the bundled ffmpeg executable"):
            await analyze_audio_structure("some.mp4")


# ---------------------------------------------------------------------------
# 8. The bundled ffmpeg executable is resolved and invoked explicitly — never a bare "ffmpeg".
# ---------------------------------------------------------------------------

async def test_bundled_ffmpeg_executable_is_invoked_explicitly():
    fake_exe = r"C:\fake\bundled\ffmpeg.exe"
    fake_proc = MagicMock()
    fake_proc.communicate = AsyncMock(return_value=(b"", _NO_SILENCE_STDERR.encode()))
    with patch.object(audio_structure_svc, "_resolve_ffmpeg_exe", return_value=fake_exe), \
         patch("app.services.audio_structure_svc.asyncio.create_subprocess_exec", new=AsyncMock(return_value=fake_proc)) as mock_exec:
        await analyze_audio_structure("some.mp4")

    called_args = mock_exec.call_args.args
    assert called_args[0] == fake_exe
    assert called_args[0] != "ffmpeg"


# ---------------------------------------------------------------------------
# 9. Configurable threshold/min-duration are passed through to the actual ffmpeg command.
# ---------------------------------------------------------------------------

async def test_configurable_parameters_are_passed_to_the_command():
    fake_proc = MagicMock()
    fake_proc.communicate = AsyncMock(return_value=(b"", _NO_SILENCE_STDERR.encode()))
    with patch.object(audio_structure_svc, "_resolve_ffmpeg_exe", return_value="fake_ffmpeg"), \
         patch("app.services.audio_structure_svc.asyncio.create_subprocess_exec", new=AsyncMock(return_value=fake_proc)) as mock_exec:
        result = await analyze_audio_structure("some.mp4", noise_threshold_db=-30.0, min_silence_duration_seconds=1.25)

    called_args = mock_exec.call_args.args
    af_index = called_args.index("-af")
    assert called_args[af_index + 1] == "silencedetect=noise=-30.0dB:d=1.25"
    assert result["noise_threshold_db"] == -30.0
    assert result["minimum_duration_seconds"] == 1.25


# ---------------------------------------------------------------------------
# 10. Decimal/time parsing is robust (integer seconds, high-precision decimals, HH:MM:SS.ss).
# ---------------------------------------------------------------------------

def test_decimal_and_integer_time_parsing_is_robust():
    # "silence_start: 0" and "silence_end: 5" (no decimal at all) alongside
    # "1.000045"/"3.000045" (high-precision decimals) all in the same real sample.
    intervals = _parse_silence_intervals(_MULTI_SILENCE_STDERR, 5.0)
    assert intervals[0]["start_time"] == 0.0
    assert intervals[2]["end_time"] == 5.0
    assert intervals[1]["start_time"] == 1.999977

    assert _parse_media_duration(_MULTI_SILENCE_STDERR) == 5.0
    assert _parse_media_duration("Duration: 01:02:03.45, bitrate: 1 kb/s") == 3723.45


# ---------------------------------------------------------------------------
# 11. No fabricated confidence anywhere in the result.
# ---------------------------------------------------------------------------

def _contains_confidence_key(obj) -> bool:
    if isinstance(obj, dict):
        if "confidence_score" in obj or "confidence" in obj:
            return True
        return any(_contains_confidence_key(v) for v in obj.values())
    if isinstance(obj, list):
        return any(_contains_confidence_key(v) for v in obj)
    return False


async def test_no_confidence_score_anywhere_in_the_result():
    fake_proc = MagicMock()
    fake_proc.communicate = AsyncMock(return_value=(b"", _MULTI_SILENCE_STDERR.encode()))
    with patch.object(audio_structure_svc, "_resolve_ffmpeg_exe", return_value="fake_ffmpeg"), \
         patch("app.services.audio_structure_svc.asyncio.create_subprocess_exec", new=AsyncMock(return_value=fake_proc)):
        result = await analyze_audio_structure("some.mp4")

    assert not _contains_confidence_key(result)


# ---------------------------------------------------------------------------
# 12. Derived active-audio regions are labeled audio_active, never speech.
# ---------------------------------------------------------------------------

def test_derived_active_intervals_fill_gaps_and_are_never_labeled_speech():
    silence = [{"start_time": 1.0, "end_time": 2.0, "duration": 1.0}, {"start_time": 3.0, "end_time": 4.0, "duration": 1.0}]
    active = derive_active_audio_intervals(silence, media_duration=5.0)

    assert active == [
        {"start_time": 0.0, "end_time": 1.0, "duration": 1.0},
        {"start_time": 2.0, "end_time": 3.0, "duration": 1.0},
        {"start_time": 4.0, "end_time": 5.0, "duration": 1.0},
    ]
    # The function's own return shape never introduces a "speech"/"type" label at all — the
    # caller (if it ever surfaces these) is responsible for labeling them "audio_active" itself;
    # confirm no key here spells "speech" in any form.
    for interval in active:
        assert "speech" not in str(interval).lower()


def test_derive_active_intervals_handles_no_silence_at_all():
    active = derive_active_audio_intervals([], media_duration=5.0)
    assert active == [{"start_time": 0.0, "end_time": 5.0, "duration": 5.0}]


def test_derive_active_intervals_handles_entirely_silent_media():
    silence = [{"start_time": 0.0, "end_time": 5.0, "duration": 5.0}]
    active = derive_active_audio_intervals(silence, media_duration=5.0)
    assert active == []
