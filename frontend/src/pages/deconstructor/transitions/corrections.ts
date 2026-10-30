// M2.4a -- a person's CORRECTIONS, kept apart from the evidence (same rule as every reconstruction kind). Every value a person sets is labelled basis "user".
import { MAX_DURATION, MIN_DURATION, TRANSITION_KINDS, clamp, fromUser, inferred, round3, type Prop, type TransitionKind } from './contract'
import { defaultDuration } from './classify'
import type { TransitionCandidate } from './candidates'

export { makeTimeMap, mapTime, type TimeMap } from '../textlayers/corrections'

export interface TransitionCorrection { include?: boolean; kind?: TransitionKind; duration?: number }
export type TransitionCorrections = Readonly<Record<string, TransitionCorrection>>

/** Return new corrections with `patch` applied to one candidate; an `undefined` value clears that field; an empty entry disappears. Never mutates. */
export function setTransitionCorrection(all: TransitionCorrections, id: string, patch: Partial<Record<keyof TransitionCorrection, unknown>>): TransitionCorrections {
  const next: Record<string, unknown> = { ...(all[id] ?? {}) }
  for (const [k, v] of Object.entries(patch)) { if (v === undefined) delete next[k]; else next[k] = v }
  const rest = { ...all }
  if (Object.keys(next).length === 0) delete rest[id]
  else rest[id] = next as TransitionCorrection
  return rest
}

export interface ResolvedTransition {
  candidate: TransitionCandidate
  include: boolean
  kind: Prop<TransitionKind>
  duration: Prop<number>
  corrected: string[]
  ignored: string[]
}

export function resolveTransition(c: TransitionCandidate, correction: TransitionCorrection | undefined): ResolvedTransition {
  const corr = correction ?? {}
  const corrected: string[] = [], ignored: string[] = []
  const cl = c.classification
  let kind: Prop<TransitionKind> = inferred(cl.kind, cl.confidence, cl.reasons[0] ?? 'Estimated from the measurements around the cut.')
  if (corr.kind !== undefined) {
    if ((TRANSITION_KINDS as readonly string[]).includes(corr.kind)) { kind = fromUser(corr.kind); corrected.push('transition') } else ignored.push('transition')
  }
  let duration: Prop<number> = inferred(round3(defaultDuration(cl)), cl.durationSeconds === null ? 'low' : cl.confidence, cl.durationSeconds === null ? 'A hard cut has no duration; the editor’s own default is kept.' : 'How many sampled frame pairs the change lasted.')
  if (corr.duration !== undefined) {
    if (typeof corr.duration === 'number' && Number.isFinite(corr.duration) && corr.duration > 0) { duration = fromUser(round3(clamp(corr.duration, MIN_DURATION, MAX_DURATION))); corrected.push('transitionDuration') } else ignored.push('transitionDuration')
  }
  return { candidate: c, include: corr.include ?? c.defaultInclude, kind, duration, corrected, ignored }
}
