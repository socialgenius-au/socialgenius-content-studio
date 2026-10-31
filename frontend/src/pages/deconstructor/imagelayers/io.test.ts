// M2.2a -- Stage B: the I/O around the engine, with everything injected. Reading the reference (one GET), choosing and validating pictures, cropping a frame,
// uploading ONLY when asked, and saving approved layers through the existing draft save. Also the committed draft fixture the backend compatibility test uses.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import bpFx from '../__fixtures__/va5368.c4-blueprint.json'
import assembledFx from '../assembly/__fixtures__/va5368.assembled.snapshot.json'
import type { Asset, ReferenceVideo } from '../../../types'
import type { BlueprintResponse } from '../../../types/deconstructor'
import { buildBlueprintPlan } from '../../video-studio-v2/blueprint/blueprintPlan'
import type { AssemblyOptions } from '../assembly'
import { saveAssembledDraft, type SaveInput } from '../footage/assembledDraft'
import { REQUESTED_ELEMENTS, footageKeyFor, newClipEdit, readyEntry, runAssembly } from '../footage/footageModel'
import { STALE_ANALYSIS_MESSAGE } from '../textlayers/loadEvidence'
import { makeTimeMap } from './corrections'
import { pickFrameCrop, pickImageFile, toImageRef, uploadChosen, uploadPicked, validateImageFile, type FrameCropper, type PickedImage, type UploadDeps } from './imageFiles'
import { loadImageEvidence } from './loadEvidence'
import { mergeImageLayers, planImageLayers } from './materialize'
import { candidatesFor, reference } from './testkit'

const resp = () => JSON.parse(JSON.stringify(bpFx)) as BlueprintResponse
const plan = buildBlueprintPlan(resp(), new Date('2026-10-01T00:00:00Z'))
const ref = (over: Partial<ReferenceVideo> = {}) => ({ ...reference(), latest_analysis: { id: plan.videoAnalysisId }, ...over }) as unknown as ReferenceVideo
const httpError = (status: number, detail: string) => Object.assign(new Error(detail), { response: { status, data: { detail } } })
const file = (name: string, type: string, size = 100) => ({ name, type, size })
const blob = (type = 'image/png') => new Blob([new Uint8Array([1, 2, 3])], { type })
const picked = (over: Partial<PickedImage> = {}): PickedImage => ({ token: 't1', source: 'user_upload', blob: blob(), fileName: 'logo.png', width: 600, height: 300, hasAlpha: true, previewUrl: 'blob:x', ...over })
const asset = (id: number, path = `/data/uploads/1/s${id}.png`): Asset => ({ id, job_id: null, user_id: 1, original_filename: 'x.png', stored_filename: `s${id}.png`, file_path: path, file_type: 'image', file_size: 3, mime_type: 'image/png', created_at: '2026-10-30T00:00:00Z' })
const deps = (over: Partial<UploadDeps> = {}): UploadDeps => ({ upload: vi.fn(async () => asset(900)), assetUrl: p => `/uploads/${p.split('/uploads/')[1]}`, ...over })

describe('reading the reference (one GET, no side effects)', () => {
  it('asks only for the blueprint’s own reference and returns frozen visual evidence', async () => {
    const getReference = vi.fn().mockResolvedValue(ref())
    const r = await loadImageEvidence(plan, getReference)
    expect(getReference).toHaveBeenCalledTimes(1); expect(getReference).toHaveBeenCalledWith(plan.referenceVideoId)
    expect(r.kind).toBe('ready')
    if (r.kind === 'ready') { expect(r.evidence.frames).toHaveLength(4); expect(Object.isFrozen(r.evidence)).toBe(true) }
  })
  it('says so when the analysis has no sampled frames', async () => {
    expect((await loadImageEvidence(plan, async () => ref({ shots: [] }))).kind).toBe('no_frames')
  })
  it('still offers the frames when nothing was detected (the person can draw a region)', async () => {
    const r = await loadImageEvidence(plan, async () => ({ ...reference({ detections: [] }), latest_analysis: { id: plan.videoAnalysisId } }) as unknown as ReferenceVideo)
    expect(r.kind).toBe('ready'); if (r.kind === 'ready') expect(r.evidence.detections).toEqual([])
  })
  it('refuses evidence from a different analysis than the blueprint was built on', async () => {
    const r = await loadImageEvidence(plan, async () => ref({ latest_analysis: { id: plan.videoAnalysisId + 1 } as ReferenceVideo['latest_analysis'] }))
    expect(r).toEqual({ kind: 'error', message: STALE_ANALYSIS_MESSAGE.replace('its text no longer matches', 'its frames no longer match') })
  })
  it('turns a failed request into words, not a crash', async () => {
    expect(await loadImageEvidence(plan, async () => { throw httpError(500, 'database is down') })).toEqual({ kind: 'error', message: 'Could not read the reference’s frames. database is down' })
  })
})

