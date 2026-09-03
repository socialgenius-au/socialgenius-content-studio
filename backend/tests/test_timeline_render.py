"""
STEP 7.15F: automated coverage for the new Video Studio V2 timeline renderer
(app/services/ffmpeg_svc.py: build_clip_segment / concat_segments_with_transitions /
mix_audio_tracks / render_project + POST /video-export/export).

Mirrors test_export_pipeline.py's own approach — real ffmpeg-generated synthetic clips, real
pixel sampling and real FFT audio-spectrum checks — rather than only asserting "didn't crash".
"""
import wave
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from app.services import ffmpeg_svc

USER_ID = 999


def _decode_error_count(path: str) -> int:
    import subprocess
    result = subprocess.run(
        [ffmpeg_svc.FFMPEG_BIN, "-v", "error", "-i", path, "-f", "null", "-"],
        capture_output=True, text=True,
    )
    assert result.returncode == 0, result.stderr
    return len([l for l in result.stderr.splitlines() if l.strip()])


def _frame_pixel(path: str, t: float, x: int, y: int, tmp_path: Path):
    import subprocess
    frame_path = tmp_path / f"frame_{t}_{x}_{y}.png"
    subprocess.run(
        [ffmpeg_svc.FFMPEG_BIN, "-y", "-v", "error", "-ss", str(t), "-i", path, "-frames:v", "1", str(frame_path)],
        capture_output=True, text=True, check=True,
    )
    return Image.open(frame_path).convert("RGB").getpixel((x, y))


