// M2.4a -- candidates: one per measured cut, each with its estimated type and the blueprint scene JOIN it lines up with (if any). A join is where one scene's footage
// ends and the next begins in the draft; only there can a transition be set. Matching is by time, one boundary per join, nearest first, within a tolerance.
import type { BlueprintPlan } from '../../video-studio-v2/blueprint/blueprintPlan'
import { classifyBoundary, type Classification } from './classify'
import { mapTime, type TimeMap } from '../textlayers/corrections'
import type { BoundaryEvidence, TransitionEvidence } from './evidence'

export interface SceneJoin { sceneNumber: number; nextSceneNumber: number; time: number }

/** The joins of a blueprint: the end of every scene but the last. */
export function sceneJoins(plan: Pick<BlueprintPlan, 'scenes'>): SceneJoin[] {
  const scenes = [...plan.scenes].sort((a, b) => a.order - b.order)
  return scenes.slice(0, -1).map((s, i) => ({ sceneNumber: s.sceneNumber, nextSceneNumber: scenes[i + 1].sceneNumber, time: s.endTime }))
}

/** How far a boundary may sit from a join and still count as that join (seconds on the draft's timeline). */
export const joinTolerance = (planSeconds: number) => Math.max(0.75, 0.04 * planSeconds)

export type TransitionFlagCode = 'low_confidence' | 'possible_motion' | 'single_boundary' | 'timing_mapped'
export interface TransitionFlag { code: TransitionFlagCode; severity: 'info' | 'warning'; message: string }

export interface TransitionCandidate {
  id: string
  boundary: BoundaryEvidence
  classification: Classification
  planTime: number                          // where the cut falls on the draft's timeline
  join: (SceneJoin & { distance: number }) | null
  flags: TransitionFlag[]
  defaultInclude: boolean
}

export function buildTransitionCandidates(evidence: TransitionEvidence, joins: readonly SceneJoin[], timeMap: TimeMap, tolerance = joinTolerance(timeMap.planSeconds)): TransitionCandidate[] {
  const rows = evidence.boundaries.map(boundary => ({ boundary, classification: classifyBoundary(boundary), planTime: mapTime(timeMap, boundary.boundary) }))
  const pairs = rows.flatMap((r, ri) => joins.map((j, ji) => ({ ri, ji, d: Math.abs(j.time - r.planTime) }))).filter(p => p.d <= tolerance).sort((a, b) => a.d - b.d || a.ri - b.ri)
  const taken = { boundaries: new Set<number>(), joins: new Set<number>() }
  const assigned = new Map<number, SceneJoin & { distance: number }>()
  for (const p of pairs) {
    if (taken.boundaries.has(p.ri) || taken.joins.has(p.ji)) continue
    taken.boundaries.add(p.ri); taken.joins.add(p.ji); assigned.set(p.ri, { ...joins[p.ji], distance: Math.round(p.d * 1000) / 1000 })
  }
  return rows.map((r, i) => {
    const flags: TransitionFlag[] = []
    if (r.classification.confidence === 'low') flags.push({ code: 'low_confidence', severity: 'warning', message: 'The measurements do not show a clear signature.' })
    if (r.classification.kind === 'dissolve') flags.push({ code: 'possible_motion', severity: 'warning', message: 'A gradual change can also be fast motion or a flash.' })
    if (rows.length === 1) flags.push({ code: 'single_boundary', severity: 'info', message: 'The analysis found one cut in the whole reference.' })
    if (timeMap.mode === 'fit' && Math.abs(timeMap.factor - 1) > 0.005) flags.push({ code: 'timing_mapped', severity: 'info', message: 'Its time is stretched to the blueprint’s length, so the match to a scene join is approximate.' })
    return { id: `tb:${r.boundary.id}`, boundary: r.boundary, classification: r.classification, planTime: r.planTime, join: assigned.get(i) ?? null, flags, defaultInclude: r.classification.confidence !== 'low' }
  })
}
