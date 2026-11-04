// M5 -- element reconstruction accounting, tested against fixtures of the M4 contract and of the layers the existing panels generate; plus the actual draft save / JSON round trip / editor-compatibility path.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import bpFx from '../__fixtures__/va5368.c4-blueprint.json'
import type { BlueprintResponse } from '../../../types/deconstructor'
import { buildBlueprintPlan } from '../../video-studio-v2/blueprint/blueprintPlan'
import type { AssemblyOptions } from '../assembly'
import { saveAssembledDraft } from '../footage/assembledDraft'
import { REQUESTED_ELEMENTS, footageKeyFor, newClipEdit, readyEntry, runAssembly } from '../footage/footageModel'
import { candidateIdsOf, ELEMENT_RECONSTRUCTION_SCHEMA, manualRegionFromElement, mergeElementReconstruction, planElementReconstruction, readElementReconstruction, validateVisualElement, type PlanContext } from '.'
import { allMeasuredText, blueprintPlaceholder, brandAsLogo, brandText, caption, el, gradientBar, handle, imageLayer, laptop, lowOcr, person, plate, textLayer, topBar } from './fixtures'

const ctx: PlanContext = { referenceVideoId: 5127, videoAnalysisId: 5368, createdAt: '2026-11-03T00:00:00.000Z' }
const status = (p: ReturnType<typeof planElementReconstruction>, id: string | null) => p.items.find(i => i.elementId === id)!

describe('the M4 contract as M5 consumes it', () => {
  it('every fixture satisfies the contract validator', () => {
    for (const e of [handle(), caption(), person(), laptop(), brandText(), brandAsLogo(), lowOcr(), topBar(), gradientBar()]) expect(validateVisualElement(e), e.id).toEqual([])
  })
  it('the validator rejects what the contract forbids', () => {
    const bad = el({ id: 'tt:grp:9', cls: 'LOGO_MARK', ids: [9], text: 'X', readiness: 'needs_user_asset', basis: 'rule', score: 0.95 })
    const problems = validateVisualElement(bad)
    expect(problems.join(' ')).toMatch(/a rule may not assign LOGO_MARK/); expect(problems.join(' ')).toMatch(/capped at 0\.8/)
    expect(validateVisualElement({ ...handle(), schema: 'visual-element-v2' }).join(' ')).toMatch(/schema/)
    expect(validateVisualElement({ ...handle(), claims: { originalAssetRecovered: true } }).join(' ')).toMatch(/claims/)
    expect(validateVisualElement(null)).toEqual(['not an object'])
  })
})

