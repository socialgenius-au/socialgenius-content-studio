// M2.4a -- turn the approved decisions into the clip transitions of a draft snapshot. Pure. A decision is tied to a SCENE JOIN (by scene numbers and time); when the draft
// is saved, it is applied to the clip whose end sits on that join, if there is one. Nothing is edited in the evidence, the editor or the saved draft until then.
import { LIMITATIONS, NO_CLAIMS, TRANSITIONS_ENGINE_VERSION, round3, type Prop, type TransitionKind } from './contract'
import type { TransitionCandidate } from './candidates'
import { resolveTransition, type TransitionCorrections } from './corrections'
import type { TimeMap } from '../textlayers/corrections'

export type TransitionItemStatus = 'included' | 'excluded_default' | 'excluded_user' | 'no_join'
export interface TransitionPlanItem { candidateId: string; status: TransitionItemStatus; message: string }

export interface TransitionChange {
  candidateId: string
  boundaryId: number
  sceneNumber: number
  nextSceneNumber: number
  joinTime: number
  kind: TransitionKind
  duration: number
  basis: { kind: Prop<TransitionKind>['basis']; duration: Prop<number>['basis']; confidence: Prop<TransitionKind>['confidence'] | null }
  corrected: string[]
  referenceBoundary: number
}

export interface TransitionReconstructionRecord {
  schema: 'reconstruction-v1'
  kind: 'transition'
  engineVersion: string
  referenceVideoId: number
  videoAnalysisId: number
  createdAt: string
  timeMap: { mode: TimeMap['mode']; factor: number; referenceSeconds: number | null; planSeconds: number }
  counts: { measured: number; applied: number; excluded: number; noJoin: number }
  changes: TransitionChange[]
  /** Filled when a draft is saved: decisions that found no clip end on their join. */
  unmatched: number[]
  claims: typeof NO_CLAIMS
  limitations: string[]
}

export interface TransitionPlan { changes: TransitionChange[]; items: TransitionPlanItem[]; record: TransitionReconstructionRecord; signature: string }

export interface TransitionContext { referenceVideoId: number; videoAnalysisId: number; timeMap: TimeMap; createdAt: string }

export function planTransitions(candidates: readonly TransitionCandidate[], corrections: TransitionCorrections, ctx: TransitionContext): TransitionPlan {
  const changes: TransitionChange[] = []
  const items: TransitionPlanItem[] = []
  for (const c of candidates) {
    const corr = corrections[c.id]
    const r = resolveTransition(c, corr)
    const add = (status: TransitionItemStatus, message: string) => items.push({ candidateId: c.id, status, message })
    if (!r.include) { add(corr?.include === false ? 'excluded_user' : 'excluded_default', corr?.include === false ? 'Left out by you.' : 'Left out by default: the measurements show no clear signature.'); continue }
    if (!c.join) { add('no_join', 'No scene join in the blueprint is close enough to this cut, so nothing is changed. Scene joins stay hard cuts.'); continue }
    changes.push({
      candidateId: c.id, boundaryId: c.boundary.id, sceneNumber: c.join.sceneNumber, nextSceneNumber: c.join.nextSceneNumber, joinTime: round3(c.join.time), kind: r.kind.value, duration: r.duration.value,
      basis: { kind: r.kind.basis, duration: r.duration.basis, confidence: r.kind.confidence ?? null }, corrected: [...r.corrected], referenceBoundary: c.boundary.boundary,
    })
    add('included', r.kind.value === 'cut' ? `Scene ${c.join.sceneNumber} → ${c.join.nextSceneNumber} stays a hard cut.` : `Scene ${c.join.sceneNumber} → ${c.join.nextSceneNumber} will use a ${r.kind.value.replace('_', ' ')} of ${r.duration.value.toFixed(1)} s.`)
  }
  const count = (s: TransitionItemStatus) => items.filter(i => i.status === s).length
  const record: TransitionReconstructionRecord = {
    schema: 'reconstruction-v1', kind: 'transition', engineVersion: TRANSITIONS_ENGINE_VERSION, referenceVideoId: ctx.referenceVideoId, videoAnalysisId: ctx.videoAnalysisId, createdAt: ctx.createdAt,
    timeMap: { mode: ctx.timeMap.mode, factor: round3(ctx.timeMap.factor), referenceSeconds: ctx.timeMap.referenceSeconds, planSeconds: ctx.timeMap.planSeconds },
    counts: { measured: candidates.length, applied: changes.length, excluded: count('excluded_default') + count('excluded_user'), noJoin: count('no_join') }, changes, unmatched: [], claims: { ...NO_CLAIMS }, limitations: [...LIMITATIONS],
  }
  return { changes, items, record, signature: JSON.stringify(changes.map(c => [c.sceneNumber, c.joinTime, c.kind, c.duration])) }
}

/** The part of a clip this touches. */
export interface TransitionClip { startTime: number; endTime: number; transition: TransitionKind; transitionDuration: number }
export interface HasVideoClips { videoClips: readonly TransitionClip[] }

/** How close a clip's end must be to a planned join to count as it (seconds). Assembled drafts place clips exactly on scene boundaries; this only absorbs rounding. */
export const CLIP_END_TOLERANCE = 0.06

/** Apply the changes to the draft's clips and attach the record. The transition of a clip describes its join with the NEXT clip, so the last clip is never changed.
 *  Returns a NEW object; a plan with no changes returns the snapshot itself. */
export function mergeTransitions<S extends HasVideoClips>(snapshot: S, plan: TransitionPlan | null | undefined): S | (Omit<S, 'videoClips'> & { videoClips: S['videoClips'][number][]; transitionReconstruction: TransitionReconstructionRecord }) {
  if (!plan || plan.changes.length === 0) return snapshot
  const clips = snapshot.videoClips.map(c => ({ ...c }))
  const order = clips.map((c, i) => i).sort((a, b) => clips[a].startTime - clips[b].startTime)
  const unmatched: number[] = []
  const used = new Set<number>()
  for (const ch of plan.changes) {
    let hit = -1, best = Infinity
    order.forEach((idx, pos) => {
      if (pos === order.length - 1 || used.has(idx)) return                 // the last clip has no join after it
      const d = Math.abs(clips[idx].endTime - ch.joinTime)
      if (d <= CLIP_END_TOLERANCE && d < best) { best = d; hit = idx }
    })
    if (hit < 0) { unmatched.push(ch.boundaryId); continue }
    used.add(hit)
    clips[hit].transition = ch.kind
    if (ch.kind !== 'cut') clips[hit].transitionDuration = ch.duration            // a hard cut keeps the clip's own duration setting: it is not used
  }
  return { ...snapshot, videoClips: clips as S['videoClips'][number][], transitionReconstruction: { ...plan.record, unmatched } }
}
