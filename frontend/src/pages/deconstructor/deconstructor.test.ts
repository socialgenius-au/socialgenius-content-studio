import { describe, it, expect } from 'vitest'
import statusFx from './__fixtures__/va5368.c1-status.json'
import anatomyFx from './__fixtures__/va5368.c2-anatomy.redacted.json'
import mechFx from './__fixtures__/va5368.c3-mechanisms.json'
import bpFx from './__fixtures__/va5368.c4-blueprint.json'
import type { Anatomy, BlueprintResponse, DeconStatus, MechanismSet } from '../../types/deconstructor'
import type { ReferenceVideo } from '../../types'
import {
  anatomyCard, anatomyOverview, anatomyReady, blueprintSectionCards, blueprintSummary, friendlyStageLabel, mechanismsView, partitionGaps,
  referenceCard, summarizeDeconStatus, fmtTime,
} from './viewModel'
import { emptyIntentForm, splitLines, validateIntentForm } from './intentForm'

const clone = <T,>(x: unknown) => JSON.parse(JSON.stringify(x)) as T
const anatomy = () => clone<Anatomy>(anatomyFx)
const mech = () => clone<MechanismSet>(mechFx)
const bp = () => clone<BlueprintResponse>(bpFx)

describe('reference card', () => {
  const base = { id: 5127, original_filename: 'clip.mp4', created_at: '2026-01-01', shots: [], technical_details: null, latest_analysis: { status: 'complete' } } as unknown as ReferenceVideo
  it('shows title, status and duration; tolerates missing thumbnail / technical details', () => {
    const c = referenceCard(base)
    expect(c).toMatchObject({ title: 'clip.mp4', status: 'ready', statusLabel: 'Analysed', durationSeconds: null, thumbnailPath: null })
  })
  it('uses the first shot frame as thumbnail and reads duration', () => {
    const v = { ...base, technical_details: { container: { duration_seconds: 30.4 } }, shots: [{ frames: [{ asset_file_path: 'uploads/1/f.jpg' }] }] } as unknown as ReferenceVideo
    expect(referenceCard(v)).toMatchObject({ durationSeconds: 30.4, thumbnailPath: 'uploads/1/f.jpg' })
  })
  it('maps running / failed / pending', () => {
    for (const [st, want] of [['running', 'running'], ['failed', 'failed'], ['pending', 'pending']] as const) {
      expect(referenceCard({ ...base, latest_analysis: { status: st } } as unknown as ReferenceVideo).status).toBe(want)
    }
  })
})

describe('C1 status rendering', () => {
  it('hides technical stage numbers in labels', () => {
    expect(friendlyStageLabel('Retention devices (Stage 11.4)')).toBe('Retention devices')
    expect(friendlyStageLabel('Scenes and Story Beats (Stage 10)')).toBe('Scenes and Story Beats')
    expect(friendlyStageLabel('Hook window (Stage 11.2)')).toBe('Hook window')
    expect(friendlyStageLabel('Keyframes')).toBe('Keyframes')
  })
  it('summarises the real VA5368 status without crashing and without stage numbers', () => {
    const p = summarizeDeconStatus(statusFx as unknown as DeconStatus)
    expect(p.total).toBe(19)
    expect(p.state).toBe('done')
    expect(p.done).toBeGreaterThan(0)
    expect(JSON.stringify(p)).not.toMatch(/Stage\s*\d/)
  })
  it('reports running, failed and null', () => {
    const s = clone<DeconStatus>(statusFx)
    s.orchestration = { status: 'running' }; s.stages[2].status = 'running'
    expect(summarizeDeconStatus(s)).toMatchObject({ state: 'running', current: s.stages[2].label })
    const f = clone<DeconStatus>(statusFx); f.stages[0].status = 'failed'; f.stages[0].error = 'boom'
    const pf = summarizeDeconStatus(f)
    expect(pf.state).toBe('failed'); expect(pf.failures[0].error).toBe('boom')
    expect(summarizeDeconStatus(null).state).toBe('not_started')
  })
})

