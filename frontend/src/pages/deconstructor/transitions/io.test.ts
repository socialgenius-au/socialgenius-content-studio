// M2.4a -- the panel's I/O with everything injected (one read of the reference) and the existing draft save applying approved transitions to the real VA5368 draft:
// without a plan the saved draft is byte-for-byte what it was; with one, only the clips ending on a planned join change.
import { describe, expect, it, vi } from 'vitest'
import bpFx from '../__fixtures__/va5368.c4-blueprint.json'
import type { Asset, ReferenceVideo } from '../../../types'
import type { BlueprintResponse } from '../../../types/deconstructor'
import { buildBlueprintPlan } from '../../video-studio-v2/blueprint/blueprintPlan'
import type { AssemblyOptions } from '../assembly'
import { saveAssembledDraft, type SaveInput } from '../footage/assembledDraft'
import { REQUESTED_ELEMENTS, footageKeyFor, newClipEdit, readyEntry, runAssembly } from '../footage/footageModel'
import { STALE_ANALYSIS_MESSAGE } from '../textlayers/loadEvidence'
import { buildTransitionCandidates, sceneJoins } from './candidates'
import { makeTimeMap } from './corrections'
import { loadTransitionEvidence } from './loadEvidence'
import { planTransitions } from './materialize'
import { DISSOLVE, FADE_BLACK, REAL_CUT, evidenceFor, reference } from './testkit'

const resp = () => JSON.parse(JSON.stringify(bpFx)) as BlueprintResponse
const plan = buildBlueprintPlan(resp(), new Date('2026-10-01T00:00:00Z'))
const ref = (over: Partial<ReferenceVideo> = {}) => ({ ...reference([REAL_CUT]), latest_analysis: { id: plan.videoAnalysisId }, ...over }) as unknown as ReferenceVideo
const httpError = (status: number, detail: string) => Object.assign(new Error(detail), { response: { status, data: { detail } } })

describe('reading the reference (one GET, no side effects)', () => {
  it('asks only for the blueprint’s own reference and returns frozen evidence', async () => {
    const getReference = vi.fn().mockResolvedValue(ref())
    const r = await loadTransitionEvidence(plan, getReference)
    expect(getReference).toHaveBeenCalledTimes(1); expect(getReference).toHaveBeenCalledWith(plan.referenceVideoId)
    expect(r.kind).toBe('ready'); if (r.kind === 'ready') expect(Object.isFrozen(r.evidence)).toBe(true)
  })
  it('says so when the analysis has no measured cuts', async () => { expect((await loadTransitionEvidence(plan, async () => ref({ transition_evidence: [] }))).kind).toBe('none') })
  it('refuses evidence from a different analysis than the blueprint was built on', async () => {
    const r = await loadTransitionEvidence(plan, async () => ref({ latest_analysis: { id: plan.videoAnalysisId + 1 } as ReferenceVideo['latest_analysis'] }))
    expect(r).toEqual({ kind: 'error', message: STALE_ANALYSIS_MESSAGE.replace('its text no longer matches', 'its cuts no longer match') })
  })
  it('turns a failed request into words, not a crash', async () => {
    expect(await loadTransitionEvidence(plan, async () => { throw httpError(500, 'database is down') })).toEqual({ kind: 'error', message: 'Could not read the reference’s cuts. database is down' })
  })
})