describe('choosing a picture', () => {
  it('accepts PNG, JPG and WebP, in any letter case', () => {
    for (const [n, t] of [['a.png', 'image/png'], ['b.JPG', 'image/jpeg'], ['c.jpeg', 'image/jpeg'], ['d.webp', 'image/webp']] as const) expect(validateImageFile(file(n, t))).toBeNull()
  })
  it('refuses a GIF (it would export as one frame), a document, an empty file, and one that is too large, in plain words', () => {
    expect(validateImageFile(file('a.gif', 'image/gif'))).toMatch(/Animated GIFs are not supported/)
    expect(validateImageFile(file('a.pdf', 'application/pdf'))).toMatch(/not a PNG, JPG or WebP/)
    expect(validateImageFile(file('a.png', 'image/png', 0))).toMatch(/is empty/)
    expect(validateImageFile(file('a.png', 'image/png', 21 * 1024 * 1024))).toMatch(/larger than 20 MB/)
    expect(validateImageFile(file('noextension', 'image/png'))).toMatch(/not a PNG/)
    expect(validateImageFile(file('disguised.png', 'text/html'))).toMatch(/does not look like/)
  })
  it('reads the real size and transparency through the decoder and keeps the file as it is', async () => {
    const f = new File([blob()], 'logo.png', { type: 'image/png' })
    const r = await pickImageFile(f, async () => ({ width: 640, height: 320, hasAlpha: true }), () => 'blob:preview')
    expect(r).toMatchObject({ ok: true, image: { source: 'user_upload', fileName: 'logo.png', width: 640, height: 320, hasAlpha: true, previewUrl: 'blob:preview' } })
    if (r.ok) expect(r.image.blob).toBe(f)
  })
  it('reports a file that is not really a picture', async () => {
    expect(await pickImageFile(new File([blob()], 'x.png', { type: 'image/png' }), async () => null)).toEqual({ ok: false, message: '“x.png” could not be read as a picture.' })
  })
  it('gives every choice its own token', async () => {
    const a = await pickImageFile(new File([blob()], 'a.png', { type: 'image/png' }), async () => ({ width: 1, height: 1, hasAlpha: false }), () => 'u')
    const b = await pickImageFile(new File([blob()], 'a.png', { type: 'image/png' }), async () => ({ width: 1, height: 1, hasAlpha: false }), () => 'u')
    expect(a.ok && b.ok && a.image.token !== b.image.token).toBe(true)
  })
})

describe('an opt-in crop of a reference frame', () => {
  const region = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 }
  it('is a plain rectangle: the requested region, no transparency, labelled as a crop of that frame', async () => {
    const cropper: FrameCropper = vi.fn(async () => ({ blob: blob(), width: 144, height: 86 }))
    const r = await pickFrameCrop({ id: 2, path: '/data/uploads/1/frame-2.jpg' }, region, cropper, () => 'blob:crop')
    expect(cropper).toHaveBeenCalledWith('/data/uploads/1/frame-2.jpg', region)
    expect(r).toMatchObject({ ok: true, image: { source: 'reference_frame_crop', width: 144, height: 86, hasAlpha: false, cropRegion: region } })
    if (r.ok) expect(r.image.fileName).toMatch(/^reference-crop-f2-100-200\.png$/)
  })
  it('says so, and offers the alternative, when the browser will not let the frame be read', async () => {
    const r = await pickFrameCrop({ id: 2, path: 'x' }, region, async () => null)
    expect(r.ok).toBe(false); expect(!r.ok && r.message).toMatch(/Choose an image of your own/)
  })
})

