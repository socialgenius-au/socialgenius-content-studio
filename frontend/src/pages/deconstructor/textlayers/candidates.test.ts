// M2.1a -- the candidate engine: extraction, confidence, flags, default exclusions, alternatives, appearance, de-duplication, determinism.
import { describe, expect, it } from 'vitest'
import type { Appearance } from './appearance'
import { buildTextCandidates, DEFAULT_TEXT_COLOR, LOW_CONFIDENCE } from './candidates'
import { readTextEvidence } from './evidence'
import { CAST, candidatesFor, reference, type TextSpec } from './testkit'

const byId = (cs: ReturnType<typeof candidatesFor>['candidates'], n: number) => cs.find(c => c.id === `text:${n}`)!
const codes = (c: { flags: { code: string }[] }) => c.flags.map(f => f.code)

describe('extraction', () => {
  const { candidates } = candidatesFor()
  it('makes one candidate per evidence group, with a stable id derived from the evidence', () => {
    expect(candidates).toHaveLength(CAST.length)
    expect(candidates.map(c => c.id).sort()).toEqual(CAST.map(c => `text:${c.id}`).sort())
  })
  it('keeps the OCR reading and its confidence exactly as measured', () => {
    const c = byId(candidates, 1)
    expect(c.sourceText).toBe('Welcome to the show')
    expect(c.sourceConfidence).toBe(0.92)
    expect(c.suggested.text).toMatchObject({ value: 'Welcome to the show', basis: 'measured' })
  })
  it('points back at every piece of evidence it came from (the group and each raw observation)', () => {
    const c = byId(candidates, 1)
    expect(c.evidence).toEqual([{ kind: 'ocr_group', id: 1 }, { kind: 'ocr_observation', id: 100 }, { kind: 'ocr_observation', id: 101 }])
    expect(c.group.observations.map(o => o.id)).toEqual([100, 101])
  })
  it('is deterministic: the same evidence gives the same candidates', () => {
    const again = candidatesFor().candidates
    expect(JSON.stringify(again)).toBe(JSON.stringify(candidates))
  })
  it('works on frozen evidence without editing it', () => {
    const { evidence } = candidatesFor()
    expect(Object.isFrozen(evidence)).toBe(true)
    expect(() => buildTextCandidates(evidence)).not.toThrow()
    expect(Object.isFrozen(evidence.groups[0])).toBe(true)
  })
})

describe('confidence and what is left out by default', () => {
  const { candidates } = candidatesFor()
  it('includes a confident, ordinary caption by default', () => {
    const c = byId(candidates, 1)
    expect(c.defaultInclude).toBe(true)
    expect(codes(c)).not.toContain('low_confidence')
  })
  it('flags and leaves out low-confidence readings (below the stated threshold)', () => {
    const c = byId(candidates, 5)
    expect(c.sourceConfidence!).toBeLessThan(LOW_CONFIDENCE)
    expect(c.defaultInclude).toBe(false)
    expect(codes(c)).toContain('low_confidence')
    expect(c.flags.find(f => f.code === 'low_confidence')!.message).toMatch(/31%/)
  })
  it('flags and leaves out a single stray character', () => {
    const c = byId(candidates, 4)
    expect(codes(c)).toContain('fragment')
    expect(c.defaultInclude).toBe(false)
  })
  it('treats an unreported confidence as not trustworthy rather than as a perfect reading', () => {
    const e = readTextEvidence(reference({ texts: [{ ...CAST[0], conf: null }] }), 1)
    const [c] = buildTextCandidates(e)
    expect(c.defaultInclude).toBe(false)
    expect(codes(c)).toContain('low_confidence')
  })
})

describe('third-party branding is excluded by default, with the reason', () => {
  const branded = (text: string, extra: Partial<TextSpec> = {}, recurring: { id: number; members: number[] }[] = []) =>
    buildTextCandidates(readTextEvidence(reference({ texts: [{ id: 50, text, box: [0.65, 0.28, 0.25, 0.03], conf: 0.95, obs: [{ t: 3 }], ...extra }], recurring }), 1))[0]
  it('an account handle', () => {
    const c = branded('@creator_name')
    expect(c.branding).toContain('handle'); expect(c.defaultInclude).toBe(false); expect(codes(c)).toContain('third_party_branding')
    expect(c.flags.find(f => f.code === 'third_party_branding')!.message).toMatch(/account handle/)
  })
  it('a handle whose "@" was read as a letter (underscore or digit still gives it away)', () => {
    expect(branded('GTANUCREATES_O').branding).toContain('handle')
    expect(branded('creator99x').branding).toContain('handle')
  })
  it('a web address', () => { expect(branded('Visit www.shop.example').branding).toContain('url'); expect(branded('buy at shop.com').branding).toContain('url') })
  it('a platform name', () => expect(branded('Follow us on Instagram').branding).toContain('platform_name'))
  it('anything the analysis linked as the same element reappearing (a watermark)', () => {
    const c = branded('Join the club', {}, [{ id: 9, members: [50] }])
    expect(c.branding).toEqual(['recurring_element']); expect(c.defaultInclude).toBe(false)
  })
  it('does not mistake ordinary captions for branding', () => {
    for (const t of ['Welcome to the show', 'Ki Duniya Badal', 'Hello', 'Great Offer', '10 tips for 2026']) expect(branded(t).branding, t).toEqual([])
  })
  it('a person can still choose to include it (the exclusion is a default, not a block)', () => {
    expect(branded('@creator_name').defaultInclude).toBe(false)   // included only through a correction -- see corrections.test.ts / materialize.test.ts
  })
})

