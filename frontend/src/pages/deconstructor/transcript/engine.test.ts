// M2.5a -- the transcript path: evidence is read and frozen; candidates are flagged honestly (quality, whose words, which scripts the exporter cannot draw); corrections stay apart;
// the plan makes native subtitles and a per-scene script with provenance; merging is idempotent; nothing claims the words are right or the voice recovered.
import { describe, expect, it } from 'vitest'
import type { SubtitleSegment } from '../../../types'
import { buildSpeechCandidates } from './candidates'
import { DEFAULT_SUBTITLE_BOX, NO_CLAIMS, unsupportedScript } from './contract'
import { makeTimeMap, resolveSpeech, setAllIncluded, setSpeechCorrection } from './corrections'
import { readSpeechEvidence } from './evidence'
import { mergeSpeech, planSpeech, subtitleId, type SpeechContext } from './materialize'
import { ARABIC_LINE, CAST, SCENES, candidatesFor, evidenceFor, reference } from './testkit'

const ctx = (over: Partial<SpeechContext> = {}): SpeechContext => ({ referenceVideoId: 5127, videoAnalysisId: 5368, timeMap: makeTimeMap(42.6, 30), scenes: SCENES, existingSubtitleIds: [], createdAt: '2026-10-30T00:00:00.000Z', ...over })

describe('evidence', () => {
  const e = evidenceFor()
  it('reads every real segment in time order, whitespace-normalised, with the recogniser’s own numbers kept', () => {
    expect(e.segments.map(s => s.id)).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19])
    expect(e.segments[1].text).toBe('Today we look at pricing'); expect(e.segments[2].diagnostics).toEqual({ avgLogprob: -1.4, noSpeechProb: 0.03, compressionRatio: 1.4 })
    expect(e).toMatchObject({ durationSeconds: 42.6, rightsStatus: 'owned' })
  })
  it('is deep-frozen and does not touch the response it reads', () => {
    expect(Object.isFrozen(e)).toBe(true); expect(Object.isFrozen(e.segments[0].diagnostics)).toBe(true); expect(() => { (e.segments[0] as { text: string }).text = 'x' }).toThrow()
    const r = reference(); const before = JSON.stringify(r); readSpeechEvidence(r, 1); expect(JSON.stringify(r)).toBe(before)
  })
  it('skips what is not speech evidence (empty text, no duration) and tolerates a response with no transcript', () => {
    expect(evidenceFor([{ id: 1, start: 0, end: 2, text: '   ' }, { id: 2, start: 3, end: 3, text: 'x' }, { id: 3, start: 4, end: 5, text: 'ok' }]).segments.map(s => s.id)).toEqual([3])
    expect(readSpeechEvidence({ id: 1 }, 1)).toMatchObject({ segments: [], durationSeconds: null, rightsStatus: null })
  })
})

describe('which scripts the exporter cannot draw', () => {
  it('flags Arabic, Hebrew, Indic, Thai and CJK, also when mixed with Latin, and passes Latin, Greek, Cyrillic and digits', () => {
    expect(unsupportedScript(ARABIC_LINE)).toBe('arabic'); expect(unsupportedScript('hello مرحبا')).toBe('arabic'); expect(unsupportedScript('שלום')).toBe('hebrew')
    expect(unsupportedScript('नमस्ते')).toBe('indic'); expect(unsupportedScript('สวัสดี')).toBe('thai'); expect(unsupportedScript('你好')).toBe('cjk')
    for (const ok of ['Hello 123', 'Café', 'Χαίρετε', 'Привет']) expect(unsupportedScript(ok)).toBeNull()
  })
})

