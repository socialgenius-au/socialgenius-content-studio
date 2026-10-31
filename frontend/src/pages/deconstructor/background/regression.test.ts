// M2.3 regression: the panel's state must survive unrelated updates, and genuinely different evidence must replace it. The bug this pins: the panel reloaded (and dropped the person's plates
// and colour) whenever assigning footage handed it a NEW plan object with the same ids. There is no DOM test library in this project, so the decision that caused it is a pure function
// (`evidenceKey`) and everything the panel does with its result is exercised here; the live behaviour is covered by the real-browser check.
import { describe, expect, it, vi } from 'vitest'
import bpFx from '../__fixtures__/va5368.c4-blueprint.json'
import type { Asset, ReferenceVideo } from '../../../types'
import type { BlueprintResponse } from '../../../types/deconstructor'
import { buildBlueprintPlan } from '../../video-studio-v2/blueprint/blueprintPlan'
import type { AssemblyOptions } from '../assembly'
import { saveAssembledDraft, type SaveInput } from '../footage/assembledDraft'
import { REQUESTED_ELEMENTS, footageKeyFor, newClipEdit, readyEntry, runAssembly, type LibraryEntry } from '../footage/footageModel'
import { makeTimeMap } from '../textlayers/corrections'
import type { PixelImage } from '../textlayers/appearance'
import { applyComposition, buildPlateCandidates, evidenceKey, loadBackgroundEvidence, mergeBackground, planBackground, setPlateCorrection, type PlateCorrections } from '.'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// ── a plan, rebuilt the way the page rebuilds it ─────────────────────────────────────────────────
const resp = () => JSON.parse(JSON.stringify(bpFx)) as BlueprintResponse
const mkPlan = () => buildBlueprintPlan(resp(), new Date('2026-10-01T00:00:00Z'))

// ── stills with known bars ───────────────────────────────────────────────────────────────────────
type RGB = [number, number, number]
const W = 120, H = 216
function image(pixel: (x: number, y: number) => RGB): PixelImage {
  const data = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const [r, g, b] = pixel(x, y); const i = (y * W + x) * 4; data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255 }
  return { width: W, height: H, data }
}
const noise = (x: number, y: number): RGB => { const v = ((x * 73856093) ^ (y * 19349663)) >>> 0; return [v & 255, (v >> 8) & 255, (v >> 16) & 255] }
const letterbox = (c: RGB) => image((x, y) => (y < Math.round(H * 0.12) || y >= H - Math.round(H * 0.12) ? c : noise(x, y)))
const reader = (byPath: Record<string, PixelImage>) => async (path: string) => byPath[path] ?? null

/** a reference whose every still lives at <name>-<n>.png and covers the plan's whole length */
function referenceOf(id: number, analysisId: number, name: string, seconds: number): ReferenceVideo {
  const frames = [1, 2, 3, 4].map(n => ({ id: id * 100 + n, asset_file_path: `/data/uploads/${name}-${n}.png`, timestamp: (n - 0.5) * (seconds / 4), order: n, width: W, height: H }))
  return { id, latest_analysis: { id: analysisId }, shots: [{ id: id * 10, start_time: 0, end_time: seconds, frames, visual_objects: [] }], technical_details: { video: { width: W, height: H, duration_seconds: seconds } } } as unknown as ReferenceVideo
}
const pixelsFor = (name: string, c: RGB) => Object.fromEntries([1, 2, 3, 4].map(n => [`/data/uploads/${name}-${n}.png`, letterbox(c)]))
const CANVAS = { width: 1080, height: 1920 }

async function evidenceFor(refId: number, analysisId: number, name: string, color: RGB) {
  const p = { ...mkPlan(), referenceVideoId: refId, videoAnalysisId: analysisId }
  const get = vi.fn(async (id: number) => (id === refId ? referenceOf(refId, analysisId, name, 40) : (() => { throw new Error('wrong reference asked for') })()))
  const r = await loadBackgroundEvidence(p, secs => makeTimeMap(secs, p.totalSeconds), get, reader(pixelsFor(name, color)))
  return { r, get, plan: p }
}

