// M2.4a -- the transition path: evidence is read and frozen; the classifier tells apart only what the measurements can show and says why; candidates line up with scene
// joins one to one; corrections stay apart; the draft merge changes only the clips whose end sits on a planned join and never claims the original effect.
import { describe, expect, it } from 'vitest'
import { buildTransitionCandidates, joinTolerance, sceneJoins } from './candidates'
import { classifyBoundary, extractFeatures } from './classify'
import { NO_CLAIMS } from './contract'
import { makeTimeMap, resolveTransition, setTransitionCorrection } from './corrections'
import { readTransitionEvidence } from './evidence'
import { CLIP_END_TOLERANCE, mergeTransitions, planTransitions, type TransitionClip } from './materialize'
import { CUT_TO_DARK, DISSOLVE, FADE_BLACK, FAST_MOTION, REAL_CUT, SHALLOW_DIP, evidenceFor, joinsFor, planWith, reference, summary } from './testkit'

const bd = (p = REAL_CUT) => evidenceFor([p]).boundaries[0]

describe('evidence', () => {
  it('reads the measured windows from the existing response and freezes them', () => {
    const e = evidenceFor([REAL_CUT, DISSOLVE])
    expect(e.boundaries.map(b => b.id)).toEqual([7002, 7001])                                  // in the order they occur: 10 s, then 39.87 s
    expect(e.boundaries[1]).toMatchObject({ boundary: 39.867, fps: 10 }); expect(Object.isFrozen(e)).toBe(true); expect(Object.isFrozen(e.boundaries[0].diff.values)).toBe(true)
  })
  it('does not touch the response, tolerates none, and skips a window too short or malformed to say anything', () => {
    const r = reference([REAL_CUT]); const before = JSON.stringify(r); readTransitionEvidence(r, 1); expect(JSON.stringify(r)).toBe(before)
    expect(readTransitionEvidence({ id: 1 }, 1).boundaries).toEqual([])
    const bad = { ...summary(REAL_CUT), luminance: { ...summary(REAL_CUT).luminance, values: [1, 2] } }
    expect(readTransitionEvidence({ id: 1, transition_evidence: [bad, { ...summary(DISSOLVE), sampling_fps: 0 }, { ...summary(DISSOLVE), frame_difference: { values: [], median: 0, max: 0, argmax_index: 0 } }] }, 1).boundaries).toEqual([])
  })
})

describe('classifier: only what the measurements can show', () => {
  it('reads the REAL VA5368 boundary as a hard cut, with high confidence and the numbers in plain words', () => {
    const c = classifyBoundary(bd())
    expect(c).toMatchObject({ kind: 'cut', confidence: 'high', durationSeconds: null })
    expect(c.features.spikeRatio).toBeGreaterThan(20); expect(c.features.spikeShare).toBeGreaterThan(0.6)
    expect(c.reasons.join(' ')).toMatch(/0\.155 against 0\.007/); expect(c.reasons.join(' ')).toMatch(/hard cut/)
  })
  it('reads several consecutive changing pairs with no dominant one as a dissolve, never above medium confidence, and says it may be motion', () => {
    const c = classifyBoundary(bd(DISSOLVE))
    expect(c).toMatchObject({ kind: 'dissolve', confidence: 'medium' }); expect(c.durationSeconds).toBeCloseTo(0.4, 2)
    expect(c.reasons.join(' ')).toMatch(/fast motion or a flash/i)
  })
  it('reads a dip to darkness that comes back, with a black frame inside, as a fade through black (high), and without a black frame as medium', () => {
    const c = classifyBoundary(bd(FADE_BLACK))
    expect(c).toMatchObject({ kind: 'fade_black', confidence: 'high' }); expect(c.durationSeconds).toBeGreaterThanOrEqual(0.2); expect(c.durationSeconds).toBeLessThanOrEqual(2)
    const shallow = classifyBoundary(bd({ ...SHALLOW_DIP, lum: [58, 58, 40, 12, 9, 14, 40, 58, 58, 58] }))
    expect(shallow).toMatchObject({ kind: 'fade_black', confidence: 'medium' })
  })
  it('does not mistake a cut TO a dark shot for a fade (the picture does not come back)', () => {
    expect(classifyBoundary(bd(CUT_TO_DARK)).kind).toBe('cut')
  })
  it('does not call a shallow brightness dip a fade through black', () => {
    expect(classifyBoundary(bd(SHALLOW_DIP)).kind).not.toBe('fade_black')
  })
  it('treats steady motion as no signature: a low-confidence hard cut, flagged, never a dissolve', () => {
    const c = classifyBoundary(bd(FAST_MOTION))
    expect(c).toMatchObject({ kind: 'cut', confidence: 'low' }); expect(c.reasons[0]).toMatch(/no clear signature/)
  })
  it('never proposes whip pan or zoom punch, on any profile', () => {
    for (const p of [REAL_CUT, DISSOLVE, FADE_BLACK, SHALLOW_DIP, FAST_MOTION, CUT_TO_DARK]) expect(['whip_pan', 'zoom_punch']).not.toContain(classifyBoundary(bd(p)).kind)
  })
  it('is deterministic and keeps every duration inside the editor’s sensible range', () => {
    for (const p of [DISSOLVE, FADE_BLACK]) { const a = classifyBoundary(bd(p)), b = classifyBoundary(bd(p)); expect(a).toEqual(b); expect(a.durationSeconds!).toBeGreaterThanOrEqual(0.2); expect(a.durationSeconds!).toBeLessThanOrEqual(2) }
  })
  it('extracts the features it explains itself with', () => {
    const f = extractFeatures(bd()); expect(f).toMatchObject({ pairs: 9, elevatedRun: 1 }); expect(f.lumMin).toBeCloseTo(13.49, 1); expect(f.blackInside).toBe(false)
  })
})

