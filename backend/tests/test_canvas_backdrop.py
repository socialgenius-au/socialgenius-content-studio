"""(ships with the C3 patch) The optional blurred backdrop behind a letterboxed ("fit") clip: request schema, the pure filter, and a real ffmpeg render."""
import asyncio
import subprocess
from pathlib import Path

import numpy as np
import pytest
from pydantic import ValidationError

from app.schemas.video_export import ExportProjectRequest
from app.services import ffmpeg_svc
from test_timeline_sync_render import FPS, H, W, _clip, _frames, sources  # noqa: F401  (sources is a fixture)

USER_ID = 996


def _req(**kw):
    return ExportProjectRequest(canvas_width=W, canvas_height=H, video_clips=[], **kw)


def test_the_request_defaults_to_a_colour_backdrop_and_accepts_only_the_two_values():
    assert _req().canvas_backdrop == "color" and _req(canvas_backdrop="blur").canvas_backdrop == "blur"
    for bad in ("Blur", "gaussian", "blur; drawtext=x", ""):
        with pytest.raises(ValidationError):
            _req(canvas_backdrop=bad)


def test_the_filter_keeps_the_whole_frame_and_covers_the_canvas_with_a_blurred_copy():
    f = ffmpeg_svc.blurred_fit_filter(1080, 1920)
    assert "force_original_aspect_ratio=increase,crop=1080:1920,boxblur=" in f and "force_original_aspect_ratio=decrease" in f and f.endswith("overlay=(W-w)/2:(H-h)/2,setsar=1")


def _render(clips, tmp_path, tag, **extra):
    project = {"canvas_width": W, "canvas_height": H, "video_clips": clips, "text_overlays": [], "shapes": [], "audio_tracks": [], "subtitle_style": {}, **extra}
    out = asyncio.run(ffmpeg_svc.render_project(project, USER_ID))
    dst = tmp_path / f"{tag}.mp4"
    dst.write_bytes(Path(out).read_bytes())
    return _frames(str(dst))


def _wide(sources, tmp_path):
    p = tmp_path / "wide.mp4"
    subprocess.run([ffmpeg_svc.FFMPEG_BIN, "-y", "-v", "error", "-i", sources["A"], "-vf", f"scale={W}:{W // 2},setsar=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "copy", "-t", "2", str(p)], check=True)
    return str(p)


def _detail(tmp_path):
    """a wide clip full of sharp detail (colour bars, grid, text), so blurred and sharp are easy to tell apart"""
    p = tmp_path / "detail.mp4"
    subprocess.run([ffmpeg_svc.FFMPEG_BIN, "-y", "-v", "error", "-f", "lavfi", "-i", f"testsrc=size={W}x{W // 2}:rate=30:duration=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(p)], check=True)
    return str(p)


def test_the_bars_show_a_blurred_copy_of_the_clip_and_the_picture_in_the_middle_is_unchanged(sources, tmp_path):
    clip = _clip(_detail(tmp_path), 0, 2, trim=0.0)
    plain = _render([clip], tmp_path, "plain")
    blur = _render([clip], tmp_path, "blur", canvas_backdrop="blur")
    top = slice(int(H * 0.02), int(H * 0.18))
    centre = slice(int(H * 0.45), int(H * 0.55))
    assert plain.shape == blur.shape
    assert plain[10, 0, top, :].mean() < 20                                           # colour backdrop: black bars as before
    assert blur[10, 0, top, :].mean() > 40                                            # blurred backdrop: the clip's own light/colour fills the bar
    assert blur[10, 0, top, :].std() > 8                                              # ... and it is the clip's picture, not one flat colour
    assert abs(float(np.mean(np.abs(blur[10, 0, centre, :].astype(int) - plain[10, 0, centre, :].astype(int))))) < 3     # the foreground picture is the same in both
    # blurred = smooth: neighbouring pixels in the bar differ far less than in the sharp picture
    assert np.abs(np.diff(blur[10, 0, top, :].astype(int), axis=1)).mean() * 3 < np.abs(np.diff(plain[10, 0, centre, :].astype(int), axis=1)).mean()


def test_a_clip_that_already_fills_the_canvas_is_unaffected_by_the_backdrop(sources, tmp_path):
    clip = {**_clip(sources["A"], 0, 2, trim=0.0), "fit_mode": "fill"}
    a = _render([clip], tmp_path, "fa")
    b = _render([clip], tmp_path, "fb", canvas_backdrop="blur")
    assert a.shape == b.shape and (a == b).all()


def test_without_the_field_the_render_is_unchanged(sources, tmp_path):
    clips = [_clip(sources["A"], 0, 2, trim=0.0)]
    a = _render(clips, tmp_path, "n1")
    b = _render(clips, tmp_path, "n2", canvas_backdrop="color")
    assert a.shape == b.shape and (a == b).all()
