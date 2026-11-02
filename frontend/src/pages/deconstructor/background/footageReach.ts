// M2.3 -- does the user's own footage reach the bar a plate would fill? Plates are shapes drawn ABOVE the footage, so a plate over footage hides it. This works out, from each assigned clip's real
// size and its Fit/Fill mode, the box the footage occupies on the canvas, and how much of a plate that box would be under. Pure. Nothing here is guessed: an unknown size is reported as unknown.
import type { Rect, Side } from './contract'
import { round3 } from './contract'

/** One clip assigned to a scene, as far as it matters here. Sizes are the source video's own pixels (undefined = could not be read). */
export interface SceneFootageUse { width?: number; height?: number; fit?: 'fit' | 'fill' }
export type SceneFootage = Readonly<Record<number, readonly SceneFootageUse[]>>

/** From the assembly's assignments and the footage library: what each scene's clips are. A clip whose footage entry is unknown is simply left out. */
export function sceneFootageOf(
  assignments: readonly { sceneNumber: number; clips: readonly { footageKey: string; fit?: 'fit' | 'fill' }[] }[],
  footage: readonly { key: string; width?: number; height?: number }[],
): SceneFootage {
  const byKey = new Map(footage.map(f => [f.key, f] as const))
  const out: Record<number, SceneFootageUse[]> = {}
  for (const a of assignments) {
    const uses = a.clips.flatMap(c => { const f = byKey.get(c.footageKey); return f ? [{ ...(f.width && f.height ? { width: f.width, height: f.height } : {}), ...(c.fit ? { fit: c.fit } : {}) }] : [] })
    if (uses.length) out[a.sceneNumber] = uses
  }
  return out
}

/** The box a clip occupies on the canvas, as fractions of the canvas. "fit" (the editor's default) shows the whole frame, centred; "fill" covers the canvas. Null when the size is unknown. */
export function footageBox(use: SceneFootageUse, canvas: { width: number; height: number }): Rect | null {
  if (use.fit === 'fill') return { x: 0, y: 0, w: 1, h: 1 }
  if (!use.width || !use.height || use.width <= 0 || use.height <= 0) return null
  const scale = Math.min(canvas.width / use.width, canvas.height / use.height)
  const w = (use.width * scale) / canvas.width, h = (use.height * scale) / canvas.height
  return { x: round3((1 - w) / 2), y: round3((1 - h) / 2), w: round3(w), h: round3(h) }
}

/** The rectangle a plate fills, as fractions of the canvas (size = share of the height for top/bottom, of the width for left/right). */
export function plateRect(side: Side, size: number): Rect {
  switch (side) {
    case 'top': return { x: 0, y: 0, w: 1, h: size }
    case 'bottom': return { x: 0, y: 1 - size, w: 1, h: size }
    case 'left': return { x: 0, y: 0, w: size, h: 1 }
    case 'right': return { x: 1 - size, y: 0, w: size, h: 1 }
  }
}

const overlapArea = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))

export type Reach =
  | { kind: 'no_footage' }                                         // nothing assigned to the scene yet
  | { kind: 'unknown' }                                            // footage is assigned but its size could not be read
  | { kind: 'known'; share: number }                               // the largest share of the plate any clip of the scene would cover, 0..1

export function plateReach(side: Side, size: number, uses: readonly SceneFootageUse[] | undefined, canvas: { width: number; height: number }): Reach {
  if (!uses || uses.length === 0) return { kind: 'no_footage' }
  const plate = plateRect(side, size)
  const plateArea = plate.w * plate.h
  let known = false, worst = 0
  for (const u of uses) {
    const box = footageBox(u, canvas)
    if (!box) continue
    known = true
    worst = Math.max(worst, overlapArea(plate, box) / plateArea)
  }
  return known ? { kind: 'known', share: round3(worst) } : { kind: 'unknown' }
}

/** More than this share of a plate under footage counts as "the footage reaches the bar". */
export const REACH_THRESHOLD = 0.02