describe('candidates: one boundary per scene join, nearest first', () => {
  const ends = [8, 16, 24, 30]
  const joins = joinsFor(ends)
  it('lists a join for the end of every scene but the last', () => {
    expect(joins.map(j => [j.sceneNumber, j.nextSceneNumber, j.time])).toEqual([[1, 2, 8], [2, 3, 16], [3, 4, 24]])
    expect(sceneJoins(planWith([5]))).toEqual([])
  })
  it('maps a boundary onto the nearest join within the tolerance, and onto none when no join is close', () => {
    const map = makeTimeMap(30, 30)
    const near = buildTransitionCandidates(evidenceFor([{ ...DISSOLVE, at: 16.4 }]), joins, map)
    expect(near[0].join).toMatchObject({ sceneNumber: 2, nextSceneNumber: 3 }); expect(near[0].join!.distance).toBeCloseTo(0.4, 3)
    expect(buildTransitionCandidates(evidenceFor([{ ...DISSOLVE, at: 12 }]), joins, map)[0].join).toBeNull()          // 4 s from the nearest join
    expect(joinTolerance(30)).toBe(1.2); expect(joinTolerance(10)).toBe(0.75)
  })
  it('gives each join to at most one boundary, the nearer one, and each boundary to at most one join', () => {
    const map = makeTimeMap(30, 30)
    const both = buildTransitionCandidates(evidenceFor([{ ...DISSOLVE, id: 1, at: 16.6 }, { ...FADE_BLACK, id: 2, at: 16.1 }]), joins, map)
    expect(both.find(c => c.boundary.id === 2)!.join).toMatchObject({ sceneNumber: 2 }); expect(both.find(c => c.boundary.id === 1)!.join).toBeNull()
  })
  it('maps reference time onto the draft’s length (fit) before matching, and says so', () => {
    const fit = makeTimeMap(42.6, 30)
    const c = buildTransitionCandidates(evidenceFor([{ ...REAL_CUT, at: 39.866667 }]), joinsFor([8, 16, 24, 28.1, 30]), fit)[0]
    expect(c.planTime).toBeCloseTo(39.866667 * 30 / 42.6, 2); expect(c.join).toMatchObject({ sceneNumber: 4 }); expect(c.flags.map(f => f.code)).toEqual(expect.arrayContaining(['single_boundary', 'timing_mapped']))
  })
  it('includes confident suggestions by default and leaves a low-confidence one out; flags a dissolve as possibly motion', () => {
    const map = makeTimeMap(30, 30)
    const cs = buildTransitionCandidates(evidenceFor([REAL_CUT, DISSOLVE, FAST_MOTION].map((p, i) => ({ ...p, at: [8, 16, 24][i] }))), joins, map)
    expect(cs.map(c => c.defaultInclude)).toEqual([true, true, false]); expect(cs[1].flags.map(f => f.code)).toContain('possible_motion'); expect(cs[2].flags.map(f => f.code)).toContain('low_confidence')
  })
})