describe('candidates', () => {
  const owned = candidatesFor(CAST, 'owned'), by = (id: number, list = owned) => list.find(c => c.id === `sp:${id}`)!
  it('includes ordinary lines of your own video by default, and leaves out poorly rated, looping and not-speech lines', () => {
    expect(by(11).defaultInclude).toBe(true); expect(by(13).defaultInclude).toBe(false); expect(by(14).defaultInclude).toBe(false); expect(by(15).defaultInclude).toBe(false)
    expect(by(13).flags.map(f => f.code)).toContain('low_quality'); expect(by(14).flags.map(f => f.code)).toContain('repetitive'); expect(by(15).flags.map(f => f.code)).toContain('maybe_not_speech')
  })
  it('leaves EVERY line out by default when the reference is somebody else’s, and says whose words they are', () => {
    const theirs = candidatesFor(CAST, 'unknown_third_party')
    expect(theirs.every(c => !c.defaultInclude)).toBe(true); expect(theirs.every(c => c.flags.some(f => f.code === 'third_party_words'))).toBe(true)
  })
  it('flags short and long lines, always says it is a machine transcript, and notes an Arabic-script line as drawn in Naskh (information, not a warning)', () => {
    expect(by(16).flags.map(f => f.code)).toContain('very_short'); expect(by(17).flags.map(f => f.code)).toContain('very_long')
    expect(owned.every(c => c.flags.some(f => f.code === 'machine_transcript'))).toBe(true)
    expect(by(18).script).toBe('arabic'); expect(by(18).flags.some(f => f.code === 'script_unsupported')).toBe(false)
    expect(by(18).flags.find(f => f.code === 'script_naskh')).toMatchObject({ severity: 'info' }); expect(by(18).flags.find(f => f.code === 'script_naskh')!.message).toMatch(/Arabic script.*Noto Naskh Arabic.*not have the Nastaliq style/)
    expect(by(11).script).toBeNull()
  })
  it('does not change the evidence', () => {
    const e = evidenceFor(); const before = JSON.stringify(e); buildSpeechCandidates(e); expect(JSON.stringify(e)).toBe(before)
  })
})

describe('corrections stay apart from the evidence', () => {
  const c = candidatesFor()[0], map = makeTimeMap(42.6, 42.6), fit = makeTimeMap(42.6, 30)
  it('labels the transcribed words measured and a person’s rewording theirs; retyping the same words is not a correction', () => {
    expect(resolveSpeech(c, undefined, map).text).toMatchObject({ value: 'Welcome to the show', basis: 'measured' })
    expect(resolveSpeech(c, { text: 'Hello and welcome' }, map)).toMatchObject({ text: { value: 'Hello and welcome', basis: 'user' }, corrected: ['text'] })
    expect(resolveSpeech(c, { text: '  Welcome   to the show ' }, map).corrected).toEqual([])
  })
  it('keeps the recogniser’s times as measured, calls stretched times inferred, and honours a person’s own', () => {
    expect(resolveSpeech(c, undefined, map).start.basis).toBe('measured'); expect(resolveSpeech(c, undefined, fit)).toMatchObject({ start: { basis: 'inferred' }, end: { basis: 'inferred' } })
    expect(resolveSpeech(c, { start: 1, end: 3 }, map)).toMatchObject({ start: { value: 1, basis: 'user' }, end: { value: 3, basis: 'user' } })
    expect(resolveSpeech(c, undefined, fit).end.value).toBeCloseTo(2.4 * 30 / 42.6, 2)
  })
  it('keeps a minimum visible time, ignores malformed corrections, and reports an emptied wording', () => {
    expect(resolveSpeech(c, { start: 3, end: 3.05 }, map).end.value).toBeCloseTo(3.3, 3)
    expect(resolveSpeech(c, { start: -2, end: Number.NaN }, map).ignored).toEqual(['startTime', 'endTime'])
    expect(resolveSpeech(c, { text: '   ' }, map).invalid).toBe('empty_text')
  })
  it('sets, clears and bulk-sets corrections immutably', () => {
    const a = setSpeechCorrection({}, 'sp:11', { include: false }); expect(setSpeechCorrection(a, 'sp:11', { include: undefined })).toEqual({}); expect(a).toEqual({ 'sp:11': { include: false } })
    expect(setAllIncluded({}, ['sp:1', 'sp:2'], true)).toEqual({ 'sp:1': { include: true }, 'sp:2': { include: true } })
  })
})

