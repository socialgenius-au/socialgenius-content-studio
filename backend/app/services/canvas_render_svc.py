"""Phase 7 (Video Studio V2 — Export/FFmpeg Compositing Parity): renders styled canvas elements
— Text Overlays, Lower Thirds, Shapes, Subtitles — as real transparent PNGs via Pillow, which
ffmpeg_svc.composite_image_overlays then burns into the export as ordinary, time-gated `overlay`
filter compositing.

WHY PNGs INSTEAD OF ffmpeg's drawtext/drawbox FILTERS — a genuine, pre-existing finding, not a
stylistic choice: the exact static ffmpeg binary this project ships (imageio_ffmpeg's bundled
binary — see ffmpeg_svc.py's own FFMPEG_BIN) was compiled WITHOUT the `drawtext` filter at all.
Confirmed directly during this phase: `ffmpeg -filters` lists no `drawtext` entry, and
`-vf drawtext=...` fails immediately with "No such filter: 'drawtext'". `drawbox` and `overlay`
ARE present. This means the existing add_text_overlays() function (used by both /video-export/
export and the older /process/export) has never actually been able to burn text into a real
export in an environment using this exact ffmpeg build — a real, pre-existing gap this phase
surfaced, not one it introduced (see the Phase 7 report for the full explanation). Rendering text
as a real raster image and compositing it with the filter that IS present sidesteps the missing
filter entirely — and, as a direct benefit rather than a workaround, gives MORE styling fidelity
than drawtext could ever have offered anyway: real rounded-corner backgrounds, real backdrop
blur, real per-character letter-spacing, a real gradient text fill, and (for Shapes) a real
filled circle — none of which drawtext supports even when it exists.

FONT — bundled directly in this repo (app/assets/fonts/DejaVuSans[-Bold].ttf; see that
directory's own LICENSE.txt) rather than relying on a system font package: Railway's own
Dockerfile (out of scope for this phase to change — "Do NOT change Railway configuration") never
installs a font package, and python:3.12-slim ships none by default, so nothing can be assumed
present on the actual render host. DejaVu Sans is explicitly licensed for free embedding. No
italic/oblique variant is bundled (none was available to source) — italic text renders upright
in export; a real gap, documented here and in the Phase 7 report rather than silently ignored.
"""
import math
import uuid
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

from app.config import settings

_FONTS_DIR = Path(__file__).resolve().parent.parent / "assets" / "fonts"
_FONT_CACHE: dict[tuple[str, int], ImageFont.FreeTypeFont] = {}


def _load_font(size: int, bold: bool) -> ImageFont.FreeTypeFont:
    size = max(1, round(size))
    key = ("bold" if bold else "regular", size)
    if key not in _FONT_CACHE:
        name = "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"
        _FONT_CACHE[key] = ImageFont.truetype(str(_FONTS_DIR / name), size)
    return _FONT_CACHE[key]


def _hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    """Accepts '#RRGGBB' (or 'RRGGBB'); malformed input falls back to opaque black rather than
    raising — a cosmetic style field should never fail an entire export."""
    h = (hex_color or "").lstrip("#")
    if len(h) != 6:
        return (0, 0, 0)
    try:
        return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))
    except ValueError:
        return (0, 0, 0)


def _rgba(hex_color: str, opacity: float) -> tuple[int, int, int, int]:
    r, g, b = _hex_to_rgb(hex_color)
    a = round(max(0.0, min(1.0, opacity)) * 255)
    return (r, g, b, a)


def _out_png(user_id: int) -> Path:
    d = Path(settings.UPLOAD_DIR) / str(user_id)
    d.mkdir(parents=True, exist_ok=True)
    return d / f"{uuid.uuid4().hex}.png"


