"""(ships inside the C2 / C1 patches) The optional canvas background colour and the opt-in edge policy, end to end through the request schema, the router's project dict and a real ffmpeg render."""
import asyncio
from pathlib import Path

import numpy as np
import pytest
from pydantic import ValidationError

from app.schemas.video_export import ExportProjectRequest
from app.services import ffmpeg_svc
from test_timeline_sync_render import FPS, H, W, _clip, _frames, sources  # noqa: F401  (sources is a fixture)

USER_ID = 995


def _req(**kw):
    return ExportProjectRequest(canvas_width=W, canvas_height=H, video_clips=[], **kw)


def test_the_request_accepts_a_hex_colour_and_rejects_anything_else_and_defaults_to_none():
    assert _req().canvas_background is None
    assert _req(canvas_background="#aa3366").canvas_background == "#aa3366"
    for bad in ("red", "#abc", "aa3366", "#gg3366", "#aa3366; drawtext=x"):
        with pytest.raises(ValidationError):
            _req(canvas_background=bad)


def _render(clips, tmp_path, tag, **extra):
    project = {"canvas_width": W, "canvas_height": H, "video_clips": clips, "text_overlays": [], "shapes": [], "audio_tracks": [], "subtitle_style": {}, **extra}
    out = asyncio.run(ffmpeg_svc.render_project(project, USER_ID))
    dst = tmp_path / f"{tag}.mp4"
    dst.write_bytes(Path(out).read_bytes())
    return _frames(str(dst))


def _wide(sources, tmp_path):
    """a clip whose picture is wider than the portrait canvas, so "fit" leaves bars above and below"""
    import subprocess
    p = tmp_path / "wide.mp4"
    subprocess.run([ffmpeg_svc.FFMPEG_BIN, "-y", "-v", "error", "-i", sources["A"], "-vf", f"scale={W}:{W // 2},setsar=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "copy", "-t", "2", str(p)], check=True)
    return str(p)


def test_a_fit_clip_is_padded_with_the_chosen_colour_and_black_by_default(sources, tmp_path):
    wide = _wide(sources, tmp_path)
    clip = _clip(wide, 0, 2, trim=0.0)
    black = _render([clip], tmp_path, "black")
    red = _render([clip], tmp_path, "red", canvas_background="#cc2244")
    top = slice(int(H * 0.05), int(H * 0.2))
    centre = slice(int(H * 0.45), int(H * 0.55))
    assert black[10, 0, top, :].mean() < 20                                          # default: black bars, as before
    y, u, v = (red[10, c, top, :].mean() for c in range(3))
    assert abs(u - 118) < 12 and abs(v - 190) < 12 and y > 40                       # #cc2244 in BT.601 YUV is about (66, 118, 190)
    assert (red[10, 0, centre, :] == black[10, 0, centre, :]).mean() > 0.97         # the picture itself is unchanged
    assert red.shape == black.shape


def test_a_gap_in_the_timeline_uses_the_same_colour(sources, tmp_path):
    clips = [_clip(sources["A"], 1, 3, trim=0.0)]                                    # starts at 1 s: the first second is a gap
    red = _render(clips, tmp_path, "gapred", canvas_background="#cc2244")
    plain = _render(clips, tmp_path, "gapblack")
    assert plain[10, 0].mean() < 20 and abs(red[10, 1].mean() - 118) < 12 and abs(red[10, 2].mean() - 190) < 12
    assert red.shape == plain.shape


def test_without_the_field_the_render_is_unchanged(sources, tmp_path):
    clips = [_clip(sources["A"], 0, 2, trim=0.0)]
    a = _render(clips, tmp_path, "n1")
    b = _render(clips, tmp_path, "n2", canvas_background=None)
    assert a.shape == b.shape and (a == b).all()
