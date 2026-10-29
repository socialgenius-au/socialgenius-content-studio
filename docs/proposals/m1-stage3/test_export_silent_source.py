"""PROPOSAL test for the backend part of Stage 3. Target path if approved: backend/tests/test_export_silent_source.py

A clip whose source file has NO audio stream (screen recordings, most stock B-roll) must not break the export. Today `build_clip_segment(keep_audio=True)` produces a
segment with no audio, and the multi-clip join (`acrossfade`) then fails: "matches no streams". With the one-line fix in render_project
(`keep_audio = keep_audio and await _has_audio_stream(path)`) the clip is treated as silent, exactly like a muted one.

Runs real ffmpeg (the bundled imageio-ffmpeg binary) on tiny generated clips in a temporary directory: no database, no network."""
import asyncio
import re
import subprocess

import pytest

from app.config import settings
from app.services import ffmpeg_svc


def _make(tmp_path, name, with_audio):
    out = tmp_path / name
    cmd = [ffmpeg_svc.FFMPEG_BIN, "-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=duration=6:size=160x90:rate=10"]
    if with_audio:
        cmd += ["-f", "lavfi", "-i", "sine=frequency=440:duration=6", "-c:a", "aac", "-shortest"]
    cmd += ["-c:v", "libx264", "-pix_fmt", "yuv420p", str(out)]
    subprocess.run(cmd, check=True)
    return str(out)


def _clip(path, start, end):
    return {"path": path, "trim_in": 0, "start_time": start, "end_time": end, "speed": 1, "color_grade": "none", "brightness": 0, "contrast": 0, "saturation": 0,
            "transition": "cut", "transition_duration": 0.5, "has_separated_audio": False, "muted": False, "volume": 1.0, "fit_mode": "fit", "crop_x": 50, "crop_y": 50}


def _project(clips):
    return {"canvas_width": 90, "canvas_height": 160, "video_clips": clips, "text_overlays": [], "audio_tracks": [], "media_overlays": [], "shapes": [], "lower_thirds": [], "subtitles": [],
            "subtitle_style": {}, "additional_video_clips": []}


def _info(path):
    t = subprocess.run([ffmpeg_svc.FFMPEG_BIN, "-i", str(path), "-af", "volumedetect", "-f", "null", "-"], capture_output=True, text=True, errors="replace").stderr
    m = re.search(r"mean_volume: (-?[\d.]+|-inf) dB", t)
    return {"audio": "Audio:" in t, "mean": float(m[1]) if m and m[1] != "-inf" else None}


@pytest.fixture(autouse=True)
def _uploads(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "UPLOAD_DIR", str(tmp_path / "out"))


def test_every_source_has_audio_the_export_keeps_it(tmp_path):
    a, b = _make(tmp_path, "a.mp4", True), _make(tmp_path, "b.mp4", True)
    out = asyncio.run(ffmpeg_svc.render_project(_project([_clip(a, 0, 3), _clip(b, 3, 6)]), 1))
    info = _info(out)
    assert info["audio"] and info["mean"] is not None and info["mean"] > -40            # the source's own sound is really there


def test_all_sources_silent_the_export_still_succeeds(tmp_path):
    a, b = _make(tmp_path, "a.mp4", False), _make(tmp_path, "b.mp4", False)
    out = asyncio.run(ffmpeg_svc.render_project(_project([_clip(a, 0, 3), _clip(b, 3, 6)]), 1))
    assert _info(out)["audio"]                                                          # a uniform (silent) audio stream, like a muted clip


def test_one_silent_source_among_audio_sources_still_succeeds_and_keeps_the_others_audio(tmp_path):
    a, silent, c = _make(tmp_path, "a.mp4", True), _make(tmp_path, "s.mp4", False), _make(tmp_path, "c.mp4", True)
    out = asyncio.run(ffmpeg_svc.render_project(_project([_clip(a, 0, 2), _clip(silent, 2, 4), _clip(c, 4, 6)]), 1))
    info = _info(out)
    assert info["audio"] and info["mean"] is not None and info["mean"] > -45


def test_muted_still_means_silent(tmp_path):
    a, b = _make(tmp_path, "a.mp4", True), _make(tmp_path, "b.mp4", True)
    clips = [dict(_clip(a, 0, 3), muted=True), dict(_clip(b, 3, 6), muted=True)]
    out = asyncio.run(ffmpeg_svc.render_project(_project(clips), 1))
    info = _info(out)
    assert info["mean"] is None or info["mean"] < -80                                   # unchanged behaviour


def test_a_single_silent_clip_still_exports(tmp_path):
    out = asyncio.run(ffmpeg_svc.render_project(_project([_clip(_make(tmp_path, "s.mp4", False), 0, 4)]), 1))
    assert out.exists()
