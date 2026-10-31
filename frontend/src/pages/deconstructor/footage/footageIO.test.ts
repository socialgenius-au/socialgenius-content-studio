// M1 / Stage 2 -- footage upload / length reading, saving through the drafts API, and the hand-off to Video Studio. All I/O is injected, so every failure
// path is exercised without a browser or server. Nothing here talks to a real backend.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import bpFx from '../__fixtures__/va5368.c4-blueprint.json'
import type { Asset } from '../../../types'
import type { BlueprintResponse } from '../../../types/deconstructor'
import { buildBlueprintPlan, isBlueprintPlan } from '../../video-studio-v2/blueprint/blueprintPlan'
import { getBlueprintPlan } from '../../video-studio-v2/blueprint/blueprintPlanStore'
import { consumeOpenDraftHint } from '../../video-studio-v2/blueprint/openDraftHint'
import { STUDIO_PROJECT_BACKUP_KEY, STUDIO_PROJECT_KEY, STUDIO_ROUTE, STUDIO_STAGE_KEY } from '../../video-studio-v2/blueprint/createStudioDraft'
import type { AssemblyOptions } from '../assembly'
import { openAssembledDraft, saveAssembledDraft, type SaveInput } from './assembledDraft'
import { UPLOAD_NOT_VIDEO, loadVideoAssets, probeAsset, uploadFootage, type LibraryDeps } from './footageLibrary'
import { REQUESTED_ELEMENTS, footageKeyFor, newClipEdit, readyEntry, runAssembly, type LibraryEntry } from './footageModel'

const resp = () => JSON.parse(JSON.stringify(bpFx)) as BlueprintResponse
const plan = buildBlueprintPlan(resp(), new Date('2026-10-01T00:00:00Z'))
const asset = (id: number, over: Partial<Asset> = {}): Asset => ({ id, job_id: null, user_id: 1, original_filename: `v${id}.mp4`, stored_filename: `s${id}.mp4`, file_path: `uploads/1/s${id}.mp4`, file_type: 'video', mime_type: 'video/mp4', file_size: 1000, created_at: '2026-10-01T00:00:00Z', ...over })
const file = (name = 'clip.mp4', type = 'video/mp4') => new File([new Uint8Array(8)], name, { type })
const httpError = (status: number, detail: string) => Object.assign(new Error(detail), { response: { status, data: { detail } } })
const url = (p: string) => `/uploads/${p.replace(/^uploads\//, '')}`

function deps(over: Partial<LibraryDeps> = {}): LibraryDeps {
  return { listAssets: async () => [], upload: async () => asset(1), probe: async () => ({ ok: true, duration: 12 }), previewUrl: url, ...over }
}

describe('loading the person’s videos', () => {
  it('lists videos only', async () => {
    const r = await loadVideoAssets(deps({ listAssets: async () => [asset(1), asset(2, { file_type: 'image' }), asset(3)] }))
    expect(r).toEqual({ ok: true, assets: [asset(1), asset(3)] })
  })
  it('reports a failed load in words, not a crash', async () => {
    const r = await loadVideoAssets(deps({ listAssets: async () => { throw httpError(500, 'database is down') } }))
    expect(r).toEqual({ ok: false, message: 'database is down' })
    const r2 = await loadVideoAssets(deps({ listAssets: async () => { throw new Error('network') } }))
    expect(r2).toEqual({ ok: false, message: 'Could not load your videos.' })
  })
  it('treats an unexpected response shape as "no videos"', async () => {
    expect(await loadVideoAssets(deps({ listAssets: async () => null as unknown as Asset[] }))).toEqual({ ok: true, assets: [] })
  })
})

describe('reading a video’s real length', () => {
  it('ready with the true duration and the editor’s URL', async () => {
    const e = await probeAsset(asset(4), deps({ probe: async u => { expect(u).toBe('/uploads/1/s4.mp4'); return { ok: true, duration: 33.25 } } }))
    expect(e).toMatchObject({ state: 'ready', key: 'a4' })
    if (e.state === 'ready') expect(e.clip.duration).toBe(33.25)
  })
  it('a failed read is a failed entry with the reason -- there is no fallback length', async () => {
    const e = await probeAsset(asset(4), deps({ probe: async () => ({ ok: false, reason: 'This file could not be opened as a video.' }) }))
    expect(e).toEqual({ state: 'failed', key: 'a4', assetId: 4, name: 'v4.mp4', reason: 'This file could not be opened as a video.' })
  })
  it('a probe that throws, or returns a nonsense length, is a failure too', async () => {
    expect((await probeAsset(asset(4), deps({ probe: async () => { throw new Error('boom') } }))).state).toBe('failed')
    expect((await probeAsset(asset(4), deps({ probe: async () => ({ ok: true, duration: 0 }) }))).state).toBe('failed')
    expect((await probeAsset(asset(4), deps({ probe: async () => ({ ok: true, duration: NaN }) }))).state).toBe('failed')
  })
})