def _extract_audio_wav(path: str, tmp_path: Path, sr: int = 8000) -> Path:
    import subprocess
    wav_path = tmp_path / "extracted_audio.wav"
    subprocess.run(
        [ffmpeg_svc.FFMPEG_BIN, "-y", "-v", "error", "-i", path, "-f", "wav", "-ar", str(sr), "-ac", "1", str(wav_path)],
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
# build_clip_segment: speed + resize + colour
# ---------------------------------------------------------------------------

async def test_build_clip_segment_speed_changes_output_duration(clips):
    # clips[0] is a 3s red clip; 2x speed over a 2s source window -> 1s output.
    seg = await ffmpeg_svc.build_clip_segment(
        clips[0], trim_in=0, source_duration=2.0, speed=2.0,
        color_grade="none", brightness=0, contrast=0, saturation=0,
        canvas_w=320, canvas_h=180, keep_audio=True, volume=1.0, user_id=USER_ID,
    )
    assert _decode_error_count(str(seg)) == 0
    assert await ffmpeg_svc._get_duration(str(seg)) == pytest.approx(1.0, abs=0.15)
    assert await ffmpeg_svc._get_video_dimensions(str(seg)) == (320, 180)


async def test_build_clip_segment_bw_desaturates(clips, tmp_path):
    seg = await ffmpeg_svc.build_clip_segment(
        clips[1], trim_in=0, source_duration=3.0, speed=1,
        color_grade="bw", brightness=0, contrast=0, saturation=0,
        canvas_w=640, canvas_h=360, keep_audio=True, volume=1.0, user_id=USER_ID,
    )
    r, g, b = _frame_pixel(str(seg), 1.0, 320, 180, tmp_path)
    # The source clip is solid green (0,255,0); full desaturation must pull r/g/b together.
    assert abs(r - g) < 10 and abs(g - b) < 10, f"expected a desaturated (grey) pixel, got {(r, g, b)}"


async def test_build_clip_segment_no_audio_produces_silent_track(clips, tmp_path):
    seg = await ffmpeg_svc.build_clip_segment(
        clips[0], trim_in=0, source_duration=3.0, speed=1,
        color_grade="none", brightness=0, contrast=0, saturation=0,
        canvas_w=640, canvas_h=360, keep_audio=False, volume=1.0, user_id=USER_ID,
    )
    assert await ffmpeg_svc._has_audio_stream(str(seg)) is True
    wav = _extract_audio_wav(str(seg), tmp_path)
    w = wave.open(str(wav), "rb")
    data = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
    assert np.abs(data).max() < 50, "keep_audio=False should produce (near-)silence, not the original 440Hz tone"


# ---------------------------------------------------------------------------
# STEP 7: Original Video Audio controls (per-clip on/off + volume)
# ---------------------------------------------------------------------------

async def test_build_clip_segment_volume_scales_original_audio(clips, tmp_path):
    """The clip's own saved volume must actually scale its own embedded audio, independent of
    speed's atempo chain (both may be present in the same -af)."""
    loud = await ffmpeg_svc.build_clip_segment(
        clips[0], trim_in=0, source_duration=3.0, speed=1,
        color_grade="none", brightness=0, contrast=0, saturation=0,
        canvas_w=320, canvas_h=180, keep_audio=True, volume=1.0, user_id=USER_ID,
    )
    quiet = await ffmpeg_svc.build_clip_segment(
        clips[0], trim_in=0, source_duration=3.0, speed=1,
        color_grade="none", brightness=0, contrast=0, saturation=0,
        canvas_w=320, canvas_h=180, keep_audio=True, volume=0.25, user_id=USER_ID,
    )
    loud_dir, quiet_dir = tmp_path / "loud", tmp_path / "quiet"
    loud_dir.mkdir(); quiet_dir.mkdir()
    wav_loud = _extract_audio_wav(str(loud), loud_dir)
    wav_quiet = _extract_audio_wav(str(quiet), quiet_dir)
    w1, w2 = wave.open(str(wav_loud), "rb"), wave.open(str(wav_quiet), "rb")
    d1 = np.frombuffer(w1.readframes(w1.getnframes()), dtype=np.int16).astype(np.float64)
    d2 = np.frombuffer(w2.readframes(w2.getnframes()), dtype=np.int16).astype(np.float64)
    rms1, rms2 = float(np.sqrt(np.mean(d1 ** 2))), float(np.sqrt(np.mean(d2 ** 2)))
    assert rms2 == pytest.approx(rms1 * 0.25, rel=0.15), (
        f"expected volume=0.25 to be ~1/4 of volume=1.0's level, got rms1={rms1:.0f} rms2={rms2:.0f}"
    )


async def test_render_project_original_audio_off_mutes_clip_without_a1(clips, tmp_path):
    """The Original Audio toggle must work on its own, with no A1 track present at all — this
    is a separate, explicit control from the existing "muted once separated to A1" rule, not a
    re-implementation of it."""
    project = {
        "canvas_width": 320, "canvas_height": 180,
        "video_clips": [{
            "path": clips[0], "trim_in": 0, "start_time": 0, "end_time": 3, "speed": 1,
            "color_grade": "none", "brightness": 0, "contrast": 0, "saturation": 0,
            "transition": "cut", "transition_duration": 0.5,
            "has_separated_audio": False, "muted": True, "volume": 1.0,
        }],
        "text_overlays": [], "media_overlays": [], "audio_tracks": [],
    }
    out = await ffmpeg_svc.render_project(project, USER_ID)
    assert await ffmpeg_svc._has_audio_stream(str(out)) is True
    wav = _extract_audio_wav(str(out), tmp_path)
    w = wave.open(str(wav), "rb")
    data = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
    assert np.abs(data).max() < 50, "Original Audio = Off must silence the clip even with no A1 track involved"


async def test_render_project_original_audio_example_scenario(clips, custom_audio, tmp_path):
    """Exact scenario from the Step 7 request: Video 1 original audio OFF + A1 replacement at
    100%, then Video 2 original audio ON at 100% with no A1 covering it. Expected result:
    Video 1's own 440Hz tone never plays; A1's 220Hz plays during Video 1's window; Video 2's
    own 550Hz tone plays during its own window, unaffected by Video 1's or A1's settings."""
    project = {
        "canvas_width": 320, "canvas_height": 180,
        "video_clips": [
            {"path": clips[0], "trim_in": 0, "start_time": 0, "end_time": 3, "speed": 1,
             "color_grade": "none", "brightness": 0, "contrast": 0, "saturation": 0,
             "transition": "cut", "transition_duration": 0.5,
             "has_separated_audio": False, "muted": True, "volume": 1.0},  # Video 1: original audio OFF
            {"path": clips[1], "trim_in": 0, "start_time": 3, "end_time": 6, "speed": 1,
             "color_grade": "none", "brightness": 0, "contrast": 0, "saturation": 0,
             "transition": "cut", "transition_duration": 0.5,
             "has_separated_audio": False, "muted": False, "volume": 1.0},  # Video 2: original audio ON
        ],
        "text_overlays": [], "media_overlays": [],
        "audio_tracks": [
            {"path": custom_audio, "trim_in": 0, "start_time": 0, "end_time": 3, "volume": 1.0},  # A1 replaces Video 1 only
        ],
    }
    out = await ffmpeg_svc.render_project(project, USER_ID)
    wav = _extract_audio_wav(str(out), tmp_path)

    freqs1, mag1 = _spectrum(wav, 1.0, 2.0)  # inside Video 1's window
    noise1 = float(np.median(mag1))
    assert _band_energy(freqs1, mag1, 440.0) < 10 * noise1, "Video 1's own audio must be off"
    assert _band_energy(freqs1, mag1, 220.0) > 10 * noise1, "A1 replacement must be audible during Video 1"

    freqs2, mag2 = _spectrum(wav, 4.0, 5.0)  # inside Video 2's window
    noise2 = float(np.median(mag2))
    assert _band_energy(freqs2, mag2, 550.0) > 10 * noise2, "Video 2's own audio must be on"
    assert _band_energy(freqs2, mag2, 220.0) < 10 * noise2, "A1 (scoped to [0,3)) must not bleed into Video 2's window"


# ---------------------------------------------------------------------------
# render_project: full pipeline, mirrors what POST /video-export/export actually calls
# ---------------------------------------------------------------------------

async def test_render_project_single_clip_with_text_and_audio(clips, custom_audio, tmp_path):
    project = {
        "canvas_width": 320, "canvas_height": 180,
        "video_clips": [{
            "path": clips[0], "trim_in": 0, "start_time": 0, "end_time": 3, "speed": 1,
            "color_grade": "none", "brightness": 0, "contrast": 0, "saturation": 0,
            "transition": "cut", "transition_duration": 0.5,
            "has_separated_audio": True,  # this clip's own 440Hz tone must NOT survive
        }],
        "text_overlays": [
            {"text": "HELLO", "start": 0.2, "end": 1.5, "x": 20, "y": 20, "font_size": 30, "font_color": "white"},
        ],
        "media_overlays": [],
        "audio_tracks": [
            {"path": custom_audio, "trim_in": 0, "start_time": 0, "end_time": 3, "volume": 1.0},
        ],
    }
    out = await ffmpeg_svc.render_project(project, USER_ID)
    assert _decode_error_count(str(out)) == 0
    assert await ffmpeg_svc._get_video_dimensions(str(out)) == (320, 180)

    # text burned in during its window
    r, g, b = _frame_pixel(str(out), 0.8, 30, 30, tmp_path)
    assert (r, g, b) != (255, 0, 0), "expected the drawtext box to darken the red background"

    # separated-audio rule: the clip's own 440Hz must be gone, only the A1 220Hz track present
    wav = _extract_audio_wav(str(out), tmp_path)
    freqs, mag = _spectrum(wav, 1.0, 2.0)
    noise_floor = float(np.median(mag))
    assert _band_energy(freqs, mag, 220.0) > 10 * noise_floor, "A1 custom audio track should be audible"
    assert _band_energy(freqs, mag, 440.0) < 10 * noise_floor, "clip's own audio should be muted once separated to A1"


def _content_column_range(path: str, t: float, tmp_path: Path, threshold: int = 15):
    """Grayscale-samples one frame and returns (min_col, max_col) of non-black pixels — used to
    detect pillarboxing (black bars) on the left/right of the frame."""
    import subprocess
    frame_path = tmp_path / f"colcheck_{Path(path).stem}.png"
    subprocess.run(
        [ffmpeg_svc.FFMPEG_BIN, "-y", "-v", "error", "-ss", str(t), "-i", path, "-frames:v", "1", str(frame_path)],
        capture_output=True, text=True, check=True,
    )
    arr = np.array(Image.open(frame_path).convert("L"))
    nonblack_cols = np.where(arr.max(axis=0) > threshold)[0]
    return int(nonblack_cols.min()), int(nonblack_cols.max()), arr.shape[1]


async def test_build_clip_segment_fill_covers_mismatched_canvas_no_bars(portrait_clip, tmp_path):
    """STEP 7.15H canvas-fill defect: a 9:16 (360x640) source exported to a 16:9 (640x360)
    canvas, with fit_mode="fill" explicitly selected, must fully cover the frame (no black
    pillarbox/letterbox bars) — this is the exact "very small ... excessive black space" defect,
    reproduced directly with a controlled source/canvas mismatch.

    STEP 7 (Platform Canvas / Full-Screen Video Acceptance): fit_mode="fill" is now passed
    explicitly — build_clip_segment's default changed to "fit" (matching the live preview's own
    long-standing object-fit:contain default) once fit_mode became a real, per-clip choice
    rather than every export always being FILL regardless of what the clip's own data says."""
    seg = await ffmpeg_svc.build_clip_segment(
        portrait_clip, trim_in=0, source_duration=3, speed=1,
        color_grade="none", brightness=0, contrast=0, saturation=0,
        canvas_w=640, canvas_h=360, keep_audio=True, volume=1.0, user_id=USER_ID,
        fit_mode="fill",
    )
    assert await ffmpeg_svc._get_video_dimensions(str(seg)) == (640, 360), "canvas dimensions must be honoured exactly, never hard-coded"
    min_col, max_col, width = _content_column_range(str(seg), 1.0, tmp_path)
    assert min_col == 0 and max_col == width - 1, (
        f"expected FILL to cover the entire frame width with no black bars, "
        f"got content only from col {min_col} to {max_col} of {width}"
    )


async def test_build_clip_segment_fit_mode_shows_letterbox_bars(portrait_clip, tmp_path):
    """STEP 7 (Platform Canvas / Full-Screen Video Acceptance): "fit" is the default and must
    preserve the WHOLE source frame — for a 9:16 source into a 16:9 canvas that necessarily
    means visible pillarbox bars (never cropping, never stretching), the exact opposite
    assertion from the FILL test above, over the identical source/canvas mismatch."""
    seg = await ffmpeg_svc.build_clip_segment(
        portrait_clip, trim_in=0, source_duration=3, speed=1,
        color_grade="none", brightness=0, contrast=0, saturation=0,
        canvas_w=640, canvas_h=360, keep_audio=True, volume=1.0, user_id=USER_ID,
        fit_mode="fit",
    )
    assert await ffmpeg_svc._get_video_dimensions(str(seg)) == (640, 360)
    min_col, max_col, width = _content_column_range(str(seg), 1.0, tmp_path)
    assert min_col > 0 and max_col < width - 1, (
        f"expected FIT to letterbox/pillarbox a mismatched-aspect source (whole frame visible, "
        f"centred), got content spanning the full col 0 to {width - 1} — i.e. no bars at all"
    )
    # And the same default with no fit_mode argument at all must behave identically — this is
    # the actual "existing project with no fit_mode key" scenario render_project relies on.
    seg_default = await ffmpeg_svc.build_clip_segment(
        portrait_clip, trim_in=0, source_duration=3, speed=1,
        color_grade="none", brightness=0, contrast=0, saturation=0,
        canvas_w=640, canvas_h=360, keep_audio=True, volume=1.0, user_id=USER_ID,
    )
    min_col2, max_col2, _ = _content_column_range(str(seg_default), 1.0, tmp_path)
    assert (min_col2, max_col2) == (min_col, max_col), "omitting fit_mode must behave exactly like fit_mode='fit'"


async def test_build_clip_segment_fill_crop_position_shifts_visible_region(portrait_two_tone_clip, tmp_path):
    """STEP 7 (Platform Canvas / Full-Screen Video Acceptance): crop_x/crop_y must actually move
    which part of an over-tall scaled source is kept, mirroring CSS object-position's own 0-100
    convention exactly (this is what the toolbar's "Crop & Reposition" drag writes) — verified
    on the VERTICAL axis: the fixture's 9:16 source filled into a very wide/short canvas is
    over-tall on the vertical axis, so crop_y=0 must keep the fixture's YELLOW top half and
    crop_y=100 must keep its BLUE bottom half — a real, different colour, not the same centred
    crop regardless of the argument."""
    top = await ffmpeg_svc.build_clip_segment(
        portrait_two_tone_clip, trim_in=0, source_duration=3, speed=1,
        color_grade="none", brightness=0, contrast=0, saturation=0,
        canvas_w=640, canvas_h=100, keep_audio=False, volume=1.0, user_id=USER_ID,
        fit_mode="fill", crop_y=0,
    )
    bottom = await ffmpeg_svc.build_clip_segment(
        portrait_two_tone_clip, trim_in=0, source_duration=3, speed=1,
        color_grade="none", brightness=0, contrast=0, saturation=0,
        canvas_w=640, canvas_h=100, keep_audio=False, volume=1.0, user_id=USER_ID,
        fit_mode="fill", crop_y=100,
    )
    px_top = _frame_pixel(str(top), 1.0, 320, 50, tmp_path)
    px_bottom = _frame_pixel(str(bottom), 1.0, 320, 50, tmp_path)
    assert px_top != px_bottom, (
        f"expected crop_y=0 and crop_y=100 to keep visibly different parts of the source, "
        f"got the same pixel {px_top} at the sampled point in both — crop_y is not being applied"
    )


async def test_build_clip_segment_fill_vertical_canvas_no_distortion(portrait_clip, tmp_path):
    """A near-matching 9:16 source into a 9:16-ish canvas should also fully cover it, and must
    not be stretched (a squashed/stretched purple frame would still just look purple+solid here,
    so this specifically checks that no black bars remain top or bottom either — full FILL)."""
    seg = await ffmpeg_svc.build_clip_segment(
        portrait_clip, trim_in=0, source_duration=3, speed=1,
        color_grade="none", brightness=0, contrast=0, saturation=0,
        canvas_w=360, canvas_h=640, keep_audio=True, volume=1.0, user_id=USER_ID,
    )
    assert await ffmpeg_svc._get_video_dimensions(str(seg)) == (360, 640)
    import subprocess
    frame_path = tmp_path / "vertical_check.png"
    subprocess.run(
        [ffmpeg_svc.FFMPEG_BIN, "-y", "-v", "error", "-ss", "1", "-i", str(seg), "-frames:v", "1", str(frame_path)],
        capture_output=True, text=True, check=True,
    )
    arr = np.array(Image.open(frame_path).convert("L"))
    nonblack_rows = np.where(arr.max(axis=1) > 15)[0]
    assert nonblack_rows.min() == 0 and nonblack_rows.max() == arr.shape[0] - 1, "expected full vertical coverage, no letterbox bars"


async def test_render_project_v1_muted_a1_and_overlay_all_three_routed_correctly(
    clips, custom_audio, overlay_clip, tmp_path,
):
    """STEP 7.15H DEFECT 1, full audio-graph check with three distinct, simultaneously-
    identifiable tones: clip's own embedded audio (440Hz, must be SILENCED — separated to A1),
    A1 voice-over (220Hz, must be audible throughout), overlay music (880Hz, audible only
    during its own [0,3) window). Explicitly verifies V1 is not included "merely because it's
    the base visual input"."""
    project = {
        "canvas_width": 320, "canvas_height": 180,
        "video_clips": [{
            "path": clips[0], "trim_in": 0, "start_time": 0, "end_time": 3, "speed": 1,
            "color_grade": "none", "brightness": 0, "contrast": 0, "saturation": 0,
            "transition": "cut", "transition_duration": 0.5,
            "has_separated_audio": True,  # clip's own 440Hz must NOT survive into the export
        }],
        "text_overlays": [],
        "media_overlays": [
            {"path": overlay_clip, "is_image": False, "start": 0, "end": 3,
             "x": 10, "y": 10, "width": 30, "height": 30, "opacity": 1.0,
             "muted": False, "volume": 1.0},
        ],
        "audio_tracks": [
            {"path": custom_audio, "trim_in": 0, "start_time": 0, "end_time": 3, "volume": 1.0},
        ],
    }
    out = await ffmpeg_svc.render_project(project, USER_ID)
    assert _decode_error_count(str(out)) == 0

    wav = _extract_audio_wav(str(out), tmp_path)
    freqs, mag = _spectrum(wav, 1.0, 2.0)
    noise_floor = float(np.median(mag))
    assert _band_energy(freqs, mag, 440.0) < 10 * noise_floor, (
        "V1's own embedded audio must remain silent after separation — it must never be "
        "included merely because V1 is the base visual input"
    )
    assert _band_energy(freqs, mag, 220.0) > 10 * noise_floor, "A1 voice-over must be audible"
    assert _band_energy(freqs, mag, 880.0) > 10 * noise_floor, "overlay music must be audible while overlay is active"


async def test_render_project_overlay_audio_and_a1_mixed_together(clips, custom_audio, overlay_clip, tmp_path):
    """STEP 7.15H, Instruction 6/7: A1 voice-over (220Hz custom_audio) and overlay music
    (880Hz overlay_clip) must BOTH be present and audible together, not one replacing the
    other — Sameena's exact reported scenario."""
    project = {
        "canvas_width": 320, "canvas_height": 180,
        "video_clips": [{
            "path": clips[0], "trim_in": 0, "start_time": 0, "end_time": 3, "speed": 1,
            "color_grade": "none", "brightness": 0, "contrast": 0, "saturation": 0,
            "transition": "cut", "transition_duration": 0.5, "has_separated_audio": True,
        }],
        "text_overlays": [],
        "media_overlays": [
            {"path": overlay_clip, "is_image": False, "start": 0, "end": 3,
             "x": 10, "y": 10, "width": 30, "height": 30, "opacity": 1.0,
             "muted": False, "volume": 1.0},
        ],
        "audio_tracks": [
            {"path": custom_audio, "trim_in": 0, "start_time": 0, "end_time": 3, "volume": 1.0},
        ],
    }
    out = await ffmpeg_svc.render_project(project, USER_ID)
    assert _decode_error_count(str(out)) == 0

    wav = _extract_audio_wav(str(out), tmp_path)
    freqs, mag = _spectrum(wav, 1.0, 2.0)
    noise_floor = float(np.median(mag))
    assert _band_energy(freqs, mag, 220.0) > 10 * noise_floor, "A1 voice-over (220Hz) must be present"
    assert _band_energy(freqs, mag, 880.0) > 10 * noise_floor, "overlay music (880Hz) must be present"
    assert _band_energy(freqs, mag, 440.0) < 10 * noise_floor, "clip's own separated audio must still be muted"


async def test_render_project_muted_overlay_excludes_its_audio(clips, custom_audio, overlay_clip, tmp_path):
    """Instruction 5: a muted overlay must contribute no audio, while A1 keeps playing."""
    project = {
        "canvas_width": 320, "canvas_height": 180,
        "video_clips": [{
            "path": clips[0], "trim_in": 0, "start_time": 0, "end_time": 3, "speed": 1,
            "color_grade": "none", "brightness": 0, "contrast": 0, "saturation": 0,
            "transition": "cut", "transition_duration": 0.5, "has_separated_audio": True,
        }],
        "text_overlays": [],
        "media_overlays": [
            {"path": overlay_clip, "is_image": False, "start": 0, "end": 3,
             "x": 10, "y": 10, "width": 30, "height": 30, "opacity": 1.0,
             "muted": True, "volume": 1.0},
        ],
        "audio_tracks": [
            {"path": custom_audio, "trim_in": 0, "start_time": 0, "end_time": 3, "volume": 1.0},
        ],
    }
    out = await ffmpeg_svc.render_project(project, USER_ID)
    wav = _extract_audio_wav(str(out), tmp_path)
    freqs, mag = _spectrum(wav, 1.0, 2.0)
    noise_floor = float(np.median(mag))
    assert _band_energy(freqs, mag, 220.0) > 10 * noise_floor, "A1 voice-over must still be present"
    assert _band_energy(freqs, mag, 880.0) < 10 * noise_floor, "muted overlay must contribute no audio"


async def test_render_project_overlay_volume_scaling(clips, overlay_clip, tmp_path):
    """Instruction 5: overlay volume must be respected — a quieter overlay setting must
    produce a measurably quieter overlay audio band."""
    def build(volume):
        return {
            "canvas_width": 320, "canvas_height": 180,
            "video_clips": [{
                "path": clips[0], "trim_in": 0, "start_time": 0, "end_time": 3, "speed": 1,
                "color_grade": "none", "brightness": 0, "contrast": 0, "saturation": 0,
                "transition": "cut", "transition_duration": 0.5, "has_separated_audio": True,
            }],
            "text_overlays": [],
            "media_overlays": [
                {"path": overlay_clip, "is_image": False, "start": 0, "end": 3,
                 "x": 10, "y": 10, "width": 30, "height": 30, "opacity": 1.0,
                 "muted": False, "volume": volume},
            ],
            "audio_tracks": [],
        }
    out_loud = await ffmpeg_svc.render_project(build(1.0), USER_ID)
    out_quiet = await ffmpeg_svc.render_project(build(0.2), USER_ID)

    # _extract_audio_wav always writes to a fixed "extracted_audio.wav" name under the given
    # dir — use two distinct subdirectories so the second call doesn't overwrite the first
    # before both get read.
    loud_dir, quiet_dir = tmp_path / "loud", tmp_path / "quiet"
    loud_dir.mkdir()
    quiet_dir.mkdir()
    wav_loud = _extract_audio_wav(str(out_loud), loud_dir)
    wav_quiet = _extract_audio_wav(str(out_quiet), quiet_dir)
    w1 = wave.open(str(wav_loud), "rb")
    w2 = wave.open(str(wav_quiet), "rb")
    d1 = np.frombuffer(w1.readframes(w1.getnframes()), dtype=np.int16).astype(np.float64)
    d2 = np.frombuffer(w2.readframes(w2.getnframes()), dtype=np.int16).astype(np.float64)
    rms1 = float(np.sqrt(np.mean(d1 ** 2)))
    rms2 = float(np.sqrt(np.mean(d2 ** 2)))
    assert rms2 < 0.5 * rms1, f"expected volume=0.2 much quieter than volume=1.0, got rms1={rms1:.0f} rms2={rms2:.0f}"


async def test_mix_audio_tracks_does_not_auto_attenuate_against_silent_base(tmp_path):
    """STEP 7.15H: ffmpeg's amix defaults to normalize=1 — auto-halving the combined level even
    when one 'input' is pure silence (the normal case here, since every clip with separated
    audio produces a silent base track). This is the exact defect Sameena's manual test caught:
    real A1 audio present, but far quieter than its own saved volume would predict. Asserts the
    saved volume is honoured on its own terms — mixing against silence must not touch the level
    a second time."""
    base = ffmpeg_svc._out(999, "mp4")
    await ffmpeg_svc._run([
        ffmpeg_svc.FFMPEG_BIN, "-y", "-f", "lavfi", "-t", "3", "-i",
        "anullsrc=channel_layout=stereo:sample_rate=44100",
        "-f", "lavfi", "-t", "3", "-i", "color=c=black:s=320x180:d=3:r=30",
        "-map", "1:v", "-map", "0:a", "-c:v", "libx264", "-c:a", "aac", str(base),
    ])
    # Stereo, matching every real-world case (a real video's own audio track) — a mono source
    # here would need an implicit channel-layout reconciliation against the stereo silent base
    # that scales by its own unrelated factor, confounding the one thing this test checks.
    tone = ffmpeg_svc._out(999, "m4a")
    await ffmpeg_svc._run([
        ffmpeg_svc.FFMPEG_BIN, "-y", "-f", "lavfi", "-i", "sine=frequency=330:duration=3",
        "-ac", "2", "-c:a", "aac", str(tone),
    ])
    baseline_wav = _extract_audio_wav(str(tone), tmp_path)
    wb = wave.open(str(baseline_wav), "rb")
    baseline = np.frombuffer(wb.readframes(wb.getnframes()), dtype=np.int16).astype(np.float64)
    baseline_rms = float(np.sqrt(np.mean(baseline ** 2)))

    mixed = await ffmpeg_svc.mix_audio_tracks(
        str(base), [{"path": str(tone), "trim_in": 0, "start_time": 0, "end_time": 3, "volume": 1.0}], USER_ID,
    )
    wav = _extract_audio_wav(str(mixed), tmp_path)
    w = wave.open(str(wav), "rb")
    data = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float64)
    rms = float(np.sqrt(np.mean(data ** 2)))
    # Mixed against pure silence at volume=1.0, the level must come out close to the source
    # tone's own unmixed level — normalize=1 (the pre-fix default) would cut this roughly in
    # half regardless, exactly what a silent "other input" should never be allowed to do.
    assert rms > 0.85 * baseline_rms, (
        f"expected ~unattenuated volume=1.0 audio (rms>{0.85*baseline_rms:.0f}, baseline={baseline_rms:.0f}), "
        f"got rms={rms:.0f} — amix is auto-attenuating against the silent base again"
    )


