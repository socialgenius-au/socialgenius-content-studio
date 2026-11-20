// Carousel Creator - layout geometry for the editor: element boxes, snapping guides, alignment and distribution. Pure functions on canvas-relative numbers (0..1 of the canvas
// width / height), so they are tested without a browser. Nothing here changes a document; ops.ts applies the results.
import type { DocumentFormat, PostElement } from '../postDocument'

export interface Box { x: number; y: number; w: number; h: number }

/**
 * The box an element occupies, canvas-relative. Text with an automatic height has no stored height, so it is estimated from its font size, line height and how many lines the
 * text needs at that width (a character is taken as ~0.52 em wide). The estimate is only used for snapping, aligning and grouping; the real painted box is always what you see.
 */
export function elementBox(el: PostElement, format: DocumentFormat): Box {
  if (el.height !== 'auto') return { x: el.x, y: el.y, w: el.width, h: el.height }
  if (el.type !== 'text') return { x: el.x, y: el.y, w: el.width, h: 0.05 }
  const S = Math.min(format.width, format.height)
  const px = el.style.fontSize * S
  const padX = (el.box?.paddingX ?? 0) * S
  const padY = (el.box?.paddingY ?? 0) * S
  const perLine = Math.max(1, Math.floor((el.width * format.width - 2 * padX) / (px * 0.52)))
  const lines = Math.max(1, el.content.split('\n').reduce((n, para) => n + Math.max(1, Math.ceil(para.length / perLine)), 0))
  const hPx = lines * px * el.style.lineHeight + 2 * padY
  return { x: el.x, y: el.y, w: el.width, h: Math.min(1, hPx / format.height) }
}

export function unionBox(boxes: Box[]): Box {
  if (boxes.length === 0) return { x: 0, y: 0, w: 0, h: 0 }
  const x0 = Math.min(...boxes.map(b => b.x)), y0 = Math.min(...boxes.map(b => b.y))
  const x1 = Math.max(...boxes.map(b => b.x + b.w)), y1 = Math.max(...boxes.map(b => b.y + b.h))
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

// ── snapping ─────────────────────────────────────────────────────────────────────────────────

export interface SnapGuides { /** x positions of vertical guide lines */ v: number[]; /** y positions of horizontal guide lines */ h: number[] }
export interface SnapResult { dx: number; dy: number; guides: SnapGuides }

const EPS = 1e-6

/**
 * Snaps a box being MOVED to the canvas edges/centre and to the edges/centres of other boxes. `threshold` is a fraction of the canvas (e.g. 0.008 ≈ 9 px on a 1080 canvas).
 * Returns the correction to add to the box's position and the guide lines that now line up. Left, centre and right edges of the box are each tried against every target; the
 * closest match within the threshold wins, per axis.
 */
export function snapMove(moving: Box, others: Box[], threshold: { x: number; y: number }): SnapResult {
  const targetsX = [0, 0.5, 1]
  const targetsY = [0, 0.5, 1]
  for (const o of others) { targetsX.push(o.x, o.x + o.w / 2, o.x + o.w); targetsY.push(o.y, o.y + o.h / 2, o.y + o.h) }
  const best = (edges: number[], targets: number[], limit: number) => {
    let bestDiff = Infinity
    for (const e of edges) for (const t of targets) { const d = t - e; if (Math.abs(d) <= limit && Math.abs(d) < Math.abs(bestDiff)) bestDiff = d }
    return Number.isFinite(bestDiff) ? bestDiff : 0
  }
  const dx = best([moving.x, moving.x + moving.w / 2, moving.x + moving.w], targetsX, threshold.x)
  const dy = best([moving.y, moving.y + moving.h / 2, moving.y + moving.h], targetsY, threshold.y)
  const nx = moving.x + dx, ny = moving.y + dy
  const v = new Set<number>(), h = new Set<number>()
  for (const e of [nx, nx + moving.w / 2, nx + moving.w]) for (const t of targetsX) if (Math.abs(e - t) < EPS) v.add(round(t))
  for (const e of [ny, ny + moving.h / 2, ny + moving.h]) for (const t of targetsY) if (Math.abs(e - t) < EPS) h.add(round(t))
  return { dx, dy, guides: { v: [...v].sort((a, b) => a - b), h: [...h].sort((a, b) => a - b) } }
}

const round = (n: number) => Math.round(n * 1e6) / 1e6

// ── alignment & distribution ─────────────────────────────────────────────────────────────────

export type AlignMode = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'
export type AlignTo = 'selection' | 'canvas'

/** New top-left positions after aligning boxes to each other (or to the canvas). Returns one {x?, y?} per input box, in the same order. */
export function alignBoxes(boxes: Box[], mode: AlignMode, to: AlignTo = 'selection'): { x?: number; y?: number }[] {
  const ref = to === 'canvas' ? { x: 0, y: 0, w: 1, h: 1 } : unionBox(boxes)
  return boxes.map(b => {
    switch (mode) {
      case 'left': return { x: ref.x }
      case 'center': return { x: ref.x + (ref.w - b.w) / 2 }
      case 'right': return { x: ref.x + ref.w - b.w }
      case 'top': return { y: ref.y }
      case 'middle': return { y: ref.y + (ref.h - b.h) / 2 }
      case 'bottom': return { y: ref.y + ref.h - b.h }
    }
  })
}

/**
 * Spaces boxes so the GAPS between neighbours are equal, keeping the outermost two where they are. Needs at least three boxes (with two there is nothing to even out). The result
 * is in the same order as the input.
 */
export function distributeBoxes(boxes: Box[], axis: 'horizontal' | 'vertical'): { x?: number; y?: number }[] {
  const out: { x?: number; y?: number }[] = boxes.map(() => ({}))
  if (boxes.length < 3) return out
  const key = axis === 'horizontal' ? 'x' : 'y'
  const size = axis === 'horizontal' ? 'w' : 'h'
  const order = boxes.map((b, i) => ({ b, i })).sort((p, q) => p.b[key] - q.b[key])
  const first = order[0].b, last = order[order.length - 1].b
  const span = last[key] + last[size] - first[key]
  const total = order.reduce((n, o) => n + o.b[size], 0)
  const gap = (span - total) / (order.length - 1)
  let cursor = first[key]
  for (const o of order) { out[o.i][key] = cursor; cursor += o.b[size] + gap }
  return out
}
