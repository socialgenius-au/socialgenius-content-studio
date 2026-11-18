// M2.4 / B1 -- ESTIMATE whether the picture was moving or zooming fast across a cut, from the motion MEASUREMENTS the analysis already stored for that cut (per frame pair: an
// ORB+RANSAC affine fit with translation and scale, and a phase-correlation shift). Pure; reads only; stores nothing and asks the backend for nothing new.
//
// What is OBSERVED/MEASURED and what is INFERRED here: the per-pair numbers are the analysis's own measurements. Whether they add up to "a whip pan" or "a zoom punch" is an
// INFERENCE made here, from provisional thresholds that have only been exercised on synthetic profiles (no real whip pan or zoom punch was available to validate them). So a result
// is never above medium confidence, is never included by default, always carries the numbers it came from, and is never called the original editing instruction.
import { round3 } from './contract'

export interface AffinePair { ok: boolean; tx: number | null; ty: number | null; scale: number | null; inlierRatio: number | null }
export interface PhasePair { dx: number; dy: number; response: number; issue: string | null }
export interface MotionMeasurements {
  /** Width and height of the analysed frames in pixels (the source video's own), needed to turn a shift in pixels into a share of the frame. */
  frame: { width: number; height: number }
  fps: number
  affine: AffinePair[]
  phase: PhasePair[]
}

export const MOTION_THRESHOLDS = {
  panShare: 0.12,          // a whip pan moves the picture at least this share of the frame width (or height) between two consecutive samples ...
  panPairs: 2,             // ... in the same direction on at least this many consecutive pairs
  zoomScale: 1.08,         // a zoom punch scales the picture by at least this much between two samples (or the inverse for a pull-out) ...
  zoomPairs: 2,            // ... on at least this many consecutive pairs
  zoomMaxShift: 0.05,      // ... while the picture hardly shifts sideways
  minInlierRatio: 0.5,     // an affine fit only counts when at least half its matches agree
  minPhaseResponse: 0.15,  // a phase-correlation shift only counts at or above this correlation (the library's own response value)
  mediumPairs: 3,          // this many agreeing pairs (or more) lifts the estimate from low to medium confidence; never higher
} as const

export type Direction = 'left' | 'right' | 'up' | 'down'
export interface MotionEstimate {
  kind: 'whip_pan' | 'zoom_punch'
  confidence: 'low' | 'medium'
  /** Whip pan: where the picture moved to. Zoom punch: 'in' (scale up) or 'out'. */
  direction: Direction | 'in' | 'out'
  /** The measured per-pair values behind the estimate, in the order of the window. */
  perPair: number[]
  unit: string
  pairs: number
  /** Seconds the movement seems to last: agreeing pairs over the sampling rate. */
  seconds: number
  source: 'affine' | 'phase'
  reasons: string[]
}

const pct = (n: number) => `${Math.round(n * 100)} %`

/** The longest run of consecutive items for which `dir` returns the same non-null value. */
function longestRun<T>(items: readonly T[], dir: (t: T) => string | null): { value: string | null; start: number; length: number } {
  let best = { value: null as string | null, start: 0, length: 0 }, cur = { value: null as string | null, start: 0, length: 0 }
  items.forEach((it, i) => {
    const d = dir(it)
    if (d !== null && d === cur.value) cur.length += 1
    else cur = { value: d, start: i, length: d === null ? 0 : 1 }
    if (cur.length > best.length) best = { ...cur }
  })
  return best
}

export function estimateMotion(m: MotionMeasurements | null | undefined): MotionEstimate | null {
  if (!m || m.frame.width <= 0 || m.frame.height <= 0 || m.fps <= 0) return null
  const T = MOTION_THRESHOLDS
  const goodAffine = (p: AffinePair) => p.ok && p.tx !== null && p.ty !== null && p.scale !== null && (p.inlierRatio ?? 0) >= T.minInlierRatio

  // Zoom punch: the picture scales the same way on consecutive pairs, without sliding sideways.
  const zoomDir = (p: AffinePair): string | null => {
    if (!goodAffine(p)) return null
    const sideways = Math.max(Math.abs(p.tx!) / m.frame.width, Math.abs(p.ty!) / m.frame.height)
    if (sideways > T.zoomMaxShift) return null
    return p.scale! >= T.zoomScale ? 'in' : p.scale! <= 1 / T.zoomScale ? 'out' : null
  }
  const z = longestRun(m.affine, zoomDir)
  if (z.length >= T.zoomPairs && z.value) {
    const scales = m.affine.slice(z.start, z.start + z.length).map(p => round3(p.scale!))
    return {
      kind: 'zoom_punch', direction: z.value as 'in' | 'out', perPair: scales, unit: 'scale per sample', pairs: z.length, seconds: round3(z.length / m.fps), source: 'affine',
      confidence: z.length >= T.mediumPairs ? 'medium' : 'low',
      reasons: [`The picture scaled ${z.value === 'in' ? 'up' : 'down'} on ${z.length} consecutive frame pairs (${scales.join(', ')} per sample; the threshold is ${T.zoomScale} or its inverse) with hardly any sideways shift.`],
    }
  }

  // Whip pan: the picture shifts a large share of the frame the same way on consecutive pairs. Affine fits are used where they succeeded; phase correlation fills in where they did not.
  const shifts = m.affine.map((a, i) => {
    if (goodAffine(a)) return { dx: a.tx! / m.frame.width, dy: a.ty! / m.frame.height, source: 'affine' as const }
    const p = m.phase[i]
    if (p && p.response >= T.minPhaseResponse && !p.issue) return { dx: p.dx / m.frame.width, dy: p.dy / m.frame.height, source: 'phase' as const }
    return null
  })
  const panDir = (s: (typeof shifts)[number]): Direction | null => {
    if (!s) return null
    const ax = Math.abs(s.dx), ay = Math.abs(s.dy)
    if (Math.max(ax, ay) < T.panShare) return null
    return ax >= ay ? (s.dx > 0 ? 'right' : 'left') : (s.dy > 0 ? 'down' : 'up')
  }
  const pan = longestRun(shifts, panDir)
  if (pan.length >= T.panPairs && pan.value) {
    const used = shifts.slice(pan.start, pan.start + pan.length) as NonNullable<(typeof shifts)[number]>[]
    const horizontal = pan.value === 'left' || pan.value === 'right'
    const values = used.map(s => round3(Math.abs(horizontal ? s.dx : s.dy)))
    const source = used.every(s => s.source === 'affine') ? 'affine' : 'phase'
    return {
      kind: 'whip_pan', direction: pan.value as Direction, perPair: values, unit: horizontal ? 'share of the frame width per sample' : 'share of the frame height per sample', pairs: pan.length,
      seconds: round3(pan.length / m.fps), source, confidence: pan.length >= T.mediumPairs ? 'medium' : 'low',
      reasons: [`The picture moved ${pan.value} by ${values.map(pct).join(', ')} of the frame ${horizontal ? 'width' : 'height'} on ${pan.length} consecutive frame pairs (the threshold is ${pct(T.panShare)}), measured by ${source === 'affine' ? 'feature matching' : 'phase correlation'}.`],
    }
  }
  return null
}

export const MOTION_NOTE =
  'Estimated from measured motion; it is not the original effect. The thresholds are provisional and have only been checked on synthetic examples. The export uses the editor’s own whip-pan and zoom effects, so the measured direction is shown for information and is not reproduced.'