describe('plan: native subtitles, a script by scene, provenance', () => {
  const cands = candidatesFor(CAST, 'owned')
  const everything = setAllIncluded({}, cands.map(c => c.id), true)
  it('adds the included lines as ordinary subtitles in the editor’s own default box, in time order, with the editor’s order convention', () => {
    const p = planSpeech(cands, {}, ctx({ timeMap: makeTimeMap(42.6, 42.6) }))
    expect(p.subtitles.map(s => s.id)).toEqual(['sp:11', 'sp:12', 'sp:16', 'sp:17', 'sp:18', 'sp:19'].map(id => `rs:5368:${id}`))
    expect(p.subtitles.map(s => s.order)).toEqual([-1, -2, -3, -4, -5, -6])
    for (const s of p.subtitles) expect([s.x, s.y, s.width]).toEqual([DEFAULT_SUBTITLE_BOX.x, DEFAULT_SUBTITLE_BOX.y, DEFAULT_SUBTITLE_BOX.width])
    expect(p.subtitles[1]).toMatchObject({ text: 'Today we look at pricing', startTime: 2.7, endTime: 4.8 })
  })
  it('keeps the transcribed words in the provenance even after the person rewords the subtitle, and never claims the words are right', () => {
    const p = planSpeech(cands, { 'sp:11': { text: 'Hello and welcome' } }, ctx({ timeMap: makeTimeMap(42.6, 42.6) }))
    const r = p.subtitles.find(s => s.id === 'rs:5368:sp:11')!
    expect(r.text).toBe('Hello and welcome'); expect(r.reconstruction).toMatchObject({ kind: 'speech', transcribedText: 'Welcome to the show', evidence: [{ kind: 'speech_segment', id: 11 }], corrected: ['text'], language: 'en' })
    expect(r.reconstruction!.properties.text.basis).toBe('user'); expect(r.reconstruction!.properties.startTime.basis).toBe('measured')
    expect(r.reconstruction!.claims).toEqual({ wordsVerifiedAgainstAudio: false, speakerVoiceRecovered: false, scriptIsOriginal: false }); expect(p.record.claims).toEqual(NO_CLAIMS)
  })
  it('groups the kept lines by blueprint scene (by the middle of the line), using the person’s wording, and leaves other scenes empty', () => {
    const p = planSpeech(cands, { 'sp:12': { text: 'Rewritten line' } }, ctx({ timeMap: makeTimeMap(42.6, 42.6) }))
    expect(p.script.map(s => [s.sceneNumber, s.lines.map(l => l.text)])).toEqual([[1, ['Welcome to the show', 'Rewritten line']], [2, ['Yes', 'A very long explanation that the recogniser kept as a single segment']], [3, [ARABIC_LINE, 'After the draft ends']]])          // a line spoken after the last scene stays with the last scene
    expect(p.script[0].lines[1]).toMatchObject({ edited: true, transcribedText: 'Today we look at pricing' }); expect(p.script[0].lines[0].edited).toBe(false)
  })
  it('stretches transcript time onto a draft of a different length (fit)', () => {
    const p = planSpeech(cands, everything, ctx())
    expect(p.subtitles[0].endTime).toBeCloseTo(2.4 * 30 / 42.6, 2); expect(p.subtitles[p.subtitles.length - 1].endTime).toBeLessThanOrEqual(30)
    expect(p.subtitles[0].reconstruction!.properties.startTime.basis).toBe('inferred')
  })
  it('clips what is spoken after the draft ends when the reference’s own seconds are kept', () => {
    const p = planSpeech(cands, everything, ctx({ timeMap: makeTimeMap(42.6, 30, 'identity') }))
    expect(p.items.find(i => i.candidateId === 'sp:19')).toMatchObject({ status: 'outside_timeline' }); expect(p.subtitles.some(s => s.id.endsWith(':sp:19'))).toBe(false)
    expect(p.subtitles.find(s => s.id.endsWith(':sp:17'))).toMatchObject({ startTime: 13, endTime: 21.5 })
  })
  it('says why each excluded line was left out, and counts the Arabic-script lines (drawn in Naskh) apart from the lines the exporter cannot draw', () => {
    const p = planSpeech(cands, {}, ctx({ timeMap: makeTimeMap(42.6, 42.6) }))
    expect(p.items.find(i => i.candidateId === 'sp:13')!.message).toMatch(/rated this segment poorly/); expect(p.items.find(i => i.candidateId === 'sp:15')!.message).toMatch(/might not be speech/)
    expect(p.record.counts).toMatchObject({ transcribed: 9, included: 6, unsupportedScript: 0, arabicScript: 1 })
    expect(p.items.find(i => i.candidateId === 'sp:18')!.message).toBe('Will be added as an editable subtitle. The exporter draws Arabic script in Noto Naskh Arabic.')
    const third = planSpeech(candidatesFor(CAST, 'unknown_third_party'), {}, ctx())
    expect(third.subtitles).toEqual([]); expect(third.items.every(i => i.status === 'excluded_default')).toBe(true); expect(third.items[0].message).toMatch(/someone else’s words/)
  })
  it('reports an emptied wording and an id already in the draft, and never both subtitles and a stale id', () => {
    expect(planSpeech(cands, { 'sp:11': { text: ' ' } }, ctx({ timeMap: makeTimeMap(42.6, 42.6) })).items.find(i => i.candidateId === 'sp:11')!.status).toBe('invalid')
    const once = planSpeech(cands, {}, ctx({ timeMap: makeTimeMap(42.6, 42.6) }))
    const again = planSpeech(cands, {}, ctx({ timeMap: makeTimeMap(42.6, 42.6), existingSubtitleIds: once.subtitles.map(s => s.id) }))
    expect(again.subtitles).toEqual([]); expect(again.items.filter(i => i.status === 'duplicate')).toHaveLength(6)
    expect(subtitleId(5368, { id: 'sp:11' })).toBe('rs:5368:sp:11')
  })
  it('judges the exporter’s script problem on the wording the person kept: rewording an Arabic line into Latin clears it, and a Hebrew line is still a warning', () => {
    const p = planSpeech(cands, { 'sp:18': { text: 'My own English line' } }, ctx({ timeMap: makeTimeMap(42.6, 42.6) }))
    expect(p.record.counts).toMatchObject({ unsupportedScript: 0, arabicScript: 0 }); expect(p.items.find(i => i.candidateId === 'sp:18')!.message).toBe('Will be added as an editable subtitle.')
    expect(planSpeech(cands, {}, ctx({ timeMap: makeTimeMap(42.6, 42.6) })).record.counts.arabicScript).toBe(1)
    const hebrew = candidatesFor([...CAST, { id: 20, start: 25, end: 27, text: 'שלום לכולם' }], 'owned')
    const h = planSpeech(hebrew, {}, ctx({ timeMap: makeTimeMap(42.6, 42.6) }))
    expect(h.record.counts).toMatchObject({ unsupportedScript: 1, arabicScript: 1 }); expect(h.items.find(i => i.candidateId === 'sp:20')!.message).toMatch(/cannot lay out this script correctly/)
    expect(hebrew.find(c => c.id === 'sp:20')!.flags.some(f => f.code === 'script_unsupported' && f.severity === 'warning')).toBe(true)
    expect(unsupportedScript('مرحبا שלום')).toBe('hebrew')                                  // a script the exporter cannot draw wins over Arabic in mixed text
  })
  it('the signature changes when what a save would write changes', () => {
    const a = planSpeech(cands, {}, ctx()), b = planSpeech(cands, { 'sp:11': { text: 'Different' } }, ctx())
    expect(a.signature).not.toBe(b.signature); expect(planSpeech(cands, {}, ctx()).signature).toBe(a.signature)
  })
})