describe('the panel reloads for different evidence and only for that', () => {
  it('the key is the reference and the analysis, and a rebuilt plan object has the same key', () => {
    const a = mkPlan(), b = { ...mkPlan(), scenes: mkPlan().scenes.map(s => ({ ...s })), createdAt: 'later' }
    expect(a).not.toBe(b); expect(evidenceKey(a)).toBe(evidenceKey(b))
    expect(evidenceKey({ ...a, referenceVideoId: a.referenceVideoId + 1 })).not.toBe(evidenceKey(a))
    expect(evidenceKey({ ...a, videoAnalysisId: a.videoAnalysisId + 1 })).not.toBe(evidenceKey(a))              // a different blueprint (a new analysis) is different evidence
  })
  it('the container depends on the key, not on the plan object, and clears the review only inside that keyed effect', () => {
    const src = readFileSync(join(__dirname, 'BackgroundReview.tsx'), 'utf8')
    expect(src).toContain('const key = evidenceKey(plan)'); expect(src).toContain('[deps, key]'); expect(src).not.toMatch(/\[deps, plan\]/)
    const effect = src.slice(src.indexOf('useEffect(() => {'), src.indexOf('[deps, key]'))
    expect(effect).toContain('setCorrections({})')                                                           // the reset lives in the keyed effect...
    expect(src.replace(effect, '')).not.toContain('setCorrections({})')                                      // ...and nowhere else
  })
  it('switching to another reference loads THAT reference’s stills, with its own bars and colour', async () => {
    const a = await evidenceFor(11, 91, 'a', [16, 42, 94]), b = await evidenceFor(22, 92, 'b', [200, 30, 30])
    if (a.r.kind !== 'ready' || b.r.kind !== 'ready') throw new Error('not ready')
    expect(a.get).toHaveBeenCalledWith(11); expect(b.get).toHaveBeenCalledWith(22)
    const ca = buildPlateCandidates(a.r.evidence, CANVAS), cb = buildPlateCandidates(b.r.evidence, CANVAS)
    expect(ca.length).toBeGreaterThan(0); expect(cb.length).toBeGreaterThan(0)
    expect(new Set(ca.map(c => c.color))).toEqual(new Set(['#102a5e'])); expect(new Set(cb.map(c => c.color))).toEqual(new Set(['#c81e1e']))
    expect(a.r.evidence.referenceVideoId).toBe(11); expect(b.r.evidence.referenceVideoId).toBe(22)
  })
  it('a blueprint made from a different analysis than the reference now holds is refused, not mixed in', async () => {
    const p = { ...mkPlan(), referenceVideoId: 11, videoAnalysisId: 91 }
    const r = await loadBackgroundEvidence(p, s => makeTimeMap(s, p.totalSeconds), async () => referenceOf(11, 777, 'a', 40), reader(pixelsFor('a', [16, 42, 94])))
    expect(r.kind).toBe('error')
  })
  it('a still that cannot be read is reported as unread, never as a bar, and the others still count', async () => {
    const p = { ...mkPlan(), referenceVideoId: 11, videoAnalysisId: 91 }
    const px = pixelsFor('a', [16, 42, 94]); delete px['/data/uploads/a-2.png']
    const r = await loadBackgroundEvidence(p, s => makeTimeMap(s, p.totalSeconds), async () => referenceOf(11, 91, 'a', 40), reader(px))
    if (r.kind !== 'ready') throw new Error('not ready')
    expect(r.evidence.scenes.reduce((n, s) => n + s.framesUnreadable, 0)).toBe(1)
  })
})

describe('unsaved edits survive unrelated updates', () => {
  it('re-planning from the same evidence and the same corrections gives the identical plan signature, so a footage reassignment never makes a saved draft look edited', async () => {
    const { r, plan } = await evidenceFor(11, 91, 'a', [16, 42, 94])
    if (r.kind !== 'ready') throw new Error('not ready')
    const corr: PlateCorrections = setPlateCorrection({}, buildPlateCandidates(r.evidence, CANVAS)[0].id, { color: '#336699' })
    const mk = (planObject: typeof plan) => planBackground(buildPlateCandidates(r.evidence, CANVAS), corr, { referenceVideoId: planObject.referenceVideoId, videoAnalysisId: planObject.videoAnalysisId, planSeconds: planObject.totalSeconds, existingShapes: [], createdAt: 'x' })
    const one = mk(plan), two = mk({ ...plan, scenes: plan.scenes.map(s => ({ ...s })) })
    expect(one.shapes.length).toBeGreaterThan(0); expect(two.signature).toBe(one.signature)
    expect(one.shapes.some(s => s.fillColor === '#336699')).toBe(true)                                         // the person's colour is in the plan
  })
})

