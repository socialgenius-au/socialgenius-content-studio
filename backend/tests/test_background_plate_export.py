"""M2.3: a draft that contains background plates (the Reconstructor's flat shapes in measured bars) exports them on the REAL ffmpeg render: banners across the full width at the top and bottom,
rectangles down the sides, in the colour on the layer, for exactly their window, and beneath other layers (their explicit order is far below the default). No database, no network."""
import asyncio
import subprocess
from pathlib import Path

import pytest
from PIL import Image

from app.services import ffmpeg_svc

W, H = 180, 320
PLATE_ORDER = -20000
NAVY, RED = "#102a5e", "#c81e1e"


@pytest.fixture(scope="module")
def clip(tmp_path_factory):
    p = tmp_path_factory.mktemp("plates") / "grey.mp4"
    r = subprocess.run([ffmpeg_svc.FFMPEG_BIN, "-y", "-v", "error", "-f", "lavfi", "-i", f"color=c=0x808080:s={W}x{H}:r=30:d=4", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
                        "-t", "4", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(p)], capture_output=True)
    assert r.returncode == 0, r.stderr.decode(errors="replace")[-500:]
    return str(p)


def _shape(kind, x, y, w, h, fill, start=1.0, end=3.0, order=PLATE_ORDER, full_width=False):
    return {"kind": kind, "start_time": start, "end_time": end, "x": x, "y": y, "width": w, "height": h, "fill_color": fill, "opacity": 1.0,
            "border_color": None, "border_width": 0, "border_radius": 0, "full_width": full_width, "order": order}


def _render(clip, shapes, tmp_path, tag):
    project = {"canvas_width": W, "canvas_height": H, "text_overlays": [], "audio_tracks": [], "shapes": shapes,
               "video_clips": [{"path": clip, "trim_in": 0, "start_time": 0, "end_time": 4, "speed": 1, "color_grade": "none", "brightness": 0, "contrast": 0, "saturation": 0,
                                "transition": "cut", "transition_duration": 0.5, "has_separated_audio": False}]}
    out = asyncio.run(ffmpeg_svc.render_project(project, 995))
    dst = tmp_path / f"{tag}.mp4"
    dst.write_bytes(Path(out).read_bytes())
    return str(dst)


def _frame(mp4, t, tmp_path, tag):
    out = tmp_path / f"{tag}.png"
    subprocess.run([ffmpeg_svc.FFMPEG_BIN, "-y", "-v", "error", "-ss", str(t), "-i", mp4, "-frames:v", "1", str(out)], check=True, capture_output=True)
    return Image.open(out).convert("RGB")


def _near(c, hexrgb, tol=12):
    ref = tuple(int(hexrgb[i:i + 2], 16) for i in (1, 3, 5))
    return all(abs(a - b) <= tol for a, b in zip(c, ref))


def test_banners_and_side_rectangles_land_in_their_bars_in_their_colour(clip, tmp_path):
    shapes = [_shape("banner", 0, 0, 100, 12, NAVY, full_width=True), _shape("banner", 0, 88, 100, 12, NAVY, full_width=True),
              _shape("rectangle", 0, 0, 8, 100, RED), _shape("rectangle", 92, 0, 8, 100, RED)]
    mp4 = _render(clip, shapes, tmp_path, "bars")
    im = _frame(mp4, 2.0, tmp_path, "bars_mid")
    assert _near(im.getpixel((W // 2, 4)), NAVY) and _near(im.getpixel((W // 2, H - 5)), NAVY)                       # top and bottom banners, full width
    assert _near(im.getpixel((2, H // 2)), RED) and _near(im.getpixel((W - 3, H // 2)), RED)                         # left and right bars
    assert _near(im.getpixel((W // 2, H // 2)), "#808080", 14)                                                       # the footage shows between the bars
    top_edge = [y for y in range(H) if _near(im.getpixel((W // 2, y)), NAVY)]
    assert top_edge[0] == 0 and abs((max(y for y in top_edge if y < H // 2) + 1) - round(H * 0.12)) <= 1             # the banner is the measured 12% tall, from the very edge


def test_a_plate_exists_for_exactly_its_window(clip, tmp_path):
    mp4 = _render(clip, [_shape("banner", 0, 0, 100, 12, NAVY, start=1.0, end=3.0, full_width=True)], tmp_path, "window")
    before, first, last, after = (_frame(mp4, t, tmp_path, f"w{t}") for t in (0.9, 1.0, 2.96, 3.0))
    assert not _near(before.getpixel((W // 2, 4)), NAVY) and _near(first.getpixel((W // 2, 4)), NAVY)
    assert _near(last.getpixel((W // 2, 4)), NAVY) and not _near(after.getpixel((W // 2, 4)), NAVY)                  # visible for start <= t < end, like the editor


def test_a_plate_sits_beneath_other_layers_by_its_explicit_order(clip, tmp_path):
    over = _shape("rectangle", 20, 0, 60, 30, "#ff00ff", order=0)                                                   # an ordinary layer that overlaps the banner, at the default order
    for order_of_plate, expect_plate_on_top in ((PLATE_ORDER, False), (5, True)):
        mp4 = _render(clip, [_shape("banner", 0, 0, 100, 12, NAVY, full_width=True, order=order_of_plate), over], tmp_path, f"stack{order_of_plate}")
        px = _frame(mp4, 2.0, tmp_path, f"stack{order_of_plate}_f").getpixel((W // 2, 10))
        assert _near(px, NAVY) is expect_plate_on_top and _near(px, "#ff00ff") is (not expect_plate_on_top)