async def test_render_project_audio_track_volume_scaling(clips, custom_audio, tmp_path):
    project = {
        "canvas_width": 320, "canvas_height": 180,
        "video_clips": [{
            "path": clips[0], "trim_in": 0, "start_time": 0, "end_time": 3, "speed": 1,
            "color_grade": "none", "brightness": 0, "contrast": 0, "saturation": 0,
            "transition": "cut", "transition_duration": 0.5, "has_separated_audio": True,
        }],
        "text_overlays": [], "media_overlays": [],
        "audio_tracks": [
            {"path": custom_audio, "trim_in": 0, "start_time": 0, "end_time": 3, "volume": 0.0},
        ],
    }
    out = await ffmpeg_svc.render_project(project, USER_ID)
    wav = _extract_audio_wav(str(out), tmp_path)
    w = wave.open(str(wav), "rb")
    data = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
    assert np.abs(data).max() < 50, "0% A1 volume must produce complete silence (Requirement 1)"


async def test_render_project_two_clips_transition_overlap(clips):
    project = {
        "canvas_width": 320, "canvas_height": 180,
        "video_clips": [
            {"path": clips[0], "trim_in": 0, "start_time": 0, "end_time": 3, "speed": 1,
             "color_grade": "none", "brightness": 0, "contrast": 0, "saturation": 0,
             "transition": "dissolve", "transition_duration": 0.5, "has_separated_audio": False},
            {"path": clips[1], "trim_in": 0, "start_time": 3, "end_time": 6, "speed": 1,
             "color_grade": "none", "brightness": 0, "contrast": 0, "saturation": 0,
             "transition": "cut", "transition_duration": 0.5, "has_separated_audio": False},
        ],
        "text_overlays": [], "media_overlays": [], "audio_tracks": [],
    }
    out = await ffmpeg_svc.render_project(project, USER_ID)
    assert _decode_error_count(str(out)) == 0
    # 3s + 3s minus one 0.5s dissolve overlap
    assert await ffmpeg_svc._get_duration(str(out)) == pytest.approx(5.5, abs=0.15)