describe('corrections stay apart from the evidence', () => {
  const map = makeTimeMap(30, 30)
  const c = buildTransitionCandidates(evidenceFor([{ ...DISSOLVE, at: 16 }]), joinsFor([8, 16, 24, 30]), map)[0]
  it('labels the estimate inferred and a person’s choice user, and never mutates the candidate', () => {
    const before = JSON.stringify(c)
    const est = resolveTransition(c, undefined)
    expect(est.kind).toMatchObject({ value: 'dissolve', basis: 'inferred', confidence: 'medium' }); expect(est.duration.basis).toBe('inferred')
    const mine = resolveTransition(c, { kind: 'whip_pan', duration: 0.8 })
    expect(mine.kind).toMatchObject({ value: 'whip_pan', basis: 'user' }); expect(mine.duration).toMatchObject({ value: 0.8, basis: 'user' }); expect(mine.corrected).toEqual(['transition', 'transitionDuration'])
    expect(JSON.stringify(c)).toBe(before)
  })
  it('clamps a duration to the editor’s range and ignores a malformed choice', () => {
    expect(resolveTransition(c, { duration: 9 }).duration.value).toBe(2); expect(resolveTransition(c, { duration: 0.01 }).duration.value).toBe(0.2)
    const bad = resolveTransition(c, { kind: 'wipe' as never, duration: Number.NaN })
    expect(bad.kind.basis).toBe('inferred'); expect(bad.ignored).toEqual(['transition', 'transitionDuration'])
  })
  it('sets and clears corrections immutably', () => {
    const a = setTransitionCorrection({}, c.id, { include: false }); expect(a).toEqual({ [c.id]: { include: false } })
    expect(setTransitionCorrection(a, c.id, { include: undefined })).toEqual({}); expect(a).toEqual({ [c.id]: { include: false } })
  })
})

