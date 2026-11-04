"""Shapes that sit BEHIND the footage (Option C, "mask overlay").

A shape marked `behind_footage` must show only where the V1 picture is not. The exporter already composites shapes as positioned PNGs over the finished V1 base, so no filter graph is touched here: for each
such shape the PNG is made transparent wherever footage is on screen at that moment, and it is composited right after the V1 base (before V2 inserts), exactly like any other shape overlay.

Everything in this module is PURE except `clear_rects_png` (Pillow) and `probe_display_size` (one ffmpeg probe per distinct file). The geometry and the time-occupancy rules are mirrored by
`frontend/src/pages/video-studio-v2/export/footageGeometry.ts` and both are held to the same cases in `backend/tests/fixtures/footage_geometry_cases.json`, so the preview and the MP4 cannot drift apart.

What counts as "footage on screen":
  * a clip's picture occupies its rectangle for the clip's whole main span, whatever its brightness (a fade to black is still footage-coloured pixels, not canvas);
  * a blend (dissolve / wipe / zoom) window [J - pre, J + post) shows BOTH clips' pictures: the union of the two rectangles;
  * 'fill' clips cover the whole canvas, so a behind shape is not visible under them;
  * where no clip is on screen (a timeline gap) the shape is fully visible.
"""
from __future__ import annotations

import asyncio
import re
import shutil
from dataclasses import dataclass
from pathlib import Path

from app.services import timeline_plan

Rect = tuple[int, int, int, int]  # x, y, w, h in canvas pixels


def _rescale(a: int, b: int, c: int) -> int:
    """av_rescale: round-to-nearest (half away from zero) of a * b / c, for positive integers."""
    return (a * b * 2 + c) // (2 * c)


