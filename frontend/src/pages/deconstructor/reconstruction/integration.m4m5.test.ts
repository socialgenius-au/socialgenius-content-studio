// M4 + M5 integration: the REAL M4 output (not fixtures) is validated against the contract M5 consumes, then the layers the REAL existing generators (text layers, image layers) produce from the same analysis are
// linked to those elements and accounted for. Synthetic analysis (shaped like the API response); the real VA5368 variant runs only when the local evidence file is present.
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { ReferenceVideo, TextElementSummary } from '../../../types'
import { makeTimeMap } from '../textlayers/corrections'
import { buildTextCandidates } from '../textlayers/candidates'
import { readTextEvidence } from '../textlayers/evidence'
import { planTextLayers } from '../textlayers/materialize'
import { buildImageCandidates } from '../imagelayers/candidates'
import { readImageEvidence } from '../imagelayers/evidence'
import { planImageLayers } from '../imagelayers/materialize'
import { framePath, reference, uploaded } from '../imagelayers/testkit'
import { buildVisualElements, type VisualElement } from '../visual'
import { mergeElementReconstruction, planElementReconstruction, readElementReconstruction, validateVisualElement, type GeneratedLayers } from '.'

const text = (id: number, frameId: number, t: number, box: [number, number, number, number], words: string, conf = 0.9): TextElementSummary => ({
  id, text: words, start_time: t, end_time: t + 1, x: box[0], y: box[1], width: box[2], height: box[3], certainty: 'MEASURED', confidence_score: conf, category: null, style_details: null, evidence_summary: null, produced_by_pass: null,
  source_frame_asset_file_path: framePath(frameId), observations: [{ id: id * 10, text: words, timestamp: t, x: box[0], y: box[1], width: box[2], height: box[3], confidence_score: conf, evidence_summary: null, source_frame_asset_file_path: framePath(frameId) }],
})

function analysis(): ReferenceVideo {
  const r = reference() as unknown as ReferenceVideo & { shots: { id: number; text_elements: TextElementSummary[] }[] }
  r.shots[0].text_elements = [
    text(11, 1, 0.15, [0.6, 0.04, 0.3, 0.03], '@creator_x'), text(12, 2, 5, [0.1, 0.7, 0.3, 0.03], '@creator_x'), text(13, 3, 10, [0.6, 0.04, 0.3, 0.03], '@creator_x'),
    text(14, 2, 5, [0.1, 0.45, 0.6, 0.05], 'Fresh every morning'),
  ]
  ;(r as unknown as { recurring_elements: unknown[] }).recurring_elements = [{ id: 900, member_text_element_ids: [11, 12, 13], start_time: 0.15, end_time: 10, certainty: 'INFERRED', confidence_score: 0.9, reasoning: null, evidence_summary: null, produced_by_pass: 'recurring_text_linkage_v1' }]
  return r
}

