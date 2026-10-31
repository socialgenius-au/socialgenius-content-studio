"""M2.2b: two existing export defects, tested on the REAL ffmpeg render (no database, no network).

1. An image/video overlay is fitted INSIDE its box (aspect kept, transparent padding) like the editor preview's object-fit: contain. It used to be stretched to the box.
2. Media overlays, text, lower thirds, shapes and subtitles are stacked by ONE shared `order`, with the editor's own tie-break, instead of fixed passes
   (media -> shapes -> lower thirds -> text -> subtitles) that ignored `order` across kinds.
"""
import subprocess
from pathlib import Path

import pytest
from PIL import Image

from app.services import ffmpeg_svc

USER_ID = 999
CANVAS = (320, 180)
MAGENTA, YELLOW = (255, 0, 255), (255, 255, 0)


def _frame(path: str, t: float, tmp_path: Path, tag: str) -> Image.Image:
    out = tmp_path / f"frame_{tag}.png"
    subprocess.run([ffmpeg_svc.FFMPEG_BIN, "-y", "-v", "error", "-ss", str(t), "-i", path, "-frames:v", "1", str(out)], check=True, capture_output=True)
    return Image.open(out).convert("RGB")


def _near(c, ref, tol=40):
    return all(abs(a - b) <= tol for a, b in zip(c, ref))


def _bbox(im: Image.Image, ref, tol=40):
    px = im.load()
    xs, ys = [], []
    for y in range(im.height):
        for x in range(im.width):
            if _near(px[x, y], ref, tol):
                xs.append(x); ys.append(y)
    return (min(xs), min(ys), max(xs), max(ys)) if xs else None


def _solid_png(path: Path, size, rgb) -> str:
    Image.new("RGBA", size, rgb + (255,)).save(path)
    return str(path)


def _project(clip: str, **layers) -> dict:
    return {
        "canvas_width": CANVAS[0], "canvas_height": CANVAS[1],
        "video_clips": [{
            "path": clip, "trim_in": 0, "start_time": 0, "end_time": 3, "speed": 1, "color_grade": "none", "brightness": 0, "contrast": 0, "saturation": 0,
            "transition": "cut", "transition_duration": 0.5, "has_separated_audio": False,
        }],
        "text_overlays": [], "audio_tracks": [], **layers,
    }


def _media(path: str, x, y, w, h, order=0) -> dict:
    return {"path": path, "is_image": True, "start": 0, "end": 3, "x": x, "y": y, "width": w, "height": h, "opacity": 1.0, "muted": False, "volume": 1.0, "order": order}


def _shape(x, y, w, h, order=0) -> dict:
    return {"kind": "rectangle", "start_time": 0, "end_time": 3, "x": x, "y": y, "width": w, "height": h, "fill_color": "#ffff00", "opacity": 1.0,
            "border_color": None, "border_width": 0, "border_radius": 0, "full_width": False, "order": order}


def _lower_third(x, y, w, h, order=0) -> dict:
    return {"name": "Name", "title": "Title", "start_time": 0, "end_time": 3, "x": x, "y": y, "width": w, "height": h, "order": order}


# ── the pure stacking rule ──────────────────────────────────────────────────────────────────

def test_default_ties_follow_the_editors_own_sequence():
    runs = ffmpeg_svc._stack_runs({"media_overlays": [{"order": 0}], "text_overlays": [{"order": 0}], "lower_thirds": [{"order": 0}], "shapes": [{"order": 0}], "subtitles": [{"order": 0}]})
    assert [k for k, _ in runs] == ["media", "text", "lower_third", "shape", "subtitle"]          # text under lower third under shape, as the editor paints them


def test_order_is_shared_across_kinds_and_same_kind_neighbours_are_composited_together():
    project = {"media_overlays": [{"order": 5}, {"order": 6}], "shapes": [{"order": 1}, {"order": 9}], "text_overlays": [{"order": 3}]}
    runs = ffmpeg_svc._stack_runs(project)
    assert [(k, [i["order"] for i in items]) for k, items in runs] == [("shape", [1]), ("text", [3]), ("media", [5, 6]), ("shape", [9])]


def test_a_missing_order_counts_as_zero_and_list_position_breaks_ties_within_a_kind():
    runs = ffmpeg_svc._stack_runs({"shapes": [{"id": "a"}, {"id": "b", "order": 0}, {"id": "c", "order": None}]})
    assert runs == [("shape", [{"id": "a"}, {"id": "b", "order": 0}, {"id": "c", "order": None}])]
    assert ffmpeg_svc._stack_runs({}) == []