describe('plan and merge', () => {
  const map = makeTimeMap(30, 30)
  const ctx = { referenceVideoId: 5127, videoAnalysisId: 5368, timeMap: map, createdAt: '2026-10-30T00:00:00.000Z' }
  const cands = buildTransitionCandidates(evidenceFor([{ ...DISSOLVE, id: 1, at: 8 }, { ...FADE_BLACK, id: 2, at: 16 }, { ...REAL_CUT, id: 3, at: 21 }, { ...FAST_MOTION, id: 4, at: 24 }]), joinsFor([8, 16, 24, 30]), map)
  const clip = (s: number, e: number): TransitionClip => ({ startTime: s, endTime: e, transition: 'cut', transitionDuration: 0.5 })
  const snap = () => ({ name: 'draft', videoClips: [clip(0, 8), clip(8, 16), clip(16, 24), clip(24, 30)] })
  it('plans exactly the included, joined decisions and says what each does', () => {
    const p = planTransitions(cands, {}, ctx)
    expect(p.changes.map(c => [c.sceneNumber, c.kind])).toEqual([[1, 'dissolve'], [2, 'fade_black']])           // the cut at 21 s is 3 s from any join; the motion profile is low confidence
    const by = new Map(p.items.map(i => [i.candidateId, i] as const))
    expect(by.get('tb:3')).toMatchObject({ status: 'no_join' }); expect(by.get('tb:4')).toMatchObject({ status: 'excluded_default' })
    expect(by.get('tb:1')!.message).toMatch(/Scene 1 → 2 will use a dissolve of 0\.4 s/)
    expect(p.record.counts).toEqual({ measured: 4, applied: 2, excluded: 1, noJoin: 1 })
  })
  it('a person can include the leftover, choose another type, or leave one out', () => {
    const p = planTransitions(cands, { 'tb:4': { include: true, kind: 'zoom_punch', duration: 0.7 }, 'tb:1': { include: false } }, ctx)
    expect(p.changes.map(c => [c.sceneNumber, c.kind, c.duration])).toEqual([[2, 'fade_black', expect.any(Number)], [3, 'zoom_punch', 0.7]])
    expect(p.items.find(i => i.candidateId === 'tb:1')!.status).toBe('excluded_user')
  })
  it('sets the transition on the clip that ENDS on each join, keeps everything else, and attaches the record', () => {
    const p = planTransitions(cands, {}, ctx)
    const out = mergeTransitions(snap(), p) as ReturnType<typeof snap> & { transitionReconstruction: { unmatched: number[]; claims: unknown } }
    expect(out.videoClips.map(c => c.transition)).toEqual(['dissolve', 'fade_black', 'cut', 'cut']); expect(out.videoClips[0].transitionDuration).toBeCloseTo(0.4, 2)
    expect(out.videoClips.map(c => [c.startTime, c.endTime])).toEqual(snap().videoClips.map(c => [c.startTime, c.endTime])); expect(out.name).toBe('draft')
    expect(out.transitionReconstruction.unmatched).toEqual([]); expect(out.transitionReconstruction.claims).toEqual(NO_CLAIMS)
  })
  it('does not change the snapshot it is given, and returns it untouched when there is nothing to apply', () => {
    const s = snap(); const before = JSON.stringify(s)
    mergeTransitions(s, planTransitions(cands, {}, ctx)); expect(JSON.stringify(s)).toBe(before)
    expect(mergeTransitions(s, null)).toBe(s); expect(mergeTransitions(s, planTransitions(cands, { 'tb:1': { include: false }, 'tb:2': { include: false } }, ctx))).toBe(s)
  })
  it('reports a decision whose join has no clip end near it, and never touches the last clip', () => {
    const shifted = { videoClips: [clip(0, 7), clip(7, 16), clip(16, 24), clip(24, 30)] }
    const out = mergeTransitions(shifted, planTransitions(cands, {}, ctx)) as typeof shifted & { transitionReconstruction: { unmatched: number[] } }
    expect(out.transitionReconstruction.unmatched).toEqual([1]); expect(out.videoClips.map(c => c.transition)).toEqual(['cut', 'fade_black', 'cut', 'cut'])
    const lastJoin = planTransitions(buildTransitionCandidates(evidenceFor([{ ...DISSOLVE, id: 9, at: 30 }]), [{ sceneNumber: 4, nextSceneNumber: 5, time: 30 }], map), {}, ctx)
    expect((mergeTransitions({ videoClips: [clip(0, 30)] }, lastJoin) as { videoClips: TransitionClip[] }).videoClips[0].transition).toBe('cut')
    expect(CLIP_END_TOLERANCE).toBeLessThan(0.1)
  })
  it('a chosen hard cut keeps the clip’s own duration; every decision names its basis; the record claims nothing about the original effect', () => {
    const p = planTransitions(cands, { 'tb:2': { kind: 'cut' } }, ctx)
    const out = mergeTransitions(snap(), p) as ReturnType<typeof snap>
    expect(out.videoClips[1]).toMatchObject({ transition: 'cut', transitionDuration: 0.5 })
    expect(p.changes[0].basis).toEqual({ kind: 'inferred', duration: 'inferred', confidence: 'medium' }); expect(p.changes[1].basis.kind).toBe('user')
    expect(p.record.claims).toEqual({ originalEffectRecovered: false, originalSettingsRecovered: false }); expect(JSON.stringify(p.record)).not.toMatch(/"(originalEffectRecovered|originalSettingsRecovered)":true/)
  })
  it('the signature changes when what a save would write changes', () => {
    expect(planTransitions(cands, {}, ctx).signature).not.toBe(planTransitions(cands, { 'tb:1': { kind: 'fade_black' } }, ctx).signature)
    expect(planTransitions(cands, {}, ctx).signature).toBe(planTransitions(cands, {}, ctx).signature)
  })
})
