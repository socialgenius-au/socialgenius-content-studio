// M2.1a -- the review panel's I/O with everything injected: the one read of the reference, the pixel sampling, and saving layers through the existing draft save.
import { describe, expect, it, vi } from 'vitest'
import bpFx from '../__fixtures__/va5368.c4-blueprint.json'
import type { ReferenceVideo } from '../../../types'
import type { BlueprintResponse } from '../../../types/deconstructor'
import { buildBlueprintPlan, buildPlaceholderOverlays } from '../../video-studio-v2/blueprint/blueprintPlan'
import type { AssemblyOptions } from '../assembly'
import { saveAssembledDraft, type SaveInput } from '../footage/assembledDraft'
import { REQUESTED_ELEMENTS, footageKeyFor, newClipEdit, readyEntry, runAssembly } from '../footage/footageModel'
import { readAppearances, type FrameSampler } from './framePixels'
import { loadEvidence, STALE_ANALYSIS_MESSAGE } from './loadEvidence'
import { makeTimeMap } from './corrections'
import { planTextLayers } from './materialize'
import { candidatesFor, CAST, reference, textRegion } from './testkit'
import { readTextEvidence } from './evidence'

const resp = () => JSON.parse(JSON.stringify(bpFx)) as BlueprintResponse
const plan = buildBlueprintPlan(resp(), new Date('2026-10-01T00:00:00Z'))
const ref = (over: Partial<ReferenceVideo> = {}) => ({ ...reference({ texts: CAST }), latest_analysis: { id: plan.videoAnalysisId }, ...over }) as unknown as ReferenceVideo
const httpError = (status: number, detail: string) => Object.assign(new Error(detail), { response: { status, data: { detail } } })

describe('reading the reference (one GET, no side effects)', () => {
  it('asks only for the blueprint’s own reference and returns frozen evidence', async () => {
    const getReference = vi.fn().mockResolvedValue(ref())
    const r = await loadEvidence(plan, getReference)
    expect(getReference).toHaveBeenCalledTimes(1); expect(getReference).toHaveBeenCalledWith(plan.referenceVideoId)
    expect(r.kind).toBe('ready')
    if (r.kind === 'ready') { expect(r.evidence.groups.length).toBe(CAST.length); expect(Object.isFrozen(r.evidence)).toBe(true) }
  })
  it('says so when the analysis has no text at all', async () => {
    const r = await loadEvidence(plan, async () => ref({ shots: [] }))
    expect(r.kind).toBe('empty')
  })
  it('refuses evidence from a different analysis than the blueprint was built on', async () => {
    const r = await loadEvidence(plan, async () => ref({ latest_analysis: { id: plan.videoAnalysisId + 1 } as ReferenceVideo['latest_analysis'] }))
    expect(r).toEqual({ kind: 'error', message: STALE_ANALYSIS_MESSAGE })
  })
  it('turns a failed request into words, not a crash', async () => {
    expect(await loadEvidence(plan, async () => { throw httpError(500, 'database is down') })).toEqual({ kind: 'error', message: 'Could not read the reference’s text. database is down' })
    const r = await loadEvidence(plan, async () => { throw new Error('network') })
    expect(r.kind === 'error' && r.message).toMatch(/Please try again/)
  })
})