describe('anatomy (C2)', () => {
  const a = anatomy()
  it('is ready for the real anatomy; not ready when missing/empty', () => {
    expect(anatomyReady(a)).toBe(true)
    expect(anatomyReady(null)).toBe(false)
    expect(anatomyReady({ ...a, sections: [] })).toBe(false)
  })
  it('builds a readable card for every section with time range, role, pacing and retention evidence', () => {
    for (const s of a.sections) {
      const c = anatomyCard(s)
      expect(c.timeRange).toMatch(/\d:\d\d\.\d – \d:\d\d\.\d/)
      expect(c.whatHappens.length).toBeGreaterThan(0)
      expect(c.role.length).toBeGreaterThan(0)
      expect(c.pacing).toMatch(/shot/)
      expect(c.retention.length).toBeGreaterThan(0)
      const text = [c.timeRange, c.role, c.visual, c.audio, c.pacing, c.retention, ...c.whatHappens, ...c.onScreenText]
      expect(text.some(t => /^\s*(\{|\[\s*\{)/.test(t))).toBe(false)   // no raw JSON in primary card content
    }
  })
  it('zero retention devices is explained, not blank or a crash', () => {
    const ov = anatomyOverview(a)
    expect(a.video.retention.accepted_count).toBe(0)
    expect(ov.retention).toMatch(/No retention devices were confirmed/)
    expect(anatomyCard(a.sections[0]).retention).toMatch(/No retention device confirmed/)
  })
  it('section 1 is the opening inside the hook window', () => {
    expect(anatomyCard(a.sections[0]).role).toBe('Opening — inside the hook window')
  })
  it('tolerates missing optional evidence (no speech/text/objects)', () => {
    const s = clone<Anatomy>(anatomyFx).sections[0]
    s.speech = []; s.on_screen_text = []; s.visual.objects = []; s.transcript_excerpt = null; s.rejected_candidates = []
    const c = anatomyCard(s)
    expect(c.whatHappens[0]).toMatch(/No speech, text or recognised objects/)
    expect(c.transcript).toBeNull()
  })
  it('lists deduplicated gaps behind a disclosure list', () => {
    const ov = anatomyOverview(a)
    expect(new Set(ov.gaps).size).toBe(ov.gaps.length)
  })
})

describe('mechanisms (C3)', () => {
  it('renders 4 real mechanisms as cards with type, principle, where, what must not be copied and confidence', () => {
    const v = mechanismsView(mech())
    expect(v.state).toBe('current')
    expect(v.cards.map(c => c.id)).toEqual(['M01', 'M02', 'M03', 'M04'])
    const m01 = v.cards[0]
    expect(m01.typeLabel).toBe('Hook / curiosity')
    expect(m01.principle.length).toBeGreaterThan(0)
    expect(m01.whereItAppears).toMatch(/Section 1/)
    expect(m01.mustNotCopy.length).toBeGreaterThan(0)
    expect(m01.confidence).toBe('Medium confidence')
    expect(v.cards[3].whereItAppears).toBe('Across the whole video')
  })
  it('none / not_run / empty -> derive prompt state; stale carries a warning', () => {
    expect(mechanismsView(null).state).toBe('none')
    expect(mechanismsView({ ...mech(), status: 'not_run', mechanisms: [] }).state).toBe('none')
    const st = mechanismsView({ ...mech(), status: 'stale' })
    expect(st.state).toBe('stale'); expect(st.message).toMatch(/earlier version/)
  })
})

describe('intent form validation (C4 contract)', () => {
  const good = { ...emptyIntentForm(), product: 'choosing tiles', audience: 'homeowners', objective: 'help them choose' }
  it('requires product, audience and objective', () => {
    const v = validateIntentForm(emptyIntentForm())
    expect(v.ok).toBe(false)
    expect(Object.keys(v.errors).sort()).toEqual(['audience', 'objective', 'product'])
    expect(v.intent).toBeNull()
  })
  it('rejects whitespace-only and too-short required fields', () => {
    expect(validateIntentForm({ ...good, product: '   ' }).errors.product).toMatch(/required/)
    expect(validateIntentForm({ ...good, product: 'ab' }).errors.product).toMatch(/at least 3/)
  })
  it('accepts the minimum and does NOT invent optional fields', () => {
    const v = validateIntentForm(good)
    expect(v.ok).toBe(true)
    expect(v.intent).toEqual({
      product_service_or_topic: 'choosing tiles', target_audience: 'homeowners', objective: 'help them choose', business_or_brand: null, desired_cta: null,
      tone_style_constraints: [], duration_platform_constraints: null, mandatory_points: [], prohibited_claims_or_elements: [],
    })
  })
  it('enforces length limits and list limits', () => {
    expect(validateIntentForm({ ...good, objective: 'x'.repeat(301) }).errors.objective).toMatch(/at most 300/)
    expect(validateIntentForm({ ...good, mandatory: Array.from({ length: 21 }, (_, i) => `point ${i}`).join('\n') }).errors.mandatory).toMatch(/at most 20/)
    expect(validateIntentForm({ ...good, prohibited: 'y'.repeat(251) }).errors.prohibited).toMatch(/at most 250/)
  })
  it('dedupes list items and rejects a mandatory point that is also prohibited', () => {
    expect(splitLines('  A  \n\na\nB')).toEqual(['A', 'B'])
    expect(validateIntentForm({ ...good, mandatory: 'Show price', prohibited: 'show price' }).errors.mandatory).toMatch(/cannot also be prohibited/)
  })
  it('validates duration bounds', () => {
    expect(validateIntentForm({ ...good, durationSeconds: '2' }).errors.durationSeconds).toMatch(/between 3 and 600/)
    expect(validateIntentForm({ ...good, durationSeconds: '601' }).errors.durationSeconds).toMatch(/between 3 and 600/)
    expect(validateIntentForm({ ...good, durationSeconds: 'abc' }).errors.durationSeconds).toMatch(/number/)
    const v = validateIntentForm({ ...good, durationSeconds: '30', platform: 'Reels' })
    expect(v.intent?.duration_platform_constraints).toEqual({ platform: 'Reels', target_duration_seconds: 30, notes: null })
  })
})

describe('blueprint view (C4) with the real persisted blueprint', () => {
  const r = bp(), b = r.blueprint!
  it('renders 7 section cards in order with role, purpose, duration and instruction', () => {
    const cards = blueprintSectionCards(b)
    expect(cards.map(c => c.number)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(cards.map(c => c.role)).toEqual(['Opening', 'Contrast', 'Contrast', 'Development', 'Development', 'Closing', 'Call to action'])
    for (const c of cards) { expect(c.contentInstruction.length).toBeGreaterThan(0); expect(c.duration).toMatch(/s$/); expect(c.directions.length).toBeGreaterThan(0) }
  })
  it('shows mechanisms per card from section.mechanisms_applied only', () => {
    const cards = blueprintSectionCards(b)
    b.sections.forEach((s, i) => expect(cards[i].mechanisms.map(m => m.id)).toEqual(s.mechanisms_applied))
    // sections 2/3 carry the controlled contrast mechanism
    expect(cards[1].mechanisms.map(m => m.id)).toContain('M02')
    expect(cards[2].mechanisms.map(m => m.id)).toContain('M02')
  })
  it('section 7 carries the CTA; other sections do not render a CTA badge', () => {
    const cards = blueprintSectionCards(b)
    expect(cards[6].cta).toBeTruthy()
    expect(cards.slice(0, 6).every(c => !c.cta)).toBe(true)
  })
  it('summary: structural approach, platform, duration, used / not-used mechanisms and constraints', () => {
    const s = blueprintSummary(b)
    expect(s.structuralApproach.length).toBeGreaterThan(0)
    expect(s.platform).toBe('short-form social video')
    expect(s.duration).toMatch(/30s planned \(no target set\)/)
    expect(s.mechanismsUsed.map(m => m.id)).toEqual(['M01', 'M02', 'M03', 'M04'])
    expect(s.mechanismsNotUsed).toEqual([])
    expect(s.constraints.some(c => c.startsWith('Avoid: '))).toBe(true)
  })
  it('quality gaps are separated from limitations and never crash the view', () => {
    const { limitations, qualityNotes } = partitionGaps(b.gaps)
    expect(qualityNotes.length).toBeGreaterThanOrEqual(3)     // all_mechanisms_used + mapping mismatches + rationale note
    expect(limitations.length).toBeGreaterThan(0)
    expect(qualityNotes.some(n => /not reconciled/.test(n))).toBe(true)
    expect(() => blueprintSummary({ ...b, gaps: [{ field: 'x', kind: 'some_future_kind', reason: 'r' }] })).not.toThrow()
    expect(() => blueprintSummary({ ...b, gaps: [], limitations: [], mechanisms_not_used: [] })).not.toThrow()
  })
  it('handles a blueprint with no CTA, no transition and no mechanisms', () => {
    const lean = clone<BlueprintResponse>(bpFx).blueprint!
    for (const s of lean.sections) { s.cta_direction = null; s.transition_direction = null; s.mechanisms_applied = []; s.mandatory_points_assigned = [] }
    const cards = blueprintSectionCards(lean)
    expect(cards).toHaveLength(7)
    expect(cards.every(c => !c.cta && c.mechanisms.length === 0)).toBe(true)
  })
})

describe('formatting', () => {
  it('formats times', () => { expect(fmtTime(0)).toBe('0:00.0'); expect(fmtTime(65.25)).toBe('1:05.3'); expect(fmtTime(null)).toBe('—') })
})