describe('uploading happens only when asked, through the existing asset upload', () => {
  it('uploads one picture as a file of its own type and returns the asset id and the address the editor loads', async () => {
    const d = deps()
    const out = await uploadPicked(picked(), d)
    expect(out).toEqual({ assetId: 900, url: '/uploads/1/s900.png' })
    const sent = (d.upload as ReturnType<typeof vi.fn>).mock.calls[0][0] as File
    expect(sent.name).toBe('logo.png'); expect(sent.type).toBe('image/png')
  })
  it('refuses an asset the editor could not address', async () => {
    await expect(uploadPicked(picked(), deps({ assetUrl: () => '' }))).rejects.toThrow(/no address/)
  })
  it('uploads exactly the listed choices and nothing else', async () => {
    const d = deps({ upload: vi.fn().mockResolvedValueOnce(asset(901)).mockResolvedValueOnce(asset(902)) })
    const picks = { a: picked({ token: 'ta', fileName: 'a.png' }), b: picked({ token: 'tb', fileName: 'b.png' }), c: picked({ token: 'tc', fileName: 'c.png' }) }
    const r = await uploadChosen(['a', 'c'], picks, d)
    expect(d.upload).toHaveBeenCalledTimes(2)
    expect(r.done).toEqual({ a: { token: 'ta', assetId: 901, url: '/uploads/1/s901.png' }, c: { token: 'tc', assetId: 902, url: '/uploads/1/s902.png' } }); expect(r.failed).toEqual([])
  })
  it('uploads nothing at all when nothing is listed (candidate discovery never uploads)', async () => {
    const d = deps()
    expect(await uploadChosen([], { a: picked() }, d)).toEqual({ done: {}, failed: [] }); expect(d.upload).not.toHaveBeenCalled()
  })
  it('one failure is reported by file name and never stops or undoes the others', async () => {
    const d = deps({ upload: vi.fn().mockRejectedValueOnce(httpError(413, 'too big')).mockResolvedValueOnce(asset(903)) })
    const r = await uploadChosen(['a', 'b'], { a: picked({ fileName: 'a.png' }), b: picked({ token: 'tb', fileName: 'b.png' }) }, d)
    expect(r.failed).toEqual(['a.png']); expect(Object.keys(r.done)).toEqual(['b'])
  })
  it('turns a pick into an engine reference, adding the asset only once uploaded', () => {
    expect(toImageRef(picked())).toEqual({ source: 'user_upload', width: 600, height: 300, fileName: 'logo.png', hasAlpha: true })
    expect(toImageRef(picked({ source: 'reference_frame_crop', cropRegion: { x: 0, y: 0, w: 0.5, h: 0.5 } }), { assetId: 5, url: '/u' })).toMatchObject({ cropRegion: { w: 0.5 }, assetId: 5, url: '/u' })
  })
})

describe('saving approved layers through the existing draft save', () => {
  const OPTIONS: AssemblyOptions = { underfilled: 'gap', referenceAssetIds: [], requestedElements: [...REQUESTED_ELEMENTS] }
  const vasset = (id: number) => ({ id, job_id: null, user_id: 1, original_filename: `v${id}.mp4`, stored_filename: `s${id}.mp4`, file_path: `/data/uploads/1/s${id}.mp4`, file_type: 'video', file_size: 1, mime_type: 'video/mp4', created_at: '2026-10-01T00:00:00Z' })
  function input(over: Partial<SaveInput> = {}): SaveInput {
    const view = runAssembly({
      plan, library: new Map([readyEntry(vasset(1), 20, p => `/uploads/${p}`), readyEntry(vasset(2), 20, p => `/uploads/${p}`)].map(e => [e.key, e] as const)), referenceAssetIds: [], underfilled: 'gap', createdAt: '2026-10-01T00:00:00.000Z',
      edits: { 1: [newClipEdit('c1', footageKeyFor(1))], 2: [newClipEdit('c2', footageKeyFor(2))] },
    })
    return { resp: resp(), plan, footage: view.footage, assignments: view.assignments, options: OPTIONS, existingDraftId: null, ...over }
  }
  const NOW = () => new Date('2026-10-05T10:00:00Z')
  const layerPlan = () => {
    const { candidates } = candidatesFor({}, [{ id: 'user:1:1', frameId: 1, region: { x: 0.6, y: 0.04, w: 0.3, h: 0.08 } }])
    return planImageLayers(candidates, { 'user:1:1': { start: 1, end: 6 } }, { 'user:1:1': { source: 'user_upload', width: 600, height: 300, fileName: 'logo.png', hasAlpha: true, assetId: 77, url: '/uploads/1/logo.png' } },
      { referenceVideoId: plan.referenceVideoId, videoAnalysisId: 5368, timeMap: makeTimeMap(42.6, plan.totalSeconds), canvas: { width: 1080, height: 1920 }, referenceRightsStatus: 'unknown_third_party', existingOverlays: [], createdAt: '2026-10-05T10:00:00.000Z' })
  }

  it('without layers the saved draft is byte-for-byte what it was before M2.2a', async () => {
    const a = vi.fn().mockResolvedValue({ data: { id: 1 } }), b = vi.fn().mockResolvedValue({ data: { id: 1 } })
    await saveAssembledDraft(input(), { createDraft: a, updateDraft: vi.fn(), now: NOW })
    await saveAssembledDraft(input({ imageLayers: null }), { createDraft: b, updateDraft: vi.fn(), now: NOW })
    expect(JSON.stringify(b.mock.calls[0][0])).toBe(JSON.stringify(a.mock.calls[0][0]))
    expect((a.mock.calls[0][0].project_json as Record<string, unknown>).imageReconstruction).toBeUndefined()
  })
  it('with layers: one draft holds the real clips, the placeholders, the new image layer and the record', async () => {
    const createDraft = vi.fn().mockResolvedValue({ data: { id: 41 } })
    const r = await saveAssembledDraft(input({ imageLayers: layerPlan() }), { createDraft, updateDraft: vi.fn(), now: NOW })
    expect(r).toMatchObject({ ok: true, draftId: 41 })
    const body = createDraft.mock.calls[0][0] as { project_json: { mediaOverlays: { id: string; assetId: number; reconstruction?: { claims: unknown } }[]; videoClips: unknown[]; textOverlays: unknown[]; imageReconstruction: { claims: unknown } } }
    expect(body.project_json.mediaOverlays.map(o => o.id)).toEqual(['ri:5368:user:1:1'])
    expect(body.project_json.mediaOverlays[0]).toMatchObject({ assetId: 77 })
    expect(body.project_json.videoClips.length).toBe(2)
    expect(body.project_json.textOverlays.length).toBeGreaterThan(0)                                        // the blueprint placeholders are untouched
    expect(body.project_json.imageReconstruction.claims).toEqual({ isolated: false, backgroundRemoved: false, burnedInContentRemoved: false, originalResolutionRecovered: false })
  })
  it('a second save updates the same draft and does not duplicate the layer', async () => {
    const createDraft = vi.fn(), updateDraft = vi.fn().mockResolvedValue({})
    const lp = layerPlan()
    await saveAssembledDraft(input({ imageLayers: lp, existingDraftId: 41 }), { createDraft, updateDraft, now: NOW })
    await saveAssembledDraft(input({ imageLayers: lp, existingDraftId: 41 }), { createDraft, updateDraft, now: NOW })
    expect(updateDraft.mock.calls.map(c => (c[1].project_json.mediaOverlays as { id: string }[]).length)).toEqual([1, 1]); expect(createDraft).not.toHaveBeenCalled()
  })
  it('keeps the M1 rules: a stale blueprint is still never turned into a draft, layers or not', async () => {
    const stale = { ...resp(), status: 'stale' } as BlueprintResponse
    expect(await saveAssembledDraft(input({ resp: stale, imageLayers: layerPlan() }), { createDraft: vi.fn(), updateDraft: vi.fn(), now: NOW })).toMatchObject({ ok: false, reason: 'blocked' })
  })
})

