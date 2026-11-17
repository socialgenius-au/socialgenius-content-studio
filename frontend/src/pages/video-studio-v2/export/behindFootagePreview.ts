// Option C: what the editor's preview needs to clip a "behind footage" shape -- the rectangles the footage occupies at the current time -- computed with the same rules as the exporter (footageGeometry.ts).
// Kept out of CreateEditTab.tsx so the protected file only wires it in.
import type { VideoClip } from '../../../types'
import type { BlendWindow } from './dissolveWindow'
import { frameAt, rectsAtFrame, type Rect, type SizeMap } from './footageGeometry'

export function behindFootageRects(clips: readonly VideoClip[], sizes: SizeMap, windows: readonly BlendWindow[], canvasW: number, canvasH: number, t: number): Rect[] {
  const geo = clips.map(c => ({ id: c.id, startTime: c.startTime, endTime: c.endTime, fitMode: c.fitMode, sizeKey: c.url }))
  return rectsAtFrame(geo, sizes, windows, canvasW, canvasH, frameAt(t))
}
