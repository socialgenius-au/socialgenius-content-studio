// M2.1a -- a person's CORRECTIONS, kept apart from the evidence. The source observations are never edited: a correction is a separate record keyed by
// candidate id, and "resolving" a candidate lays the corrections over the suggestion to get the values that will become the layer. Every value that
// came from a person is labelled basis "user"; everything else keeps the label the engine gave it.
import { clamp, comparable, fromUser, normaliseText, round3, type Prop } from './contract'
import type { TextCandidate } from './candidates'
import { MIN_VISIBLE_SECONDS } from './timing'

/** Reference-video seconds -> the draft's timeline. "fit" stretches the reference's length onto the blueprint's; "identity" keeps reference seconds. */
export interface TimeMap { mode: 'fit' | 'identity'; factor: number; referenceSeconds: number | null; planSeconds: number }

export function makeTimeMap(referenceSeconds: number | null, planSeconds: number, mode?: TimeMap['mode']): TimeMap {
  const known = referenceSeconds !== null && referenceSeconds > 0 && planSeconds > 0
  const differs = known && Math.abs(referenceSeconds - planSeconds) / planSeconds > 0.01
  const chosen = mode ?? (differs ? 'fit' : 'identity')
  return { mode: chosen, factor: chosen === 'fit' && known ? planSeconds / (referenceSeconds as number) : 1, referenceSeconds, planSeconds }
}
export const mapTime = (m: TimeMap, t: number) => round3(t * m.factor)

/** Everything a person can change on one candidate. Times are on the DRAFT's timeline; x / y / width are percent of the canvas. */
export interface TextCorrection {
  include?: boolean
  text?: string
  start?: number
  end?: number
  x?: number
  y?: number
  width?: number
  fontSize?: number
  color?: string
  /** Replace the blueprint placeholder this layer overlaps (the placeholder is removed and the layer keeps its scene link). */
  replacePlaceholder?: boolean
}
export type Corrections = Readonly<Record<string, TextCorrection>>

/** Return new corrections with `patch` applied to one candidate; an `undefined` value clears that field; an empty entry disappears. Never mutates. */
export function setCorrection(all: Corrections, id: string, patch: Partial<Record<keyof TextCorrection, unknown>>): Corrections {
  const next: Record<string, unknown> = { ...(all[id] ?? {}) }
  for (const [k, v] of Object.entries(patch)) { if (v === undefined) delete next[k]; else next[k] = v }
  const rest = { ...all }
  if (Object.keys(next).length === 0) delete rest[id]
  else rest[id] = next as TextCorrection
  return rest
}

const isHex = (s: unknown): s is string => typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s)
const num = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

export interface ResolvedText {
  candidate: TextCandidate
  include: boolean
  text: Prop<string>
  start: Prop<number>
  end: Prop<number>
  x: Prop<number>
  y: Prop<number>
  width: Prop<number>
  fontSize: Prop<number>
  color: Prop<string>
  replacePlaceholder: boolean
  corrected: string[]                 // the names of the properties a person changed
  invalid: 'empty_text' | null
  ignored: string[]                   // corrections that were out of range / malformed and therefore not applied
}

export function resolveCandidate(c: TextCandidate, correction: TextCorrection | undefined, map: TimeMap): ResolvedText {
  const corr = correction ?? {}
  const corrected: string[] = []
  const ignored: string[] = []
  const t = c.timing, g = c.geometry
  const pick = <T,>(name: string, user: T | undefined, ok: boolean, suggested: Prop<T>): Prop<T> => {
    if (user === undefined) return suggested
    if (!ok) { ignored.push(name); return suggested }
    corrected.push(name)
    return fromUser(user)
  }
  const sNote = `Between sampled frames; could be off by up to about ${Math.max(t.startUncertainty, t.endUncertainty).toFixed(1)} s.${map.mode === 'fit' ? ' Stretched to fit the blueprint length.' : ''}`
  const typed = typeof corr.text === 'string' ? normaliseText(corr.text) : undefined
  let text = c.suggested.text
  if (typed !== undefined && typed !== c.sourceText) { text = fromUser(typed); corrected.push('text') }          // retyping the same wording is not a correction
  else if (corr.text !== undefined && typed === undefined) ignored.push('text')
  const start = pick('startTime', corr.start, num(corr.start) && corr.start >= 0, { value: mapTime(map, t.start), basis: 'inferred', confidence: 'low', note: sNote })
  let end = pick('endTime', corr.end, num(corr.end) && corr.end > 0, { value: mapTime(map, t.end), basis: 'inferred', confidence: 'low', note: sNote })
  if (end.value - start.value < MIN_VISIBLE_SECONDS) end = { ...end, value: round3(start.value + MIN_VISIBLE_SECONDS) }
  const geo = (note: string) => (v: number): Prop<number> => ({ value: v, basis: 'inferred', confidence: 'medium', note })
  const x = pick('x', corr.x, num(corr.x), geo('From the detected box position, adjusted for the export renderer.')(g.x))
  const y = pick('y', corr.y, num(corr.y), geo('From the detected box position, adjusted for the export renderer.')(g.y))
  const width = pick('width', corr.width, num(corr.width) && corr.width > 0, geo('From the detected box width, with room to hold the text on one line.')(g.width))
  const fontSize = pick('fontSize', corr.fontSize, num(corr.fontSize) && corr.fontSize >= 1, {
    value: g.fontSize, basis: 'inferred', confidence: 'low', note: `Estimated from the detected box (${g.fontSizeFromHeight}px by height${g.fontSizeFromWidth === null ? '' : `, ${g.fontSizeFromWidth}px by width`}); the original font is not recovered.`,
  })
  const color = pick('color', corr.color, isHex(corr.color), c.suggested.color)
  const body = normaliseText(text.value)
  return {
    candidate: c, include: corr.include ?? c.defaultInclude, text: { ...text, value: body }, start,
    end, x: { ...x, value: clamp(x.value, 0, 100) }, y: { ...y, value: clamp(y.value, 0, 100) },
    width: { ...width, value: clamp(width.value, 1, 100) }, fontSize: { ...fontSize, value: Math.round(clamp(fontSize.value, 6, 300)) },
    color, replacePlaceholder: corr.replacePlaceholder === true, corrected, invalid: body === '' ? 'empty_text' : null, ignored,
  }
}

/** Say "replace the placeholder" for every item that is waiting on that decision. Returns new corrections; items already decided are left as they are. */
export function replaceAllBlocked(all: Corrections, blockedIds: readonly string[]): Corrections {
  return blockedIds.reduce((acc, id) => (acc[id]?.replacePlaceholder === true ? acc : setCorrection(acc, id, { replacePlaceholder: true })), all)
}

/** Two resolved items are the same text if their wording matches ignoring case and spacing. */
export const sameWording = (a: string, b: string) => comparable(a) === comparable(b)
