// M2.1b -- the ONE place a Video Studio V2 TextOverlay becomes an export request item. Pure: no React, no network.
//
// Until now the export button sent seven text fields (text, timing, x, y, size, colour, order), so everything a person set in the editor beyond those --
// width and wrapping, alignment, bold, underline, spacing, opacity, stroke, shadow, gradient, background chip -- was dropped on the way to the MP4 even though
// the backend renderer (canvas_render_svc, Pillow) already supported all of it. This mapper carries each supported property across, translating the few places
// where the editor's CSS and the Pillow renderer mean slightly different things (see the parity matrix in docs/RECONSTRUCTOR_M2_1B_EXPORT_FIDELITY.md):
//
//   * stroke   CSS -webkit-text-stroke W is centred on the glyph edge and painted over the fill. The renderer's editor-box mode (bg_padding_x given) draws exactly that, so the CSS
//              width is sent unchanged (minimum 1 px).
//   * shadow   CSS blur "radius" B is a gaussian of sigma B/2; Pillow's GaussianBlur(radius) takes sigma directly -> send B/2.
//   * chip     bgColor 'transparent' (or no opacity, or gradient fill active) means NO chip in the editor -> send no bg_color (a hex-parse fallback would draw black).
//   * box      the editor pads p vertically and p+4 horizontally (default p = 2) inside a border-box, with the border inside the padding; the exporter used to pad 8 on every side.
//              Sending bg_padding = p and bg_padding_x = p+4 switches the renderer to the editor's box model (text wraps and sits where it does in the editor).
//   * border   a border with no fill still draws in the editor -> sent as a fully transparent chip so the renderer draws the border.
//
// SIZE SCALE. Every pixel quantity (font size, letter spacing, stroke, shadow, padding, radius, border) passes through `pxScale`. It is 1 today: the export draws them as
// pixels on the real canvas, exactly as before. Whether it should be canvasWidth/1080 depends on how the preview scales text, which lives in a protected editor file --
// see the proposal in the docs. Nothing else here needs to change when that is decided.
import type { TextOverlay } from '../../../types'

export interface ExportTextItem {
  text: string
  start_time: number
  end_time: number
  x: number
  y: number
  font_size: number
  color: string
  order: number
  align: 'left' | 'center' | 'right'
  bold: boolean
  underline: boolean
  letter_spacing: number
  line_spacing: number
  width_pct?: number
  opacity: number
  stroke_color?: string
  stroke_width?: number
  shadow_color?: string
  shadow_blur?: number
  shadow_offset_x?: number
  shadow_offset_y?: number
  use_gradient: boolean
  gradient_from?: string
  gradient_to?: string
  bg_color?: string
  bg_opacity?: number
  bg_padding: number
  bg_padding_x: number
  bg_border_radius: number
  bg_border_color?: string
  bg_border_width: number
  bg_blur: boolean
  bg_full_width: boolean
}

export interface TextExportOptions {
  /** Multiplies every pixel quantity. 1 = canvas pixels (today's behaviour). */
  pxScale?: number
}

/** The editor's own default text padding (CreateEditTab.getTextRenderStyle). */
export const EDITOR_DEFAULT_PADDING = 2
export const EDITOR_DEFAULT_LINE_SPACING = 1.15
export const EDITOR_DEFAULT_BORDER_RADIUS = 3

const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v : undefined)
const ALIGNS = ['left', 'center', 'right'] as const

export function buildExportTextOverlay(t: TextOverlay, opts: TextExportOptions = {}): ExportTextItem {
  const k = num(opts.pxScale, 1) > 0 ? num(opts.pxScale, 1) : 1
  const px = (v: unknown, fallback = 0) => num(v, fallback) * k
  const gradient = !!(t.useGradient && str(t.gradientFrom) && str(t.gradientTo))
  const bgOpacity = clamp01(num(t.bgOpacity, 1))
  const bg = str(t.bgColor)
  const chip = !gradient && !!bg && bg !== 'transparent' && bgOpacity > 0                 // the editor draws no chip behind gradient text (see getTextRenderStyle)
  const strokeW = px(t.strokeWidth)
  const padding = px(t.bgPadding, EDITOR_DEFAULT_PADDING)
  const blur = Math.max(0, px(t.shadowBlur)), offX = px(t.shadowOffsetX), offY = px(t.shadowOffsetY)
  const shadow = blur > 0 || offX !== 0 || offY !== 0
  const borderW = px(t.bgBorderWidth)
  const align = ALIGNS.includes(t.align as (typeof ALIGNS)[number]) ? (t.align as ExportTextItem['align']) : t.bgFullWidth ? 'center' : 'left'
  const width = num(t.width, 0)

  return {
    text: t.text, start_time: t.startTime, end_time: t.endTime, x: t.x, y: t.y,
    font_size: Math.max(1, Math.round(px(t.fontSize, 42))), color: t.color, order: num(t.order, 0),
    align, bold: !!t.bold, underline: !!t.underline,
    letter_spacing: px(t.letterSpacing), line_spacing: num(t.lineSpacing, EDITOR_DEFAULT_LINE_SPACING),
    ...(width > 0 ? { width_pct: Math.min(100, width) } : {}),
    opacity: clamp01(num(t.opacity, 1)),
    ...(strokeW > 0 ? { stroke_color: str(t.strokeColor) ?? '#000000', stroke_width: Math.max(1, Math.round(strokeW)) } : {}),
    ...(shadow ? { shadow_color: str(t.shadowColor) ?? '#000000', shadow_blur: blur / 2, shadow_offset_x: offX, shadow_offset_y: offY } : {}),
    use_gradient: gradient,
    ...(gradient ? { gradient_from: str(t.gradientFrom), gradient_to: str(t.gradientTo) } : {}),
    ...(chip ? { bg_color: bg, bg_opacity: bgOpacity } : borderW > 0 ? { bg_color: '#000000', bg_opacity: 0 } : {}),
    bg_padding: padding, bg_padding_x: padding + 4 * k,
    bg_border_radius: px(t.bgBorderRadius, EDITOR_DEFAULT_BORDER_RADIUS),
    ...(borderW > 0 ? { bg_border_color: str(t.bgBorderColor) ?? '#000000' } : {}),
    bg_border_width: borderW, bg_blur: !!t.bgBlur, bg_full_width: !!t.bgFullWidth,
  }
}

export function buildExportTextOverlays(overlays: readonly TextOverlay[] | null | undefined, opts: TextExportOptions = {}): ExportTextItem[] {
  return (overlays ?? []).map(t => buildExportTextOverlay(t, opts))
}
