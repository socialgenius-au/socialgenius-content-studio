// M2.2a -- Stage A: the independent engine. Evidence is read and frozen; candidates, geometry and timing are honest; corrections stay apart; layers are native
// MediaOverlay objects whose box has the picture's own proportions; provenance never over-claims; merging is idempotent.
import { describe, expect, it } from 'vitest'
import type { MediaOverlay } from '../../../types'
import { buildImageCandidates, LOW_CONFIDENCE, type ManualRegion } from './candidates'
import { LIMITATIONS, NO_CLAIMS } from './contract'
import { makeTimeMap, resolveImageCandidate, setImageCorrection } from './corrections'
import { readImageEvidence } from './evidence'
import { boxAspect, clampRegion, cropPixels, fitContain, isValidRegion, rectFromPoints, sameRegion } from './geometry'
import { layerId, mergeImageLayers, planImageLayers, type ImageLayerContext } from './materialize'
import { estimateFrameTiming } from './timing'
import { candidatesFor, evidenceFor, pending, reference, uploaded } from './testkit'

const CANVAS = { width: 1080, height: 1920 }
const ctx = (over: Partial<ImageLayerContext> = {}): ImageLayerContext => ({
  referenceVideoId: 5127, videoAnalysisId: 5368, timeMap: makeTimeMap(42.6, 42.6), canvas: CANVAS, referenceRightsStatus: 'unknown_third_party', existingOverlays: [], createdAt: '2026-10-30T00:00:00.000Z', ...over,
})
const drawn = (over: Partial<ManualRegion> = {}): ManualRegion => ({ id: 'user:1:1', frameId: 1, region: { x: 0.1, y: 0.05, w: 0.3, h: 0.1 }, ...over })

describe('evidence', () => {
  const e = evidenceFor()
  it('reads frames and detections from the existing response, in time order, and nothing else', () => {
    expect(e.frames.map(f => f.id)).toEqual([1, 2, 3, 4])
    expect(e.detections.map(d => d.id)).toEqual([105, 101, 102, 103, 104])           // 105 has no still, so it falls back to its stored time (0 s) and sorts first
    expect(e.durationSeconds).toBe(42.6)
    expect(e.frameSize).toEqual({ width: 480, height: 864 })
    expect(e.rightsStatus).toBe('unknown_third_party')
  })
  it('keeps the detector label and score verbatim and links a detection to its still', () => {
    const laptop = e.detections.find(d => d.id === 102)!
    expect(laptop).toMatchObject({ label: 'laptop', category: 'object', confidence: 0.88, frameId: 2, timestamp: 5 })
    expect(e.detections.find(d => d.id === 105)!.frameId).toBeNull()                 // its still is unknown: kept as evidence, but unusable as a slot
  })
  it('keeps only the part of a box that lies inside the frame', () => {
    const tv = e.detections.find(d => d.id === 104)!
    expect(tv.box.x + tv.box.w).toBeCloseTo(1, 6)
    expect(tv.box.w).toBeCloseTo(0.3, 6)
  })
  it('is deep-frozen: nothing can edit it afterwards', () => {
    expect(Object.isFrozen(e)).toBe(true); expect(Object.isFrozen(e.frames[0])).toBe(true); expect(Object.isFrozen(e.detections[0].box)).toBe(true)
    expect(() => { (e.detections[0] as { label: string }).label = 'x' }).toThrow()
  })
  it('does not touch the response it reads', () => {
    const r = reference(); const before = JSON.stringify(r)
    readImageEvidence(r, 5368)
    expect(JSON.stringify(r)).toBe(before)
  })
  it('tolerates a response with no detections, no stills or no technical details', () => {
    expect(evidenceFor({ detections: [] }).detections).toEqual([])
    const bare = readImageEvidence({ id: 1, shots: [] }, 1)
    expect(bare).toMatchObject({ frames: [], detections: [], durationSeconds: null, frameSize: null })
    expect(evidenceFor({ noFrames: true }).frames).toEqual([])
  })
})

