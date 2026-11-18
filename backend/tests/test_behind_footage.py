"""Option C ("mask overlay"): a shape marked behind_footage shows only where no footage is on screen. Tested on the REAL ffmpeg render (no database, no network).

1. The footage rectangle the planner assumes is exactly where `build_clip_segment` puts the picture (several canvases x several source shapes, fit and fill).
2. The pure occupancy rules: a main span, a dissolve window (union of both pictures), a fade (still footage), a gap (no footage), 'fill' (hidden).
3. End to end through render_project: a wide clip on a portrait canvas with a behind banner shows the banner in the bars and not over the picture; an ordinary shape is unchanged; the default render
   (no behind shape) is byte-for-byte the same pipeline as before; a dissolve between different-shaped clips hides the shape under BOTH pictures during the window.
"""
import subprocess
from pathlib import Path

import pytest
from PIL import Image

from app.services import behind_footage as bf
from app.services import canvas_render_svc, ffmpeg_svc, timeline_plan as tp

USER_ID = 999
RED, BLUE, YELLOW = (255, 0, 0), (0, 0, 255), (255, 255, 0)


def _color_clip(path: Path, w: int, h: int, rgb=RED, secs=3) -> str:
    hexc = "0x%02x%02x%02x" % rgb
    subprocess.run([ffmpeg_svc.FFMPEG_BIN, "-y", "-v", "error", "-f", "lavfi", "-i", f"color=c={hexc}:s={w}x{h}:d={secs}:r=30", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(path)], check=True, capture_output=True)
    return str(path)


def _frame(path: str, t: float, tmp_path: Path, tag: str) -> Image.Image:
    out = tmp_path / f"frame_{tag}.png"
    subprocess.run([ffmpeg_svc.FFMPEG_BIN, "-y", "-v", "error", "-ss", str(t), "-i", path, "-frames:v", "1", str(out)], check=True, capture_output=True)
    return Image.open(out).convert("RGB")


def _near(c, ref, tol=60):
    return all(abs(a - b) <= tol for a, b in zip(c, ref))


def _bbox(im: Image.Image, ref, tol=60):
    px = im.load()
    xs, ys = [], []
    for y in range(im.height):
        for x in range(im.width):
            if _near(px[x, y], ref, tol):
                xs.append(x); ys.append(y)
    return (min(xs), min(ys), max(xs) - min(xs) + 1, max(ys) - min(ys) + 1) if xs else None


def _picture_bbox(im: Image.Image, pad=BLUE, tol=60):
    """Where the picture is = every pixel that is not the padding colour (an odd-sized picture's edge column is chroma-blended with the padding, so a strict colour test would miss it)."""
    px = im.load()
    xs, ys = [], []
    for y in range(im.height):
        for x in range(im.width):
            if not _near(px[x, y], pad, tol):
                xs.append(x); ys.append(y)
    return (min(xs), min(ys), max(xs) - min(xs) + 1, max(ys) - min(ys) + 1) if xs else None


# ── 1. geometry equals what the exporter really draws ────────────────────────────────────────────
CASES = [((320, 180), (640, 360)), ((320, 180), (360, 640)), ((320, 180), (400, 400)), ((180, 320), (640, 360)), ((180, 320), (360, 640)), ((200, 200), (640, 360)), ((200, 200), (360, 640)),
         ((320, 180), (320, 240)), ((256, 144), (480, 270)), ((320, 180), (200, 150)), ((324, 576), (1280, 720))]


@pytest.mark.asyncio
@pytest.mark.parametrize("canvas,src", CASES)
async def test_the_assumed_rectangle_is_where_the_picture_really_is(canvas, src, tmp_path):
    cw, ch = canvas
    clip = _color_clip(tmp_path / "src.mp4", *src)
    seg = await ffmpeg_svc.build_clip_segment(clip, 0, 1.0, 1, "none", 0, 0, 0, cw, ch, keep_audio=False, volume=1.0, user_id=USER_ID, fit_mode="fit", crop_x=50.0, crop_y=50.0, pad_color="0x0000ff", backdrop="color")
    got = _picture_bbox(_frame(str(seg), 0.2, tmp_path, "g"))
    assert got == bf.footage_rect(cw, ch, src[0], src[1], "fit"), f"canvas {canvas} source {src}: picture is at {got}"