describe('uploading footage -- failures are reported and nothing is assumed', () => {
  it('success: uploaded, length read, entry ready', async () => {
    const upload = vi.fn(async () => asset(9, { original_filename: 'shop.mp4' }))
    const r = await uploadFootage(file('shop.mp4'), deps({ upload }))
    expect(upload).toHaveBeenCalledTimes(1)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.entry).toMatchObject({ state: 'ready', key: 'a9', name: 'shop.mp4' })
  })
  it('a non-video file is refused before anything is sent', async () => {
    const upload = vi.fn()
    for (const f of [file('notes.txt', 'text/plain'), file('pic.png', 'image/png'), file('x', '')]) {
      expect(await uploadFootage(f, deps({ upload }))).toEqual({ ok: false, message: UPLOAD_NOT_VIDEO })
    }
    expect(upload).not.toHaveBeenCalled()
  })
  it('the server refusing the file (type / size) shows the server’s own words', async () => {
    const a = await uploadFootage(file(), deps({ upload: async () => { throw httpError(415, 'File type .avi is not allowed') } }))
    expect(a).toEqual({ ok: false, message: 'File type .avi is not allowed' })
    const b = await uploadFootage(file(), deps({ upload: async () => { throw httpError(413, 'File exceeds size limit') } }))
    expect(b).toEqual({ ok: false, message: 'File exceeds size limit' })
  })
  it('a dropped connection gives a plain retry message', async () => {
    const r = await uploadFootage(file(), deps({ upload: async () => { throw new Error('Network Error') } }))
    expect(r).toEqual({ ok: false, message: 'The upload failed. Nothing was added — please try again.' })
  })
  it('a malformed server reply is not trusted', async () => {
    for (const bad of [null, {}, { id: 'x', file_path: 'p' }, { id: 5 }]) {
      const r = await uploadFootage(file(), deps({ upload: async () => bad as unknown as Asset }))
      expect(r.ok).toBe(false)
      expect(r).toMatchObject({ message: expect.stringContaining('did not return') })
    }
  })
  it('the server classifying it as something other than video is refused', async () => {
    const r = await uploadFootage(file(), deps({ upload: async () => asset(5, { file_type: 'audio' }) }))
    expect(r).toMatchObject({ ok: false, message: UPLOAD_NOT_VIDEO })
  })
  it('uploaded but unreadable: the failure says so, and the stored asset is returned so it is not lost', async () => {
    const r = await uploadFootage(file(), deps({ upload: async () => asset(6), probe: async () => ({ ok: false, reason: 'This file could not be opened as a video.' }) }))
    expect(r.ok).toBe(false)
    if (!r.ok) { expect(r.message).toBe('Uploaded “v6.mp4”, but this file could not be opened as a video.'); expect(r.asset?.id).toBe(6) }
  })
})

// ── saving ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const lib = (...e: LibraryEntry[]) => new Map(e.map(x => [x.key, x] as const))
const OPTIONS: AssemblyOptions = { underfilled: 'gap', referenceAssetIds: [], requestedElements: REQUESTED_ELEMENTS }
function input(over: Partial<SaveInput> = {}): SaveInput {
  const view = runAssembly({
    plan, library: lib(readyEntry(asset(1), 20, url), readyEntry(asset(2), 20, url)), referenceAssetIds: [], underfilled: 'gap', createdAt: '2026-10-01T00:00:00.000Z',
    edits: { 1: [newClipEdit('c1', footageKeyFor(1))], 2: [newClipEdit('c2', footageKeyFor(2))] },
  })
  return { resp: resp(), plan, footage: view.footage, assignments: view.assignments, options: OPTIONS, existingDraftId: null, ...over }
}
const NOW = () => new Date('2026-10-05T10:00:00Z')