describe('what became of each element', () => {
  const layers = {
    textOverlays: [textLayer('rt:1247', 1247), textLayer('rt:1259', 1259), textLayer('rt:21', 21, { text: 'user', region: 'measured', startTime: 'inferred', endTime: 'inferred' }, ['text'], 'My own words'), allMeasuredText('rt:31', 31), blueprintPlaceholder('bp:3')],
    mediaOverlays: [imageLayer('ri:1', 'det:102', 'user_upload', 'detected_region')], shapes: [plate('rb:1', 'bg:1:top')],
  }
  const elements = [handle(), caption(), person(), laptop(), brandText(), lowOcr(), topBar(), gradientBar()]
  const p = planElementReconstruction(elements, layers, ctx)

  it('a rebuilt text with inferred timing is approximate, linked to every member group it came from', () => {
    const i = status(p, 'tt:rec:2202')
    expect(i.status).toBe('approximate'); expect(i.layers.map(l => l.id)).toEqual(['rt:1247', 'rt:1259']); expect(i.reasons.join(' ')).toMatch(/inferred/)
  })
  it('wording you set yourself is your own content', () => { expect(status(p, 'tt:grp:21').status).toBe('user_supplied') })
  it('only a layer whose every property is measured is called faithful', () => { expect(status(p, 'tt:grp:31').status).toBe('faithful') })
  it('an image slot filled with your upload is yours; the same slot empty is a missing asset; a person is unsupported', () => {
    expect(status(p, 'ot:det:102').status).toBe('user_supplied')
    const empty = planElementReconstruction([laptop()], { mediaOverlays: [] }, ctx)
    expect(status(empty, 'ot:det:102')).toMatchObject({ status: 'missing_asset', layers: [] })
    expect(status(p, 'ot:det:101').status).toBe('unsupported')
  })
  it('a crop of the reference is approximate and says it includes its background', () => {
    const q = planElementReconstruction([laptop()], { mediaOverlays: [imageLayer('ri:2', 'det:102', 'reference_frame_crop', 'detected_region')] }, ctx)
    expect(status(q, 'ot:det:102').status).toBe('approximate'); expect(status(q, 'ot:det:102').limitations.join(' ')).toMatch(/includes its background/)
  })
  it('a plate is approximate (its timing is inferred); a gradient needs restoration we do not do and is unsupported', () => {
    expect(status(p, 'bt:1:top').status).toBe('approximate'); expect(status(p, 'bt:1:top').layers[0].kind).toBe('shape')
    expect(status(p, 'bt:2:bottom')).toMatchObject({ status: 'unsupported', layers: [] }); expect(status(p, 'bt:2:bottom').limitations.join(' ')).toMatch(/separately approved design/)
  })
  it('text too unsure to read is unsupported, and nothing is silently dropped: every element has an item', () => {
    expect(status(p, 'tt:grp:41').status).toBe('unsupported')
    expect(p.items.filter(i => i.elementId !== null).map(i => i.elementId).sort()).toEqual(elements.map(e => e.id).sort())
  })
  it('a rebuildable element with no layer is "not included", never counted as done', () => {
    const q = planElementReconstruction([caption(), topBar()], {}, ctx)
    expect(q.items.map(i => i.status)).toEqual(['not_included', 'not_included']); expect(q.record.counts).toMatchObject({ elements: 2, not_included: 2, approximate: 0 })
  })
  it('an unreplaced blueprint instruction is reported as a placeholder with no element behind it', () => {
    expect(status(p, null)).toMatchObject({ status: 'placeholder', layers: [{ id: 'bp:3' }] })
  })
  it('an element the person says is a logo is a missing asset until they supply their image, and never text', () => {
    const q = planElementReconstruction([brandAsLogo()], { textOverlays: [] }, ctx)
    expect(status(q, 'tt:grp:31')).toMatchObject({ status: 'missing_asset', class: 'LOGO_MARK', classBasis: 'user' })
    const filled = planElementReconstruction([brandAsLogo()], { mediaOverlays: [imageLayer('ri:9', 'user:ve:tt:grp:31', 'user_upload', 'user_region')] }, ctx)
    expect(status(filled, 'tt:grp:31')).toMatchObject({ status: 'user_supplied' })
  })
  it('every item keeps the evidence it traces to, and the record claims nothing recovered', () => {
    for (const i of p.items.filter(x => x.elementId)) expect(i.evidence.length).toBeGreaterThan(0)
    expect(p.record.claims).toEqual({ originalAssetsRecovered: false, referenceFootageInserted: false, burnedInContentRemoved: false, exactStylesRecovered: false })
    expect(p.record.schema).toBe(ELEMENT_RECONSTRUCTION_SCHEMA)
  })
  it('counts add up', () => {
    const c = p.record.counts
    expect(c.faithful + c.approximate + c.user_supplied + c.placeholder + c.missing_asset + c.not_included + c.unsupported).toBe(p.items.length)
  })
})

describe('linking rules', () => {
  it('maps elements to the existing panels’ candidate ids', () => {
    expect(candidateIdsOf(handle())).toEqual({ text: ['text:1247', 'text:1259', 'text:1301'], image: ['rec:2202', 'user:ve:tt:rec:2202'], shape: [] })
    expect(candidateIdsOf(laptop()).image).toEqual(['det:102', 'user:ve:ot:det:102'])
    expect(candidateIdsOf(topBar()).shape).toEqual(['bg:1:top'])           // a gradient step is its own element (bt:S:side:outer|inner) with its own plate id
  })
  it('a layer from another element is never claimed', () => {
    const q = planElementReconstruction([caption()], { textOverlays: [textLayer('rt:99', 99)] }, ctx)
    expect(status(q, 'tt:grp:21')).toMatchObject({ status: 'not_included', layers: [] })
  })
})

describe('the reference footage rule', () => {
  it('flags a draft that contains the reference’s own asset, and says so in the record', () => {
    const bad = planElementReconstruction([caption()], {}, { ...ctx, referenceAssetIds: [7485], footageAssetIds: [{ id: 'clip1', assetId: 7485 }, { id: 'clip2', assetId: 12 }] })
    expect(bad.record.referenceFootage).toEqual({ checked: 2, violations: ['clip1'] }); expect(bad.record.claims.referenceFootageInserted).toBe(true)
    const ok = planElementReconstruction([caption()], {}, { ...ctx, referenceAssetIds: [7485], footageAssetIds: [{ id: 'clip2', assetId: 12 }] })
    expect(ok.record.referenceFootage.violations).toEqual([]); expect(ok.record.claims.referenceFootageInserted).toBe(false)
  })
})

describe('mapping an element to an image slot the existing panel understands', () => {
  it('uses the analysis’s own box on a sampled still', () => {
    expect(manualRegionFromElement(brandAsLogo())).toEqual({ id: 'user:ve:tt:grp:31', frameId: 4, region: { x: 0.8, y: 0.05, w: 0.15, h: 0.04 } })
  })
  it('returns null when the element was not seen on any still', () => {
    const e = brandAsLogo(); e.track.observations = e.track.observations.map(o => ({ ...o, frameId: null }))
    expect(manualRegionFromElement(e)).toBeNull()
  })
})

