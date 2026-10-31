// M2.5a -- the panel's I/O with everything injected (one read of the reference) and the existing draft save adding approved subtitles and the per-scene script to the real VA5368 draft:
// without a plan the saved draft is byte-for-byte what it was; with one, only subtitles and the record are added.
import { describe, expect, it, vi } from 'vitest'
import bpFx from '../__fixtures__/va5368.c4-blueprint.json'
import type { Asset, ReferenceVideo } from '../../../types'
import type { BlueprintResponse } from '../../../types/deconstructor'
import { buildBlueprintPlan } from '../../video-studio-v2/blueprint/blueprintPlan'
import type { AssemblyOptions } from '../assembly'
import { saveAssembledDraft, type SaveInput } from '../footage/assembledDraft'
import { REQUESTED_ELEMENTS, footageKeyFor, newClipEdit, readyEntry, runAssembly } from '../footage/footageModel'
import { STALE_ANALYSIS_MESSAGE } from '../textlayers/loadEvidence'
import { buildSpeechCandidates } from './candidates'
import { makeTimeMap, setAllIncluded } from './corrections'
import { loadSpeechEvidence } from './loadEvidence'
import { planSpeech } from './materialize'
import { CAST, evidenceFor, reference } from './testkit'

const resp = () => JSON.parse(JSON.stringify(bpFx)) as BlueprintResponse
const plan = buildBlueprintPlan(resp(), new Date('2026-10-01T00:00:00Z'))
const ref = (over: Partial<ReferenceVideo> = {}) => ({ ...reference(CAST, 'owned'), latest_analysis: { id: plan.videoAnalysisId }, ...over }) as unknown as ReferenceVideo
const httpError = (status: number, detail: string) => Object.assign(new Error(detail), { response: { status, data: { detail } } })

describe('reading the reference (one GET, no side effects)', () => {
  it('asks only for the blueprint’s own reference and returns frozen evidence', async () => {
    const getReference = vi.fn().mockResolvedValue(ref())
    const r = await loadSpeechEvidence(plan, getReference)
    expect(getReference).toHaveBeenCalledTimes(1); expect(getReference).toHaveBeenCalledWith(plan.referenceVideoId)
    expect(r.kind).toBe('ready'); if (r.kind === 'ready') { expect(r.evidence.segments).toHaveLength(9); expect(Object.isFrozen(r.evidence)).toBe(true) }
  })
  it('says so when the analysis heard no speech', async () => { expect((await loadSpeechEvidence(plan, async () => ref({ speech_segments: [] }))).kind).toBe('none') })
  it('refuses a transcript from a different analysis than the blueprint was built on', async () => {
    expect(await loadSpeechEvidence(plan, async () => ref({ latest_analysis: { id: plan.videoAnalysisId + 1 } as ReferenceVideo['latest_analysis'] })))
      .toEqual({ kind: 'error', message: STALE_ANALYSIS_MESSAGE.replace('its text no longer matches', 'its transcript no longer matches') })
  })
  it('turns a failed request into words, not a crash', async () => {
    expect(await loadSpeechEvidence(plan, async () => { throw httpError(500, 'database is down') })).toEqual({ kind: 'error', message: 'Could not read the reference’s transcript. database is down' })
  })
})