# ── real renders ────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_a_picture_is_fitted_inside_its_box_not_stretched_to_it(clips, tmp_path):
    wide = _solid_png(tmp_path / "wide.png", (200, 100), MAGENTA)                      # 2:1 picture
    # box = 40% x 70% of 320x180 = 128 x 126 px: nearly square, so a stretch would be 128x126 and a fit is 128x64, centred vertically
    out = await ffmpeg_svc.render_project(_project(clips[1], media_overlays=[_media(wide, 10, 10, 40, 70)]), USER_ID)
    im = _frame(str(out), 1.0, tmp_path, "fit")
    bb = _bbox(im, MAGENTA)
    assert bb is not None
    w, h = bb[2] - bb[0] + 1, bb[3] - bb[1] + 1
    assert abs(w / h - 2.0) < 0.1, f"drawn {w}x{h}: the picture was stretched to its box"
    assert abs(w - 128) <= 3 and abs(h - 64) <= 3
    box_top, box_h = round(180 * 0.10), 126
    assert abs((bb[1] + bb[3]) / 2 - (box_top + box_h / 2)) <= 3, "the fitted picture is centred in its box"
    # the padding is transparent: the video shows above and below the picture inside the box
    assert _near(im.getpixel((round(320 * 0.10) + 64, box_top + 5)), im.getpixel((300, 5)), 12)


@pytest.mark.asyncio
async def test_a_box_with_the_pictures_own_proportions_is_unchanged(clips, tmp_path):
    wide = _solid_png(tmp_path / "wide2.png", (200, 100), MAGENTA)
    out = await ffmpeg_svc.render_project(_project(clips[1], media_overlays=[_media(wide, 10, 10, 40, 40)]), USER_ID)       # 128 x 72: a hair off 2:1 because the canvas is 16:9
    bb = _bbox(_frame(str(out), 1.0, tmp_path, "same"), MAGENTA)
    assert bb is not None and abs((bb[2] - bb[0] + 1) - 128) <= 3 and abs((bb[3] - bb[1] + 1) - 64) <= 9


@pytest.mark.asyncio
async def test_a_higher_order_shape_is_drawn_over_a_lower_order_picture(clips, tmp_path):
    img = _solid_png(tmp_path / "sq.png", (100, 100), MAGENTA)
    project = _project(clips[1], media_overlays=[_media(img, 20, 20, 40, 70, order=1)], shapes=[_shape(30, 30, 40, 60, order=5)])
    im = _frame(str(await ffmpeg_svc.render_project(project, USER_ID)), 1.0, tmp_path, "shape_top")
    assert _near(im.getpixel((round(320 * 0.40), round(180 * 0.55))), YELLOW), "the higher-order shape must cover the picture where they overlap"


@pytest.mark.asyncio
async def test_a_higher_order_picture_is_drawn_over_a_lower_order_shape(clips, tmp_path):
    """The old fixed order (media first, shapes after) could never do this."""
    img = _solid_png(tmp_path / "sq2.png", (100, 100), MAGENTA)
    project = _project(clips[1], media_overlays=[_media(img, 20, 20, 40, 70, order=5)], shapes=[_shape(30, 30, 40, 60, order=1)])
    im = _frame(str(await ffmpeg_svc.render_project(project, USER_ID)), 1.0, tmp_path, "img_top")
    # 40% x 70% of 320x180 = 128x126 box at (64, 36); the picture is square so it is fitted to 126x126, centred: it covers the shape's overlap
    assert _near(im.getpixel((round(320 * 0.40), round(180 * 0.55))), MAGENTA), "the higher-order picture must cover the shape where they overlap"


@pytest.mark.asyncio
async def test_with_no_order_set_a_shape_is_over_a_lower_third_as_in_the_editor(clips, tmp_path):
    """Editor tie-break: lower third, then shape. The old export drew lower thirds AFTER shapes, so they were on top."""
    project = _project(clips[1], shapes=[_shape(10, 40, 30, 40)], lower_thirds=[_lower_third(5, 30, 55, 60)])
    im = _frame(str(await ffmpeg_svc.render_project(project, USER_ID)), 1.0, tmp_path, "tie")
    assert _near(im.getpixel((round(320 * 0.25), round(180 * 0.60))), YELLOW), "the shape must be over the lower third"


@pytest.mark.asyncio
async def test_a_project_without_any_layers_still_renders_and_a_layer_run_does_not_break_audio(clips, custom_audio, tmp_path):
    out = await ffmpeg_svc.render_project(_project(clips[1], audio_tracks=[{"path": custom_audio, "trim_in": 0, "start_time": 0, "end_time": 3, "volume": 1.0}]), USER_ID)
    assert Path(out).exists() and "Audio:" in subprocess.run([ffmpeg_svc.FFMPEG_BIN, "-i", str(out)], capture_output=True, text=True).stderr
