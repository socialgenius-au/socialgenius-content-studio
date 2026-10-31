// M2.1a -- approved candidates -> native Video Studio V2 text layers, merged into the REAL M1 assembled-draft shape: placeholders, duplicates, provenance,
// and the Stage-3 export guard. Uses the committed VA5368 assembled-draft fixture (blueprint placeholders at y=72 / 58, 30 s timeline, 7 scenes).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import fixture from '../assembly/__fixtures__/va5368.assembled.snapshot.json'
import type { TextOverlay } from '../../../types'
import { checkReconstructionExport } from '../../video-studio-v2/blueprint/exportGuard'
import { deepFreeze } from './contract'
import { makeTimeMap } from './corrections'
import { mergeTextLayers, planTextLayers, type TextLayerContext } from './materialize'
import { CAST, candidatesFor, reference } from './testkit'
import { buildTextCandidates } from './candidates'
import { readTextEvidence } from './evidence'

interface Snap { textOverlays: TextOverlay[]; videoClips: unknown[]; mediaAssets: unknown[]; timeline: unknown; assembly: unknown; clientIdentity: unknown; blueprintPlan: { blueprintId: string } }
const snap = () => JSON.parse(JSON.stringify(fixture.snapshot)) as Snap                 // the committed JSON types `animation` as a plain string, hence the explicit shape
const placeholders = () => snap().textOverlays
const { candidates } = candidatesFor()
const ctx = (over: Partial<TextLayerContext> = {}): TextLayerContext => ({
  referenceVideoId: 5127, videoAnalysisId: 5368, timeMap: makeTimeMap(42.6, 30), canvas: { width: 1080, height: 1920 },
  existingOverlays: placeholders(), createdAt: '2026-11-01T00:00:00.000Z', ...over,
})
const item = (plan: ReturnType<typeof planTextLayers>, n: number) => plan.items.find(i => i.candidateId === `text:${n}`)!

describe('what is included, and why the rest is not', () => {
  const plan = planTextLayers(candidates, {}, ctx())
  it('includes a clear, confident item that does not collide with anything', () => {
    expect(item(plan, 7).status).toBe('included')                                // "Great Offer" sits high in the frame; the placeholders sit low
    expect(plan.overlays.map(o => o.id)).toContain('rc:5368:text:7')
  })
  it('says why each default exclusion is excluded', () => {
    expect(item(plan, 6)).toMatchObject({ status: 'excluded_default' }); expect(item(plan, 6).message).toMatch(/account handle/)
    expect(item(plan, 5).message).toMatch(/31%/)
    expect(item(plan, 4).message).toMatch(/35%/)                                    // "X" is both a fragment and low-confidence; the first reason is shown
    const frag = buildTextCandidates(readTextEvidence(reference({ texts: [{ id: 90, text: 'X', box: [0.3, 0.3, 0.05, 0.03], conf: 0.95, obs: [{ t: 3 }] }] }), 5368))
    expect(planTextLayers(frag, {}, ctx()).items[0].message).toMatch(/single character/)
  })
  it('records what a person chose to leave out as their choice', () => {
    const p = planTextLayers(candidates, { 'text:7': { include: false } }, ctx())
    expect(item(p, 7)).toMatchObject({ status: 'excluded_user', message: 'Left out by you.' })
  })
  it('lets a person include the excluded-by-default handle (it is a default, not a block)', () => {
    const p = planTextLayers(candidates, { 'text:6': { include: true } }, ctx())
    expect(item(p, 6).status).toBe('included')
  })
  it('refuses empty wording', () => {
    expect(item(planTextLayers(candidates, { 'text:7': { text: '  ' } }, ctx()), 7).status).toBe('invalid')
  })
})