describe('saving approved transitions through the existing draft save', () => {
  const asset = (id: number): Asset => ({ id, job_id: null, user_id: 1, original_filename: `v${id}.mp4`, stored_filename: `s${id}.mp4`, file_path: `/data/uploads/1/s${id}.mp4`, file_type: 'video', file_size: 1, mime_type: 'video/mp4', created_at: '2026-10-01T00:00:00Z' })
  const OPTIONS: AssemblyOptions = { underfilled: 'gap', referenceAssetIds: [], requestedElements: [...REQUESTED_ELEMENTS] }
  const joins = sceneJoins(plan)
  const NOW = () => new Date('2026-10-05T10:00:00Z')
  function input(over: Partial<SaveInput> = {}): SaveInput {
    const view = runAssembly({
      plan, library: new Map([readyEntry(asset(1), 60, p => `/uploads/${p}`)].map(e => [e.key, e] as const)), referenceAssetIds: [], underfilled: 'gap', createdAt: '2026-10-01T00:00:00.000Z',
      edits: Object.fromEntries(plan.scenes.map(s => [s.sceneNumber, [newClipEdit(`c${s.sceneNumber}`, footageKeyFor(1))]])),
    })
    return { resp: resp(), plan, footage: view.footage, assignments: view.assignments, options: OPTIONS, existingDraftId: null, ...over }
  }
  // two measured cuts placed exactly on scene joins 2->3 and 5->6 (the draft is on the reference's own seconds, so no stretching)
  const planFor = () => {
    const evidence = evidenceFor([{ ...DISSOLVE, id: 1, at: joins[1].time }, { ...FADE_BLACK, id: 2, at: joins[4].time }])
    const map = makeTimeMap(plan.totalSeconds, plan.totalSeconds)
    return planTransitions(buildTransitionCandidates(evidence, joins, map), {}, { referenceVideoId: 5127, videoAnalysisId: plan.videoAnalysisId, timeMap: map, createdAt: '2026-10-05T10:00:00.000Z' })
  }

  it('without a plan the saved draft is byte-for-byte what it was', async () => {
    const a = vi.fn().mockResolvedValue({ data: { id: 1 } }), b = vi.fn().mockResolvedValue({ data: { id: 1 } })
    await saveAssembledDraft(input(), { createDraft: a, updateDraft: vi.fn(), now: NOW })
    await saveAssembledDraft(input({ transitionPlan: null }), { createDraft: b, updateDraft: vi.fn(), now: NOW })
    expect(JSON.stringify(b.mock.calls[0][0])).toBe(JSON.stringify(a.mock.calls[0][0])); expect((a.mock.calls[0][0].project_json as Record<string, unknown>).transitionReconstruction).toBeUndefined()
  })
  it('with a plan only the clips that end on the planned joins change; times, assets and everything else are as before', async () => {
    const createDraft = vi.fn().mockResolvedValue({ data: { id: 41 } }), plain = vi.fn().mockResolvedValue({ data: { id: 1 } })
    await saveAssembledDraft(input(), { createDraft: plain, updateDraft: vi.fn(), now: NOW })
    const r = await saveAssembledDraft(input({ transitionPlan: planFor() }), { createDraft, updateDraft: vi.fn(), now: NOW })
    expect(r).toMatchObject({ ok: true, draftId: 41 })
    type Clip = { startTime: number; endTime: number; transition: string; transitionDuration: number; assetId: number }
    const withPlan = (createDraft.mock.calls[0][0].project_json as { videoClips: Clip[]; transitionReconstruction: { unmatched: number[]; counts: { applied: number } } })
    const without = (plain.mock.calls[0][0].project_json as { videoClips: Clip[] })
    expect(withPlan.videoClips).toHaveLength(7)
    const changed = withPlan.videoClips.map((c, i) => c.transition !== without.videoClips[i].transition ? i : -1).filter(i => i >= 0)
    expect(changed).toEqual([1, 4]); expect(withPlan.videoClips[1].transition).toBe('dissolve'); expect(withPlan.videoClips[4].transition).toBe('fade_black')
    expect(withPlan.videoClips.map(c => [c.startTime, c.endTime, c.assetId])).toEqual(without.videoClips.map(c => [c.startTime, c.endTime, c.assetId]))
    expect(withPlan.transitionReconstruction).toMatchObject({ unmatched: [], counts: { applied: 2 } })
  })
  it('a second save updates the same draft with the same result', async () => {
    const createDraft = vi.fn(), updateDraft = vi.fn().mockResolvedValue({})
    await saveAssembledDraft(input({ transitionPlan: planFor(), existingDraftId: 41 }), { createDraft, updateDraft, now: NOW })
    await saveAssembledDraft(input({ transitionPlan: planFor(), existingDraftId: 41 }), { createDraft, updateDraft, now: NOW })
    expect(JSON.stringify(updateDraft.mock.calls[0][1])).toBe(JSON.stringify(updateDraft.mock.calls[1][1])); expect(createDraft).not.toHaveBeenCalled()
  })
  it('keeps the M1 rules: a stale blueprint is still never turned into a draft, plan or not', async () => {
    const stale = { ...resp(), status: 'stale' } as BlueprintResponse
    expect(await saveAssembledDraft(input({ resp: stale, transitionPlan: planFor() }), { createDraft: vi.fn(), updateDraft: vi.fn(), now: NOW })).toMatchObject({ ok: false, reason: 'blocked' })
  })
})
