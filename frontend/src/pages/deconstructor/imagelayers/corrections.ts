// M2.2a -- a person's CORRECTIONS, kept apart from the evidence (same rule as the text engine). A correction is a separate record keyed by candidate id;
// "resolving" a candidate lays the corrections over the suggestion to get the values that will become the layer. Every value that came from a person is
// labelled basis "user"; everything else keeps the label the engine gave it.
import { fromUser, measured, round3, MIN_VISIBLE_SECONDS, type Prop, type Rect } from './contract'
import type { ImageCandidate } from './candidates'
import { clampRegion, isValidRegion } from './geometry'
import { mapTime, type TimeMap } from '../textlayers/corrections'

export { makeTimeMap, mapTime, type TimeMap } from '../textlayers/corrections'

/** Everything a person can change on one candidate. Times are on the DRAFT's timeline. */
export interface ImageCorrection {
  include?: boolean
  /** A different region on the same frame (normalised 0..1). */
  region?: Rect
  start?: number
  end?: number
  /** Only meaningful for a crop of the reference: the person confirms they may use that part of the reference video. */
  rightsAcknowledged?: boolean
}
export type ImageCorrections = Readonly<Record<string, ImageCorrection>>

/** Return new corrections with `patch` applied to one candidate; an `undefined` value clears that field; an empty entry disappears. Never mutates. */
export function setImageCorrection(all: ImageCorrections, id: string, patch: Partial<Record<keyof ImageCorrection, unknown>>): ImageCorrections {
  const next: Record<string, unknown> = { ...(all[id] ?? {}) }
  for (const [k, v] of Object.entries(patch)) { if (v === undefined) delete next[k]; else next[k] = v }
  const rest = { ...all }
  if (Object.keys(next).length === 0) delete rest[id]
  else rest[id] = next as ImageCorrection
  return rest
}

const num = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
const isRect = (r: unknown): r is Rect => !!r && typeof r === 'object' && num((r as Rect).x) && num((r as Rect).y) && num((r as Rect).w) && num((r as Rect).h)

export interface ResolvedImage {
  candidate: ImageCandidate
  include: boolean
  region: Prop<Rect>
  start: Prop<number>
  end: Prop<number>
  rightsAcknowledged: boolean
  corrected: string[]                 // the names of the properties a person changed
  ignored: string[]                   // corrections that were out of range / malformed and therefore not applied
}

export function resolveImageCandidate(c: ImageCandidate, correction: ImageCorrection | undefined, map: TimeMap): ResolvedImage {
  const corr = correction ?? {}
  const corrected: string[] = []
  const ignored: string[] = []
  const t = c.timing
  const pick = <T,>(name: string, user: T | undefined, ok: boolean, suggested: Prop<T>): Prop<T> => {
    if (user === undefined) return suggested
    if (!ok) { ignored.push(name); return suggested }
    corrected.push(name)
    return fromUser(user)
  }
  const sNote = `A guess between sampled frames: it could be off by up to about ${Math.max(t.startUncertainty, t.endUncertainty).toFixed(1)} s, and one sighting says nothing about how long it stayed.${map.mode === 'fit' ? ' Stretched to fit the blueprint length.' : ''}`
  const suggestedRegion: Prop<Rect> = c.origin === 'user_region'
    ? fromUser(c.region)
    : measured(c.region, 'The detector’s bounding box on this frame. It is a rectangle, not an outline of the object.')
  const asked = isRect(corr.region) ? clampRegion(corr.region) : undefined
  const region = pick('region', corr.region === undefined ? undefined : asked, asked !== undefined && isValidRegion(asked), suggestedRegion)
  const start = pick('startTime', corr.start, num(corr.start) && corr.start >= 0, { value: mapTime(map, t.start), basis: 'inferred', confidence: 'low', note: sNote })
  let end = pick('endTime', corr.end, num(corr.end) && corr.end > 0, { value: mapTime(map, t.end), basis: 'inferred', confidence: 'low', note: sNote })
  if (end.value - start.value < MIN_VISIBLE_SECONDS) end = { ...end, value: round3(start.value + MIN_VISIBLE_SECONDS) }
  return { candidate: c, include: corr.include ?? c.defaultInclude, region, start, end, rightsAcknowledged: corr.rightsAcknowledged === true, corrected, ignored }
}