describe('saving through the existing drafts API', () => {
  it('creates ONE draft holding real clips, text placeholders and the blueprint plan, and calls nothing else', async () => {
    const createDraft = vi.fn().mockResolvedValue({ data: { id: 31 } })
    const updateDraft = vi.fn()
    const r = await saveAssembledDraft(input(), { createDraft, updateDraft, now: NOW })
    expect(r).toMatchObject({ ok: true, draftId: 31, clips: 2 })
    expect(createDraft).toHaveBeenCalledTimes(1) ; expect(updateDraft).not.toHaveBeenCalled()
    const body = createDraft.mock.calls[0][0]
    expect(body.name).toMatch(/^Blueprint — .+ \(2026-10-05\)$/)
    const proj = JSON.parse(JSON.stringify(body.project_json))
    expect(proj.videoClips).toHaveLength(2)
    expect(proj.videoClips[0]).toMatchObject({ assetId: 1, startTime: 0, endTime: 4, trimIn: 0, speed: 1 })
    expect(proj.textOverlays.length).toBeGreaterThanOrEqual(8)
    expect(isBlueprintPlan(proj.blueprintPlan)).toBe(true)
    expect(proj.mediaAssets.map((a: Asset) => a.id)).toEqual([1, 2])
    expect(proj.assembly.createdAt).toBe('2026-10-05T10:00:00.000Z')                  // stamped at save time by the caller
    expect(proj.assembly.unsupported.length).toBe(6)
  })
  it('saving again updates the same draft instead of creating a copy', async () => {
    const createDraft = vi.fn(), updateDraft = vi.fn().mockResolvedValue({})
    const r = await saveAssembledDraft(input({ existingDraftId: 31 }), { createDraft, updateDraft, now: NOW })
    expect(r).toMatchObject({ ok: true, draftId: 31 })
    expect(createDraft).not.toHaveBeenCalled()
    expect(updateDraft).toHaveBeenCalledWith(31, expect.objectContaining({ name: expect.any(String) }))
  })
  it('if the saved draft was deleted elsewhere (404), a fresh one is created', async () => {
    const createDraft = vi.fn().mockResolvedValue({ data: { id: 50 } })
    const updateDraft = vi.fn().mockRejectedValue(httpError(404, 'Draft not found'))
    expect(await saveAssembledDraft(input({ existingDraftId: 31 }), { createDraft, updateDraft, now: NOW })).toMatchObject({ ok: true, draftId: 50 })
  })
  it('any other update failure is reported and creates nothing', async () => {
    const createDraft = vi.fn(), updateDraft = vi.fn().mockRejectedValue(httpError(500, 'boom'))
    const r = await saveAssembledDraft(input({ existingDraftId: 31 }), { createDraft, updateDraft, now: NOW })
    expect(r).toMatchObject({ ok: false, reason: 'failed' })
    expect(createDraft).not.toHaveBeenCalled()
  })
  it('a failed save says nothing in Video Studio changed, and does not touch the editor’s state', async () => {
    const r = await saveAssembledDraft(input(), { createDraft: vi.fn().mockRejectedValue(httpError(503, 'Service unavailable')), updateDraft: vi.fn(), now: NOW })
    expect(r).toMatchObject({ ok: false, reason: 'failed' })
    if (!r.ok) expect(r.message).toContain('Nothing in Video Studio was changed')
    expect(consumeOpenDraftHint()).toBeNull()
  })
  it('never saves from a stale, unknown or missing blueprint', async () => {
    const createDraft = vi.fn()
    const stale = resp(); stale.status = 'stale'; stale.input_pin.current_anatomy_fingerprint = 'x'
    for (const r of [stale, { ...resp(), status: 'unknown' as const }, { ...resp(), blueprint: null }, null]) {
      expect(await saveAssembledDraft(input({ resp: r }), { createDraft, updateDraft: vi.fn(), now: NOW })).toMatchObject({ ok: false, reason: 'blocked' })
    }
    expect(createDraft).not.toHaveBeenCalled()
  })
  it('never saves an invalid assembly (missing footage, bad trim, reference media) -- the engine is the gate', async () => {
    const createDraft = vi.fn()
    const base = input()
    const cases: Partial<SaveInput>[] = [
      { footage: [] },                                                                                              // assignments point at footage that is not supplied
      { assignments: [{ sceneNumber: 1, clips: [{ footageKey: 'a1', trimIn: 99 }] }] },                              // starts beyond the end of the file
      { options: { ...OPTIONS, referenceAssetIds: [1] } },                                                           // a1 is the reference's own media
      { assignments: [{ sceneNumber: 99, clips: [{ footageKey: 'a1' }] }] },                                         // a scene that does not exist
    ]
    for (const c of cases) {
      const r = await saveAssembledDraft({ ...base, ...c }, { createDraft, updateDraft: vi.fn(), now: NOW })
      expect(r, JSON.stringify(c).slice(0, 60)).toMatchObject({ ok: false, reason: 'blocked' })
    }
    expect(createDraft).not.toHaveBeenCalled()
  })
  it('never saves a draft with no clips', async () => {
    const createDraft = vi.fn()
    const r = await saveAssembledDraft({ ...input(), assignments: [] }, { createDraft, updateDraft: vi.fn(), now: NOW })
    expect(r).toMatchObject({ ok: false, reason: 'blocked', message: 'Assign footage to at least one scene first.' })
    expect(createDraft).not.toHaveBeenCalled()
  })
  it('the same input saves the same project twice (repeated assembly is stable)', async () => {
    const calls: unknown[] = []
    const createDraft = vi.fn(async (b: { project_json: unknown }) => { calls.push(JSON.stringify(b.project_json)); return { data: { id: 1 } } })
    await saveAssembledDraft(input(), { createDraft, updateDraft: vi.fn(), now: NOW })
    await saveAssembledDraft(input(), { createDraft, updateDraft: vi.fn(), now: NOW })
    expect(calls[0]).toBe(calls[1])
  })
})