// The backend compatibility test (backend/tests/test_image_layers_draft_compat.py) pushes exactly this through the EXISTING drafts API and export schema.
// Regenerate with UPDATE_IMAGELAYER_FIXTURE=1 after an intentional engine change; otherwise any drift fails here. Synthetic data only.
describe('the committed draft fixture is what the engine really produces', () => {
  const FIXTURE = join(__dirname, '__fixtures__', 'imagelayers.draft.parts.json')
  it('matches the engine output for a synthetic slot merged into the VA5368 assembled draft', () => {
    const { candidates } = candidatesFor({}, [{ id: 'user:1:1', frameId: 1, region: { x: 0.6, y: 0.04, w: 0.3, h: 0.08 } }])
    const images = {
      'user:1:1': { source: 'user_upload' as const, width: 600, height: 300, fileName: 'logo.png', hasAlpha: true, assetId: 77, url: '/uploads/1/logo.png' },
      'det:102': { source: 'reference_frame_crop' as const, width: 144, height: 104, fileName: 'reference-crop-f2-600-100.png', hasAlpha: false, cropRegion: { x: 0.6, y: 0.1, w: 0.3, h: 0.12 }, assetId: 78, url: '/uploads/1/crop.png' },
    }
    const p = planImageLayers(candidates, { 'user:1:1': { start: 1, end: 6 }, 'det:102': { rightsAcknowledged: true } }, images,
      { referenceVideoId: 5127, videoAnalysisId: 5368, timeMap: makeTimeMap(42.6, 30), canvas: { width: 1080, height: 1920 }, referenceRightsStatus: 'unknown_third_party', existingOverlays: [], createdAt: '2026-10-05T10:00:00.000Z' })
    const merged = mergeImageLayers(JSON.parse(JSON.stringify(assembledFx.snapshot)), p) as { mediaOverlays: { id: string }[]; imageReconstruction: unknown }
    const parts = { mediaOverlays: p.overlays, imageReconstruction: merged.imageReconstruction, expectedMediaOverlayIds: merged.mediaOverlays.map(o => o.id) }
    const text = JSON.stringify(JSON.parse(JSON.stringify(parts)), null, 1) + String.fromCharCode(10)
    if (process.env.UPDATE_IMAGELAYER_FIXTURE) { mkdirSync(dirname(FIXTURE), { recursive: true }); writeFileSync(FIXTURE, text) }
    expect(existsSync(FIXTURE)).toBe(true)
    expect(JSON.parse(readFileSync(FIXTURE, 'utf8'))).toEqual(JSON.parse(text))
    expect(p.overlays).toHaveLength(2)
  })
})