describe('candidates', () => {
  const { candidates } = candidatesFor()
  const by = (id: string) => candidates.find(c => c.id === id)!
  it('makes one candidate per detection that has a still; a detection with no still is not offered', () => {
    expect(candidates.map(c => c.id)).toEqual(['det:101', 'det:102', 'det:103', 'det:104'])
  })
  it('excludes detected people by default and says why', () => {
    expect(by('det:101').defaultInclude).toBe(false)
    expect(by('det:101').flags.map(f => f.code)).toContain('person_detected')
  })
  it('excludes low-confidence detections by default but includes a confident object', () => {
    expect(by('det:103').defaultInclude).toBe(false); expect(by('det:103').flags.map(f => f.code)).toContain('low_confidence')
    expect(by('det:102').defaultInclude).toBe(true)
    expect(0.31).toBeLessThan(LOW_CONFIDENCE)
  })
  it('never calls a detected region an extracted or isolated object: it is a labelled bounding box on one frame', () => {
    const box = by('det:102').flags.find(f => f.code === 'box_only')!
    expect(box.message).toContain('bounding box'); expect(box.message).toContain('not outlined or separated')
    expect(JSON.stringify(candidates)).not.toMatch(/isolated|extracted|cut out|logo found/i)
    expect(by('det:102').label).toBe('laptop (detector label)')
  })
  it('flags a single sighting and inferred timing on every candidate', () => {
    for (const c of candidates) expect(c.flags.map(f => f.code)).toEqual(expect.arrayContaining(['single_frame', 'timing_inferred']))
  })
  it('adds a region the person drew, included by default, with no evidence behind it', () => {
    const all = buildImageCandidates(evidenceFor(), [drawn()])
    const m = all.find(c => c.id === 'user:1:1')!
    expect(m).toMatchObject({ origin: 'user_region', defaultInclude: true, sourceConfidence: null, evidence: [] })
    expect(m.flags.map(f => f.code)).not.toContain('box_only')
  })
  it('ignores a drawn region on a frame that does not exist', () => {
    expect(buildImageCandidates(evidenceFor(), [drawn({ frameId: 999 })]).some(c => c.id === 'user:1:1')).toBe(false)
  })
  it('flags a region too small to hold an image', () => {
    const tiny = buildImageCandidates(evidenceFor(), [drawn({ region: { x: 0.1, y: 0.1, w: 0.004, h: 0.2 } })]).find(c => c.id === 'user:1:1')!
    expect(tiny.flags.map(f => f.code)).toContain('region_too_small')
  })
  it('does not change the evidence', () => {
    const e = evidenceFor(); const before = JSON.stringify(e)
    buildImageCandidates(e, [drawn()])
    expect(JSON.stringify(e)).toBe(before)
  })
})

describe('timing (single sighting = inferred, not an observed duration)', () => {
  const e = evidenceFor()
  it('puts start and end in the middle of the gaps to the neighbouring sampled frames of the SAME scene', () => {
    const t = estimateFrameTiming(e.frames[1], e.frames)                      // frame at 5 s, neighbours at 0.15 s and 10 s
    expect(t.observedAt).toBe(5)
    expect(t.start).toBeCloseTo((0.15 + 5) / 2, 2); expect(t.end).toBeCloseTo((5 + 10) / 2, 2)             // the midpoints of the two gaps
    expect(t.startUncertainty).toBeCloseTo((5 - 0.15) / 2, 2); expect(t.endUncertainty).toBeCloseTo(2.5, 2)
  })
  it('does not borrow a neighbour from another scene', () => {
    const t = estimateFrameTiming(e.frames[3], e.frames)                      // the only frame of the second scene (40.2 s, scene 40-42.6)
    expect(t.start).toBeGreaterThanOrEqual(40); expect(t.shotStart).toBe(40)
  })
  it('never makes a span shorter than the minimum visible time', () => {
    for (const f of e.frames) { const t = estimateFrameTiming(f, e.frames); expect(t.end - t.start).toBeGreaterThanOrEqual(0.5 - 1e-9) }
  })
  it('exposes the scene bounds for a "whole scene" choice', () => {
    const t = estimateFrameTiming(e.frames[0], e.frames)
    expect([t.shotStart, t.shotEnd]).toEqual([0, 40])
  })
})