describe('timing uncertainty', () => {
  const { candidates } = candidatesFor()
  it('flags uncertain timing and states the size of the doubt', () => {
    const f = byId(candidates, 1).flags.find(x => x.code === 'timing_uncertain')!
    expect(f.severity).toBe('warning'); expect(f.message).toMatch(/up to about 1\.5 s/)
  })
  it('says when a text was only read once', () => {
    expect(codes(byId(candidates, 2))).toContain('single_observation')
    expect(codes(byId(candidates, 1))).not.toContain('single_observation')
  })
  it('keeps the measured first/last reading apart from the inferred start/end', () => {
    const t = byId(candidates, 1).timing
    expect([t.observedFirst, t.observedLast]).toEqual([3, 6])
    expect(t.start).toBeLessThan(3); expect(t.end).toBeGreaterThan(6)
  })
})

describe('alternative readings (progressive caption reveals, misreads)', () => {
  const { candidates } = candidatesFor()
  it('offers other distinct readings of the same text, best first, and never replaces the measured one', () => {
    const c = byId(candidates, 3)
    expect(c.sourceText).toBe('Ki Dun')
    expect(c.alternatives).toEqual([{ text: 'Ki Duniya Badal', observationId: 301, confidence: 0.7 }])
    expect(codes(c)).toContain('alternate_readings')
    expect(c.suggested.text.value).toBe('Ki Dun')
  })
  it('has none to offer when every reading agrees', () => { expect(byId(candidates, 1).alternatives).toEqual([]) })
})

describe('appearance', () => {
  const app = (over: Partial<Appearance>): Appearance => ({ textColor: '#f5f5f5', backdropColor: '#1c1c1c', confidence: 'high', separation: 200, notes: ['light on dark'], ...over })
  it('never applies the stored colour pair', () => {
    const c = byId(candidatesFor().candidates, 1)
    expect(c.suggested.color.value).not.toBe('#1e1e1e')
    expect(c.suggested.color).toMatchObject({ value: DEFAULT_TEXT_COLOR, basis: 'default' })
    expect(codes(c)).toContain('colour_unknown')
  })
  it('uses a pixel-based estimate when it is confident, and labels it inferred', () => {
    const { candidates } = candidatesFor({}, { appearances: new Map([[1, app({})]]) })
    const c = byId(candidates, 1)
    expect(c.suggested.color).toMatchObject({ value: '#f5f5f5', basis: 'inferred', confidence: 'high' })
    expect(codes(c)).not.toContain('colour_unknown')
  })
  it('falls back to the default, and says so, when the estimate is weak', () => {
    const { candidates } = candidatesFor({}, { appearances: new Map([[1, app({ confidence: 'low', notes: ['cues disagree'] })]]) })
    const c = byId(candidates, 1)
    expect(c.suggested.color).toMatchObject({ value: DEFAULT_TEXT_COLOR, basis: 'default' })
    expect(c.suggested.color.note).toMatch(/cues disagree/)
  })
})

describe('de-duplication', () => {
  const twice = (second: Partial<TextSpec>) => buildTextCandidates(readTextEvidence(reference({ texts: [
    { id: 1, text: 'Same words here', box: [0.1, 0.75, 0.5, 0.035], conf: 0.7, obs: [{ t: 3 }] },
    { id: 2, text: 'same  words here', box: [0.105, 0.752, 0.5, 0.035], conf: 0.9, obs: [{ t: 3 }], ...second },
  ] }), 1))
  it('keeps the better reading of the same wording at the same place and time, and leaves the other out by default', () => {
    const [a, b] = twice({})
    expect(b.defaultInclude).toBe(true); expect(a.defaultInclude).toBe(false)
    expect(codes(a)).toContain('duplicate_candidate'); expect(a.flags.find(f => f.code === 'duplicate_candidate')!.message).toMatch(/text:2/)
  })
  it('keeps both when the wording is the same but the place is different', () => {
    const [a, b] = twice({ box: [0.1, 0.2, 0.5, 0.035] })
    expect([a.defaultInclude, b.defaultInclude]).toEqual([true, true])
  })
  it('keeps both when the same words appear at a different time', () => {
    const [a, b] = twice({ obs: [{ t: 33 }] })
    expect([a.defaultInclude, b.defaultInclude]).toEqual([true, true])
  })
})