describe('merging, saving and reopening', () => {
  const layers = { textOverlays: [textLayer('rt:21', 21)] }
  const plan = planElementReconstruction([caption(), person()], layers, ctx)
  it('adds exactly one key, leaves every layer alone, is idempotent, and is a no-op without a plan', () => {
    const snap = { videoClips: [{ id: 'c' }], textOverlays: layers.textOverlays, shapes: [] }
    const merged = mergeElementReconstruction(snap, plan) as Record<string, unknown>
    expect(Object.keys(merged).sort()).toEqual(['elementReconstruction', 'shapes', 'textOverlays', 'videoClips'])
    expect(merged.textOverlays).toBe(snap.textOverlays); expect(merged.videoClips).toBe(snap.videoClips)
    expect(mergeElementReconstruction(merged, plan)).toEqual(merged)
    expect(mergeElementReconstruction(snap, null)).toBe(snap); expect(mergeElementReconstruction(snap, { ...plan, items: [] })).toBe(snap)
    expect(snap).not.toHaveProperty('elementReconstruction')
  })
  it('survives the real draft save through the drafts API and a JSON round trip, and reads back', async () => {
    const bp = buildBlueprintPlan(JSON.parse(JSON.stringify(bpFx)) as BlueprintResponse, new Date('2026-10-01T00:00:00Z'))
    const asset = (id: number) => ({ id, job_id: null, user_id: 1, original_filename: `v${id}.mp4`, stored_filename: `s${id}.mp4`, file_path: `uploads/1/s${id}.mp4`, file_type: 'video', mime_type: 'video/mp4', file_size: 1, created_at: '2026-10-01T00:00:00Z' }) as never
    const lib = new Map([[footageKeyFor(1), readyEntry(asset(1), 20, p => `/uploads/${p}`)], [footageKeyFor(2), readyEntry(asset(2), 20, p => `/uploads/${p}`)]])
    const options: AssemblyOptions = { underfilled: 'gap', referenceAssetIds: [], requestedElements: REQUESTED_ELEMENTS }
    const view = runAssembly({ plan: bp, library: lib, referenceAssetIds: [], underfilled: 'gap', createdAt: '2026-10-01T00:00:00.000Z', edits: { 1: [newClipEdit('c1', footageKeyFor(1))], 2: [newClipEdit('c2', footageKeyFor(2))] } })
    const base = { resp: JSON.parse(JSON.stringify(bpFx)) as BlueprintResponse, plan: bp, footage: view.footage, assignments: view.assignments, options, existingDraftId: null }
    const without = vi.fn().mockResolvedValue({ data: { id: 1 } }), withPlan = vi.fn().mockResolvedValue({ data: { id: 2 } })
    const NOW = () => new Date('2026-11-03T10:00:00Z')
    await saveAssembledDraft(base, { createDraft: without, updateDraft: vi.fn(), now: NOW })
    await saveAssembledDraft({ ...base, elementPlan: plan }, { createDraft: withPlan, updateDraft: vi.fn(), now: NOW })
    const json = (m: ReturnType<typeof vi.fn>) => JSON.parse(JSON.stringify(m.mock.calls[0][0].project_json))
    const a = json(without), b = json(withPlan)
    expect(a).not.toHaveProperty('elementReconstruction')                                       // a draft saved without the feature is exactly what it was
    const { elementReconstruction, ...rest } = b
    expect(rest).toEqual(a)                                                                     // nothing else in the draft changed
    const back = readElementReconstruction(b)
    expect(back).toEqual(JSON.parse(JSON.stringify(plan.record))); expect(back!.counts.elements).toBe(2)
    expect(readElementReconstruction(a)).toBeNull(); expect(readElementReconstruction(null)).toBeNull(); expect(readElementReconstruction({ elementReconstruction: { schema: 'other' } })).toBeNull()
    expect(elementReconstruction.items.every((i: { status: string }) => ['approximate', 'unsupported'].includes(i.status))).toBe(true)
  })
  it('older editors and the current editor ignore the extra key: the editor reads named keys only and never this one', () => {
    const src = readFileSync(join(__dirname, '../../video-studio-v2/components/CreateEditTab.tsx'), 'utf8').replace(/\r\n/g, '\n')
    const open = src.slice(src.indexOf('(snap.videoClips ?? [])'), src.indexOf('// Requirement 9'))
    const read = new Set([...open.matchAll(/snap\.([A-Za-z]+)/g)].map(m => m[1]))
    expect(read.has('elementReconstruction')).toBe(false); expect(read.size).toBeGreaterThan(10)
  })
  it('is deterministic and does not mutate its inputs', () => {
    const els = [caption(), person()], before = JSON.stringify([els, layers])
    const a = planElementReconstruction(els, layers, ctx), b = planElementReconstruction(els, layers, ctx)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b)); expect(JSON.stringify([els, layers])).toBe(before)
  })
})
