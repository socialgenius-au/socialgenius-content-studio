// M2.1a -- WHERE the text sat and how big it was, converted to a Video Studio V2 text layer's own units. Pure.
//
// What is measured: the detected box (normalised 0..1 of the frame). What is inferred: the font size (OCR does not report one) and the layer's own
// top-left position (the editor/exporter position the layer's text BOX, not its ink). Both conversions use constants MEASURED from the real export
// renderer (backend canvas_render_svc.render_styled_text_box, DejaVu Sans, upright, as the export button calls it today: no background, 8 px box
// padding). They are exact only for that renderer and that padding; the preview uses a different font and padding, so a few pixels of difference
// between the editor and the exported MP4 remain until export and preview are brought into line (M2.1b).
import { clamp, round3 } from './contract'
import type { TextEvidenceGroup } from './evidence'

export const RENDER_CALIBRATION = {
  exportPadPx: 8,         // the box padding the backend applies when the export request carries none (bg_padding default)
  inkTopEm: 0.17,         // distance from the box top to the top of the ink, in em, for the first line (measured: 0.167-0.178 at 60-90 px)
  inkLeftEm: 0.05,        // left side bearing, in em (measured: 0-8 px extra at 30-90 px; 0.05 is the middle)
  inkHeightEm: 0.95,      // ink height of a mixed-case line with ascenders and descenders / font size (measured 0.967; capitals-only lines measure 0.73-0.77)
  advanceEm: 0.5,         // average advance per character of mixed-case text / font size (measured 0.50-0.55)
  editorReferenceWidth: 1080,   // the editor scales font size by canvas width / 1080
} as const

export const DEFAULT_CANVAS = { width: 1080, height: 1920 } as const          // the editor's 9:16 Reel / Story preset
export const MIN_FONT = 12
export const MAX_FONT = 200

export interface GeometryEstimate {
  x: number; y: number; width: number            // layer box, percent of the canvas
  fontSize: number                               // editor units (px on a 1080-wide canvas)
  fontSizeFromHeight: number
  fontSizeFromWidth: number | null
  frameAssumed: boolean                          // the source frame's size was unknown; 9:16 was assumed
}

export function estimateGeometry(g: Pick<TextEvidenceGroup, 'box' | 'frame'>, text: string, canvas: { width: number; height: number } = DEFAULT_CANVAS): GeometryEstimate {
  const C = RENDER_CALIBRATION
  const frameAssumed = !(g.frame.width && g.frame.height)
  const fw = g.frame.width ?? 1080, fh = g.frame.height ?? 1920
  const toRef = C.editorReferenceWidth / fw                                       // reference-frame pixel -> editor pixel (font size scales with width)
  const heightPx = g.box.h * fh * toRef
  const widthPx = g.box.w * fw * toRef
  const fsH = heightPx / C.inkHeightEm
  const chars = Array.from(text).length
  const fsW = chars >= 3 ? widthPx / (chars * C.advanceEm) : null                  // too few characters to size by width
  // The smaller of the two keeps the line inside the space the original used (the stand-in font is wider than many caption fonts)
  const fontSize = Math.round(clamp(fsW === null ? fsH : Math.min(fsH, fsW), MIN_FONT, MAX_FONT))

  const scale = canvas.width / C.editorReferenceWidth
  const pad = C.exportPadPx * scale, fsPx = fontSize * scale
  const left = g.box.x * canvas.width - pad - C.inkLeftEm * fsPx
  const top = g.box.y * canvas.height - pad - C.inkTopEm * fsPx
  const x = clamp((left / canvas.width) * 100, 0, 100)
  const y = clamp((top / canvas.height) * 100, 0, 100)
  const widthPct = clamp(g.box.w * 100 * 1.2 + ((2 * pad) / canvas.width) * 100 + 2, 5, Math.max(5, 100 - x))   // room to hold the text on one line
  return {
    x: round3(x), y: round3(y), width: round3(widthPct), fontSize,
    fontSizeFromHeight: Math.round(fsH), fontSizeFromWidth: fsW === null ? null : Math.round(fsW), frameAssumed,
  }
}
