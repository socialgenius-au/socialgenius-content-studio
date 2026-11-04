// M4/M5 batch 2: background bars as visual elements, and a logo the person classifies becoming a pre-filled image slot that only their own image can fill.
import { describe, expect, it } from 'vitest'
import type { ReferenceVideo } from '../../../types'
import { buildImageCandidates } from '../imagelayers/candidates'
import { makeTimeMap } from '../imagelayers/corrections'
import { readImageEvidence } from '../imagelayers/evidence'
import { planImageLayers } from '../imagelayers/materialize'
import { framePath, pending, reference, uploaded } from '../imagelayers/testkit'
import { candidateIdsOf, manualRegionFromElement, planElementReconstruction, validateVisualElement } from '../reconstruction'
import { plate } from '../reconstruction/fixtures'
import { buildVisualElements, type BarEvidence } from '.'

const bar = (o: Partial<BarEvidence> = {}): BarEvidence => ({ sceneNumber: 1, side: 'top', size: 0.12, color: '#080808', uniformity: 1, framesSeen: 2, framesMeasured: 2, flat: true, startTime: 0, endTime: 10, frameIds: [1], ...o })
const ref = () => reference({ detections: [] }) as unknown as ReferenceVideo

describe('background bars as visual elements', () => {
  const els = buildVisualElements(ref(), { videoAnalysisId: 9, background: [bar(), bar({ side: 'bottom', size: 0.1, color: '#102a5e' }), bar({ sceneNumber: 2, side: 'top', size: 0.1, part: 'outer', flat: false, uniformity: 0.9 }), bar({ sceneNumber: 2, side: 'top', size: 0.1, part: 'inner', offset: 0.1, flat: false, uniformity: 0.9 })] })
  it('every bar and gradient step is its own element with a distinct, analysis-derived id, and satisfies the contract', () => {
    expect(els.map(e => e.id).sort()).toEqual(['bt:1:bottom', 'bt:1:top', 'bt:2:top:inner', 'bt:2:top:outer'])
    for (const e of els) expect(validateVisualElement(e), e.id).toEqual([])
  })
  it('shows position, dimensions, evidence, confidence and readiness', () => {
    const top = els.find(e => e.id === 'bt:1:top')!
    expect(top.box).toEqual({ x: 0, y: 0, w: 1, h: 0.12 }); expect(els.find(e => e.id === 'bt:1:bottom')!.box.y).toBeCloseTo(0.9, 6)
    expect(top.classification).toMatchObject({ class: 'BACKGROUND_ELEMENT', certainty: 'INFERRED' }); expect(top.classification.evidence[0]).toMatchObject({ kind: 'background_measurement', certainty: 'MEASURED' })
    expect(top.readiness.state).toBe('native_shape'); expect(top.classification.confidence.score).toBeLessThanOrEqual(0.8)
    const inner = els.find(e => e.id === 'bt:2:top:inner')!
    expect(inner.box).toEqual({ x: 0, y: 0.1, w: 1, h: 0.1 }); expect(inner.readiness.state).toBe('needs_background_restoration'); expect(inner.classification.confidence.level).toBe('low')
  })
  it('M5 links each to the plate layer the background panel wrote for exactly that bar or step', () => {
    expect(candidateIdsOf(els.find(e => e.id === 'bt:2:top:inner')!).shape).toEqual(['bg:2:top:inner'])
    expect(candidateIdsOf(els.find(e => e.id === 'bt:1:top')!).shape).toEqual(['bg:1:top'])
    const p = planElementReconstruction(els, { shapes: [plate('rb:1', 'bg:1:top'), plate('rb:3', 'bg:2:top:inner')] }, { referenceVideoId: 1, videoAnalysisId: 9, createdAt: 'x' })
    const st = Object.fromEntries(p.items.map(i => [i.elementId, i.status]))
    expect(st).toEqual({ 'bt:1:bottom': 'not_included', 'bt:1:top': 'approximate', 'bt:2:top:inner': 'approximate', 'bt:2:top:outer': 'unsupported' })
  })
})

