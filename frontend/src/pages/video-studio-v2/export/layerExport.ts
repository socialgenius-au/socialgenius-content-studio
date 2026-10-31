// M2.2b -- shapes and lower thirds were drawn by the editor and supported by the backend renderer, but the export button never sent them, so they were dropped
// from every MP4. These two pure mappers turn the editor's own state into the request fields the existing backend schema already accepts (ExportShape / ExportLowerThird).
// Percent values (x, y, width, height) are the same unit on both sides; nothing here rescales anything.
import type { LowerThird, Shape, SubtitleSegment, SubtitleStyle, VideoClip } from '../../../types'

/** The box a lower third gets when it has none of its own. The same numbers as CreateEditTab's DEFAULT_LOWER_THIRD_BOX (a wiring test pins them to its source). */
export const DEFAULT_LOWER_THIRD_BOX = { x: 5, y: 78, width: 55, height: 14 } as const

export interface ExportShapeItem {
  kind: Shape['kind']
  start_time: number
  end_time: number
  x: number
  y: number
  width: number
  height: number
  fill_color: string
  opacity: number
  border_color: string | null
  border_width: number
  border_radius: number
  full_width: boolean
  order: number
}

export interface ExportLowerThirdItem {
  name: string
  title: string
  start_time: number
  end_time: number
  x: number
  y: number
  width: number
  height: number
  show_logo: boolean
  order: number
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

export function buildExportShapes(shapes: readonly Shape[]): ExportShapeItem[] {
  return shapes
    .filter(s => finite(s.startTime) && finite(s.endTime) && s.endTime > s.startTime && finite(s.x) && finite(s.y) && finite(s.width) && finite(s.height) && s.width > 0 && s.height > 0)
    .map(s => {
      const border = finite(s.borderWidth) && s.borderWidth > 0 ? s.borderWidth : 0
      return {
        kind: s.kind, start_time: s.startTime, end_time: s.endTime, x: s.x, y: s.y, width: s.width, height: s.height,
        fill_color: s.fillColor, opacity: clamp01(finite(s.opacity) ? s.opacity : 1),
        border_color: border > 0 ? s.borderColor ?? '#000000' : null,            // the editor draws a border only when it has a width, in black unless told otherwise
        border_width: border, border_radius: finite(s.borderRadius) && s.borderRadius > 0 ? s.borderRadius : 0, full_width: s.fullWidth === true, order: s.order ?? 0,
      }
    })
}

export function buildExportLowerThirds(lowerThirds: readonly LowerThird[]): ExportLowerThirdItem[] {
  return lowerThirds
    .filter(l => finite(l.startTime) && finite(l.endTime) && l.endTime > l.startTime)         // the editor draws a lower third only once it has an end time
    .map(l => ({
      name: l.name || 'Name', title: l.title ?? '', start_time: l.startTime, end_time: l.endTime as number,
      x: l.x ?? DEFAULT_LOWER_THIRD_BOX.x, y: l.y ?? DEFAULT_LOWER_THIRD_BOX.y, width: l.width ?? DEFAULT_LOWER_THIRD_BOX.width, height: l.height ?? DEFAULT_LOWER_THIRD_BOX.height,
      show_logo: l.showLogo === true, order: l.order ?? 0,
    }))
}

// ── subtitles ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// The exporter merges a segment's `style_override` over the project's `subtitle_style` the same way the editor's resolveSubtitleStyle does, but in snake_case. The editor's
// font family cannot be sent: the exporter has one font (DejaVu Sans) and no family field. Shadow blur is a CSS blur radius in the editor; the exporter's Gaussian takes the
// standard deviation, which is half of it (the same conversion the text mapper makes).

export interface ExportSubtitleStyleItem {
  font_size: number
  color: string
  bg_color: string
  bg_opacity: number
  align: string
  outline_color: string | null
  outline_width: number
  shadow_color: string | null
  shadow_blur: number
}

export interface ExportSubtitleItem {
  text: string
  start_time: number
  end_time: number
  x: number
  y: number
  width: number
  style_override: Partial<ExportSubtitleStyleItem>
  order: number
}

const OVERRIDE_KEYS: Record<string, keyof ExportSubtitleStyleItem> = {
  fontSize: 'font_size', color: 'color', bgColor: 'bg_color', bgOpacity: 'bg_opacity', align: 'align',
  outlineColor: 'outline_color', outlineWidth: 'outline_width', shadowColor: 'shadow_color', shadowBlur: 'shadow_blur',
}

export function buildExportSubtitleStyle(style: SubtitleStyle): ExportSubtitleStyleItem {
  return {
    font_size: style.fontSize, color: style.color, bg_color: style.bgColor, bg_opacity: clamp01(finite(style.bgOpacity) ? style.bgOpacity : 0.6), align: style.align,
    outline_color: style.outlineColor ?? '#000000', outline_width: finite(style.outlineWidth) && style.outlineWidth > 0 ? style.outlineWidth : 0,       // no width = no outline, as in the editor
    shadow_color: style.shadowColor ?? '#000000', shadow_blur: finite(style.shadowBlur) && style.shadowBlur > 0 ? style.shadowBlur / 2 : 0,
  }
}

export function buildExportSubtitles(subtitles: readonly SubtitleSegment[]): ExportSubtitleItem[] {
  return subtitles
    .filter(s => typeof s.text === 'string' && s.text.trim() !== '' && finite(s.startTime) && finite(s.endTime) && s.endTime > s.startTime)
    .map(s => {
      const override: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(s.styleOverride ?? {})) {
        const to = OVERRIDE_KEYS[k]
        if (to === undefined || v === undefined) continue                                          // fontFamily and anything unknown: not exportable
        override[to] = to === 'shadow_blur' ? (finite(v) && v > 0 ? v / 2 : 0) : to === 'outline_width' ? (finite(v) && v > 0 ? v : 0) : to === 'bg_opacity' ? clamp01(v as number) : v
      }
      return { text: s.text, start_time: s.startTime, end_time: s.endTime, x: s.x, y: s.y, width: s.width, style_override: override as Partial<ExportSubtitleStyleItem>, order: s.order ?? 0 }
    })
}

