// Learn stage logic: no invented performance, assessments with evidence/confidence, recommendations that are grounded and qualified. Uses the REAL saved draft 9 (reference 5131) as the fixture.
import { describe, expect, it } from 'vitest'
import draft from './__fixtures__/draft9.learn-input.json'
import bpFx from '../../deconstructor/__fixtures__/ref5131.c4-blueprint.json'
import type { BlueprintResponse } from '../../../types/deconstructor'
import { buildBlueprintPlan } from '../blueprint/blueprintPlan'
import { aiStructure, assessProject, contrastRatio, type AssessInput } from './assessment'
import { buildRecommendations, INSUFFICIENT } from './recommendations'
import { METRIC_KEYS, parseVerifiedPerformance, PERFORMANCE_NOT_AVAILABLE } from './performance'

const plan = () => buildBlueprintPlan(JSON.parse(JSON.stringify(bpFx)) as BlueprintResponse, new Date('2026-11-14T00:00:00Z'))
const real = (over: Partial<AssessInput> = {}): AssessInput => ({ ...(JSON.parse(JSON.stringify(draft)) as Omit<AssessInput, 'plan'>), plan: plan(), ...over })
const allStrings = (o: unknown): string[] => (typeof o === 'string' ? [o] : Array.isArray(o) ? o.flatMap(allStrings) : o && typeof o === 'object' ? Object.values(o).flatMap(allStrings) : [])
const FORBIDDEN = /dropped off|performed best|viewers (will|loved|liked)|more engagement|higher retention|conversion rate|reach of|went viral|% (more|increase|improvement)/i

describe('A. verified performance', () => {
  const ok = { metrics: [{ key: 'views', value: 1200, source: 'Instagram Insights', periodStart: '2026-11-15', periodEnd: '2026-11-21' }] }

  it('is "Not available" when there is no data, and the sentence is the one specified', () => {
    expect(parseVerifiedPerformance(null)).toBeNull()
    expect(parseVerifiedPerformance(undefined)).toBeNull()
    expect(parseVerifiedPerformance({})).toBeNull()
    expect(parseVerifiedPerformance({ metrics: [] })).toBeNull()
    expect(PERFORMANCE_NOT_AVAILABLE).toBe('Not available — connect or import performance data after publishing.')
  })

  it('accepts complete data and keeps its source and period', () => {
    const p = parseVerifiedPerformance(ok)
    expect(p?.metrics[0]).toMatchObject({ key: 'views', label: 'Views', value: 1200, source: 'Instagram Insights', periodStart: '2026-11-15', periodEnd: '2026-11-21' })
  })

  it.each([
    ['no source', { ...ok.metrics[0], source: '' }], ['blank source', { ...ok.metrics[0], source: '   ' }], ['no period', { ...ok.metrics[0], periodStart: undefined }],
    ['reversed period', { ...ok.metrics[0], periodStart: '2026-11-22' }], ['bad date', { ...ok.metrics[0], periodEnd: 'last week' }], ['unknown metric', { ...ok.metrics[0], key: 'vibes' }],
    ['negative', { ...ok.metrics[0], value: -1 }], ['NaN', { ...ok.metrics[0], value: Number.NaN }], ['string value', { ...ok.metrics[0], value: '1200' }], ['percent over 100', { ...ok.metrics[0], key: 'ctr_pct', value: 140 }],
  ])('refuses a metric with %s, and shows nothing of the set', (_n, bad) => {
    expect(parseVerifiedPerformance({ metrics: [ok.metrics[0], bad] })).toBeNull()
    expect(parseVerifiedPerformance({ metrics: [bad] })).toBeNull()
  })

  it('only the documented metrics exist', () => {
    expect([...METRIC_KEYS]).toEqual(['views', 'reach', 'engagement', 'watch_time_seconds', 'avg_retention_pct', 'ctr_pct', 'conversions'])
  })
})