@pytest.mark.asyncio
async def test_a_fill_clip_covers_the_whole_canvas(tmp_path):
    clip = _color_clip(tmp_path / "src.mp4", 640, 360)
    seg = await ffmpeg_svc.build_clip_segment(clip, 0, 1.0, 1, "none", 0, 0, 0, 180, 320, keep_audio=False, volume=1.0, user_id=USER_ID, fit_mode="fill", crop_x=50.0, crop_y=50.0, pad_color="0x0000ff", backdrop="color")
    assert _picture_bbox(_frame(str(seg), 0.2, tmp_path, "fill")) == bf.footage_rect(180, 320, 640, 360, "fill") == (0, 0, 180, 320)


def test_a_sideways_file_swaps_its_size_and_an_unreadable_one_counts_as_covering():
    assert bf.display_size_from_probe("Stream #0:0: Video: h264, yuv420p, 1920x1080 [SAR 1:1 DAR 16:9], 30 fps") == (1920, 1080)
    assert bf.display_size_from_probe("Video: h264, yuv420p, 1920x1080, 30 fps\n    Side data:\n      displaymatrix: rotation of -90.00 degrees") == (1080, 1920)
    assert bf.display_size_from_probe("Video: h264, yuv420p, 1920x1080\n displaymatrix: rotation of 180.00 degrees") == (1920, 1080)
    assert bf.display_size_from_probe("no video here") is None
    assert bf.footage_rect(320, 180, 0, 0, "fit") == (0, 0, 320, 180)


# ── 2. the occupancy rules (pure) ─────────────────────────────────────────────────────────────────
def _clip(path, start, end, transition="cut", dur=0.5, trim=0.0, fit="fit"):
    return {"path": path, "trim_in": trim, "start_time": start, "end_time": end, "speed": 1, "transition": transition, "transition_duration": dur, "fit_mode": fit}


def _events(clips, sizes, cw=180, ch=320, durations=None):
    plan = tp.plan_timeline(clips, ffmpeg_svc._XFADE_NAMES, durations or {}, policy="shorten")
    return bf.run_events(clips, plan, cw, ch, sizes), plan


def test_one_clip_occupies_its_rectangle_for_its_whole_span_and_nothing_outside_it():
    ev, _ = _events([_clip("a", 0, 3)], {"a": (640, 360)})
    r = bf.footage_rect(180, 320, 640, 360)
    assert bf.occupancy(ev, (0, 90)) == [bf.Span(0, 90, frozenset({r}))]
    assert bf.occupancy(ev, (60, 150)) == [bf.Span(60, 90, frozenset({r})), bf.Span(90, 150, frozenset())]            # after the clip: no footage, the shape is fully visible


def test_a_dissolve_window_is_the_union_of_both_pictures_and_a_fade_is_still_footage():
    sizes = {"a": (640, 360), "b": (360, 640)}
    clips = [_clip("a", 0, 3, "dissolve", 0.6, trim=1.0), _clip("b", 3, 6, trim=1.0)]
    ev, plan = _events(clips, sizes, durations={"a": 10.0, "b": 10.0})
    ra, rb = bf.footage_rect(180, 320, 640, 360), bf.footage_rect(180, 320, 360, 640)
    j = plan.joins[0]
    assert j.kind == "blend" and j.pre > 0 and j.post > 0
    spans = bf.occupancy(ev, (0, 180))
    assert [(s.t0, s.t1, s.rects) for s in spans] == [(0, j.join_f - j.pre, frozenset({ra})), (j.join_f - j.pre, j.join_f + j.post, frozenset({ra, rb})), (j.join_f + j.post, 180, frozenset({rb}))]
    fade_clips = [_clip("a", 0, 3, "fade_black", 0.6), _clip("b", 3, 6)]
    ev2, _ = _events(fade_clips, sizes)
    assert [(s.t0, s.t1, s.rects) for s in bf.occupancy(ev2, (0, 180))] == [(0, 90, frozenset({ra})), (90, 180, frozenset({rb}))]