describe('saving approved subtitles through the existing draft save', () => {
  const asset = (id: number): Asset => ({ id, job_id: null, user_id: 1, original_filename: `v${id}.mp4`, stored_filename: `s${id}.mp4`, file_path: `/data/uploads/1/s${id}.mp4`, file_type: 'video', file_size: 1, mime_type: 'video/mp4', created_at: '2026-10-01T00:00:00Z' })
  const OPTIONS: AssemblyOptions = { underfilled: 'gap', referenceAssetIds: [], requestedElements: [...REQUESTED_ELEMENTS] }
  const NOW = () => new Date('2026-10-05T10:00:00Z')
  function input(over: Partial<SaveInput> = {}): SaveInput {
    const view = runAssembly({
      plan, library: new Map([readyEntry(asset(1), 20, p => `/uploads/${p}`), readyEntry(asset(2), 20, p => `/uploads/${p}`)].map(e => [e.key, e] as const)), referenceAssetIds: [], underfilled: 'gap', createdAt: '2026-10-01T00:00:00.000Z',
      edits: { 1: [newClipEdit('c1', footageKeyFor(1))], 2: [newClipEdit('c2', footageKeyFor(2))] },
    })
    return { resp: resp(), plan, footage: view.footage, assignments: view.assignments, options: OPTIONS, existingDraftId: null, ...over }
  }
  const speechPlan = () => {
    const cands = buildSpeechCandidates(evidenceFor(CAST, 'owned'))
    return planSpeech(cands, setAllIncluded({ 'sp:11': { text: 'Hello and welcome' } }, cands.map(c => c.id), true), {
      referenceVideoId: 5127, videoAnalysisId: plan.videoAnalysisId, timeMap: makeTimeMap(42.6, plan.totalSeconds), scenes: plan.scenes.map(s => ({ sceneNumber: s.sceneNumber, startTime: s.startTime, endTime: s.endTime })),
      existingSubtitleIds: [], createdAt: '2026-10-05T10:00:00.000Z',
    })
  }

  it('without a plan the saved draft is byte-for-byte what it was', async () => {
    const a = vi.fn().mockResolvedValue({ data: { id: 1 } }), b = vi.fn().mockResolvedValue({ data: { id: 1 } })
    await saveAssembledDraft(input(), { createDraft: a, updateDraft: vi.fn(), now: NOW })
    await saveAssembledDraft(input({ speechPlan: null }), { createDraft: b, updateDraft: vi.fn(), now: NOW })
    expect(JSON.stringify(b.mock.calls[0][0])).toBe(JSON.stringify(a.mock.calls[0][0])); expect((a.mock.calls[0][0].project_json as Record<string, unknown>).speechReconstruction).toBeUndefined()
  })
  it('with a plan: the clips, text placeholders and everything else are as before; the subtitles and the script are added', async () => {
    const createDraft = vi.fn().mockResolvedValue({ data: { id: 41 } }), plain = vi.fn().mockResolvedValue({ data: { id: 1 } })
    await saveAssembledDraft(input(), { createDraft: plain, updateDraft: vi.fn(), now: NOW })
    const r = await saveAssembledDraft(input({ speechPlan: speechPlan() }), { createDraft, updateDraft: vi.fn(), now: NOW })
    expect(r).toMatchObject({ ok: true, draftId: 41 })
    type Json = { videoClips: unknown[]; textOverlays: unknown[]; subtitles: { id: string; text: string; order: number; reconstruction: { transcribedText: string } }[]; speechReconstruction: { counts: { included: number }; script: { lines: unknown[] }[]; claims: unknown } }
    const withPlan = createDraft.mock.calls[0][0].project_json as Json, without = plain.mock.calls[0][0].project_json as Json
    expect(withPlan.videoClips).toEqual(without.videoClips); expect(withPlan.textOverlays).toEqual(without.textOverlays)
    expect(withPlan.subtitles.length).toBe(withPlan.speechReconstruction.counts.included); expect(withPlan.subtitles.length).toBeGreaterThanOrEqual(6)
    const edited = withPlan.subtitles.find(s => s.id === 'rs:5368:sp:11')!
    expect(edited.text).toBe('Hello and welcome'); expect(edited.reconstruction.transcribedText).toBe('Welcome to the show')
    expect(withPlan.speechReconstruction.script).toHaveLength(plan.scenes.length); expect(withPlan.speechReconstruction.claims).toEqual({ wordsVerifiedAgainstAudio: false, speakerVoiceRecovered: false, scriptIsOriginal: false })
  })
  it('a second save updates the same draft with the same result', async () => {
    const createDraft = vi.fn(), updateDraft = vi.fn().mockResolvedValue({})
    await saveAssembledDraft(input({ speechPlan: speechPlan(), existingDraftId: 41 }), { createDraft, updateDraft, now: NOW })
    await saveAssembledDraft(input({ speechPlan: speechPlan(), existingDraftId: 41 }), { createDraft, updateDraft, now: NOW })
    expect(JSON.stringify(updateDraft.mock.calls[0][1])).toBe(JSON.stringify(updateDraft.mock.calls[1][1])); expect(createDraft).not.toHaveBeenCalled()
  })
  it('keeps the M1 rules: a stale blueprint is still never turned into a draft, plan or not', async () => {
    const stale = { ...resp(), status: 'stale' } as BlueprintResponse
    expect(await saveAssembledDraft(input({ resp: stale, speechPlan: speechPlan() }), { createDraft: vi.fn(), updateDraft: vi.fn(), now: NOW })).toMatchObject({ ok: false, reason: 'blocked' })
  })
})
