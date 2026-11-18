// M4 -- the small, deterministic signals the classifier weighs. Ported (not imported) from the M3 image-slot classifier on branch feature/m3-image-slot-classification (imagelayers/recurring.ts, b3659a5):
// looksLikeHandle, looksLikeWords and distinctSpots keep their M3 behaviour and tests so the two stay consistent; what M4 adds is the movement reading and the sampling-aware visibility intervals.
// Nothing here looks at pixels or calls a model.
import type { Rect } from './contract'
import { round3, type Movement, type VisibilityInterval } from './contract'

export const SPOT_TOLERANCE = 0.02            // two sightings are "the same spot" when their box corners are within 2% of the frame

export const cx = (b: Rect) => b.x + b.w / 2
export const cy = (b: Rect) => b.y + b.h / 2
export const spread = (xs: readonly number[]) => (xs.length ? Math.max(...xs) - Math.min(...xs) : 0)
export const median = (xs: readonly number[]) => { const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2); return s.length === 0 ? 0 : s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
export const mean = (xs: readonly number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

/**
 * A handle, address or code-like string. An "@" attached to a word, or a web address, is enough. Digits and underscores only count inside ONE token (user_123, shop2024): a phrase with spaces that merely
 * contains a number ("Spring Launch 2026", "50% OFF", "Call 555-1234") is ordinary text, not a handle. (Found on the second reference: the first version called those handles.)
 */
export function looksLikeHandle(s: string): boolean {
  const t = s.trim()
  if (/@\w/.test(t) || /www\./i.test(t) || /\b\w+\.(com|net|org|tv|app)\b/i.test(t)) return true
  if (/\s/.test(t)) return false
  return (/_/.test(t) && /[A-Za-z]/.test(t)) || (/[A-Za-z]/.test(t) && /\d/.test(t)) || /^[A-Z]{8,}$/.test(t)
}
/** A plain word or short phrase of letters, as a caption would be. */
export const looksLikeWords = (s: string) => /^[\p{L}][\p{L}'’\- ]{1,60}$/u.test(s.trim()) && !/^[A-Z]{3,}$/.test(s.trim()) && !looksLikeHandle(s)

/** How many distinct places the boxes sit in (boxes whose corners are within the tolerance count as one place). */
export function distinctSpots(boxes: readonly Rect[]): number {
  const spots: Rect[] = []
  for (const b of boxes) if (!spots.some(s => Math.abs(s.x - b.x) <= SPOT_TOLERANCE && Math.abs(s.y - b.y) <= SPOT_TOLERANCE)) spots.push(b)
  return spots.length
}

/** How a thing moved between its sightings. A single sighting says nothing about movement; positions that repeat are "fixed spots"; the same height at changing positions is a line it slides along. */
export function movementOf(boxes: readonly Rect[]): Movement {
  const n = boxes.length
  const spots = distinctSpots(boxes)
  const sp = { x: round3(spread(boxes.map(cx))), y: round3(spread(boxes.map(cy))) }
  if (n <= 1) return { kind: 'single_sighting', spots: Math.min(n, 1), spread: sp, notes: ['Seen once: nothing is known about movement.'] }
  if (spots === 1) return { kind: 'static', spots, spread: sp, notes: [`The same place on all ${n} sightings.`] }
  if (sp.y < 0.02 && sp.x > 0.15) return { kind: 'slides', spots, spread: sp, notes: [`The same height at ${spots} different positions: it slides along one line.`] }
  if (n / spots >= 1.5) return { kind: 'fixed_spots', spots, spread: sp, notes: [`Back to the same ${spots} places (${n} sightings): it hops between fixed spots.`] }
  return { kind: 'moves', spots, spread: sp, notes: [`${spots} different places over ${n} sightings, with no repeating pattern.`] }
}

/**
 * Visibility intervals from the instants a thing was SEEN and the instants the analysis LOOKED (a sampled still that was read). Two sightings are in one interval unless a sampled instant lies strictly between
 * them at which it was not seen: that instant is evidence of absence (or occlusion), so the interval is split there. Without sample times nothing is split, and the interval is only ever "a span between sightings":
 * visibility in the gaps is never claimed.
 */
export function visibilityIntervals(seen: readonly number[], sampleTimes: readonly number[], shotId: number | null): VisibilityInterval[] {
  const times = [...new Set(seen.map(round3))].sort((a, b) => a - b)
  if (times.length === 0) return []
  const lookedAndMissed = (a: number, b: number) => sampleTimes.some(t => t > a + 0.05 && t < b - 0.05 && !times.some(s => Math.abs(s - t) <= 0.05))
  const groups: number[][] = [[times[0]]]
  for (let i = 1; i < times.length; i++) (lookedAndMissed(times[i - 1], times[i]) ? groups.push([times[i]]) : groups[groups.length - 1].push(times[i]))
  return groups.map(g => ({ start: g[0], end: g[g.length - 1], observed: g, kind: g.length === 1 ? 'single_instant' as const : 'span_between_sightings' as const, shotId }))
}