describe('blueprint placeholders: conflicts are never silent', () => {
  it('blocks an item that lands on a placeholder and names the scene', () => {
    const p = planTextLayers(candidates, {}, ctx())
    const i = item(p, 1)
    expect(i.status).toBe('blocked_conflict'); expect(i.message).toMatch(/text placeholder for scene 1/)
    expect(i.conflictsWith).toContain('bp:' + snap().blueprintPlan.blueprintId + ':s1:text')
    expect(p.overlays.find(o => o.id === 'rc:5368:text:1')).toBeUndefined()
  })
  it('replaces the placeholder when the person says so: the placeholder goes, the layer keeps its scene link', () => {
    const p = planTextLayers(candidates, { 'text:1': { replacePlaceholder: true } }, ctx())
    const layer = p.overlays.find(o => o.id === 'rc:5368:text:1')!
    expect(item(p, 1).status).toBe('included'); expect(item(p, 1).replaces!.length).toBeGreaterThanOrEqual(1)
    expect(p.removePlaceholderIds).toEqual(item(p, 1).replaces!.slice().sort())
    expect(layer.blueprint).toMatchObject({ kind: 'text', referenceVideoId: 5127 })
    expect(layer.blueprint!.sectionNumber).toBe(1)
  })
  it('leaves every placeholder that is not replaced exactly where it is', () => {
    const p = planTextLayers(candidates, { 'text:1': { replacePlaceholder: true } }, ctx())
    const merged = mergeTextLayers(snap(), p)
    const ids = merged.textOverlays.map(o => o.id)
    for (const gone of p.removePlaceholderIds) expect(ids).not.toContain(gone)
    expect(merged.textOverlays.filter(o => o.id.startsWith('bp:')).length).toBe(8 - p.removePlaceholderIds.length)
  })
  it('does not conflict with a placeholder it only shares a time with (different part of the frame)', () => {
    const p = planTextLayers(candidates, {}, ctx())
    expect(item(p, 2).status).toBe('included')                                   // y=80%, below the placeholder band
  })
})

describe('timeline: mapping and limits', () => {
  it('stretches the reference onto the blueprint length by default', () => {
    const p = planTextLayers(candidates, { 'text:7': { include: true } }, ctx())
    const l = p.overlays.find(o => o.id === 'rc:5368:text:7')!
    expect(l.endTime).toBeLessThanOrEqual(30); expect(l.startTime).toBeGreaterThan(0)
    expect(p.record.timeMap.mode).toBe('fit')
  })
  it('keeps reference seconds when asked, and reports text that then falls after the draft ends', () => {
    const late = buildTextCandidates(readTextEvidence(reference({ texts: [{ id: 80, text: 'Very late words', box: [0.1, 0.1, 0.4, 0.035], conf: 0.9, obs: [{ t: 40 }] }, { id: 82, text: 'Neighbour before', box: [0.1, 0.5, 0.4, 0.035], conf: 0.9, obs: [{ t: 36 }] }, { id: 83, text: 'Neighbour after', box: [0.1, 0.6, 0.4, 0.035], conf: 0.9, obs: [{ t: 42 }] }] }), 5368))
    const p = planTextLayers(late, {}, ctx({ timeMap: makeTimeMap(42.6, 30, 'identity') }))
    const i = p.items.find(x => x.candidateId === 'text:80')!
    expect(i).toMatchObject({ status: 'outside_timeline' }); expect(i.message).toMatch(/after the draft ends/)
    expect(p.overlays.find(o => o.id === 'rc:5368:text:80')).toBeUndefined()
  })
  it('clips a layer that straddles the end of the draft instead of dropping it', () => {
    const edge = buildTextCandidates(readTextEvidence(reference({ texts: [{ id: 81, text: 'Near the end', box: [0.1, 0.1, 0.4, 0.035], conf: 0.9, obs: [{ t: 28 }] }] }), 5368))
    const p = planTextLayers(edge, { 'text:81': { start: 28, end: 36 } }, ctx({ timeMap: makeTimeMap(42.6, 30, 'identity') }))
    expect(p.overlays[0]).toMatchObject({ startTime: 28, endTime: 30 })
  })
})

