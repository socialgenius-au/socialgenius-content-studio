// Inferred image slots: a mark the analysis linked across several moments from repeated on-screen text (a possible watermark or logo). It is a third kind of slot beside a detector's box (measured)
// and a region you drew (set by you): never included by default, never called a detection, and filled with your own image like any other slot.
import { describe, expect, it } from 'vitest'
import type { ReferenceVideo, TextElementSummary } from '../../../types'
import { buildImageCandidates } from './candidates'
import { makeTimeMap } from './corrections'
import { readImageEvidence } from './evidence'
import { mergeImageLayers, planImageLayers } from './materialize'
import { framePath, reference, uploaded } from './testkit'

const text = (id: number, frameId: number, t: number, box: [number, number, number, number], words = '@creator_mark'): TextElementSummary => ({
  id, text: words, start_time: t, end_time: t + 1, x: box[0], y: box[1], width: box[2], height: box[3], certainty: 'MEASURED', confidence_score: 0.9, category: null, style_details: null,
  evidence_summary: null, produced_by_pass: null, source_frame_asset_file_path: framePath(frameId), observations: [],
})
const rec = (id: number, members: number[], first = 0.15, last = 40.2, conf: number | null = 0.93) => ({ id, member_text_element_ids: members, start_time: first, end_time: last, certainty: 'INFERRED', confidence_score: conf, reasoning: null, evidence_summary: null, produced_by_pass: 'recurring_text_linkage_v1' })

function withRecurring(recurring: ReturnType<typeof rec>[], texts: TextElementSummary[][]) {
  const r = reference({ detections: [] })
  r.shots = r.shots.map((s, i) => ({ ...s, text_elements: texts[i] ?? [] }))
  return { ...r, recurring_elements: recurring } as unknown as ReferenceVideo
}
const members = [text(1, 1, 0.15, [0.6, 0.04, 0.3, 0.05]), text(2, 2, 5, [0.62, 0.05, 0.28, 0.05]), text(3, 3, 10, [0.61, 0.04, 0.3, 0.06])]
const refOk = () => withRecurring([rec(7, [1, 2, 3, 4])], [members, [text(4, 4, 40.2, [0.6, 0.04, 0.3, 0.05])]])

describe('reading a recurring mark from the stored analysis', () => {
  it('links the members to their stills and keeps the median box and the outer bounds, changing nothing it read', () => {
    const input = refOk(); const before = JSON.stringify(input)
    const ev = readImageEvidence(input, 5368)
    expect(JSON.stringify(input)).toBe(before)
    expect(ev.recurring).toHaveLength(1)
    expect(ev.recurring[0]).toMatchObject({ id: 7, members: 4, first: 0.15, last: 40.2, confidence: 0.93, frameId: 1, text: '@creator_mark' })
    expect(ev.recurring[0].box).toEqual({ x: 0.605, y: 0.04, w: 0.3, h: 0.05 })                  // the median of four readings (0.60, 0.60, 0.61, 0.62)
    expect(Object.isFrozen(ev.recurring)).toBe(true)
  })
  it('ignores a recurring element it cannot place: fewer than two readable members, or none read on a still it has', () => {
    expect(readImageEvidence(withRecurring([rec(8, [1])], [members, []]), 5368).recurring).toEqual([])
    expect(readImageEvidence(withRecurring([rec(9, [1, 2])], [[{ ...members[0], source_frame_asset_file_path: '/elsewhere.jpg' }, { ...members[1], source_frame_asset_file_path: null }], []]), 5368).recurring).toEqual([])
    expect(readImageEvidence({ ...reference({ detections: [] }) }, 5368).recurring).toEqual([])                      // an analysis with no recurring elements (older ones too)
  })
})

describe('the candidate', () => {
  const cand = () => buildImageCandidates(readImageEvidence(refOk(), 5368)).find(c => c.origin === 'inferred_region')!
  it('is its own kind, labelled as inferred, never detected, and left out unless you choose it', () => {
    const c = cand()
    expect(c).toMatchObject({ id: 'rec:7', origin: 'inferred_region', defaultInclude: false, sourceConfidence: 0.93, evidence: [{ kind: 'recurring_element', id: 7 }] })
    expect(c.label).toContain('inferred'); expect(c.label).not.toMatch(/detect/i)
    expect(c.flags.map(f => f.code)).toEqual(expect.arrayContaining(['recurring_inferred', 'span_outer_bounds', 'box_only']))
    expect(c.flags.find(f => f.code === 'recurring_inferred')!.message).toMatch(/Inferred, not detected/)
    expect(c.flags.find(f => f.code === 'span_outer_bounds')!.severity).toBe('warning')
  })
  it('spans the outer bounds of its sightings and does not pretend a start or end is uncertain by a frame gap', () => {
    expect(cand().timing).toMatchObject({ start: 0.15, end: 40.2, startUncertainty: 0, endUncertainty: 0, observedAt: 0.15 })
  })
})

describe('filling the slot with your own image', () => {
  const ctx = { referenceVideoId: 5127, videoAnalysisId: 5368, timeMap: makeTimeMap(42.6, 42.6), canvas: { width: 1080, height: 1920 }, referenceRightsStatus: 'unknown_third_party', existingOverlays: [], createdAt: '2026-11-03T00:00:00.000Z' }
  const cands = () => buildImageCandidates(readImageEvidence(refOk(), 5368))
  it('adds nothing until you include it and give it a picture', () => {
    expect(planImageLayers(cands(), {}, {}, ctx).overlays).toEqual([])
    expect(planImageLayers(cands(), { 'rec:7': { include: true } }, {}, ctx).overlays).toEqual([])                      // included but no picture yet
  })
  it('becomes an editable image layer of YOUR image, with its provenance saying it was inferred and what you set', () => {
    const p = planImageLayers(cands(), { 'rec:7': { include: true } }, { 'rec:7': uploaded({ width: 400, height: 100 }) }, ctx)
    expect(p.overlays).toHaveLength(1)
    const o = p.overlays[0]
    const prov = o.reconstruction!
    expect(prov.origin).toBe('inferred_region'); expect(prov.evidence).toEqual([{ kind: 'recurring_element', id: 7 }]); expect(prov.image.source).toBe('user_upload')
    expect(prov.properties.region.basis).toBe('inferred'); expect(prov.properties.image.basis).toBe('user')
    expect(prov.claims).toEqual({ isolated: false, backgroundRemoved: false, burnedInContentRemoved: false, originalResolutionRecovered: false })
    expect(p.record.counts).toMatchObject({ inferred: 1, detected: 0, drawn: 0 })
    const merged = mergeImageLayers({ mediaOverlays: [] as never[] }, p) as unknown as { mediaOverlays: { id: string }[] }
    expect(merged.mediaOverlays).toHaveLength(1)
  })
  it('a region you move is yours; one you leave is inferred', () => {
    const moved = planImageLayers(cands(), { 'rec:7': { include: true, region: { x: 0.1, y: 0.1, w: 0.2, h: 0.1 } } }, { 'rec:7': uploaded() }, ctx).overlays[0].reconstruction!
    expect(moved.properties.region.basis).toBe('user')
  })
})
