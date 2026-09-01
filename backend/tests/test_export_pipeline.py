"""
Automated coverage for the merge -> text overlay -> audio track export chain
(app/services/ffmpeg_svc.py + POST /process/export).

Clip layout produced by the `clips` fixture, after merge_with_transitions()
with a 0.5s dissolve: red [0, 2.5) -> dissolve [2.5, 3.0) -> green [3.0, 5.0)
-> dissolve [5.0, 5.5) -> blue [5.5, 8.0). Assertions sample well inside the
pure segments to avoid the blended transition windows.
"""
import subprocess
import wave
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from app.services import ffmpeg_svc
# STEP 7.15F: no ffmpeg/ffprobe on PATH in this environment — see ffmpeg_svc.py's own header
# comment. These test-only helpers now use the same bundled binary the app itself uses
# (ffmpeg_svc.FFMPEG_BIN), and get duration via ffmpeg_svc's own ffprobe-free _get_duration
# instead of shelling out to a nonexistent ffprobe.
from app.services.ffmpeg_svc import FFMPEG_BIN

USER_ID = 999


async def _ffprobe_duration(path: str) -> float:
    return await ffmpeg_svc._get_duration(path)


def _decode_error_count(path: str) -> int:
    """Fully decode the file; a clean file produces no stderr lines."""
    result = subprocess.run(
        [FFMPEG_BIN, "-v", "error", "-i", path, "-f", "null", "-"],
        capture_output=True, text=True,
    )
    assert result.returncode == 0, result.stderr
    return len([l for l in result.stderr.splitlines() if l.strip()])


def _frame_pixel(path: str, t: float, x: int, y: int, tmp_path: Path):
    frame_path = tmp_path / f"frame_{t}.png"
    subprocess.run(
        [FFMPEG_BIN, "-y", "-v", "error", "-ss", str(t), "-i", path, "-frames:v", "1", str(frame_path)],
        capture_output=True, text=True, check=True,
    )
    return Image.open(frame_path).convert("RGB").getpixel((x, y))


def _extract_audio_wav(path: str, tmp_path: Path, sr: int = 8000) -> Path:
    wav_path = tmp_path / "extracted_audio.wav"
    subprocess.run(
        [FFMPEG_BIN, "-y", "-v", "error", "-i", path, "-f", "wav", "-ar", str(sr), "-ac", "1", str(wav_path)],
        capture_output=True, text=True, check=True,
    )
    return wav_path


def _spectrum(wav_path: Path, t_start: float, t_end: float):
    w = wave.open(str(wav_path), "rb")
    sr = w.getframerate()
    data = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float64)
    window = data[int(sr * t_start):int(sr * t_end)]
    mag = np.abs(np.fft.rfft(window * np.hanning(len(window))))
    freqs = np.fft.rfftfreq(len(window), d=1 / sr)
    return freqs, mag


def _band_energy(freqs, mag, target_hz: float, tol_hz: float = 15.0) -> float:
    band = (freqs >= target_hz - tol_hz) & (freqs <= target_hz + tol_hz)
    return float(mag[band].max()) if band.any() else 0.0


# ---------------------------------------------------------------------------
# merge_with_transitions
# ---------------------------------------------------------------------------

async def test_merge_with_transitions_duration_and_integrity(clips, tmp_path):
    out = await ffmpeg_svc.merge_with_transitions(clips, "dissolve", 0.5, USER_ID)
    assert out.exists()
    assert _decode_error_count(str(out)) == 0
    # 3 clips x 3s, minus 2 overlapping 0.5s transitions
    assert await _ffprobe_duration(str(out)) == pytest.approx(8.0, abs=0.1)


# ---------------------------------------------------------------------------
# add_text_overlays: two independently-timed overlays
# ---------------------------------------------------------------------------

async def test_add_text_overlays_two_independent_windows(clips, tmp_path):
    merged = await ffmpeg_svc.merge_with_transitions(clips, "dissolve", 0.5, USER_ID)

    overlays = [
        {"text": "OVERLAY_A", "start": 0.2, "end": 1.5, "x": 20, "y": 20, "font_size": 50},
        {"text": "OVERLAY_B", "start": 6.0, "end": 7.0, "x": 20, "y": 20, "font_size": 50},
    ]
    out = await ffmpeg_svc.add_text_overlays(str(merged), overlays, USER_ID)
    assert _decode_error_count(str(out)) == 0

    sample_point = (30, 30)  # inside the drawtext box for both overlays above

    # overlay A window: pure red segment, box should darken the sample pixel
    r, g, b = _frame_pixel(str(out), 0.8, *sample_point, tmp_path)
    assert (r, g, b) != (255, 0, 0), "expected overlay A box to darken the red background"

    # just after overlay A ends, still pure red: box should be gone
    r, g, b = _frame_pixel(str(out), 2.0, *sample_point, tmp_path)
    assert r > 200 and g < 50 and b < 50, f"expected plain red after overlay A ends, got {(r, g, b)}"

    # overlay B window: pure blue segment, box should darken the sample pixel
    r, g, b = _frame_pixel(str(out), 6.5, *sample_point, tmp_path)
    assert (r, g, b) != (0, 0, 255), "expected overlay B box to darken the blue background"

    # after overlay B ends, still pure blue: box should be gone
    r, g, b = _frame_pixel(str(out), 7.5, *sample_point, tmp_path)
    assert b > 200 and r < 50 and g < 50, f"expected plain blue after overlay B ends, got {(r, g, b)}"