describe('geometry: the picture is never stretched', () => {
  it('fits a wide picture inside a tall region, centred, with the picture’s own aspect ratio', () => {
    const fit = fitContain({ x: 0.1, y: 0.1, w: 0.4, h: 0.3 }, { width: 600, height: 300 }, CANVAS)!
    expect(boxAspect(fit.box, CANVAS)).toBeCloseTo(2, 3)
    expect(fit.box.x).toBeGreaterThanOrEqual(10 - 1e-6); expect(fit.box.x + fit.box.width).toBeLessThanOrEqual(50 + 1e-6)
    expect(fit.box.y).toBeGreaterThanOrEqual(10 - 1e-6); expect(fit.box.y + fit.box.height).toBeLessThanOrEqual(40 + 1e-6)
    expect(fit.box.x + fit.box.width / 2).toBeCloseTo(30, 2)                  // centred horizontally in the region
    expect(fit.box.y + fit.box.height / 2).toBeCloseTo(25, 2)                 // and vertically
  })
  it.each([
    [{ width: 600, height: 300 }], [{ width: 300, height: 600 }], [{ width: 512, height: 512 }], [{ width: 1920, height: 1080 }], [{ width: 37, height: 211 }],
  ])('keeps the aspect for any picture and any canvas: %j', image => {
    for (const canvas of [{ width: 1080, height: 1920 }, { width: 1080, height: 1080 }, { width: 1920, height: 1080 }, { width: 1080, height: 566 }]) {
      const fit = fitContain({ x: 0.2, y: 0.3, w: 0.35, h: 0.2 }, image, canvas)!
      expect(boxAspect(fit.box, canvas)).toBeCloseTo(image.width / image.height, 2)
      expect(fit.box.x).toBeGreaterThanOrEqual(20 - 1e-3); expect(fit.box.y).toBeGreaterThanOrEqual(30 - 1e-3)
      expect(fit.box.x + fit.box.width).toBeLessThanOrEqual(55 + 1e-2); expect(fit.box.y + fit.box.height).toBeLessThanOrEqual(50 + 1e-2)
    }
  })
  it('reports how much the picture is enlarged', () => {
    const fit = fitContain({ x: 0, y: 0, w: 0.5, h: 0.5 }, { width: 270, height: 480 }, CANVAS)!     // region 540x960 px, picture 270x480 -> 2x
    expect(fit.scale).toBeCloseTo(2, 2); expect(fit.pixelWidth).toBe(540)
  })
  it('refuses a region or picture without a usable size', () => {
    expect(fitContain({ x: 0, y: 0, w: 0.005, h: 0.5 }, { width: 10, height: 10 })).toBeNull()
    expect(fitContain({ x: 0, y: 0, w: 0.5, h: 0.5 }, { width: 0, height: 10 })).toBeNull()
    expect(isValidRegion({ x: 0, y: 0, w: 0.01, h: 0.01 })).toBe(true)
  })
  it('turns two points into a clamped region, whatever the drag direction', () => {
    expect(rectFromPoints({ x: 0.6, y: 0.7 }, { x: 0.2, y: 0.1 })).toEqual({ x: 0.2, y: 0.1, w: 0.4, h: 0.6 })
    expect(rectFromPoints({ x: 0.9, y: 0.9 }, { x: 1.4, y: 1.4 })).toEqual({ x: 0.9, y: 0.9, w: 0.1, h: 0.1 })
    expect(clampRegion({ x: -0.2, y: 0.5, w: 2, h: 0.2 })).toEqual({ x: 0, y: 0.5, w: 1, h: 0.2 })
    expect(sameRegion({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, { x: 0.1004, y: 0.1, w: 0.2, h: 0.2 })).toBe(true)
  })
  it('works out the pixel size of a crop', () => {
    expect(cropPixels({ x: 0, y: 0, w: 0.5, h: 0.25 }, { width: 480, height: 864 })).toEqual({ width: 240, height: 216 })
    expect(cropPixels({ x: 0, y: 0, w: 0.5, h: 0.25 }, { width: null, height: null })).toBeNull()
  })
})

describe('corrections stay apart from the evidence', () => {
  const { candidates, evidence } = candidatesFor()
  const c = candidates.find(x => x.id === 'det:102')!
  const map = makeTimeMap(42.6, 42.6)
  it('applies a correction without touching the candidate or the evidence', () => {
    const before = JSON.stringify([c, evidence])
    const r = resolveImageCandidate(c, { region: { x: 0.5, y: 0.1, w: 0.2, h: 0.1 }, start: 2, end: 6 }, map)
    expect(r.region).toMatchObject({ value: { x: 0.5, y: 0.1, w: 0.2, h: 0.1 }, basis: 'user' })
    expect(r.start).toMatchObject({ value: 2, basis: 'user' }); expect(r.corrected).toEqual(['region', 'startTime', 'endTime'])
    expect(JSON.stringify([c, evidence])).toBe(before)
  })
  it('labels the detector’s box measured, a drawn region user, and times inferred until a person sets them', () => {
    const r = resolveImageCandidate(c, undefined, map)
    expect(r.region.basis).toBe('measured'); expect(r.start.basis).toBe('inferred'); expect(r.start.confidence).toBe('low')
    const m = buildImageCandidates(evidence, [drawn()]).find(x => x.id === 'user:1:1')!
    expect(resolveImageCandidate(m, undefined, map).region.basis).toBe('user')
  })
  it('ignores malformed or out-of-range corrections and reports them', () => {
    const r = resolveImageCandidate(c, { region: { x: 0.1, y: 0.1, w: 0.001, h: 0.5 }, start: -3, end: Number.NaN }, map)
    expect(r.region.basis).toBe('measured'); expect(r.ignored).toEqual(expect.arrayContaining(['region', 'startTime', 'endTime'])); expect(r.corrected).toEqual([])
  })
  it('keeps a minimum visible time and maps times onto a differently long draft', () => {
    expect(resolveImageCandidate(c, { start: 3, end: 3.1 }, map).end.value).toBeCloseTo(3.5, 3)
    const fit = makeTimeMap(42.6, 21.3)
    expect(resolveImageCandidate(c, undefined, fit).start.value).toBeCloseTo(c.timing.start / 2, 2)
  })
  it('sets and clears corrections immutably', () => {
    const a = setImageCorrection({}, 'det:102', { include: false })
    expect(a).toEqual({ 'det:102': { include: false } })
    expect(setImageCorrection(a, 'det:102', { include: undefined })).toEqual({})
    expect(a).toEqual({ 'det:102': { include: false } })
  })
})

describe('plan: statuses and the rights gate', () => {
  const { candidates } = candidatesFor({}, [drawn()])
  const plan = (images = {}, corrections = {}, over: Partial<ImageLayerContext> = {}) => planImageLayers(candidates, corrections, images, ctx(over))
  const status = (p: ReturnType<typeof plan>, id: string) => p.items.find(i => i.candidateId === id)!.status
  it('adds nothing until a picture is chosen, and says what each slot is waiting for', () => {
    const p = plan()
    expect(p.overlays).toEqual([])
    expect(status(p, 'det:101')).toBe('excluded_default'); expect(status(p, 'det:102')).toBe('needs_image'); expect(status(p, 'user:1:1')).toBe('needs_image')
  })
  it('leaves a person out unless the person chooses it', () => {
    expect(status(plan({ 'det:101': uploaded() }), 'det:101')).toBe('excluded_default')
    expect(status(plan({ 'det:101': uploaded() }, { 'det:101': { include: true } }), 'det:101')).toBe('included')
    expect(status(plan({}, { 'det:102': { include: false } }), 'det:102')).toBe('excluded_user')
  })
  it('a chosen but not yet uploaded picture is ready to upload and makes no layer', () => {
    const p = plan({ 'user:1:1': pending() })
    expect(status(p, 'user:1:1')).toBe('ready_to_upload'); expect(p.overlays).toEqual([]); expect(p.items.find(i => i.candidateId === 'user:1:1')!.box).toBeDefined()
  })
  it('a crop of the reference needs the rights confirmation, and only then becomes a layer', () => {
    const crop = uploaded({ source: 'reference_frame_crop', cropRegion: { x: 0.1, y: 0.05, w: 0.3, h: 0.1 }, fileName: 'frame-crop.png', hasAlpha: false })
    expect(status(plan({ 'user:1:1': crop }), 'user:1:1')).toBe('needs_rights')
    const ok = plan({ 'user:1:1': crop }, { 'user:1:1': { rightsAcknowledged: true } })
    expect(status(ok, 'user:1:1')).toBe('included')
    expect(ok.overlays[0].reconstruction!.image).toMatchObject({ source: 'reference_frame_crop', rightsAcknowledged: true, referenceRightsStatus: 'unknown_third_party' })
  })
  it('a crop made for one region no longer matches after the region is changed', () => {
    const crop = uploaded({ source: 'reference_frame_crop', cropRegion: { x: 0.1, y: 0.05, w: 0.3, h: 0.1 } })
    const p = plan({ 'user:1:1': crop }, { 'user:1:1': { rightsAcknowledged: true, region: { x: 0.2, y: 0.05, w: 0.3, h: 0.1 } } })
    expect(status(p, 'user:1:1')).toBe('crop_outdated')
  })
  it('an upload never needs the rights gate', () => {
    expect(status(plan({ 'user:1:1': uploaded() }), 'user:1:1')).toBe('included')
  })
  it('moves a slot that appears after the draft ends to “outside”, and ignores an id already in the draft', () => {
    const late = plan({ 'det:104': uploaded() }, {}, { timeMap: makeTimeMap(42.6, 10, 'identity') })
    expect(status(late, 'det:104')).toBe('outside_timeline')
    const first = plan({ 'user:1:1': uploaded() })
    const again = plan({ 'user:1:1': uploaded() }, {}, { existingOverlays: first.overlays })
    expect(status(again, 'user:1:1')).toBe('duplicate')
  })
  it('reports an unusable picture size', () => {
    expect(status(plan({ 'user:1:1': uploaded({ width: 0 }) }), 'user:1:1')).toBe('invalid')
  })
})

describe('layers: native MediaOverlay objects', () => {
  const { candidates } = candidatesFor({}, [drawn()])
  const p = planImageLayers(candidates, { 'user:1:1': { start: 1, end: 4 } }, { 'user:1:1': uploaded() }, ctx())
  const layer = p.overlays[0]
  it('is a plain MediaOverlay the editor already understands', () => {
    expect(p.overlays).toHaveLength(1)
    expect(layer).toMatchObject({ id: layerId(5368, { id: 'user:1:1' }), assetId: 77, url: '/uploads/1/logo.png', opacity: 1, startTime: 1, endTime: 4 })
    for (const k of ['x', 'y', 'width', 'height'] as const) expect(layer[k]).toEqual(expect.any(Number))
    expect(layer.order).toBeUndefined()
  })
  it('keeps the picture’s proportions inside the region the person marked, and keeps that region as it was', () => {
    expect(boxAspect(layer, CANVAS)).toBeCloseTo(2, 2)                                           // 600x300
    expect(layer.x).toBeGreaterThanOrEqual(10 - 1e-6); expect(layer.x + layer.width).toBeLessThanOrEqual(40 + 1e-6)
    expect(layer.reconstruction!.region).toEqual({ x: 0.1, y: 0.05, w: 0.3, h: 0.1 })
  })
  it('carries provenance: origin, frame, image source, bases, corrections and claims that are all false', () => {
    const r = layer.reconstruction!
    expect(r).toMatchObject({ schema: 'reconstruction-v1', kind: 'image', origin: 'user_region', candidateId: 'user:1:1', referenceVideoId: 5127, videoAnalysisId: 5368, evidence: [] })
    expect(r.frame).toMatchObject({ id: 1, timestamp: 0.15, width: 480, height: 864 })
    expect(r.image).toMatchObject({ source: 'user_upload', assetId: 77, width: 600, height: 300, hasAlpha: true }); expect(r.image.rightsAcknowledged).toBeUndefined()
    expect(r.properties.startTime.basis).toBe('user'); expect(r.properties.region.basis).toBe('user'); expect(r.properties.box.basis).toBe('inferred'); expect(r.properties.opacity.basis).toBe('default')
    expect(r.corrected).toEqual(['startTime', 'endTime'])
    expect(r.claims).toEqual({ isolated: false, backgroundRemoved: false, burnedInContentRemoved: false, originalResolutionRecovered: false })
  })
  it('a detected slot records the evidence it came from and the detector’s score', () => {
    const q = planImageLayers(candidates, {}, { 'det:102': uploaded() }, ctx())
    const r = q.overlays[0].reconstruction!
    expect(r).toMatchObject({ origin: 'detected_region', evidence: [{ kind: 'visual_object', id: 102 }], sourceConfidence: 0.88 }); expect(r.properties.region.basis).toBe('measured')
  })
  it('the record never claims extraction, isolation or removal', () => {
    expect(p.record.claims).toEqual(NO_CLAIMS)
    expect(p.record.limitations).toEqual([...LIMITATIONS])
    expect(JSON.stringify(p.record)).not.toMatch(/"(isolated|backgroundRemoved|burnedInContentRemoved|originalResolutionRecovered)":true/)
    expect(p.record.counts).toMatchObject({ detected: 4, drawn: 1, included: 1 })
  })
  it('the signature changes when what a save would write changes', () => {
    const moved = planImageLayers(candidates, { 'user:1:1': { start: 1, end: 5 } }, { 'user:1:1': uploaded() }, ctx())
    expect(moved.signature).not.toBe(p.signature)
    expect(planImageLayers(candidates, { 'user:1:1': { start: 1, end: 4 } }, { 'user:1:1': uploaded() }, ctx()).signature).toBe(p.signature)
  })
})

describe('merging into a draft', () => {
  const { candidates } = candidatesFor({}, [drawn()])
  const p = planImageLayers(candidates, {}, { 'user:1:1': uploaded() }, ctx())
  const existing: MediaOverlay = { id: 'old', url: 'u', assetId: 1, x: 1, y: 1, width: 5, height: 5, opacity: 1, startTime: 0, endTime: 1 }
  const snap = { name: 'd', textOverlays: [], mediaOverlays: [existing], videoClips: [{ id: 'c' }] }
  it('adds the layers, keeps what is there, attaches the record, and leaves other fields alone', () => {
    const out = mergeImageLayers(snap, p) as typeof snap & { imageReconstruction: unknown }
    expect(out.mediaOverlays.map(o => o.id)).toEqual(['old', p.overlays[0].id])
    expect(out.videoClips).toBe(snap.videoClips); expect(out.imageReconstruction).toBe(p.record); expect(snap.mediaOverlays).toHaveLength(1)
  })
  it('is idempotent: merging the same plan again adds nothing more', () => {
    const once = mergeImageLayers(snap, p) as typeof snap
    const twice = mergeImageLayers(once, p) as typeof snap
    expect(twice.mediaOverlays.map(o => o.id)).toEqual(once.mediaOverlays.map(o => o.id))
  })
  it('returns the snapshot itself when there is nothing to add', () => {
    expect(mergeImageLayers(snap, null)).toBe(snap)
    expect(mergeImageLayers(snap, planImageLayers(candidates, {}, {}, ctx()))).toBe(snap)
  })
  it('works on the assembled snapshot whose mediaOverlays is an empty list', () => {
    const empty = { mediaOverlays: [] as never[], x: 1 }
    expect((mergeImageLayers(empty, p) as unknown as { mediaOverlays: unknown[] }).mediaOverlays).toHaveLength(1)
  })
})