// ── V2 inserts / B-roll ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The box a new insert gets. The same numbers as CreateEditTab's DEFAULT_INSERT_BOX (a wiring test pins them to its source). */
export const DEFAULT_INSERT_BOX = { insertX: 56, insertY: 56, insertWidth: 38, insertHeight: 38 } as const

export interface ExportInsertItem {
  asset_id: number
  start_time: number
  end_time: number
  trim_in: number
  color_grade: string
  brightness: number
  contrast: number
  saturation: number
  fit_mode: string
  crop_x: number
  crop_y: number
  insert_x: number
  insert_y: number
  insert_width: number
  insert_height: number
  opacity: number
  order: number
}

/** Inserts that have an uploaded source. An insert without one cannot be rendered; the export button refuses to start while any exists (see missingInsertSources). */
export function buildExportInserts(inserts: readonly VideoClip[]): ExportInsertItem[] {
  return inserts
    .filter(c => c.assetId != null && finite(c.startTime) && finite(c.endTime) && c.endTime > c.startTime)
    .map(c => ({
      asset_id: c.assetId as number, start_time: c.startTime, end_time: c.endTime, trim_in: c.trimIn ?? 0,
      color_grade: c.colorGrade ?? 'none', brightness: c.brightness ?? 0, contrast: c.contrast ?? 0, saturation: c.saturation ?? 0,
      fit_mode: c.fitMode ?? 'fit', crop_x: c.cropOffsetX ?? 50, crop_y: c.cropOffsetY ?? 50,
      insert_x: c.insertX ?? DEFAULT_INSERT_BOX.insertX, insert_y: c.insertY ?? DEFAULT_INSERT_BOX.insertY,
      insert_width: c.insertWidth ?? DEFAULT_INSERT_BOX.insertWidth, insert_height: c.insertHeight ?? DEFAULT_INSERT_BOX.insertHeight,
      opacity: clamp01((finite(c.opacity) ? c.opacity : 100) / 100),                                // the editor stores 0-100, the exporter takes 0-1
      order: 0,                                                                                    // inserts are the layer under every overlay in the editor too
    }))
}

export const missingInsertSources = (inserts: readonly VideoClip[]) => inserts.filter(c => c.assetId == null).length

/** What the editor shows that the exporter cannot do, said plainly (never silently dropped). */
export function exportNotices(state: { inserts: readonly VideoClip[] }): string[] {
  const notices: string[] = []
  if (state.inserts.some(c => finite(c.speed) && c.speed !== 1)) notices.push('B-roll speed is not applied in the export: the exporter has no speed setting for B-roll clips, so they play at normal speed.')
  return notices
}