describe('duplicates', () => {
  it('never adds the same layer twice: a layer already in the draft is skipped', () => {
    const first = planTextLayers(candidates, {}, ctx())
    const again = planTextLayers(candidates, {}, ctx({ existingOverlays: [...placeholders(), ...first.overlays] }))
    expect(item(again, 7)).toMatchObject({ status: 'duplicate' }); expect(item(again, 7).message).toMatch(/already in the draft/)
    expect(again.overlays.find(o => o.id === 'rc:5368:text:7')).toBeUndefined()
  })
  it('merging the same plan twice changes nothing the second time', () => {
    const plan = planTextLayers(candidates, {}, ctx())
    const once = mergeTextLayers(snap(), plan)
    const twice = mergeTextLayers(once, plan)
    expect(twice.textOverlays).toEqual(once.textOverlays)
  })
  it('skips text the draft already has at the same place and time, even if it was not made by this tool', () => {
    const manual: TextOverlay = { id: 'manual-1', text: 'great offer', x: 9, y: 9, width: 50, startTime: 0, endTime: 30, fontFamily: 'Inter', fontSize: 40, bold: false, italic: false, color: '#fff', bgColor: 'transparent', bgOpacity: 0, animation: 'none' }
    const p = planTextLayers(candidates, {}, ctx({ existingOverlays: [...placeholders(), manual] }))
    expect(item(p, 7)).toMatchObject({ status: 'duplicate' })
  })
  it('catches two selected items that a correction made identical', () => {
    const p = planTextLayers(candidates, { 'text:2': { text: 'Great Offer', x: 9, y: 9, start: 18, end: 22 }, 'text:7': { x: 9, y: 9, start: 18, end: 22 } }, ctx())
    expect([item(p, 2).status, item(p, 7).status].sort()).toEqual(['duplicate', 'included'])
  })
})

describe('provenance carried by every layer', () => {
  const plan = planTextLayers(candidates, { 'text:7': { text: 'Fresh new wording', color: '#00ff88' } }, ctx())
  const layer = plan.overlays.find(o => o.id === 'rc:5368:text:7')!
  it('is a native, editable text overlay with the editor’s own fields', () => {
    expect(layer).toMatchObject({ text: 'Fresh new wording', fontFamily: 'Inter', bold: false, italic: false, bgColor: 'transparent', animation: 'none', color: '#00ff88' })
    expect(layer.x).toBeGreaterThanOrEqual(0); expect(layer.width).toBeGreaterThan(0); expect(layer.endTime).toBeGreaterThan(layer.startTime)
  })
  it('records the evidence, the source confidence and where each property came from', () => {
    const r = layer.reconstruction!
    expect(r).toMatchObject({ schema: 'reconstruction-v1', kind: 'text', candidateId: 'text:7', referenceVideoId: 5127, videoAnalysisId: 5368, sourceConfidence: 0.88 })
    expect(r.evidence.map(e => e.kind)).toEqual(['ocr_group', 'ocr_observation', 'ocr_observation'])
    expect(r.properties.text.basis).toBe('user'); expect(r.properties.color.basis).toBe('user')
    expect(r.properties.fontSize.basis).toBe('inferred'); expect(r.properties.startTime.basis).toBe('inferred'); expect(r.properties.fontFamily.basis).toBe('default')
    expect(r.corrected.sort()).toEqual(['color', 'text'])
  })
  it('labels an uncorrected reading as measured and an uncorrected colour as a default', () => {
    const p = planTextLayers(candidates, {}, ctx())
    const r = p.overlays.find(o => o.id === 'rc:5368:text:7')!.reconstruction!
    expect(r.properties.text.basis).toBe('measured'); expect(r.properties.color.basis).toBe('default'); expect(r.corrected).toEqual([])
  })
  it('states plainly what it does NOT claim', () => {
    expect(plan.record.claims).toEqual({ burnedInTextRemoved: false, originalFontsRecovered: false, originalLayersRecovered: false, backgroundPixelsRecovered: false })
    expect(plan.record.limitations.join(' ')).toMatch(/still burned into/)
    expect(plan.record.counts.detected).toBe(CAST.length)
  })
  it('survives JSON (the drafts API stores plain JSON)', () => {
    expect(JSON.parse(JSON.stringify(layer))).toEqual(layer)
  })
})

