// Option C ("mask overlay") -- where the V1 picture is on the canvas, so a shape marked "behind footage" can be shown only outside it. This is a port of the exporter's own rules (backend
// `behind_footage.py`: `footage_rect`, `run_events`, `occupancy`), kept honest by a shared fixture (`__fixtures__/footageGeometry.cases.json`, generated from the Python and compared by
// backend/tests/test_footage_geometry_fixture.py), the same way dissolveWindow.ts follows timeline_plan.py. Pure and dependency free (apart from the blend windows it is handed).
//
// What counts as "footage on screen" (identical to the MP4):
//   * a clip's picture occupies its rectangle for the clip's whole main span (a fade to black is still footage-coloured pixels, not canvas);
//   * a blend window [J - pre, J + post) shows BOTH clips' pictures: the union of their rectangles;
//   * 'fill' clips cover the whole canvas, so a behind shape is not visible under them;
//   * where no clip is on screen (a timeline gap) the shape is complete.
// A clip whose size is not known yet counts as covering the canvas (nothing is drawn over a picture that may be there).
import type { BlendWindow } from './dissolveWindow'
import { EDITOR_FPS as FPS } from './transitionFade'

/** x, y, w, h in canvas pixels */
export type Rect = readonly [number, number, number, number]

/** av_rescale: round-to-nearest (half away from zero) of a * b / c, for positive integers. */
const rescale = (a: number, b: number, c: number) => Math.floor((a * b * 2 + c) / (2 * c))

/** Python's round(): halves go to the even neighbour (the exporter's `to_frames`). */
const pyRound = (x: number) => {
  const f = Math.floor(x), d = x - f
  if (d < 0.5) return f
  if (d > 0.5) return f + 1
  return f % 2 === 0 ? f : f + 1
}
const toFrames = (s: number) => pyRound(s * FPS)

/** The rectangle a clip's picture occupies: 'fill' (or an unknown source size) covers the canvas; 'fit' is the exporter's scale-to-fit + centred pad (even-sized, even-aligned). */
export function footageRect(cw: number, ch: number, sw: number, sh: number, fit: 'fit' | 'fill' = 'fit'): Rect {
  if (fit === 'fill' || sw <= 0 || sh <= 0) return [0, 0, cw, ch]
  const tmpW = rescale(ch, sw, sh)
  let w: number, h: number
  if (tmpW > cw) { w = cw; h = rescale(cw, sh, sw) } else { w = tmpW; h = ch }
  w = Math.max(2, Math.min(w, cw)); h = Math.max(2, Math.min(h, ch))
  const x = Math.floor((cw - w) / 2) & ~1, y = Math.floor((ch - h) / 2) & ~1
  return [x, y, w & ~1, h & ~1]
}

/** A shape's "behind the footage" switch. Kept as an optional property read through this one function so no shared type has to change. */
export const isBehindFootage = (shape: unknown): boolean => !!shape && (shape as { behindFootage?: unknown }).behindFootage === true

export interface GeoClip { id: string; startTime: number; endTime: number; fitMode?: 'fit' | 'fill'; /** the key of the clip's source size, e.g. its url */ sizeKey: string }
export type SizeMap = ReadonlyMap<string, readonly [number, number]>

interface Span { id: string; f0: number; f1: number }

/** Each clip's main span in whole timeline frames: the cumulative rounding the exporter plans with (timeline_plan.plan_timeline), per contiguous run. */
export function clipSpans(clips: readonly GeoClip[]): Span[] {
  const ordered = [...clips].sort((a, b) => a.startTime - b.startTime)
  const runs: GeoClip[][] = []
  for (const c of ordered) {
    const last = runs[runs.length - 1]
    if (last && toFrames(c.startTime) - toFrames(last[last.length - 1].endTime) < 1) last.push(c)
    else runs.push([c])
  }
  const out: Span[] = []
  for (const run of runs) {
    const bnd = [toFrames(run[0].startTime)]
    let cum = run[0].startTime
    for (const c of run) { cum += c.endTime - c.startTime; bnd.push(Math.max(bnd[bnd.length - 1] + 1, toFrames(cum))) }
    run.forEach((c, i) => out.push({ id: c.id, f0: bnd[i], f1: bnd[i + 1] }))
  }
  return out
}

/** The rectangles of the footage on screen at timeline frame `frame` (de-duplicated; empty = no footage). `windows` are the blend windows of ALL blending transitions (dissolveWindow.planBlendWindows). */
export function rectsAtFrame(clips: readonly GeoClip[], sizes: SizeMap, windows: readonly BlendWindow[], cw: number, ch: number, frame: number): Rect[] {
  const rectOf = new Map<string, Rect>()
  for (const c of clips) {
    const s = sizes.get(c.sizeKey)
    rectOf.set(c.id, footageRect(cw, ch, s ? s[0] : 0, s ? s[1] : 0, c.fitMode ?? 'fit'))
  }
  const found = new Map<string, Rect>()
  const add = (id: string) => { const r = rectOf.get(id); if (r) found.set(r.join(','), r) }
  for (const sp of clipSpans(clips)) if (frame >= sp.f0 && frame < sp.f1) add(sp.id)
  for (const w of windows) {
    if (frame >= w.joinFrame - w.pre && frame < w.joinFrame + w.post) add(frame < w.joinFrame ? w.inId : w.outId)
  }
  return [...found.values()]
}

/** The timeline frame the preview is showing at time `t` (seconds). */
export const frameAt = (t: number) => Math.floor(t * FPS + 1e-9)

/** CSS clip-path that keeps everything OUTSIDE one rectangle (percent of the canvas): an even-odd polygon with the rectangle as a hole. */
export function outsideRectClipPath(r: Rect, cw: number, ch: number): string {
  const p = (x: number, y: number) => `${((x / cw) * 100).toFixed(4)}% ${((y / ch) * 100).toFixed(4)}%`
  const [x, y, w, h] = r
  return `polygon(evenodd, 0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%, ${p(x, y)}, ${p(x + w, y)}, ${p(x + w, y + h)}, ${p(x, y + h)}, ${p(x, y)})`
}