describe('a logo the person classifies becomes a pre-filled slot that only their own image fills', () => {
  // an element the analysis read as the text BRAND on a sampled still, which the person says is a logo
  const raw = ref() as unknown as { shots: { text_elements: unknown[] }[] }
  raw.shots[0].text_elements = [{
    id: 31, text: 'BRAND', start_time: 5, end_time: 6, x: 0.8, y: 0.05, width: 0.15, height: 0.04, certainty: 'MEASURED', confidence_score: 0.9, category: null, style_details: null, evidence_summary: null, produced_by_pass: null, source_frame_asset_file_path: framePath(2),
    observations: [{ id: 3101, text: 'BRAND', timestamp: 5, x: 0.8, y: 0.05, width: 0.15, height: 0.04, confidence_score: 0.9, evidence_summary: null, source_frame_asset_file_path: framePath(2) }],
  }]
  const base = buildVisualElements(raw as unknown as ReferenceVideo, { videoAnalysisId: 5368 })[0]
  const logo = buildVisualElements(raw as unknown as ReferenceVideo, { videoAnalysisId: 5368, corrections: { [base.id]: { class: 'LOGO_MARK' } } })[0]
  const slot = { ...manualRegionFromElement(logo)!, source: { elementId: logo.id, classLabel: 'Logo or mark (set by you)', summary: 'BRAND', evidence: logo.classification.evidence.filter(x => x.kind !== 'user_correction').map(x => ({ kind: x.kind, id: x.id, certainty: x.certainty })) } }
  const evidence = readImageEvidence(raw as unknown as ReferenceVideo, 5368)
  const ctx = { referenceVideoId: 1, videoAnalysisId: 5368, timeMap: makeTimeMap(42.6, 42.6), canvas: { width: 1080, height: 1920 }, referenceRightsStatus: 'unknown_third_party', existingOverlays: [] as never[], createdAt: '2026-11-03T00:00:00.000Z' }

  it('the person’s class is theirs, and the analysis’s own class stays visible as an alternative', () => {
    expect(base.classification.class).not.toBe('LOGO_MARK')
    expect(logo.classification).toMatchObject({ class: 'LOGO_MARK', basis: 'user', certainty: 'OBSERVED' }); expect(logo.classification.alternatives[0].class).toBe(base.classification.class)
    expect(logo.readiness.state).toBe('needs_user_asset')
  })
  it('the slot is pre-filled with the analysis’s box on its frame, labelled as made from the person’s classification, and requires their own image', () => {
    const c = buildImageCandidates(evidence, [slot]).find(x => x.id === slot.id)!
    expect(c).toMatchObject({ origin: 'user_region', userAssetRequired: true, region: { x: 0.8, y: 0.05, w: 0.15, h: 0.04 } })
    expect(c.label).toMatch(/you classified as logo or mark/i); expect(c.flags.some(f => f.code === 'from_classified_element')).toBe(true); expect(c.source!.evidence.map(e => e.kind)).toEqual(['text_element'])
  })
  it('without an image it is a missing asset; a crop of the reference is refused; their own image makes an editable layer with the source evidence in its provenance', () => {
    const cands = buildImageCandidates(evidence, [slot])
    expect(planImageLayers(cands, { [slot.id]: { include: true } }, {}, ctx).items.find(i => i.candidateId === slot.id)).toMatchObject({ status: 'needs_image' })
    const crop = planImageLayers(cands, { [slot.id]: { include: true, rightsAcknowledged: true } }, { [slot.id]: { source: 'reference_frame_crop', width: 100, height: 40, fileName: 'c.png', hasAlpha: false, assetId: 9, url: '/u/c.png' } }, ctx)
    expect(crop.overlays).toEqual([]); expect(crop.items.find(i => i.candidateId === slot.id)!.message).toMatch(/only your own image/)
    expect(planImageLayers(cands, { [slot.id]: { include: true } }, { [slot.id]: pending({ width: 400, height: 100 }) }, ctx).items.find(i => i.candidateId === slot.id)!.status).toBe('ready_to_upload')
    const ok = planImageLayers(cands, { [slot.id]: { include: true } }, { [slot.id]: uploaded({ width: 400, height: 100 }) }, ctx)
    expect(ok.overlays).toHaveLength(1)
    const prov = ok.overlays[0].reconstruction!
    expect(prov).toMatchObject({ origin: 'user_region', image: { source: 'user_upload' }, claims: { isolated: false, backgroundRemoved: false, burnedInContentRemoved: false, originalResolutionRecovered: false } })
    expect(prov.properties.region.basis).toBe('user'); expect(prov.properties.region.note).toMatch(/you classified it as logo or mark/i); expect(prov.properties.region.note).toMatch(/text_element 31/)
  })
  it('M5 then accounts for it: missing asset before, your own content after, both traced to the element and its evidence', () => {
    const ctx2 = { referenceVideoId: 1, videoAnalysisId: 5368, createdAt: 'x' }
    expect(planElementReconstruction([logo], { mediaOverlays: [] }, ctx2).items[0]).toMatchObject({ status: 'missing_asset', class: 'LOGO_MARK', classBasis: 'user' })
    const ok = planImageLayers(buildImageCandidates(evidence, [slot]), { [slot.id]: { include: true } }, { [slot.id]: uploaded({ width: 400, height: 100 }) }, ctx)
    const item = planElementReconstruction([logo], { mediaOverlays: ok.overlays as never }, ctx2).items[0]
    expect(item).toMatchObject({ status: 'user_supplied', layers: [{ kind: 'image' }] }); expect(item.evidence.some(e => e.kind === 'user_correction')).toBe(true); expect(item.evidence.some(e => e.kind === 'text_element')).toBe(true)
  })
})
