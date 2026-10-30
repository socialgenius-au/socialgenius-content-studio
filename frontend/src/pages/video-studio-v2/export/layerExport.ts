// M2.2b -- shapes and lower thirds were drawn by the editor and supported by the backend renderer, but the export button never sent them, so they were dropped
// from every MP4. These two pure mappers turn the editor's own state into the request fields the existing backend schema already accepts (ExportShape / ExportLowerThird).
// Percent values (x, y, width, height) are the same unit on both sides; nothing here rescales anything.
import type { LowerThird, Shape } from '../../../types'

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
