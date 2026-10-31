// M2.2a -- REAL-DATA validation against the actual VA5368 analysis. LOCAL ONLY: it runs when M2_REAL_VISUAL_EVIDENCE points at a JSON file shaped like the
// reference-video response (frames and visual objects; kept outside the repository because it describes a third-party video). Skipped in CI and on a fresh checkout.
// It asserts what we CLAIM from the real data, not exact numbers: counts, exclusions, timing bounds, geometry limits, proportions, immutability.
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { ReferenceVideo } from '../../../types'
import { buildImageCandidates, type ManualRegion } from './candidates'
import { makeTimeMap } from './corrections'
import { readImageEvidence } from './evidence'
import { boxAspect } from './geometry'
import { mergeImageLayers, planImageLayers } from './materialize'
import { uploaded } from './testkit'

const file = process.env.M2_REAL_VISUAL_EVIDENCE
const run = !!file && existsSync(file)
const d = run ? describe : describe.skip

d('real VA5368 visual evidence (local only)', () => {
  const ref = run ? (JSON.parse(readFileSync(file!, 'utf8')) as ReferenceVideo) : (null as never)
  const before = run ? JSON.stringify(ref) : ''
  const analysisId = run ? ((ref as unknown as { latest_analysis: { id: number } }).latest_analysis.id) : 0
  const evidence = run ? readImageEvidence(ref, analysisId) : (null as never)
  const manual: ManualRegion[] = run ? evidence.frames.map((f, i) => ({ id: `user:${f.id}:${i}`, frameId: f.id, region: { x: 0.62, y: 0.04, w: 0.3, h: 0.1 } })) : []
  const candidates = run ? buildImageCandidates(evidence, manual) : []
  const map = run ? makeTimeMap(evidence.durationSeconds, 42.6) : (null as never)
  const ctx = { referenceVideoId: ref?.id ?? 0, videoAnalysisId: analysisId, timeMap: map, canvas: { width: 1080, height: 1920 }, referenceRightsStatus: ref?.rights_status ?? null, existingOverlays: [], createdAt: '2026-10-30T00:00:00.000Z' }

  it('reads the 9 sampled stills and the 9 detections without touching the analysis', () => {
    expect(evidence.frames).toHaveLength(9); expect(evidence.detections).toHaveLength(9)
    expect(evidence.frameSize).toEqual({ width: 480, height: 864 })
    expect(JSON.stringify(ref)).toBe(before)
    expect(Object.isFrozen(evidence)).toBe(true)
  })
  it('finds only people: no logo, product or graphic, and says so by leaving them all out of the draft by default', () => {
    expect(evidence.detections.every(x => x.category === 'person' && x.label === 'person')).toBe(true)
    const detected = candidates.filter(c => c.origin === 'detected_region')
    expect(detected).toHaveLength(9)
    expect(detected.every(c => !c.defaultInclude && c.flags.some(f => f.code === 'person_detected'))).toBe(true)
    expect(planImageLayers(detected, {}, {}, ctx).overlays).toEqual([])
  })
  it('puts a drawn region on every sampled still, each timed inside its own scene', () => {
    const drawn = candidates.filter(c => c.origin === 'user_region')
    expect(drawn).toHaveLength(9)
    for (const c of drawn) {
      expect(c.timing.start).toBeGreaterThanOrEqual(c.frame.shotStart - 1e-6)
      expect(c.timing.end - c.timing.start).toBeGreaterThanOrEqual(0.5 - 1e-9)
      expect(c.timing.observedAt).toBe(c.frame.timestamp)
    }
  })
  it('turns a drawn region plus an uploaded transparent logo into a layer that keeps the logo’s proportions inside the region', () => {
    const only = candidates.filter(c => c.origin === 'user_region').slice(0, 1)
    const p = planImageLayers(only, {}, { [only[0].id]: uploaded({ width: 800, height: 400 }) }, ctx)
    expect(p.overlays).toHaveLength(1)
    const o = p.overlays[0]
    expect(boxAspect(o, ctx.canvas)).toBeCloseTo(2, 2)
    expect(o.x).toBeGreaterThanOrEqual(62 - 1e-6); expect(o.x + o.width).toBeLessThanOrEqual(92 + 1e-6)
    expect(o.reconstruction!.claims).toEqual({ isolated: false, backgroundRemoved: false, burnedInContentRemoved: false, originalResolutionRecovered: false })
    const merged = mergeImageLayers({ mediaOverlays: [] as never[] }, p) as unknown as { mediaOverlays: unknown[] }
    expect(merged.mediaOverlays).toHaveLength(1)
  })
})
