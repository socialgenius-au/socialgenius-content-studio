// M2.5a -- a person's CORRECTIONS, kept apart from the evidence (same rule as every reconstruction kind). Every value a person sets is labelled basis "user"; the transcribed words
// are kept in the provenance even after the person rewords the subtitle.
import { MIN_VISIBLE_SECONDS, fromUser, measured, inferred, normaliseText, round3, type Prop } from './contract'
import type { SpeechCandidate } from './candidates'
import { mapTime, type TimeMap } from '../textlayers/corrections'

export { makeTimeMap, mapTime, type TimeMap } from '../textlayers/corrections'

export interface SpeechCorrection { include?: boolean; text?: string; start?: number; end?: number }
export type SpeechCorrections = Readonly<Record<string, SpeechCorrection>>

/** Return new corrections with `patch` applied to one candidate; an `undefined` value clears that field; an empty entry disappears. Never mutates. */
export function setSpeechCorrection(all: SpeechCorrections, id: string, patch: Partial<Record<keyof SpeechCorrection, unknown>>): SpeechCorrections {
  const next: Record<string, unknown> = { ...(all[id] ?? {}) }
  for (const [k, v] of Object.entries(patch)) { if (v === undefined) delete next[k]; else next[k] = v }
  const rest = { ...all }
  if (Object.keys(next).length === 0) delete rest[id]
  else rest[id] = next as SpeechCorrection
  return rest
}

/** Include every candidate (or none). An explicit person action: a third party's words are never included by default. */
export function setAllIncluded(all: SpeechCorrections, ids: readonly string[], include: boolean): SpeechCorrections {
  return ids.reduce((acc, id) => setSpeechCorrection(acc, id, { include }), all)
}

const num = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

export interface ResolvedSpeech {
  candidate: SpeechCandidate
  include: boolean
  text: Prop<string>
  start: Prop<number>
  end: Prop<number>
  corrected: string[]
  ignored: string[]
  invalid: 'empty_text' | null
}

export function resolveSpeech(c: SpeechCandidate, correction: SpeechCorrection | undefined, map: TimeMap): ResolvedSpeech {
  const corr = correction ?? {}
  const corrected: string[] = [], ignored: string[] = []
  const stretched = map.mode === 'fit' && Math.abs(map.factor - 1) > 0.005
  const timeProp = (v: number): Prop<number> => stretched
    ? inferred(mapTime(map, v), 'medium', 'The recogniser’s time, stretched to the blueprint’s length.')
    : measured(mapTime(map, v), 'The recogniser’s time: usually within a few tenths of a second.')
  const typed = typeof corr.text === 'string' ? normaliseText(corr.text) : undefined
  let text: Prop<string> = measured(c.segment.text, 'As the speech recogniser wrote it; not checked against the audio.')
  if (typed !== undefined && typed !== c.segment.text) { text = fromUser(typed); corrected.push('text') } else if (corr.text !== undefined && typed === undefined) ignored.push('text')
  const pick = (name: string, user: number | undefined, ok: boolean, suggested: Prop<number>): Prop<number> => {
    if (user === undefined) return suggested
    if (!ok) { ignored.push(name); return suggested }
    corrected.push(name)
    return fromUser(round3(user))
  }
  const start = pick('startTime', corr.start, num(corr.start) && corr.start >= 0, timeProp(c.segment.start))
  let end = pick('endTime', corr.end, num(corr.end) && corr.end > 0, timeProp(c.segment.end))
  if (end.value - start.value < MIN_VISIBLE_SECONDS) end = { ...end, value: round3(start.value + MIN_VISIBLE_SECONDS) }
  return { candidate: c, include: corr.include ?? c.defaultInclude, text, start, end, corrected, ignored, invalid: text.value === '' ? 'empty_text' : null }
}
