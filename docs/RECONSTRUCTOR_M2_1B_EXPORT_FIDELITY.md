# Reconstructor M2.1b — text export fidelity

Status: implemented and verified locally on `feature/m2-1b-export-fidelity` (base `0851e38`, the deployed M2.1a). Not pushed, not deployed.

Goal: an editable text overlay (including M2.1a reconstructed layers) exports to MP4 looking like it does in the Video Studio V2 editor.

## What was wrong

The export button (`ReviewTab`) sent **seven** text fields: text, timing, x, y, font size, colour, order. The backend renderer (Pillow, Phase 7) already supported width, alignment, bold, underline, spacing, opacity, stroke, shadow, gradient and background chips, but none of it was ever sent, so it was dropped on the way to the MP4. Measuring the real editor against a real export then showed four further, systematic differences in how the renderer lays a box out compared with the browser (below).

## Field-by-field parity matrix

Units: `x`, `y`, `width` are percent of the canvas (identical in editor and export). Every other number is in pixels (see "Size scale").

| Property | Editor (preview, CSS) | Sent before | Sent now | Export renderer | Result |
|---|---|---|---|---|---|
| text, start/end | `innerText`, pre-wrap | yes | yes | greedy word wrap | same |
| x, y | `left/top: %` of the canvas | yes | yes | top-left of the box | same |
| width | `width: %` (border-box) | no (default 90 %) | `width_pct` | box width = % of canvas | **new**, wraps where the editor does |
| font size | raw CSS px | yes | yes | px on the real canvas | scale policy pending (below) |
| bold | weight 700 | no | `bold` | DejaVu Sans Bold | **new** |
| italic | italic | no | not sent | no italic font bundled, upright | unsupported (documented) |
| font family | web font | no | not sent | always DejaVu Sans | unsupported (documented) |
| underline | underline | no | `underline` | drawn line | **new** |
| align | `text-align` (banner defaults to centre) | no | `align` | per line | **new** |
| letter spacing | px | no | `letter_spacing` | per character | **new** |
| line spacing | `line-height` × font size, default 1.15 | no | `line_spacing` | now × font size with half-leading (was × 1.16 em) | **fixed** |
| opacity | whole element | no | `opacity` | whole element (chip, border, stroke, shadow, glyphs) | **new / fixed** |
| stroke | `-webkit-text-stroke`: centred, painted over the fill | no | `stroke_*` (CSS width) | editor-box mode draws a centred ring over the fill | **new**, looks the same |
| shadow | `text-shadow`, blur radius B (sigma B/2), follows the stroked shape | no | `shadow_*` (blur sent as B/2) | blurred layer under the text, grown by the stroke | **new** |
| gradient fill | `background-clip: text`, no chip behind it | no | `use_gradient`, `gradient_*` | gradient through a glyph mask | **new** |
| background chip | colour + alpha; `transparent` means none | no | `bg_color` only when the editor draws one | rounded rectangle | **new** |
| padding | `p` vertical, `p+4` horizontal, default 2 | no (export used 8 square) | `bg_padding` = p, `bg_padding_x` = p+4 | editor box model | **fixed** |
| border | inside the box, pushes the content in; draws with no fill | no | `bg_border_*` (border-only sent as a transparent chip) | inside the box | **new / fixed** |
| radius | default 3 | no | `bg_border_radius` | rounded rectangle | **new** |
| full-width banner | `left:0; width:100%` | no | `bg_full_width` | x = 0, width 100 % | **new** |
| backdrop blur (`bgBlur`) | blurs the video behind the chip | no | `bg_blur` | blurs the chip itself | different meaning (documented) |
| animation | CSS | no | not sent | none | unsupported (documented) |
| layer order | `order`, then list order | yes | yes | sorted by `order` (stable) | same (text vs text) |
| z-order against images/shapes | shared `order` space | n/a | n/a | passes: inserts, media, shapes, lower thirds, **text**, subtitles | text is always on top of non-text layers (known limit) |

## The four layout differences found by measurement, and the fixes

Measured with the real editor forced to 100% and a real MP4 of the same project (same font file for both, so only layout differs):

1. Every text block sat **6–7 px lower** in the export: the exporter padded 8 px on every side, the editor pads 2 px top / 6 px left.
2. Lines wrapped differently: the export's wrap width was narrower (wrong horizontal padding, and it also subtracted the stroke width, which CSS does not).
3. Shadowed text sat **12 px lower** in the export (the renderer pushed the text down by half the shadow size).
4. A bordered chip was **6 px short** (CSS borders sit inside the box and push the content in).

Fix: an **opt-in "editor box" layout** in the existing renderer, switched on only when the request carries `bg_padding_x` (new, optional). Subtitles and lower thirds never send it and are untouched. Also: CSS line pitch for wrapped lines (explicit `line_spacing` only), and group opacity.

## Preview versus export (real browser, real MP4s)