def test_a_gap_between_runs_has_no_footage_and_fill_hides_the_shape():
    r1 = tp.split_runs([_clip("a", 0, 1), _clip("b", 3, 4)])
    assert len(r1) == 2
    ev = bf.run_events(r1[0], tp.plan_timeline(r1[0], ffmpeg_svc._XFADE_NAMES), 180, 320, {"a": (640, 360)}) + bf.run_events(r1[1], tp.plan_timeline(r1[1], ffmpeg_svc._XFADE_NAMES), 180, 320, {"b": (640, 360)})
    spans = bf.occupancy(ev, (0, 120))
    assert [(s.t0, s.t1, bool(s.rects)) for s in spans] == [(0, 30, True), (30, 90, False), (90, 120, True)]
    assert bf.union_covers(frozenset({bf.footage_rect(180, 320, 640, 360, "fill")}), 180, 320)


def test_clearing_makes_the_pixels_transparent_and_reports_when_nothing_is_left(tmp_path):
    src = tmp_path / "s.png"
    Image.new("RGBA", (100, 40), YELLOW + (255,)).save(src)
    dst = tmp_path / "d.png"
    assert bf.clear_rects_png(str(src), str(dst), (10, 20), frozenset({(0, 0, 60, 30)})) is True       # rect covers canvas x 0..60, y 0..30: PNG x 0..50, y 0..10
    im = Image.open(dst)
    assert im.getpixel((10, 5))[3] == 0 and im.getpixel((55, 5))[3] == 255 and im.getpixel((10, 15))[3] == 255
    assert bf.clear_rects_png(str(src), str(dst), (10, 20), frozenset({(0, 0, 200, 200)})) is False


# ── 3. end to end ─────────────────────────────────────────────────────────────────────────────────
def _project(clips: list[dict], shapes, cw=180, ch=320) -> dict:
    return {"canvas_width": cw, "canvas_height": ch, "canvas_background": "#0000ff", "video_clips": clips, "text_overlays": [], "audio_tracks": [], "shapes": shapes}


def _vc(path, start, end, **kw):
    return {"path": path, "trim_in": 0, "start_time": start, "end_time": end, "speed": 1, "color_grade": "none", "brightness": 0, "contrast": 0, "saturation": 0,
            "transition": "cut", "transition_duration": 0.5, "has_separated_audio": False, **kw}


def _shape(x, y, w, h, behind=False, full_width=False, order=0, start=0, end=3):
    d = {"kind": "rectangle", "start_time": start, "end_time": end, "x": x, "y": y, "width": w, "height": h, "fill_color": "#ffff00", "opacity": 1.0, "border_color": None, "border_width": 0,
         "border_radius": 0, "full_width": full_width, "order": order}
    if behind:
        d["behind_footage"] = True
    return d


@pytest.mark.asyncio
async def test_a_behind_banner_shows_in_the_bars_and_never_over_the_picture(tmp_path):
    wide = _color_clip(tmp_path / "wide.mp4", 640, 360)              # 16:9 picture on a 9:16 canvas: bars above and below
    out = await ffmpeg_svc.render_project(_project([_vc(wide, 0, 3)], [_shape(0, 0, 100, 100, behind=True)]), USER_ID)
    im = _frame(str(out), 1.0, tmp_path, "bars")
    pic = bf.footage_rect(180, 320, 640, 360)
    assert _picture_bbox(im, YELLOW) == pic, "the picture is untouched and the shape fills exactly the bars"
    assert _near(im.getpixel((90, 10)), YELLOW) and _near(im.getpixel((90, 310)), YELLOW), "the shape is visible in the bars"
    assert _near(im.getpixel((90, 160)), RED), "and not over the picture"
    # the same shape NOT behind covers the picture (the long-standing behaviour is unchanged)
    over = await ffmpeg_svc.render_project(_project([_vc(wide, 0, 3)], [_shape(0, 0, 100, 100)]), USER_ID)
    assert _near(_frame(str(over), 1.0, tmp_path, "over").getpixel((90, 160)), YELLOW)


