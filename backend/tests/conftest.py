import subprocess
from pathlib import Path

import pytest

from app.config import settings

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
            "ffmpeg", "-y",
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
    _run(["ffmpeg", "-y", "-f", "lavfi", "-i", "sine=frequency=220:duration=8", "-c:a", "aac", str(out)])
    return str(out)