def footage_rect(cw: int, ch: int, sw: int, sh: int, fit_mode: str = "fit") -> Rect:
    """The rectangle the picture of a clip occupies on the canvas.

    'fill' (and any source of unknown size) covers the whole canvas. 'fit' is what `build_clip_segment` produces with
    `scale=cw:ch:force_original_aspect_ratio=decrease,pad=cw:ch:(ow-iw)/2:(oh-ih)/2`: the scaled size follows libavfilter's rule (rescale with rounding to nearest), and the
    pad offset is centred and aligned down to an even pixel (yuv420p chroma), as the pad filter does."""
    if fit_mode == "fill" or sw <= 0 or sh <= 0:
        return (0, 0, cw, ch)
    tmp_w = _rescale(ch, sw, sh)
    if tmp_w > cw:
        w, h = cw, _rescale(cw, sh, sw)
    else:
        w, h = tmp_w, ch
    w, h = max(2, min(w, cw)), max(2, min(h, ch))
    x, y = ((cw - w) // 2) & ~1, ((ch - h) // 2) & ~1                       # the pad offset is centred from the scaler's own size, then aligned down to an even pixel (yuv420p chroma)
    w, h = w & ~1, h & ~1                                                    # the picture drawn is the even-sized part: a computed 101 shows 100 (measured against the real render)
    return (x, y, w, h)


def covers_canvas(r: Rect, cw: int, ch: int) -> bool:
    return r[0] <= 0 and r[1] <= 0 and r[0] + r[2] >= cw and r[1] + r[3] >= ch


@dataclass(frozen=True)
class Span:
    """footage on screen for frames [t0, t1) of the whole timeline, as the set of rectangles it occupies (empty set = no footage)"""
    t0: int
    t1: int
    rects: frozenset


def run_events(clips: list[dict], plan: "timeline_plan.TimelinePlan", cw: int, ch: int, sizes: dict[str, tuple[int, int]]) -> list[tuple[int, int, Rect]]:
    """(t0, t1, rect) for every picture that is on screen in one contiguous run of V1 clips, from that run's own timeline plan: each clip's main span, plus the pre-roll / post-roll a blend
    shows on the far side of its join."""
    rects: list[Rect] = []
    for c in clips:
        sw, sh = sizes.get(c["path"], (0, 0))
        rects.append(footage_rect(cw, ch, sw, sh, c.get("fit_mode", "fit")))
    ev: list[tuple[int, int, Rect]] = []
    for k, cp in enumerate(plan.clips):
        ev.append((cp.start_f, cp.start_f + cp.n, rects[k]))
    for jn in plan.joins:
        if jn.kind == "blend":
            if jn.pre > 0:
                ev.append((jn.join_f - jn.pre, jn.join_f, rects[jn.index + 1]))      # the incoming clip's pre-roll, shown before the join
            if jn.post > 0:
                ev.append((jn.join_f, jn.join_f + jn.post, rects[jn.index]))         # the outgoing clip's post-roll, shown after the join
    return ev


def occupancy(events: list[tuple[int, int, Rect]], window: tuple[int, int]) -> list[Span]:
    """The footage-on-screen spans inside the frame window [a, b), consecutive spans with the same rectangles merged. Frames with no footage are spans with an empty set."""
    a, b = window
    if b <= a:
        return []
    cuts = sorted({a, b, *(t for t0, t1, _ in events for t in (t0, t1) if a < t < b)})
    spans: list[Span] = []
    for t0, t1 in zip(cuts, cuts[1:]):
        rs = frozenset(r for e0, e1, r in events if e0 < t1 and e1 > t0)
        if spans and spans[-1].rects == rs:
            spans[-1] = Span(spans[-1].t0, t1, rs)
        else:
            spans.append(Span(t0, t1, rs))
    return spans


def union_covers(rects: frozenset, cw: int, ch: int) -> bool:
    """True when the shape would be completely hidden (a single rectangle covers the canvas). Unions of several partial rectangles are not tested: the PNG is simply cleared and, if empty, skipped."""
    return any(covers_canvas(r, cw, ch) for r in rects)


def clear_rects_png(src: str, dst: str, origin: tuple[int, int], rects: frozenset) -> bool:
    """Writes `dst` = `src` with alpha 0 inside every rectangle (canvas pixels; `origin` is where the PNG's top-left sits on the canvas). Returns False when nothing visible is left."""
    from PIL import Image
    im = Image.open(src).convert("RGBA")
    ox, oy = origin
    clear = Image.new("RGBA", (1, 1), (0, 0, 0, 0))
    for (x, y, w, h) in rects:
        x0, y0, x1, y1 = max(0, x - ox), max(0, y - oy), min(im.width, x + w - ox), min(im.height, y + h - oy)
        if x1 > x0 and y1 > y0:
            im.paste(clear.resize((x1 - x0, y1 - y0)), (x0, y0))
    if im.getchannel("A").getbbox() is None:
        return False
    im.save(dst)
    return True


_SIZE_RE = re.compile(r"Video:.*?(\d{2,5})x(\d{2,5})")
_ROT_RE = re.compile(r"rotation of (-?\d+(?:\.\d+)?) degrees")


def display_size_from_probe(text: str) -> tuple[int, int] | None:
    """Pixel size of the picture as ffmpeg will deliver it (a clip stored sideways with a 90 / 270 degree display matrix is auto-rotated, so its width and height swap)."""
    m = _SIZE_RE.search(text)
    if not m:
        return None
    w, h = int(m.group(1)), int(m.group(2))
    r = _ROT_RE.search(text)
    if r and int(round(abs(float(r.group(1))))) % 180 == 90:
        w, h = h, w
    return w, h


def png_path_for(base: str, key: int) -> str:
    p = Path(base)
    return str(p.with_name(f"{p.stem}-bf{key}{p.suffix}"))


def window_frames(shape: dict) -> tuple[int, int]:
    return timeline_plan.to_frames(shape["start_time"]), timeline_plan.to_frames(shape["end_time"])


async def plan_behind_overlays(shapes: list[dict], events: list[tuple[int, int, Rect]], cw: int, ch: int, user_id: int, render_png) -> tuple[list[dict], list[str]]:
    """For each behind shape: the overlays (`{path, start, end, x, y}`, the shape `composite_image_overlays` takes) that show it only outside the footage, and the temp PNGs to delete.
    `render_png(item, cw, ch, user_id) -> (path, w, h)` is canvas_render_svc.render_shape_png, injected so this stays testable. One PNG is made per distinct set of footage rectangles."""
    overlays: list[dict] = []
    temps: list[str] = []
    F = timeline_plan.FPS
    for sh in shapes:
        item = dict(sh)
        if item.get("full_width"):
            item["width"] = 100
        base_path, _w, _h = await asyncio.to_thread(render_png, item, cw, ch, user_id)
        temps.append(str(base_path))
        ox = 0 if item.get("full_width") else round(cw * item.get("x", 0) / 100)
        oy = round(ch * item.get("y", 0) / 100)
        made: dict[frozenset, str | None] = {}
        for sp in occupancy(events, window_frames(sh)):
            if union_covers(sp.rects, cw, ch):
                continue                                              # footage fills the canvas here: the shape is not visible, nothing to draw
            if sp.rects not in made:
                if not sp.rects:
                    made[sp.rects] = str(base_path)                   # no footage: the shape exactly as any other shape would be drawn
                else:
                    dst = png_path_for(str(base_path), len(made))
                    ok = await asyncio.to_thread(clear_rects_png, str(base_path), dst, (ox, oy), sp.rects)
                    made[sp.rects] = dst if ok else None
                    if ok:
                        temps.append(dst)
            path = made[sp.rects]
            if path:
                overlays.append({"path": path, "start": sp.t0 / F, "end": sp.t1 / F, "x": ox, "y": oy})
    return overlays, temps


async def probe_display_sizes(paths: list[str], probe) -> dict[str, tuple[int, int]]:
    """One probe per distinct file. `probe(path) -> str` is ffmpeg_svc._probe. A file that cannot be read is left out (its clip then counts as covering the canvas, so nothing is drawn over it)."""
    out: dict[str, tuple[int, int]] = {}
    for p in dict.fromkeys(paths):
        try:
            size = display_size_from_probe(await probe(p))
        except Exception:
            size = None
        if size:
            out[p] = size
    return out