# ---------------------------------------------------------------------------
# add_audio_track: replace mode
# ---------------------------------------------------------------------------

async def test_add_audio_track_replace_mode(clips, custom_audio, tmp_path):
    merged = await ffmpeg_svc.merge_with_transitions(clips, "dissolve", 0.5, USER_ID)
    out = await ffmpeg_svc.add_audio_track(str(merged), custom_audio, USER_ID, mode="replace")
    assert _decode_error_count(str(out)) == 0

    wav = _extract_audio_wav(str(out), tmp_path)
    # Sample the pure-green segment (3.2-4.2s); original tone there was 550 Hz.
    freqs, mag = _spectrum(wav, 3.2, 4.2)
    peak_freq = freqs[np.argmax(mag)]
    assert peak_freq == pytest.approx(220.0, abs=15), (
        f"replace mode should fully swap audio to the 220Hz custom track, got peak {peak_freq}Hz"
    )
    assert _band_energy(freqs, mag, 550.0) < 0.15 * mag.max(), "original 550Hz clip tone should be gone in replace mode"


# ---------------------------------------------------------------------------
# add_audio_track: mix mode (the previously-unverified gap)
# ---------------------------------------------------------------------------

async def test_add_audio_track_mix_mode_layers_both_tracks(clips, custom_audio, tmp_path):
    merged = await ffmpeg_svc.merge_with_transitions(clips, "dissolve", 0.5, USER_ID)
    out = await ffmpeg_svc.add_audio_track(
        str(merged), custom_audio, USER_ID,
        mode="mix", original_volume=1.0, audio_volume=1.0,
    )
    assert _decode_error_count(str(out)) == 0

    wav = _extract_audio_wav(str(out), tmp_path)
    # Pure-green segment (3.2-4.2s): original clip tone is 550Hz, custom track is 220Hz.
    # In mix mode both must be present; in replace mode the 550Hz would vanish.
    freqs, mag = _spectrum(wav, 3.2, 4.2)
    energy_550 = _band_energy(freqs, mag, 550.0)
    energy_220 = _band_energy(freqs, mag, 220.0)
    noise_floor = float(np.median(mag))

    assert energy_550 > 10 * noise_floor, "mix mode should retain the original 550Hz clip audio"
    assert energy_220 > 10 * noise_floor, "mix mode should layer in the 220Hz custom track"


# ---------------------------------------------------------------------------
# Full chain: merge -> text overlays -> audio (mix), mirrors POST /process/export
# ---------------------------------------------------------------------------

async def test_full_export_chain_mix_mode(clips, custom_audio, tmp_path):
    merged = await ffmpeg_svc.merge_with_transitions(clips, "dissolve", 0.5, USER_ID)
    with_text = await ffmpeg_svc.add_text_overlays(
        str(merged),
        [{"text": "FINAL", "start": 0.2, "end": 1.5, "x": 20, "y": 20, "font_size": 50}],
        USER_ID,
    )
    final = await ffmpeg_svc.add_audio_track(
        str(with_text), custom_audio, USER_ID, mode="mix", original_volume=1.0, audio_volume=1.0,
    )

    assert _decode_error_count(str(final)) == 0
    assert await _ffprobe_duration(str(final)) == pytest.approx(8.0, abs=0.2)

    # text still burned in
    r, g, b = _frame_pixel(str(final), 0.8, 30, 30, tmp_path)
    assert (r, g, b) != (255, 0, 0)

    # both audio layers still present
    wav = _extract_audio_wav(str(final), tmp_path)
    freqs, mag = _spectrum(wav, 3.2, 4.2)
    noise_floor = float(np.median(mag))
    assert _band_energy(freqs, mag, 550.0) > 10 * noise_floor
    assert _band_energy(freqs, mag, 220.0) > 10 * noise_floor