describe('M4 output feeds M5 through the versioned contract', () => {
  const ref = analysis()
  const elements = buildVisualElements(ref, { videoAnalysisId: 5368 })
  it('every real M4 element satisfies the contract validator M5 gates on', () => {
    expect(elements.length).toBeGreaterThanOrEqual(6)
    for (const e of elements) expect(validateVisualElement(e), e.id).toEqual([])
  })
  it('the handle is TEXT_HANDLE, the phrase is a caption or other text, the people are UNKNOWN, the laptop is only an image region', () => {
    const cls = (id: string) => elements.find(e => e.id === id)!.classification.class
    expect(cls('tt:rec:900')).toBe('TEXT_HANDLE'); expect(['TEXT_CAPTION', 'TEXT_OTHER']).toContain(cls('tt:grp:14'))
    expect(cls('ot:det:101')).toBe('UNKNOWN'); expect(cls('ot:det:102')).toBe('IMAGE_REGION')
    expect(elements.some(e => ['LOGO_MARK', 'ICON_GRAPHIC', 'SHAPE_GRAPHIC'].includes(e.classification.class))).toBe(false)
  })

  // the layers the real generators make from the SAME analysis once the person has ticked the text and added their own image to the laptop slot
  const ctx = { referenceVideoId: 5127, videoAnalysisId: 5368, timeMap: makeTimeMap(42.6, 42.6), canvas: { width: 1080, height: 1920 }, existingOverlays: [] as never[], createdAt: '2026-11-03T00:00:00.000Z' }
  const textPlan = planTextLayers(buildTextCandidates(readTextEvidence(ref, 5368)), { 'text:11': { include: true }, 'text:12': { include: true }, 'text:13': { include: true }, 'text:14': { include: true } }, ctx)   // as if the person ticked them
  const imgEv = readImageEvidence(ref, 5368)
  const imgPlan = planImageLayers(buildImageCandidates(imgEv), { 'det:102': { include: true } }, { 'det:102': uploaded({ width: 400, height: 200 }) }, { ...ctx, referenceRightsStatus: 'unknown_third_party' })
  const generated: GeneratedLayers = { textOverlays: textPlan.overlays as never, mediaOverlays: imgPlan.overlays as never }

  it('the real generators produced layers, and M5 links each to the element it came from', () => {
    expect(textPlan.overlays.length).toBeGreaterThan(0); expect(imgPlan.overlays).toHaveLength(1)
    const plan = planElementReconstruction(elements, generated, { referenceVideoId: 5127, videoAnalysisId: 5368, createdAt: ctx.createdAt })
    const item = (id: string) => plan.items.find(i => i.elementId === id)!
    expect(item('tt:rec:900').layers.length).toBeGreaterThan(0); expect(item('tt:rec:900').status).toBe('approximate')
    expect(item('ot:det:102')).toMatchObject({ status: 'user_supplied' }); expect(item('ot:det:102').layers[0].kind).toBe('image')
    expect(item('ot:det:101').status).toBe('unsupported')                                                  // a person: never an image layer
    // every layer the generators made is accounted for by exactly one element
    const linked = plan.items.flatMap(i => i.layers.map(l => l.id))
    for (const o of [...textPlan.overlays, ...imgPlan.overlays]) expect(linked.filter(x => x === o.id).length, o.id).toBe(1)
  })
  it('the record survives merge, JSON and reading back, and the layers themselves are untouched', () => {
    const plan = planElementReconstruction(elements, generated, { referenceVideoId: 5127, videoAnalysisId: 5368, createdAt: ctx.createdAt })
    const snap = { textOverlays: textPlan.overlays, mediaOverlays: imgPlan.overlays }
    const saved = JSON.parse(JSON.stringify(mergeElementReconstruction(snap, plan)))
    expect(saved.textOverlays).toEqual(JSON.parse(JSON.stringify(snap.textOverlays))); expect(saved.mediaOverlays).toEqual(JSON.parse(JSON.stringify(snap.mediaOverlays)))
    const back = readElementReconstruction(saved)!
    expect(back.counts.elements).toBe(elements.length); expect(back.claims.originalAssetsRecovered).toBe(false)
  })
})

const file = process.env.M2_REAL_VISUAL_EVIDENCE
const real = !!file && existsSync(file)
;(real ? describe : describe.skip)('real VA5368 through M4 and M5 (local only)', () => {
  it('every real element is valid, and the generators’ real layers are each accounted for once', () => {
    const ref = JSON.parse(readFileSync(file!, 'utf8')) as ReferenceVideo
    const aid = (ref as unknown as { latest_analysis: { id: number } }).latest_analysis.id
    const els: VisualElement[] = buildVisualElements(ref, { videoAnalysisId: aid })
    for (const e of els) expect(validateVisualElement(e), e.id).toEqual([])
    const ctx = { referenceVideoId: ref.id, videoAnalysisId: aid, timeMap: makeTimeMap(42.6, 42.6), canvas: { width: 1080, height: 1920 }, existingOverlays: [] as never[], createdAt: '2026-11-03T00:00:00.000Z' }
    const tp = planTextLayers(buildTextCandidates(readTextEvidence(ref, aid)), {}, ctx)
    const plan = planElementReconstruction(els, { textOverlays: tp.overlays as never }, { referenceVideoId: ref.id, videoAnalysisId: aid, createdAt: ctx.createdAt })
    const linked = plan.items.flatMap(i => i.layers.map(l => l.id))
    for (const o of tp.overlays) expect(linked.filter(x => x === o.id).length, o.id).toBe(1)
    expect(plan.items.filter(i => i.elementId).length).toBe(els.length)
    expect(plan.record.counts.unsupported).toBeGreaterThanOrEqual(9)                                       // the nine people
  })
})