describe('merging into a draft', () => {
  const cands = candidatesFor(CAST, 'owned')
  const p = planSpeech(cands, {}, ctx({ timeMap: makeTimeMap(42.6, 42.6) }))
  const own: SubtitleSegment = { id: 'mine', text: 'Mine', startTime: 0, endTime: 1, x: 10, y: 82, width: 80 }
  const snap = { name: 'd', subtitles: [own], videoClips: [{ id: 'c' }] }
  it('adds the subtitles after what is there, attaches the record with the script, and leaves other fields alone', () => {
    const out = mergeSpeech(snap, p) as typeof snap & { speechReconstruction: { script: unknown[]; claims: unknown } }
    expect(out.subtitles.map(s => s.id)).toEqual(['mine', ...p.subtitles.map(s => s.id)]); expect(out.videoClips).toBe(snap.videoClips); expect(snap.subtitles).toHaveLength(1)
    expect(out.speechReconstruction.script).toHaveLength(3); expect(out.speechReconstruction.claims).toEqual(NO_CLAIMS)
  })
  it('is idempotent, returns the snapshot when there is nothing to add, and works on the assembled snapshot whose subtitles list is empty', () => {
    const once = mergeSpeech(snap, p) as typeof snap
    expect((mergeSpeech(once, p) as typeof snap).subtitles.map(s => s.id)).toEqual(once.subtitles.map(s => s.id))
    expect(mergeSpeech(snap, null)).toBe(snap); expect(mergeSpeech(snap, planSpeech(cands, setAllIncluded({}, cands.map(c => c.id), false), ctx()))).toBe(snap)
    expect((mergeSpeech({ subtitles: [] as never[] }, p) as unknown as { subtitles: unknown[] }).subtitles).toHaveLength(6)
  })
})