def _wrap_lines(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont, max_width: int, letter_spacing: float) -> list[str]:
    """Word-wraps at `max_width` px, same convention the canvas's own CSS white-space:pre-wrap
    box gives a real browser — greedy word-wrap, never splits a single word. An explicit '\\n'
    (or a literal newline already in the text) always starts a new line regardless of width."""
    def line_width(s: str) -> float:
        w = draw.textlength(s, font=font)
        if letter_spacing and len(s) > 1:
            w += letter_spacing * (len(s) - 1)
        return w

    lines: list[str] = []
    for paragraph in text.split("\n"):
        words = paragraph.split(" ")
        current = ""
        for word in words:
            trial = f"{current} {word}".strip()
            if current and line_width(trial) > max_width:
                lines.append(current)
                current = word
            else:
                current = trial
        lines.append(current)
    return lines or [""]


def _draw_text_line(img: Image.Image, xy: tuple[float, float], text: str, font: ImageFont.FreeTypeFont, fill: tuple[int, int, int, int], letter_spacing: float, stroke_width: int, stroke_fill: tuple[int, int, int, int] | None, underline: bool) -> float:
    """Draws one line, honouring letter_spacing (Pillow's own ImageDraw.text has no native
    per-character spacing control — a real engine gap, closed here by drawing character-by-
    character and advancing manually) and an optional underline (also not a Pillow primitive —
    a drawn line at the font's own descender position). Returns the line's total rendered width."""
    draw = ImageDraw.Draw(img)
    x, y = xy
    start_x = x
    if letter_spacing <= 0:
        draw.text((x, y), text, font=font, fill=fill, stroke_width=stroke_width, stroke_fill=stroke_fill)
        width = draw.textlength(text, font=font)
    else:
        width = 0.0
        for ch in text:
            draw.text((x + width, y), ch, font=font, fill=fill, stroke_width=stroke_width, stroke_fill=stroke_fill)
            width += draw.textlength(ch, font=font) + letter_spacing
        width = max(0.0, width - letter_spacing)
    if underline:
        _ascent, descent = font.getmetrics()
        underline_y = y + font.size - max(1, descent // 3)
        draw.line([(start_x, underline_y), (start_x + width, underline_y)], fill=fill, width=max(1, round(font.size / 16)))
    return width


def render_styled_text_box(
    text: str, box_w: int, font_size: int, color: str, align: str, bold: bool,
    underline: bool = False, letter_spacing: float = 0, line_spacing: float | None = None,
    opacity: float = 1.0,
    stroke_color: str | None = None, stroke_width: float = 0,
    shadow_color: str | None = None, shadow_blur: float = 0, shadow_offset_x: float = 0, shadow_offset_y: float = 0,
    use_gradient: bool = False, gradient_from: str | None = None, gradient_to: str | None = None,
    bg_color: str | None = None, bg_opacity: float = 1.0, bg_padding: float = 2,
    bg_border_radius: float = 0, bg_border_color: str | None = None, bg_border_width: float = 0,
    bg_blur: bool = False,
) -> Image.Image:
    """The one shared "styled, word-wrapped text box" renderer behind Text Overlays and
    Subtitles (Lower Thirds compose two calls to this — name + title — plus their own accent
    bar; see render_lower_third_png). Returns an RGBA image exactly `box_w` px wide; height is
    computed from the wrapped text, matching the frontend's own "height is implicit from
    content" convention for these element types (TextOverlay/SubtitleSegment both have no
    stored height field)."""
    font = _load_font(font_size, bold)
    probe = Image.new("RGBA", (1, 1))
    probe_draw = ImageDraw.Draw(probe)
    inner_w = max(1, box_w - round(bg_padding) * 2 - round(stroke_width) * 2)
    lines = _wrap_lines(probe_draw, text, font, inner_w, letter_spacing)
    ascent, descent = font.getmetrics()
    line_h = (ascent + descent) * (line_spacing if line_spacing else 1.15)
    text_block_h = round(line_h * len(lines))
    pad = round(bg_padding)
    shadow_pad = round(abs(shadow_offset_x) + abs(shadow_offset_y) + shadow_blur * 2)
    box_h = text_block_h + pad * 2 + shadow_pad

    img = Image.new("RGBA", (box_w, box_h), (0, 0, 0, 0))

    # Background chip — real rounded corners (Pillow's own rounded_rectangle, unlike ffmpeg
    # drawbox/drawtext's own `box`, which is always a plain rectangle) and a real Gaussian blur
    # for a translucent/frosted look, composited before the text/shadow layers.
    if bg_color:
        bg_layer = Image.new("RGBA", (box_w, box_h), (0, 0, 0, 0))
        bg_draw = ImageDraw.Draw(bg_layer)
        rect = (shadow_pad // 2, shadow_pad // 2, box_w - 1 - shadow_pad // 2, box_h - 1 - shadow_pad // 2)
        radius = max(0, min(round(bg_border_radius), (rect[2] - rect[0]) // 2, (rect[3] - rect[1]) // 2))
        bg_draw.rounded_rectangle(rect, radius=radius, fill=_rgba(bg_color, bg_opacity))
        if bg_border_width > 0 and bg_border_color:
            bg_draw.rounded_rectangle(rect, radius=radius, outline=_rgba(bg_border_color, 1.0), width=round(bg_border_width))
        if bg_blur:
            bg_layer = bg_layer.filter(ImageFilter.GaussianBlur(radius=4))
        img = Image.alpha_composite(img, bg_layer)

    # Shadow layer — drawn/blurred separately from the real text so the blur never bleeds onto
    # the glyphs themselves (matching CSS text-shadow's own separate-layer behaviour).
    if shadow_color and (shadow_blur > 0 or shadow_offset_x or shadow_offset_y):
        shadow_layer = Image.new("RGBA", (box_w, box_h), (0, 0, 0, 0))
        y = pad + shadow_pad / 2
        for line in lines:
            lw = probe_draw.textlength(line, font=font) if letter_spacing <= 0 else None
            x = _align_x(box_w, pad, inner_w, lw, align, line, font, letter_spacing, probe_draw)
            _draw_text_line(shadow_layer, (x + shadow_offset_x, y + shadow_offset_y), line, font, _rgba(shadow_color, opacity), letter_spacing, 0, None, False)
            y += line_h
        if shadow_blur > 0:
            shadow_layer = shadow_layer.filter(ImageFilter.GaussianBlur(radius=shadow_blur))
        img = Image.alpha_composite(img, shadow_layer)

    # Text layer. Gradient fill: Pillow has no native gradient-text primitive either — rendered
    # here as a real one, not an approximation: draw the text as a solid-white alpha MASK, paint
    # a horizontal linear gradient the same size, then composite the gradient through that mask
    # so only the glyph pixels receive gradient colour (the same technique CSS's own
    # background-clip:text uses under the hood).
    text_layer = Image.new("RGBA", (box_w, box_h), (0, 0, 0, 0))
    y = pad + shadow_pad / 2
    line_boxes: list[tuple[float, float, str]] = []
    for line in lines:
        lw = probe_draw.textlength(line, font=font) if letter_spacing <= 0 else None
        x = _align_x(box_w, pad, inner_w, lw, align, line, font, letter_spacing, probe_draw)
        line_boxes.append((x, y, line))
        y += line_h

    if use_gradient and gradient_from and gradient_to:
        mask = Image.new("L", (box_w, box_h), 0)
        mask_rgba = Image.new("RGBA", (box_w, box_h), (0, 0, 0, 0))
        for x, ly, line in line_boxes:
            _draw_text_line(mask_rgba, (x, ly), line, font, (255, 255, 255, 255), letter_spacing, round(stroke_width), (255, 255, 255, 255) if stroke_width else None, underline)
        mask = mask_rgba.split()[3]
        gradient = Image.new("RGBA", (box_w, box_h))
        c0, c1 = _hex_to_rgb(gradient_from), _hex_to_rgb(gradient_to)
        alpha_byte = round(max(0.0, min(1.0, opacity)) * 255)
        for gx in range(box_w):
            t = gx / max(1, box_w - 1)
            col = tuple(round(c0[i] + (c1[i] - c0[i]) * t) for i in range(3)) + (alpha_byte,)
            for gy in range(box_h):
                gradient.putpixel((gx, gy), col)
        gradient.putalpha(mask.point(lambda a: round(a * (alpha_byte / 255))))
        img = Image.alpha_composite(img, gradient)
    else:
        fill = _rgba(color, opacity)
        stroke_fill = _rgba(stroke_color, 1.0) if stroke_color and stroke_width else None
        for x, ly, line in line_boxes:
            _draw_text_line(text_layer, (x, ly), line, font, fill, letter_spacing, round(stroke_width), stroke_fill, underline)
        img = Image.alpha_composite(img, text_layer)

    return img


def _align_x(box_w: int, pad: int, inner_w: int, line_width: float | None, align: str, line: str, font: ImageFont.FreeTypeFont, letter_spacing: float, draw: ImageDraw.ImageDraw) -> float:
    if line_width is None:
        line_width = draw.textlength(line, font=font) + letter_spacing * max(0, len(line) - 1)
    if align == "center":
        return pad + max(0.0, (inner_w - line_width) / 2)
    if align == "right":
        return pad + max(0.0, inner_w - line_width)
    return float(pad)


def render_text_overlay_png(t: dict, canvas_w: int, canvas_h: int, user_id: int) -> tuple[Path, int, int]:
    """t: the same shape ffmpeg_svc.render_project already builds from ExportTextOverlay — see
    that schema's own field list. Returns (png_path, box_w_px, box_h_px) — the overlay step
    needs the actual rendered height to position the box's own y correctly."""
    box_w = max(1, round(canvas_w * t.get("width_pct", 100) / 100)) if t.get("width_pct") is not None else round(canvas_w * 0.9)
    img = render_styled_text_box(
        text=str(t["text"]), box_w=box_w, font_size=t.get("font_size", 42), color=t.get("color", "#FFFFFF"),
        align=t.get("align", "left"), bold=t.get("bold", False), underline=t.get("underline", False),
        letter_spacing=t.get("letter_spacing", 0), line_spacing=t.get("line_spacing", 1.15),
        opacity=t.get("opacity", 1.0),
        stroke_color=t.get("stroke_color"), stroke_width=t.get("stroke_width", 0),
        shadow_color=t.get("shadow_color"), shadow_blur=t.get("shadow_blur", 0),
        shadow_offset_x=t.get("shadow_offset_x", 0), shadow_offset_y=t.get("shadow_offset_y", 0),
        use_gradient=t.get("use_gradient", False), gradient_from=t.get("gradient_from"), gradient_to=t.get("gradient_to"),
        bg_color=t.get("bg_color"), bg_opacity=t.get("bg_opacity", 0.5), bg_padding=t.get("bg_padding", 8),
        bg_border_radius=t.get("bg_border_radius", 0), bg_border_color=t.get("bg_border_color"),
        bg_border_width=t.get("bg_border_width", 0), bg_blur=t.get("bg_blur", False),
    )
    out = _out_png(user_id)
    img.save(out)
    return out, img.width, img.height


def render_subtitle_png(sub: dict, resolved_style: dict, canvas_w: int, canvas_h: int, user_id: int) -> tuple[Path, int, int]:
    box_w = max(1, round(canvas_w * sub.get("width", 80) / 100))
    img = render_styled_text_box(
        text=str(sub["text"]), box_w=box_w, font_size=resolved_style.get("font_size", 36),
        color=resolved_style.get("color", "#FFFFFF"), align=resolved_style.get("align", "center"), bold=False,
        bg_color=resolved_style.get("bg_color"), bg_opacity=resolved_style.get("bg_opacity", 0.6), bg_padding=6,
        stroke_color=resolved_style.get("outline_color"), stroke_width=resolved_style.get("outline_width", 0),
        shadow_color=resolved_style.get("shadow_color"), shadow_blur=resolved_style.get("shadow_blur", 0),
    )
    out = _out_png(user_id)
    img.save(out)
    return out, img.width, img.height


def render_lower_third_png(lt: dict, canvas_w: int, canvas_h: int, user_id: int) -> tuple[Path, int, int]:
    """Accent bar + Name (bold) + Title, on a translucent dark chip — the same visual treatment
    as CreateEditTab.tsx's own .canvas-lowerthird-item/.lowerthird-bar/.lowerthird-text CSS
    (Phase 2), reproduced here as real pixels rather than approximated through drawtext."""
    box_w = max(1, round(canvas_w * lt.get("width", 55) / 100))
    box_h = max(1, round(canvas_h * lt.get("height", 14) / 100))
    img = Image.new("RGBA", (box_w, box_h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.rectangle((0, 0, box_w - 1, box_h - 1), fill=(10, 14, 12, 158))
    bar_w = max(2, round(box_w * 0.012))
    draw.rectangle((0, 0, bar_w, box_h - 1), fill=(31, 143, 143, 255))  # var(--v-teal)

    name_font = _load_font(round(box_h * 0.32), bold=True)
    title_font = _load_font(round(box_h * 0.22), bold=False)
    pad_x = round(box_w * 0.03)
    name = str(lt.get("name") or "")
    title = str(lt.get("title") or "")
    if title:
        total_h = name_font.size + title_font.size + round(box_h * 0.06)
        name_y = max(2, (box_h - total_h) // 2)
        title_y = name_y + name_font.size + round(box_h * 0.04)
    else:
        name_y = max(2, (box_h - name_font.size) // 2)
        title_y = None
    draw.text((pad_x + bar_w + pad_x, name_y), name, font=name_font, fill=(255, 255, 255, 255))
    if title and title_y is not None:
        draw.text((pad_x + bar_w + pad_x, title_y), title, font=title_font, fill=(255, 255, 255, 191))

    out = _out_png(user_id)
    img.save(out)
    return out, box_w, box_h


def render_shape_png(sh: dict, canvas_w: int, canvas_h: int, user_id: int) -> tuple[Path, int, int]:
    """Real geometry, not an approximation, for every kind INCLUDING 'circle' (drawn as a real
    filled ellipse — the honest gap this phase originally expected to have with ffmpeg's own
    drawbox, which has no circle primitive at all, is closed entirely by rendering as an image
    instead) and rounded rectangles (real rounded_rectangle, not a plain box)."""
    box_w = max(1, round(canvas_w * sh.get("width", 20) / 100))
    box_h = max(1, round(canvas_h * sh.get("height", 20) / 100))
    img = Image.new("RGBA", (box_w, box_h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    fill = _rgba(sh["fill_color"], sh.get("opacity", 1.0))
    outline = _rgba(sh["border_color"], 1.0) if sh.get("border_color") and sh.get("border_width", 0) > 0 else None
    width = max(1, round(sh.get("border_width", 0))) if outline else 0
    rect = (0, 0, box_w - 1, box_h - 1)
    kind = sh.get("kind", "rectangle")
    if kind == "circle":
        draw.ellipse(rect, fill=fill, outline=outline, width=width)
    else:
        radius = 0 if kind in ("line", "banner") else max(0, min(round(sh.get("border_radius", 0)), box_w // 2, box_h // 2))
        draw.rounded_rectangle(rect, radius=radius, fill=fill, outline=outline, width=width)

    out = _out_png(user_id)
    img.save(out)
    return out, box_w, box_h


def resolve_subtitle_style(global_style: dict, style_override: dict | None) -> dict:
    """Server-side mirror of CreateEditTab.tsx's own resolveSubtitleStyle — same merge, same
    "any field absent from the override falls back to the project's global style" semantics, so
    export and the live preview resolve a segment's real style identically. Pure and
    independently testable."""
    return {**global_style, **(style_override or {})}