// ── assigning, reassigning, saving, reopening ────────────────────────────────────────────────────
const asset = (id: number): Asset => ({ id, job_id: null, user_id: 1, original_filename: `v${id}.mp4`, stored_filename: `s${id}.mp4`, file_path: `uploads/1/s${id}.mp4`, file_type: 'video', file_size: 1, mime_type: 'video/mp4', created_at: '2026-10-01T00:00:00Z' } as unknown as Asset)
const url = (p: string) => `/uploads/${p.replace(/^uploads\//, '')}`
const lib = (...e: LibraryEntry[]) => new Map(e.map(x => [x.key, x] as const))
const OPTIONS: AssemblyOptions = { underfilled: 'gap', referenceAssetIds: [], requestedElements: REQUESTED_ELEMENTS }
const NOW = () => new Date('2026-10-05T10:00:00Z')

describe('saving and reopening a draft with plates', () => {
  async function plateInput(assignTo: 1 | 2) {
    const { r, plan } = await evidenceFor(5127, 5368, 'a', [16, 42, 94])
    if (r.kind !== 'ready') throw new Error('not ready')
    const bg = planBackground(buildPlateCandidates(r.evidence, CANVAS), {}, { referenceVideoId: plan.referenceVideoId, videoAnalysisId: plan.videoAnalysisId, planSeconds: plan.totalSeconds, existingShapes: [], createdAt: 'x' })
    const bp = buildBlueprintPlan(resp(), new Date('2026-10-01T00:00:00Z'))
    const view = runAssembly({ plan: bp, library: lib(readyEntry(asset(1), 20, url), readyEntry(asset(2), 20, url)), referenceAssetIds: [], underfilled: 'gap', createdAt: '2026-10-01T00:00:00.000Z', edits: { 1: [newClipEdit('c1', footageKeyFor(assignTo))] } })
    const input: SaveInput = { resp: resp(), plan: bp, footage: view.footage, assignments: view.assignments, options: OPTIONS, existingDraftId: null, backgroundPlan: bg, compositionPolicy: 'recommended' }
    return { input, bg }
  }
  it('assigning footage, then reassigning it, writes the same plates both times, and never twice into one draft', async () => {
    const createDraft = vi.fn().mockResolvedValue({ data: { id: 31 } }), updateDraft = vi.fn().mockResolvedValue({})
    const first = await plateInput(1), second = await plateInput(2)
    expect(first.bg.shapes.length).toBeGreaterThan(0)
    await saveAssembledDraft(first.input, { createDraft, updateDraft, now: NOW })
    await saveAssembledDraft({ ...second.input, existingDraftId: 31 }, { createDraft, updateDraft, now: NOW })
    const a = createDraft.mock.calls[0][0].project_json, b = updateDraft.mock.calls[0][1].project_json
    expect(a.videoClips[0].assetId).toBe(1); expect(b.videoClips[0].assetId).toBe(2)                              // the reassignment really changed the footage
    expect(b.shapes.map((s: { id: string }) => s.id)).toEqual(a.shapes.map((s: { id: string }) => s.id)); expect(a.shapes).toHaveLength(first.bg.shapes.length)
    expect(new Set(a.shapes.map((s: { id: string }) => s.id)).size).toBe(a.shapes.length)
    expect(a.backgroundReconstruction.counts.included).toBe(first.bg.shapes.length); expect(a.backgroundReconstruction.claims).toEqual({ backgroundRecovered: false, contentBehindOverlaysRecovered: false, inpainted: false })
  })
  it('reopening and saving the saved draft again adds nothing and changes no plate', async () => {
    const createDraft = vi.fn().mockResolvedValue({ data: { id: 31 } })
    const { input, bg } = await plateInput(1)
    await saveAssembledDraft(input, { createDraft, updateDraft: vi.fn(), now: NOW })
    const saved = JSON.parse(JSON.stringify(createDraft.mock.calls[0][0].project_json))
    const again = applyComposition(mergeBackground(saved, bg), 'recommended')
    expect(again.shapes).toEqual(saved.shapes)
    expect(JSON.stringify(again.shapes.map((s: { id: string; order: number }) => [s.id, s.order]))).toBe(JSON.stringify(saved.shapes.map((s: { id: string; order: number }) => [s.id, s.order])))
  })
  it('the draft the editor receives has the plates as ordinary editable shapes: banner or rectangle, explicit order, times of their scene', async () => {
    const createDraft = vi.fn().mockResolvedValue({ data: { id: 31 } })
    const { input } = await plateInput(1)
    await saveAssembledDraft(input, { createDraft, updateDraft: vi.fn(), now: NOW })
    const shapes = createDraft.mock.calls[0][0].project_json.shapes
    for (const s of shapes) {
      expect(['banner', 'rectangle']).toContain(s.kind); expect(s.order).toBe(-20000); expect(s.endTime).toBeGreaterThan(s.startTime); expect(s.opacity).toBe(1)
      expect(s.reconstruction.kind).toBe('background')
    }
  })
})
