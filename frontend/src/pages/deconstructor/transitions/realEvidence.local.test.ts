// M2.4a -- REAL-DATA validation against the actual VA5368 analysis. LOCAL ONLY: it runs when M2_REAL_TRANSITION_EVIDENCE points at a JSON file shaped like the
// reference-video response (kept outside the repository because it describes a third-party video). Skipped in CI and on a fresh checkout.
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import bpFx from '../__fixtures__/va5368.c4-blueprint.json'
import type { ReferenceVideo } from '../../../types'
import type { BlueprintResponse } from '../../../types/deconstructor'
import { buildBlueprintPlan } from '../../video-studio-v2/blueprint/blueprintPlan'
import { buildTransitionCandidates, sceneJoins } from './candidates'
import { classifyBoundary } from './classify'
import { makeTimeMap } from './corrections'
import { readTransitionEvidence } from './evidence'
import { planTransitions } from './materialize'

const file = process.env.M2_REAL_TRANSITION_EVIDENCE
const run = !!file && existsSync(file)
const d = run ? describe : describe.skip

d('real VA5368 transition evidence (local only)', () => {
  const ref = run ? (JSON.parse(readFileSync(file!, 'utf8')) as ReferenceVideo) : (null as never)
  const before = run ? JSON.stringify(ref) : ''
  const plan = buildBlueprintPlan(JSON.parse(JSON.stringify(bpFx)) as BlueprintResponse, new Date('2026-10-01T00:00:00Z'))
  const evidence = run ? readTransitionEvidence(ref, plan.videoAnalysisId) : (null as never)
  const map = run ? makeTimeMap(evidence.durationSeconds, plan.totalSeconds) : (null as never)
  const cands = run ? buildTransitionCandidates(evidence, sceneJoins(plan), map) : []

  it('reads the one measured cut without touching the analysis', () => {
    expect(evidence.boundaries).toHaveLength(1); expect(evidence.boundaries[0].boundary).toBeCloseTo(39.867, 2); expect(JSON.stringify(ref)).toBe(before); expect(Object.isFrozen(evidence)).toBe(true)
  })
  it('classifies it as a high-confidence hard cut, the only thing a single-pair spike with a brightness step can be', () => {
    expect(classifyBoundary(evidence.boundaries[0])).toMatchObject({ kind: 'cut', confidence: 'high' })
  })
  it('maps onto the blueprint honestly: the plan, its joins, and whether a join is near the stretched cut', () => {
    const joins = sceneJoins(plan)
    console.log(`      real plan: ${plan.scenes.length} scenes over ${plan.totalSeconds}s; joins at ${joins.map(j => j.time).join(', ')}; reference ${evidence.durationSeconds}s -> map ${map.mode} x${map.factor.toFixed(3)}; the cut lands at ${cands[0].planTime.toFixed(2)}s -> ${cands[0].join ? `scene ${cands[0].join.sceneNumber}->${cands[0].join.nextSceneNumber} (${cands[0].join.distance}s away)` : 'no join within tolerance'}`)
    expect(cands).toHaveLength(1); expect(cands[0].planTime).toBeGreaterThan(0)
    const p = planTransitions(cands, {}, { referenceVideoId: ref.id, videoAnalysisId: plan.videoAnalysisId, timeMap: map, createdAt: '2026-10-30T00:00:00.000Z' })
    expect(p.record.claims).toEqual({ originalEffectRecovered: false, originalSettingsRecovered: false })
    expect(p.changes.every(c => c.kind === 'cut')).toBe(true)                      // a hard cut can only ever leave the join a hard cut: nothing is invented
  })
})
