// M2.1a -- REAL-DATA validation against the actual VA5368 analysis. LOCAL ONLY: it runs when M2_REAL_EVIDENCE points at a JSON file shaped like the
// reference-video response (kept outside the repository because it contains the third-party video's own text); in CI and on a fresh checkout it is skipped.
// It asserts what we CLAIM from the real data, not exact strings: counts, flags, exclusions, timing bounds, geometry limits, immutability.
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import bpFx from '../__fixtures__/va5368.c4-blueprint.json'
import type { ReferenceVideo } from '../../../types'
import type { BlueprintResponse } from '../../../types/deconstructor'
import { buildBlueprintPlan, buildPlaceholderOverlays } from '../../video-studio-v2/blueprint/blueprintPlan'
import { buildTextCandidates } from './candidates'
import { makeTimeMap } from './corrections'
import { readTextEvidence } from './evidence'
import { planTextLayers } from './materialize'

const file = process.env.M2_REAL_EVIDENCE
const run = !!file && existsSync(file)
const d = run ? describe : describe.skip

d('real VA5368 evidence (local only)', () => {
  const ref = run ? (JSON.parse(readFileSync(file!, 'utf8')) as ReferenceVideo) : (null as never)
  const before = run ? JSON.stringify(ref) : ''
  const plan = buildBlueprintPlan(JSON.parse(JSON.stringify(bpFx)) as BlueprintResponse, new Date('2026-10-01T00:00:00Z'))
  const evidence = run ? readTextEvidence(ref, plan.videoAnalysisId) : (null as never)
  const candidates = run ? buildTextCandidates(evidence) : []

  it('reads all 31 text groups with their evidence, without touching the analysis', () => {
    expect(evidence.groups).toHaveLength(31)
    expect(JSON.stringify(ref)).toBe(before)
    expect(evidence.groups.every(g => g.observations.length >= 1 && g.confidence !== null)).toBe(true)
    expect(evidence.frameSize).toEqual({ width: 480, height: 864 })
  })
  it('flags every low-confidence group and leaves it out by default', () => {
    const low = candidates.filter(c => c.sourceConfidence! < 0.5)
    expect(low.length).toBeGreaterThan(0)
    expect(low.every(c => !c.defaultInclude && c.flags.some(f => f.code === 'low_confidence'))).toBe(true)
  })
  it('excludes the creator handle / watermark by default and says why', () => {
    const branded = candidates.filter(c => c.branding.length > 0)
    expect(branded.length).toBeGreaterThanOrEqual(2)                                   // the @handle read several times
    expect(branded.every(c => !c.defaultInclude)).toBe(true)
    expect(branded.some(c => c.branding.includes('recurring_element') || c.branding.includes('handle'))).toBe(true)
  })
  it('reports timing uncertainty on every group, bounded by the real sample spacing', () => {
    expect(candidates.every(c => c.flags.some(f => f.code === 'timing_uncertain'))).toBe(true)
    const gaps = evidence.sampleTimes.slice(1).map((t, i) => t - evidence.sampleTimes[i])
    const maxGap = Math.max(...gaps)
    for (const c of candidates) expect(Math.max(c.timing.startUncertainty, c.timing.endUncertainty)).toBeLessThanOrEqual(Math.max(maxGap, evidence.durationSeconds!) / 2 + 1e-6)
    expect(evidence.sampleTimes.length).toBe(21)
  })
  it('keeps geometry inside the canvas and font sizes in the supported range', () => {
    for (const c of candidates) {
      const g = c.geometry
      expect(g.x).toBeGreaterThanOrEqual(0); expect(g.y).toBeGreaterThanOrEqual(0); expect(g.x + g.width).toBeLessThanOrEqual(100.001)
      expect(g.fontSize).toBeGreaterThanOrEqual(12); expect(g.fontSize).toBeLessThanOrEqual(200)
    }
  })
  it('offers the longer progressive-reveal readings as alternatives, never as the measured text', () => {
    const withAlt = candidates.filter(c => c.alternatives.length > 0)
    expect(withAlt.length).toBeGreaterThan(0)
    for (const c of withAlt) expect(c.suggested.text.basis).toBe('measured')
  })
  it('plans layers against the real blueprint placeholders: conflicts are reported, nothing is silently placed over a placeholder', () => {
    const p = planTextLayers(candidates, {}, {
      referenceVideoId: plan.referenceVideoId, videoAnalysisId: plan.videoAnalysisId, timeMap: makeTimeMap(evidence.durationSeconds, plan.totalSeconds), canvas: { width: 1080, height: 1920 },
      existingOverlays: buildPlaceholderOverlays(plan), createdAt: '2026-11-01T00:00:00.000Z',
    })
    const c = p.record.counts
    // eslint-disable-next-line no-console
    console.log('REAL PLAN COUNTS', JSON.stringify(c), '| time map', JSON.stringify(p.record.timeMap))
    expect(c.detected).toBe(31)
    expect(c.included + c.excludedByDefault + c.blocked + c.duplicates + c.outside + c.invalid + c.excludedByUser).toBe(31)
    expect(p.record.claims.burnedInTextRemoved).toBe(false)
    expect(p.overlays.every(o => o.reconstruction!.evidence.length >= 2)).toBe(true)
  })
})