describe('merging into a draft snapshot', () => {
  const plan = planTextLayers(candidates, { 'text:1': { replacePlaceholder: true } }, ctx())
  it('adds the layers and the record, replaces only what was chosen, and passes everything else through untouched', () => {
    const base = snap()
    const merged = mergeTextLayers(base, plan)
    expect(merged.reconstruction).toBe(plan.record)
    for (const k of ['videoClips', 'timeline', 'assembly', 'blueprintPlan', 'mediaAssets', 'clientIdentity'] as const) expect(merged[k]).toEqual(base[k])
    expect(merged.textOverlays.length).toBe(8 - plan.removePlaceholderIds.length + plan.overlays.length)
  })
  it('never mutates the snapshot it was given', () => {
    const base = deepFreeze(snap())
    expect(() => mergeTextLayers(base, plan)).not.toThrow()
  })
  it('is a no-op without a plan', () => {
    const base = snap()
    expect(mergeTextLayers(base, null)).toBe(base)
    expect(mergeTextLayers(base, undefined)).toBe(base)
  })
  it('produces JSON the existing drafts API can store and return unchanged', () => {
    const merged = mergeTextLayers(snap(), plan)
    expect(JSON.parse(JSON.stringify(merged))).toEqual(merged)
  })
})

describe('the Stage-3 export guard still protects a reconstruction', () => {
  const clips = (gap: boolean) => [{ startTime: 0, endTime: gap ? 4 : 5 }, { startTime: 5, endTime: 30 }]
  it('blocks export while any blueprint placeholder is still in the draft', () => {
    const merged = mergeTextLayers(snap(), planTextLayers(candidates, { 'text:1': { replacePlaceholder: true } }, ctx()))
    const r = checkReconstructionExport(merged.textOverlays, clips(false))
    expect(r.ok).toBe(false); expect(r.ok === false && r.code).toBe('placeholders')
  })
  it('keeps the gap check alive once the placeholders are replaced, because a replacing layer keeps its scene link', () => {
    const plan = planTextLayers(candidates, { 'text:1': { replacePlaceholder: true } }, ctx())
    const layers = plan.overlays.filter(o => o.blueprint)                               // what is left of a draft whose placeholders were all replaced
    expect(layers.length).toBeGreaterThan(0)
    expect(checkReconstructionExport(layers, clips(true))).toMatchObject({ ok: false, code: 'gaps' })
    expect(checkReconstructionExport(layers, clips(false))).toEqual({ ok: true })       // real wording, gapless timeline: allowed
  })
})

// The backend compatibility test (backend/tests/test_text_layers_draft_compat.py) pushes exactly this through the EXISTING drafts API and export schema.
// Regenerate with UPDATE_TEXTLAYER_FIXTURE=1 after an intentional engine change; otherwise any drift fails here. Synthetic data only.
describe('the committed draft fixture is what the engine really produces', () => {
  const FIXTURE = join(__dirname, '__fixtures__', 'textlayers.draft.parts.json')
  it('matches the engine output for the synthetic cast merged into the VA5368 assembled draft', () => {
    const plan = planTextLayers(candidates, { 'text:1': { replacePlaceholder: true }, 'text:6': { include: true, text: 'My own brand line' } }, ctx())
    const merged = mergeTextLayers(snap(), plan)
    const parts = { removePlaceholderIds: plan.removePlaceholderIds, textOverlays: plan.overlays, reconstruction: merged.reconstruction, expectedOverlayIds: merged.textOverlays.map(o => o.id) }
    const text = JSON.stringify(JSON.parse(JSON.stringify(parts)), null, 1) + String.fromCharCode(10)
    if (process.env.UPDATE_TEXTLAYER_FIXTURE) { mkdirSync(dirname(FIXTURE), { recursive: true }); writeFileSync(FIXTURE, text) }
    expect(existsSync(FIXTURE)).toBe(true)
    expect(JSON.parse(readFileSync(FIXTURE, 'utf8'))).toEqual(JSON.parse(text))
    expect(plan.overlays.length).toBeGreaterThanOrEqual(3)
  })
})