At 100% zoom (the real editor with only its preview box forced to the canvas's pixel size, same DejaVu font file in both), 8 styled overlays on each canvas (wrapped centred text, bold underlined stroked shadowed right-aligned headline, bordered chip, full-width banner, gradient fill). Edge differences, export minus preview, in px:

| Canvas | Text blocks (preview / export) | Largest edge difference |
|---|---|---|
| 1080×1920 | 8 / 8 | 3 |
| 1080×1080 | 8 / 8 | 2 |
| 1920×1080 | 6 / 6 | 3 |
| 1080×566 | 4 / 4 | 10 (width of 22 px wrapped lines; font engines position small glyphs about 2 % differently) |

Layer order (higher `order` painted on top even when listed first): correct in preview and export. A styled draft saved through the drafts API reopens unchanged and exports the same way.

## Size scale: not changed (needs a decision)

The editor draws text at **raw CSS pixels inside a fitted preview box**; the exporter draws **pixels on the real canvas**. So the preview's text is larger, relative to the canvas, than the export's by `1 / displayed scale`, on **every** canvas, not only non-1080-wide ones. Measured at a 1440×1000 window:

| Canvas | Preview shown at | Preview text is larger than the export by |
|---|---|---|
| 1080×1920 | 31 % | 3.3× (a 60 px overlay: 18.2 % of the canvas width in the preview, 5.6 % in the export) |
| 1080×1080 | 54 % | 1.9× |
| 1920×1080 | 37 % | 2.7× |
| 1080×566 | 66 % | 1.5× |

The ratio also changes when the window is resized. No export-side change can fix this, because the export cannot know the preview's on-screen size. It must be fixed in the preview, which is protected (`CreateEditTab.tsx`). All pixel quantities already pass through **one** parameter in the export mapper (`pxScale`, currently 1), so no further export change is needed.

### Proposed change (NOT applied): `CreateEditTab.getTextRenderStyle`

Recommended (preview-only; export unchanged; px values then mean canvas pixels exactly as the exporter already treats them):

```diff
   const getTextRenderStyle = (t: TextOverlay): React.CSSProperties => {
+    const k = canvasBox.w / rawW;   // displayed scale of the canvas (the toolbar's zoom readout)
     const gradientActive = !!(t.useGradient && t.gradientFrom && t.gradientTo);
     const base: React.CSSProperties = {
       left: `${t.x}%`, top: `${t.y}%`, width: `${t.width}%`,
-      fontFamily: t.fontFamily, fontSize: t.fontSize,
+      fontFamily: t.fontFamily, fontSize: t.fontSize * k,
-      letterSpacing: t.letterSpacing ? `${t.letterSpacing}px` : undefined,
+      letterSpacing: t.letterSpacing ? `${t.letterSpacing * k}px` : undefined,
-      WebkitTextStroke: t.strokeWidth ? `${t.strokeWidth}px ${t.strokeColor ?? "#000000"}` : undefined,
+      WebkitTextStroke: t.strokeWidth ? `${t.strokeWidth * k}px ${t.strokeColor ?? "#000000"}` : undefined,
-      textShadow: ... `${t.shadowOffsetX ?? 0}px ${t.shadowOffsetY ?? 0}px ${Math.max(0, t.shadowBlur ?? 0)}px ${t.shadowColor ?? "#000000"}`
+      textShadow: ... `${(t.shadowOffsetX ?? 0) * k}px ${(t.shadowOffsetY ?? 0) * k}px ${Math.max(0, t.shadowBlur ?? 0) * k}px ${t.shadowColor ?? "#000000"}`
-      padding: `${t.bgPadding ?? 2}px ${(t.bgPadding ?? 2) + 4}px`,
-      borderRadius: t.bgBorderRadius ?? 3,
-      border: t.bgBorderWidth ? `${t.bgBorderWidth}px solid ${t.bgBorderColor ?? "#000000"}` : undefined,
+      padding: `${(t.bgPadding ?? 2) * k}px ${((t.bgPadding ?? 2) + 4) * k}px`,
+      borderRadius: (t.bgBorderRadius ?? 3) * k,
+      border: t.bgBorderWidth ? `${t.bgBorderWidth * k}px solid ${t.bgBorderColor ?? "#000000"}` : undefined,
```

Consequence: text in existing drafts is drawn smaller on screen by the displayed zoom, which is exactly its exported size (M2.1a layers, currently drawn about 3× too large in the editor, would look right). The default "Add text" (48 px) would look small at 31 % zoom until resized. Alternative if text size should be relative to a 1080-wide canvas on every canvas: use `k = canvasBox.w / 1080` in the preview **and** pass `{ pxScale: canvasFormat.width / 1080 }` in `ReviewTab`; that changes exports on the two 1920-wide presets (text 1.78× larger).

## Compatibility and regression risks

* Request: only `text_overlays` changed; the M1 guards still run first and are unchanged. One M1 wiring test assertion was updated to the new call; nothing else in M1.
* M1 / M2.1a exports shift slightly because they now follow the editor: text moves about 6 px up and 2 px left (the editor's padding). New M2.1a layers are placed with the new calibration (`geometry.ts`), so they still land on the detected box (verified: within 1.5 px in a real export). **Layers saved before this change export about 6 px higher / 2 px further left than the reference box they were aligned to.** Draft data is not touched.
* Overlays the editor shows with a background chip now export with it (before, chips were never exported).
* Wrapped text is spaced like the editor (about 14 % tighter than before) and wraps at the editor's width.
* Backend changes are confined to the text-overlay path: `canvas_render_svc.render_styled_text_box` (editor-box mode is opt-in; subtitles and lower thirds are tested to be unchanged), one optional schema field and one router key.

## Known limits

Italic, font family and animation are not exported; text is always above non-text layers; `bgBlur` blurs the chip, not the video behind it; small text wraps ±2 % differently between Chrome and Pillow; shadow regions beyond the top/left of the box are clipped.