describe('reading colours from frames', () => {
  const evidence = readTextEvidence(reference({ texts: CAST }), 1)
  const good = textRegion({ text: [245, 245, 245], box: [28, 28, 28], ring: [50, 50, 54] })
  it('estimates each group from its own frame and box', async () => {
    const sampler: FrameSampler = vi.fn().mockResolvedValue({ image: good.img, inner: good.inner })
    const map = await readAppearances(evidence, sampler)
    expect(sampler).toHaveBeenCalledTimes(CAST.length)
    expect(map.size).toBe(CAST.length)
    expect(map.get(1)).toMatchObject({ textColor: '#f5f5f5', confidence: 'high' })
    expect((sampler as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe('/data/uploads/1/frame-a.jpg')
  })
  it('leaves out a group whose frame cannot be read, and never stops the others', async () => {
    let n = 0
    const sampler: FrameSampler = async () => { n++; if (n === 2) throw new Error('boom'); return n === 3 ? null : { image: good.img, inner: good.inner } }
    const map = await readAppearances(evidence, sampler)
    expect(map.size).toBe(CAST.length - 2)
  })
  it('skips groups with no source frame and honours cancellation', async () => {
    const none = readTextEvidence(reference({ texts: CAST.map(c => ({ ...c, frame: null })) }), 1)
    const s = vi.fn()
    expect((await readAppearances(none, s as unknown as FrameSampler)).size).toBe(0); expect(s).not.toHaveBeenCalled()
    const s2 = vi.fn().mockResolvedValue(null)
    await readAppearances(evidence, s2, () => true); expect(s2).not.toHaveBeenCalled()
  })
})

describe('saving approved layers through the existing draft save', () => {
  const asset = (id: number) => ({ id, job_id: null, user_id: 1, original_filename: `v${id}.mp4`, stored_filename: `s${id}.mp4`, file_path: `/data/uploads/1/s${id}.mp4`, file_type: 'video', file_size: 1, mime_type: 'video/mp4', created_at: '2026-10-01T00:00:00Z' }) as never
  const url = (p: string) => `/uploads/${p}`
  const OPTIONS: AssemblyOptions = { underfilled: 'gap', referenceAssetIds: [], requestedElements: [...REQUESTED_ELEMENTS] }
  function input(over: Partial<SaveInput> = {}): SaveInput {
    const view = runAssembly({
      plan, library: new Map([readyEntry(asset(1), 20, url), readyEntry(asset(2), 20, url)].map(e => [e.key, e] as const)), referenceAssetIds: [], underfilled: 'gap', createdAt: '2026-10-01T00:00:00.000Z',
      edits: { 1: [newClipEdit('c1', footageKeyFor(1))], 2: [newClipEdit('c2', footageKeyFor(2))] },
    })
    return { resp: resp(), plan, footage: view.footage, assignments: view.assignments, options: OPTIONS, existingDraftId: null, ...over }
  }
  const NOW = () => new Date('2026-10-05T10:00:00Z')
  const layerPlan = () => {
    const { candidates } = candidatesFor()
    return planTextLayers(candidates, { 'text:1': { replacePlaceholder: true } }, {
      referenceVideoId: plan.referenceVideoId, videoAnalysisId: plan.videoAnalysisId, timeMap: makeTimeMap(42.6, plan.totalSeconds), canvas: { width: 1080, height: 1920 },
      existingOverlays: buildPlaceholderOverlays(plan), createdAt: '2026-10-05T10:00:00.000Z',
    })
  }

  it('without layers the saved draft is byte-for-byte what M1 saved', async () => {
    const a = vi.fn().mockResolvedValue({ data: { id: 1 } }), b = vi.fn().mockResolvedValue({ data: { id: 1 } })
    await saveAssembledDraft(input(), { createDraft: a, updateDraft: vi.fn(), now: NOW })
    await saveAssembledDraft(input({ textLayers: null }), { createDraft: b, updateDraft: vi.fn(), now: NOW })
    expect(JSON.stringify(b.mock.calls[0][0])).toBe(JSON.stringify(a.mock.calls[0][0]))
    expect((a.mock.calls[0][0].project_json as Record<string, unknown>).reconstruction).toBeUndefined()
  })
  it('with layers: one draft holds the real clips, the new layers and the record; replaced placeholders are gone; everything else is as before', async () => {
    const createDraft = vi.fn().mockResolvedValue({ data: { id: 41 } })
    const lp = layerPlan()
    const r = await saveAssembledDraft(input({ textLayers: lp }), { createDraft, updateDraft: vi.fn(), now: NOW })
    expect(r).toMatchObject({ ok: true, draftId: 41 })
    const body = createDraft.mock.calls[0][0] as { project_json: { textOverlays: { id: string; reconstruction?: unknown }[]; videoClips: unknown[]; reconstruction: { claims: unknown } } }
    const ids = body.project_json.textOverlays.map(o => o.id)
    expect(ids).toContain('rc:5368:text:1')
    for (const gone of lp.removePlaceholderIds) expect(ids).not.toContain(gone)
    expect(body.project_json.videoClips.length).toBe(2)
    expect(body.project_json.reconstruction.claims).toMatchObject({ burnedInTextRemoved: false })
    expect(createDraft).toHaveBeenCalledTimes(1)
  })
  it('a second save updates the same draft and does not duplicate layers', async () => {
    const createDraft = vi.fn(), updateDraft = vi.fn().mockResolvedValue({})
    const lp = layerPlan()
    await saveAssembledDraft(input({ textLayers: lp, existingDraftId: 41 }), { createDraft, updateDraft, now: NOW })
    await saveAssembledDraft(input({ textLayers: lp, existingDraftId: 41 }), { createDraft, updateDraft, now: NOW })
    const counts = updateDraft.mock.calls.map(c => (c[1].project_json.textOverlays as { id: string }[]).filter(o => o.id === 'rc:5368:text:1').length)
    expect(counts).toEqual([1, 1]); expect(createDraft).not.toHaveBeenCalled()
  })
  it('keeps the M1 rules: a stale blueprint is still never turned into a draft, layers or not', async () => {
    const stale = { ...resp(), status: 'stale' } as BlueprintResponse
    const r = await saveAssembledDraft(input({ resp: stale, textLayers: layerPlan() }), { createDraft: vi.fn(), updateDraft: vi.fn(), now: NOW })
    expect(r).toMatchObject({ ok: false, reason: 'blocked' })
  })
})
