import subprocess
from pathlib import Path

import pytest

from app.config import settings
# STEP 7.15F: this environment has no ffmpeg on PATH at all — see ffmpeg_svc.py's own header
# comment. These fixtures generate their synthetic test clips via the same bundled binary the
# app itself now uses, rather than a bare "ffmpeg" that would never be found here.
from app.services.ffmpeg_svc import FFMPEG_BIN

USER_ID = 999


def _run(cmd: list[str]) -> None:
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg fixture generation failed: {result.stderr[-1000:]}")


@pytest.fixture(autouse=True)
def upload_dir(tmp_path, monkeypatch):
    """Point ffmpeg_svc's output directory at a per-test tmp dir instead of the real uploads/."""
    monkeypatch.setattr(settings, "UPLOAD_DIR", str(tmp_path))
    return tmp_path


@pytest.fixture
def clips(tmp_path) -> list[str]:
    """Three 3s clips: solid red/green/blue with distinct sine tones (440/550/660 Hz)."""
    specs = [("red", 440), ("green", 550), ("blue", 660)]
    paths = []
    for color, freq in specs:
        out = tmp_path / f"clip_{color}.mp4"
        _run([
            FFMPEG_BIN, "-y",
            "-f", "lavfi", "-i", f"color=c={color}:s=640x360:d=3:r=30",
            "-f", "lavfi", "-i", f"sine=frequency={freq}:duration=3",
            "-c:v", "libx264", "-c:a", "aac", "-pix_fmt", "yuv420p",
            str(out),
        ])
        paths.append(str(out))
    return paths


@pytest.fixture
def custom_audio(tmp_path) -> str:
    """An 8s 220 Hz tone standing in for a separate, custom audio track."""
    out = tmp_path / "custom_audio.m4a"
    _run([FFMPEG_BIN, "-y", "-f", "lavfi", "-i", "sine=frequency=220:duration=8", "-c:a", "aac", str(out)])
    return str(out)


@pytest.fixture
def portrait_clip(tmp_path) -> str:
    """STEP 7.15H: a 360x640 (9:16) portrait clip standing in for Sameena's real phone-shot
    footage (480x864) — used to verify FILL scaling behaviour when exported to a mismatched
    (16:9) canvas."""
    out = tmp_path / "portrait_clip.mp4"
    _run([
        FFMPEG_BIN, "-y",
        "-f", "lavfi", "-i", "color=c=purple:s=360x640:d=3:r=30",
        "-f", "lavfi", "-i", "sine=frequency=990:duration=3",
        "-c:v", "libx264", "-c:a", "aac", "-pix_fmt", "yuv420p",
        str(out),
    ])
    return str(out)


@pytest.fixture
def overlay_clip(tmp_path) -> str:
    """STEP 7.15H: a small video-backed overlay with its own distinct 880Hz tone — standing in
    for Sameena's "overlay contains music" scenario, distinguishable by frequency from both
    clips' 440/550/660Hz tones and custom_audio's 220Hz A1 tone."""
    out = tmp_path / "overlay_clip.mp4"
    _run([
        FFMPEG_BIN, "-y",
        "-f", "lavfi", "-i", "color=c=yellow:s=200x150:d=5:r=30",
        "-f", "lavfi", "-i", "sine=frequency=880:duration=5",
        "-c:v", "libx264", "-c:a", "aac", "-pix_fmt", "yuv420p", "-ac", "2",
        str(out),
    ])
    return str(out)