@pytest.mark.asyncio
async def test_under_a_fill_clip_it_is_invisible_and_in_a_gap_it_is_fully_visible(tmp_path):
    wide = _color_clip(tmp_path / "wide.mp4", 640, 360)
    fill = await ffmpeg_svc.render_project(_project([_vc(wide, 0, 3, fit_mode="fill")], [_shape(0, 0, 100, 100, behind=True)]), USER_ID)
    im = _frame(str(fill), 1.0, tmp_path, "fill")
    assert not _near(im.getpixel((90, 10)), YELLOW) and not _near(im.getpixel((90, 160)), YELLOW)
    gap = await ffmpeg_svc.render_project(_project([_vc(wide, 0, 1), _vc(wide, 2, 3)], [_shape(0, 0, 100, 100, behind=True)]), USER_ID)
    assert _near(_frame(str(gap), 1.5, tmp_path, "gap").getpixel((90, 160)), YELLOW), "no footage in the gap: the shape is complete"
    assert _near(_frame(str(gap), 0.5, tmp_path, "gap0").getpixel((90, 10)), YELLOW) and not _near(_frame(str(gap), 0.5, tmp_path, "gap1").getpixel((90, 160)), YELLOW)


@pytest.mark.asyncio
async def test_it_lies_under_ordinary_layers_and_only_inside_its_own_time(tmp_path):
    wide = _color_clip(tmp_path / "wide.mp4", 640, 360)
    ordinary = _shape(0, 40, 100, 20, order=1)
    ordinary["fill_color"] = "#00ff00"
    out = await ffmpeg_svc.render_project(_project([_vc(wide, 0, 3)], [_shape(0, 0, 100, 100, behind=True, start=1, end=2), ordinary]), USER_ID)
    assert not _near(_frame(str(out), 0.5, tmp_path, "t0").getpixel((90, 10)), YELLOW), "before its start time it is not drawn"
    assert _near(_frame(str(out), 1.5, tmp_path, "t1").getpixel((90, 10)), YELLOW), "inside its time it fills the bars"
    assert not _near(_frame(str(out), 2.5, tmp_path, "t3").getpixel((90, 10)), YELLOW), "after its end time it is gone"
    assert _near(_frame(str(out), 1.5, tmp_path, "t2").getpixel((90, 160)), (0, 255, 0), 80), "an ordinary shape still lies over the footage"


@pytest.mark.asyncio
async def test_a_dissolve_between_different_shaped_pictures_hides_the_shape_under_both(tmp_path):
    wide, tall = _color_clip(tmp_path / "wide.mp4", 640, 360, RED, 5), _color_clip(tmp_path / "tall.mp4", 400, 640, (0, 255, 0), 5)
    clips = [_vc(wide, 0, 3, trim_in=1.0, transition="dissolve", transition_duration=0.6), _vc(tall, 3, 6, trim_in=1.0)]
    out = await ffmpeg_svc.render_project(_project(clips, [_shape(0, 0, 100, 100, behind=True, start=0, end=6)]), USER_ID)
    ra, rb = bf.footage_rect(180, 320, 640, 360), bf.footage_rect(180, 320, 400, 640)
    assert ra == (0, 108, 180, 100) and rb == (0, 16, 180, 288)
    at = lambda t, x, y: _near(_frame(str(out), t, tmp_path, f"d{t}_{x}_{y}").getpixel((x, y)), YELLOW, 40)
    assert at(2.0, 90, 30), "before the window only picture A is on screen: B area above A is still shape"
    assert not at(2.8, 90, 30), "inside the window B's pre-roll is on screen: the shape is hidden under it too"
    assert at(2.8, 90, 5) and at(4.0, 90, 5), "outside both pictures the shape is visible throughout"
    assert not at(4.0, 90, 150) and not at(4.0, 90, 30), "after the window picture B hides it"
    assert not at(2.0, 90, 150), "and picture A hides it before"


@pytest.mark.asyncio
async def test_without_a_behind_shape_the_pipeline_is_the_same_as_before(tmp_path, monkeypatch):
    wide = _color_clip(tmp_path / "wide.mp4", 640, 360)
    calls = []
    real = ffmpeg_svc.composite_image_overlays

    async def spy(*a, **k):
        calls.append(len(a[1]))
        return await real(*a, **k)
    monkeypatch.setattr(ffmpeg_svc, "composite_image_overlays", spy)
    await ffmpeg_svc.render_project(_project([_vc(wide, 0, 3)], [_shape(0, 0, 50, 50)]), USER_ID)
    assert calls == [1], "exactly one overlay pass for one ordinary shape: no extra pass when nothing is behind the footage"