// ── opening in Video Studio ─────────────────────────────────────────────────────────────────────────────────────────────────

function memStorage(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init))
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) }, removeItem: (k: string) => { m.delete(k) } }
}
beforeEach(() => {
  ;(globalThis as unknown as { localStorage: unknown }).localStorage = memStorage()
  ;(globalThis as unknown as { sessionStorage: unknown }).sessionStorage = memStorage()
})

describe('opening the assembled draft in Video Studio V2', () => {
  it('uses the editor’s own hand-off: Create/Edit stage, the draft id hint, the blueprint plan, and the V2 route', () => {
    const storage = memStorage()
    const r = openAssembledDraft(77, plan, { storage, confirmReplace: () => true })
    expect(r).toEqual({ ok: true, route: STUDIO_ROUTE })
    expect(STUDIO_ROUTE).toBe('/video-studio-v2')
    expect(storage.getItem(STUDIO_STAGE_KEY)).toBe('create')
    expect(consumeOpenDraftHint()).toBe(77)
    expect(getBlueprintPlan()?.blueprintId).toBe(plan.blueprintId)
  })
  it('does not ask when the editor holds nothing', () => {
    const confirmReplace = vi.fn()
    expect(openAssembledDraft(1, plan, { storage: memStorage(), confirmReplace }).ok).toBe(true)
    expect(confirmReplace).not.toHaveBeenCalled()
  })
  it('protects a project in progress: cancel leaves everything untouched; confirm keeps a backup', () => {
    const project = JSON.stringify({ videoClips: [{ id: 'a' }], textOverlays: [{ id: 't' }], mediaOverlays: [], audioTracks: [] })
    const cancel = memStorage({ [STUDIO_PROJECT_KEY]: project })
    expect(openAssembledDraft(5, plan, { storage: cancel, confirmReplace: () => false })).toMatchObject({ ok: false, reason: 'cancelled' })
    expect(cancel.getItem(STUDIO_PROJECT_KEY)).toBe(project) ; expect(consumeOpenDraftHint()).toBeNull()

    const ok = memStorage({ [STUDIO_PROJECT_KEY]: project })
    const confirm = vi.fn().mockReturnValue(true)
    expect(openAssembledDraft(5, plan, { storage: ok, confirmReplace: confirm }).ok).toBe(true)
    expect(confirm).toHaveBeenCalledWith(2)
    expect(ok.getItem(STUDIO_PROJECT_BACKUP_KEY)).toBe(project) ; expect(ok.getItem(STUDIO_PROJECT_KEY)).toBeNull()
    expect(consumeOpenDraftHint()).toBe(5)
  })
  it('saving never touches the editor’s recovered project -- only opening does', async () => {
    const storage = memStorage({ [STUDIO_PROJECT_KEY]: JSON.stringify({ videoClips: [{ id: 'a' }] }) })
    ;(globalThis as unknown as { localStorage: unknown }).localStorage = storage
    await saveAssembledDraft(input(), { createDraft: vi.fn().mockResolvedValue({ data: { id: 3 } }), updateDraft: vi.fn(), now: NOW })
    expect(storage.getItem(STUDIO_PROJECT_KEY)).not.toBeNull() ; expect(storage.getItem(STUDIO_PROJECT_BACKUP_KEY)).toBeNull() ; expect(consumeOpenDraftHint()).toBeNull()
  })
})