describe('B. content assessment of the real draft', () => {
  const a = assessProject(real())
  const f = (id: string) => a.findings.find(x => x.id === id)!

  it('measures the facts of the project', () => {
    expect(a.facts).toMatchObject({ durationSeconds: 12, clipCount: 4, distinctSources: 1, textCount: 4, audioTrackCount: 0, frameHeight: 1920 })
    expect(f('length').finding).toContain('12 s across 4 clips')
    expect(f('source_variety').finding).toContain('same source recording')
    expect(f('opening_text').finding).toContain('first frame')
  })

  it('every finding carries evidence, a confidence level and its reasoning, and says whether it was measured or is a rule of thumb', () => {
    for (const x of a.findings) {
      expect(x.evidence.length, x.id).toBeGreaterThan(0)
      expect(['high', 'medium', 'low']).toContain(x.confidence)
      expect(x.reasoning.length, x.id).toBeGreaterThan(20)
      expect(['measured', 'heuristic']).toContain(x.kind)
    }
    expect(f('reading_speed').kind).toBe('heuristic')
    expect(f('text_size').confidence).toBe('low')
  })

  it('never states an audience result', () => {
    expect(allStrings(a.findings).filter(s => FORBIDDEN.test(s))).toEqual([])
  })

  it('passes the AI blueprint structure through with its own confidence and limits, per scene', () => {
    const ai = aiStructure(plan())
    expect(ai.map(s => [s.scene, s.mechanisms.map(m => m.id)])).toEqual([[1, ['M01']], [2, ['M02']], [3, ['M02']], [4, ['M03']]])
    expect(ai.every(s => s.confidence && Array.isArray(s.limitations))).toBe(true)
    expect(aiStructure(null)).toEqual([])
  })

  it('computes contrast with the WCAG formula', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0)
    expect(contrastRatio('#777777', '#888888')!).toBeLessThan(1.5)
    expect(contrastRatio('red', '#fff')).toBeNull()
  })
})

describe('C. recommendations', () => {
  it('for the real draft one thing is measured (scene 1 text is read at 3.5 words/second) and everything else is a labelled hypothesis, each saying no viewer data exists', () => {
    const recs = buildRecommendations(assessProject(real()))
    expect(recs.map(r => r.key).sort()).toEqual(['alt-cta', 'alt-opening-hook', 'footage-variety', 'reading-speed-s1', 'shorter-cut', 'text-size-mobile'])
    expect(recs.filter(r => r.basis === 'evidence').map(r => r.key)).toEqual(['reading-speed-s1'])
    expect(recs.find(r => r.key === 'reading-speed-s1')!.evidence[0]).toBe('7 words in 2 s (3.5 words/second; the rule of thumb is about 3)')
    for (const r of recs) {
      expect(r.caveat, r.key).toMatch(/No viewer data|not checked on real devices|cannot be known|rule of thumb/i)
      expect(r.evidence.length, r.key).toBeGreaterThan(0)
    }
    for (const r of recs.filter(x => x.basis === 'hypothesis')) expect(r.caveat, r.key).toMatch(/No viewer data|not checked on real devices|cannot be known/i)
    expect(allStrings(recs).filter(s => FORBIDDEN.test(s))).toEqual([])
  })

  it('a measured problem becomes an evidence-based recommendation that cites its numbers and is still qualified', () => {
    const fastText = real({ texts: [{ text: 'one two three four five six seven eight nine ten', startTime: 0, endTime: 2, fontSize: 80, color: '#ffffff', bgColor: '#777777', bgOpacity: 0.9 }] })
    const recs = buildRecommendations(assessProject(fastText))
    const speed = recs.find(r => r.key.startsWith('reading-speed'))!
    const contrast = recs.find(r => r.key.startsWith('contrast'))!
    expect(speed.basis).toBe('evidence')
    expect(speed.evidence[0]).toContain('10 words in 2 s')
    expect(speed.caveat).toMatch(/rule of thumb/)
    expect(contrast.basis).toBe('evidence')
    expect(contrast.evidence[0]).toMatch(/Contrast \d/)
    expect(recs.find(r => r.key === 'text-size-mobile')).toBeUndefined()      // 80px on 1920 is fine, so no size hypothesis
  })

  it('keys are stable between runs so a recorded decision attaches to the same recommendation', () => {
    const k = () => buildRecommendations(assessProject(real())).map(r => r.key)
    expect(k()).toEqual(k())
  })

  it('says plainly what cannot be concluded', () => {
    expect(INSUFFICIENT.join(' ')).toMatch(/stop watching/)
    expect(INSUFFICIENT.join(' ')).toMatch(/call to action/)
  })

  it('a project with no text and no clips yields no invented findings', () => {
    const empty = assessProject({ canvas: { width: 1080, height: 1920 }, clips: [], texts: [], audioTrackCount: 0, plan: null })
    expect(empty.findings.map(x => x.id)).toEqual(['audio'])
    expect(buildRecommendations(empty).every(r => r.basis === 'hypothesis')).toBe(true)
  })
})
