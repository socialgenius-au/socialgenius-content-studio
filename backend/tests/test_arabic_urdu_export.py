"""Functional: a REAL export of a real MP4 with an Urdu subtitle (containing the letters DejaVu lacks, U+06C1 and U+06D2). The frame is decoded from the exported file and its subtitle region is compared with what the
renderer itself says the subtitle looks like, so the new font demonstrably reaches the video through the actual export pipeline (render_project), not only through the font loader. The same export with the Arabic font
withdrawn must NOT match: that is the proof the font, not something else, is what is in the file. (Joining and right-to-left order are Raqm's; they are measured on the preview, see the Arabic/Urdu record.)"""
import asyncio
import subprocess
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from app.services import canvas_render_svc as svc, ffmpeg_svc

W, H = 540, 960
URDU = "یہ ایک آزمائش ہے"                                   # includes ہ (U+06C1) and ے (U+06D2)


@pytest.fixture(scope="module")
def clip(tmp_path_factory):
    p = tmp_path_factory.mktemp("urdu") / "base.mp4"
    r = subprocess.run([ffmpeg_svc.FFMPEG_BIN, "-y", "-v", "error", "-f", "lavfi", "-i", f"color=c=0x203060:s={W}x{H}:r=30:d=4", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
                        "-t", "4", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(p)], capture_output=True)
    assert r.returncode == 0, r.stderr.decode(errors="replace")[-400:]
    return str(p)


def _export(clip, text, tmp_path, tag):
    project = {"canvas_width": W, "canvas_height": H, "text_overlays": [], "shapes": [], "audio_tracks": [], "subtitle_style": {},
               "subtitles": [{"text": text, "order": 0, "start_time": 0.5, "end_time": 3.5, "x": 10, "y": 60, "width": 80, "style_override": {"bg_color": "#000000", "bg_opacity": 0}}],
               "video_clips": [{"path": clip, "trim_in": 0, "start_time": 0, "end_time": 4, "speed": 1, "color_grade": "none", "brightness": 0, "contrast": 0, "saturation": 0,
                                "transition": "cut", "transition_duration": 0.5, "has_separated_audio": False}]}
    out = asyncio.run(ffmpeg_svc.render_project(project, 996))
    dst = tmp_path / f"{tag}.mp4"
    dst.write_bytes(Path(out).read_bytes())
    frame = tmp_path / f"{tag}.png"
    subprocess.run([ffmpeg_svc.FFMPEG_BIN, "-y", "-v", "error", "-ss", "2.0", "-i", str(dst), "-frames:v", "1", str(frame)], check=True, capture_output=True)
    return Image.open(frame).convert("RGB")


def _expected_mask(text, tmp_path):
    """where the renderer says the subtitle's ink is (text pixels), placed at the subtitle's own position on the canvas"""
    sub = {"text": text, "x": 10, "y": 60, "width": 80, "start_time": 0.5, "end_time": 3.5, "style_override": {"bg_color": "#000000", "bg_opacity": 0}}
    path, w, h = svc.render_subtitle_png(sub, svc.resolve_subtitle_style({}, sub["style_override"]), W, H, 996)
    a = np.array(Image.open(path).convert("RGBA").getchannel("A"))
    full = np.zeros((H, W), dtype=bool)
    x0, y0 = round(W * 10 / 100), round(H * 60 / 100)
    full[y0:y0 + a.shape[0], x0:x0 + a.shape[1]] = a > 200
    return full


def _match(frame: Image.Image, mask: np.ndarray) -> float:
    """share of the expected text pixels that are bright (white subtitle text) in the exported frame"""
    px = np.array(frame.convert("L")).astype(int)
    return float((px[mask] > 170).mean()) if mask.any() else 0.0


def test_the_exported_mp4_shows_the_urdu_subtitle_in_the_arabic_font(clip, tmp_path):
    frame = _export(clip, URDU, tmp_path, "naskh")
    expected = _expected_mask(URDU, tmp_path)
    assert expected.sum() > 300                                                       # the renderer really drew something
    assert _match(frame, expected) > 0.9                                              # ...and it is exactly what is in the exported frame, in place
    outside = np.array(frame.convert("L")).astype(int)[~expected]
    assert (outside > 170).mean() < 0.01                                              # nothing else bright: no stray text or boxes


def test_withdrawing_the_arabic_font_changes_the_video(clip, tmp_path, monkeypatch):
    with_font = _export(clip, URDU, tmp_path, "with")
    expected_naskh = _expected_mask(URDU, tmp_path)
    monkeypatch.setattr(svc, "_NASKH_PATH", Path(svc.__file__).parent / "no-such-font.ttf")
    svc._FONT_CACHE.clear()
    without = _export(clip, URDU, tmp_path, "without")
    svc._FONT_CACHE.clear()
    assert _match(with_font, expected_naskh) > 0.9
    assert _match(without, expected_naskh) < 0.8                                      # DejaVu's drawing (with empty boxes for ہ and ے) is a different picture from the Naskh one
    assert np.abs(np.array(with_font).astype(int) - np.array(without).astype(int)).sum() > 20000


def test_an_english_subtitle_export_is_unchanged_by_the_new_font(clip, tmp_path, monkeypatch):
    a = _export(clip, "A plain English subtitle", tmp_path, "en1")
    monkeypatch.setattr(svc, "_NASKH_PATH", Path(svc.__file__).parent / "no-such-font.ttf")
    svc._FONT_CACHE.clear()
    b = _export(clip, "A plain English subtitle", tmp_path, "en2")
    svc._FONT_CACHE.clear()
    assert np.array_equal(np.array(a), np.array(b))                                   # byte-identical frames with and without the new font present
