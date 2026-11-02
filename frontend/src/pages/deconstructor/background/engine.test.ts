// M2.3a-c, f -- the background engine on synthetic stills whose bars, colours and gradients are known exactly, so every figure can be checked to the pixel.
import { describe, expect, it } from 'vitest'
import type { ImageEvidenceInput } from '../imagelayers/evidence'
import { makeTimeMap } from '../textlayers/corrections'
import type { PixelImage } from '../textlayers/appearance'
import {
  applyComposition, backgroundManifest, bucketOf, buildBackgroundEvidence, buildPlateCandidates, compositionManifest, measureFrame, measureFrames, mergeBackground, planBackground,
  planComposition, setPlateCorrection, PLATE_ORDER, type FrameBackground,
} from '.'

type RGB = [number, number, number]
function image(w: number, h: number, pixel: (x: number, y: number) => RGB): PixelImage {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [r, g, b] = pixel(x, y); const i = (y * w + x) * 4; data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255 }
  return { width: w, height: h, data }
}
// deterministic "busy picture": hash noise, no randomness
const noise = (x: number, y: number): RGB => { const v = ((x * 73856093) ^ (y * 19349663)) >>> 0; return [v & 255, (v >> 8) & 255, (v >> 16) & 255] }
const W = 120, H = 216                                                                          // 9:16, like the reference stills

const letterbox = (bar: number, color: RGB) => image(W, H, (x, y) => (y < Math.round(H * bar) || y >= H - Math.round(H * bar) ? color : noise(x, y)))
const pillarbox = (bar: number, color: RGB) => image(W, H, (x, y) => (x < Math.round(W * bar) || x >= W - Math.round(W * bar) ? color : noise(x, y)))

describe('M2.3a measuring one still', () => {
  it('finds letterbox bars to the pixel, with their colour', () => {
    const m = measureFrame(letterbox(0.12, [0, 0, 0]))
    const top = m.bars.find(b => b.side === 'top')!, bottom = m.bars.find(b => b.side === 'bottom')!
    expect(top.size).toBeCloseTo(Math.round(H * 0.12) / H, 3); expect(bottom.size).toBeCloseTo(Math.round(H * 0.12) / H, 3)
    expect(top.color).toBe('#000000'); expect(top.uniformity).toBeGreaterThan(0.99)
    expect(m.bars.some(b => b.side === 'left' || b.side === 'right')).toBe(false)
  })
  it('finds pillarbox bars and a non-black colour', () => {
    const m = measureFrame(pillarbox(0.1, [32, 64, 128]))
    expect(m.bars.map(b => b.side).sort()).toEqual(['left', 'right'])
    expect(m.bars[0].color).toBe('#204080'); expect(m.bars[0].size).toBeCloseTo(Math.round(W * 0.1) / W, 3)
  })
  it('reports no bars on a busy picture and invents none', () => {
    const m = measureFrame(image(W, H, noise))
    expect(m.bars).toEqual([]); expect(m.variance).toBe('busy'); expect(m.uniformFrame).toBe(false)
  })
  it('does not call a blank still a bar', () => {
    const m = measureFrame(image(W, H, () => [20, 20, 20]))
    expect(m.bars).toEqual([]); expect(m.uniformFrame).toBe(true)
  })
  it('ignores a band that is too thin or too thick to be a bar', () => {
    expect(measureFrame(letterbox(0.005, [0, 0, 0])).bars).toEqual([])                         // under 2%
    expect(measureFrame(image(W, H, (x, y) => (y < H * 0.6 ? [0, 0, 0] : noise(x, y)))).bars.some(b => b.side === 'top')).toBe(false)   // over 45%
  })
  it('tells a plain border from a smooth gradient from a busy one', () => {
    expect(measureFrame(letterbox(0.1, [10, 10, 10])).variance).toBe('solid')               // flat bars were measured: the background is those bars
    expect(measureFrame(image(W, H, (x, y) => (x < 8 || x >= W - 8 || y < 12 || y >= H - 12 ? [200, 30, 30] : noise(x, y)))).variance).toBe('solid')   // a plain frame around a picture
    expect(measureFrame(image(W, H, (_x, y) => { const v = Math.round(40 + (y / H) * 160); return [v, v, v] })).variance).toBe('gradient')
    expect(measureFrame(image(W, H, noise)).variance).toBe('busy')
    expect(measureFrame(image(W, H, (x, y) => { const v = 31 + ((x + y) % 24); return [v, v, v] })).variance).toBe('solid')           // a dark, almost-flat background with slight variation
  })
  it('is deterministic and survives bad input', () => {
    const a = letterbox(0.08, [5, 5, 5])
    expect(JSON.stringify(measureFrame(a))).toBe(JSON.stringify(measureFrame(a)))
    expect(measureFrame({ width: 2, height: 2, data: new Uint8ClampedArray(16) }).bars).toEqual([])
    expect(measureFrame({ width: W, height: H, data: new Uint8ClampedArray(10) }).bars).toEqual([])
  })
})

// ── evidence ────────────────────────────────────────────────────────────────────────────────
const frame = (id: number, t: number) => ({ id, asset_file_path: `f${id}.png`, timestamp: t, order: id, width: W, height: H })
const ref = (frames: ReturnType<typeof frame>[]) => ({ id: 1, shots: [{ id: 1, start_time: 0, end_time: 20, frames, visual_objects: [] }], technical_details: { video: { width: W, height: H, duration_seconds: 20 } } }) as unknown as ImageEvidenceInput
const SCENES = [{ sceneNumber: 1, startTime: 0, endTime: 10 }, { sceneNumber: 2, startTime: 10, endTime: 20 }]
const MAP = makeTimeMap(20, 20)
const withBars = (bar: number, c: RGB): FrameBackground => measureFrame(letterbox(bar, c))

describe('M2.3a scene evidence', () => {
  const frames = [frame(1, 2), frame(2, 6), frame(3, 12), frame(4, 16)]
  const meas = new Map<number, FrameBackground | null>([[1, withBars(0.1, [0, 0, 0])], [2, withBars(0.1, [0, 0, 0])], [3, measureFrame(image(W, H, noise))], [4, null]])
  const ev = buildBackgroundEvidence(ref(frames), 9, meas, SCENES, MAP)
  it('puts each still in its scene and keeps bars only where they were seen', () => {
    expect(ev.scenes[0].bars.map(b => [b.side, b.framesSeen]).sort()).toEqual([['bottom', 2], ['top', 2]])
    expect(ev.scenes[1].bars).toEqual([]); expect(ev.scenes[1].framesMeasured).toBe(1); expect(ev.scenes[1].framesUnreadable).toBe(1)
  })
  it('is frozen: later steps cannot change it', () => {
    expect(Object.isFrozen(ev)).toBe(true); expect(Object.isFrozen(ev.scenes[0].bars[0])).toBe(true)
  })
  it('reads stills through an injectable reader and treats a failure as "not read"', async () => {
    const out = await measureFrames(buildFrames(), async p => { if (p === 'f2.png') throw new Error('refused'); return p === 'f3.png' ? null : letterbox(0.1, [0, 0, 0]) }, measureFrame)
    expect(out.get(1)?.bars.length).toBe(2); expect(out.get(2)).toBeNull(); expect(out.get(3)).toBeNull()
  })
  function buildFrames() {
    return frames.slice(0, 3).map(f => ({ id: f.id, shotId: 1, shotStart: 0, shotEnd: 20, order: f.order, timestamp: f.timestamp, path: f.asset_file_path, width: W, height: H }))
  }
})

// ── candidates, plan, merge ─────────────────────────────────────────────────────────────────
const CANVAS = { width: 1080, height: 1920 }
const evidence = (m: Map<number, FrameBackground | null>, frames = [frame(1, 2), frame(2, 6)]) => buildBackgroundEvidence(ref(frames), 9, m, SCENES, MAP)
const goodMeas = new Map<number, FrameBackground | null>([[1, withBars(0.1, [0, 0, 0])], [2, withBars(0.1, [0, 0, 0])]])
const ctx = { referenceVideoId: 1, videoAnalysisId: 9, planSeconds: 20, existingShapes: [] as { id: string }[], createdAt: '2026-10-30T00:00:00.000Z' }

describe('M2.3b candidates and plates', () => {
  const cands = buildPlateCandidates(evidence(goodMeas), CANVAS)
  it('one candidate per measured bar, included by default only when it is safe', () => {
    expect(cands.map(c => c.id).sort()).toEqual(['bg:1:bottom', 'bg:1:top']); expect(cands.every(c => c.includeByDefault)).toBe(true)
  })
  it('does not include by default a bar seen on only some stills, or when the reference and canvas differ in shape', () => {
    const some = new Map(goodMeas); some.set(2, measureFrame(image(W, H, noise)))
    expect(buildPlateCandidates(evidence(some), CANVAS).every(c => !c.includeByDefault && c.flags.some(f => f.code === 'seen_in_some_frames'))).toBe(true)
    const wide = buildPlateCandidates(evidence(goodMeas), { width: 1920, height: 1080 })
    expect(wide.every(c => !c.includeByDefault && c.flags.some(f => f.code === 'aspect_differs'))).toBe(true)
  })
  const plan = planBackground(cands, {}, ctx)
  it('writes each plate in its bar, for its scene, under everything else, with provenance', () => {
    expect(plan.shapes).toHaveLength(2)
    const top = plan.shapes.find(s => s.id.endsWith('bg:1:top'))!, bottom = plan.shapes.find(s => s.id.endsWith('bg:1:bottom'))!
    expect([top.x, top.y, top.width, top.fullWidth, top.kind]).toEqual([0, 0, 100, true, 'banner'])
    expect(top.height).toBeCloseTo(10.2, 1); expect(bottom.y).toBeCloseTo(100 - bottom.height, 3)
    expect([top.startTime, top.endTime, top.order, top.fillColor, top.opacity]).toEqual([0, 10, PLATE_ORDER, '#000000', 1])
    expect(top.reconstruction).toMatchObject({ kind: 'background', sceneNumber: 1, side: 'top', claims: { backgroundRecovered: false, contentBehindOverlaysRecovered: false, inpainted: false } })
    expect(top.reconstruction?.properties.color.basis).toBe('measured')
  })
  it('side bars are rectangles from the edge', () => {
    const p = planBackground(buildPlateCandidates(evidence(new Map([[1, measureFrame(pillarbox(0.1, [32, 64, 128]))], [2, measureFrame(pillarbox(0.1, [32, 64, 128]))]])), CANVAS), {}, ctx)
    const left = p.shapes.find(s => s.id.endsWith(':left'))!, right = p.shapes.find(s => s.id.endsWith(':right'))!
    expect([left.kind, left.x, left.y, left.height, right.x + right.width]).toEqual(['rectangle', 0, 0, 100, 100]); expect(left.fillColor).toBe('#204080')
  })
  it('a colour you choose is marked as yours; an exclusion removes the plate', () => {
    const c = setPlateCorrection(setPlateCorrection({}, 'bg:1:top', { color: '#112233' }), 'bg:1:bottom', { include: false })
    const p = planBackground(cands, c, ctx)
    expect(p.shapes).toHaveLength(1); expect(p.shapes[0].fillColor).toBe('#112233'); expect(p.shapes[0].reconstruction?.properties.color.basis).toBe('user')
    expect(p.items.find(i => i.candidateId === 'bg:1:bottom')?.status).toBe('excluded_user'); expect(bucketOf(p.shapes[0].reconstruction)).toBe('manual')
    expect(setPlateCorrection({}, 'x', { color: 'red' })).toEqual({})                          // not a colour: ignored
  })
  it('is a no-op to merge nothing, never duplicates, and leaves everything else on the snapshot alone', () => {
    const snap = { shapes: [] as unknown[], textOverlays: [{ id: 't' }], keep: 1 }
    expect(mergeBackground(snap, null)).toBe(snap); expect(mergeBackground(snap, planBackground([], {}, ctx))).toBe(snap)
    const once = mergeBackground(snap, plan) as typeof snap & { backgroundReconstruction: unknown }
    expect(once.shapes).toHaveLength(2); expect(once.keep).toBe(1); expect(once.textOverlays).toBe(snap.textOverlays); expect(once.backgroundReconstruction).toBeDefined()
    expect((mergeBackground(once, plan) as typeof once).shapes).toHaveLength(2)
    expect(planBackground(cands, {}, { ...ctx, existingShapes: once.shapes as { id: string }[] }).items.every(i => i.status === 'duplicate')).toBe(true)
  })
  it('does not add a plate for a scene that starts after the draft ends', () => {
    expect(planBackground(cands, {}, { ...ctx, planSeconds: 0.05 }).items.every(i => i.status === 'outside_timeline')).toBe(true)
  })
})

// ── M2.3c composition, M2.3f manifest ────────────────────────────────────────────────────────
describe('M2.3c composition ordering', () => {
  const snap = () => ({
    shapes: [{ id: 'rb:9:bg:1:top', order: PLATE_ORDER }, { id: 'rb:9:bg:2:top', order: 0 }, { id: 'mine', order: 0 }],
    mediaOverlays: [{ id: 'ri:9:a', order: 0 }, { id: 'mine-img', order: 0 }],
    textOverlays: [{ id: 'rc:9:t', order: 0 }],
    subtitles: [{ id: 'rs:9:a', order: -1 }, { id: 'rs:9:b', order: -2 }, { id: 'my-sub', order: -1 }],
  })
  it('as_generated changes nothing', () => {
    const s = snap(); expect(applyComposition(s, 'as_generated')).toBe(s); expect(applyComposition(s, null)).toBe(s); expect(planComposition(s, 'as_generated').changes).toEqual([])
  })
  it('recommended: plates under pictures under text under subtitles, and only the Reconstructor’s own layers move', () => {
    const out = applyComposition(snap(), 'recommended') as ReturnType<typeof snap>
    const o = (arr: { id: string; order?: number }[], id: string) => arr.find(x => x.id === id)?.order
    expect(o(out.shapes, 'rb:9:bg:1:top')).toBe(PLATE_ORDER); expect(o(out.shapes, 'rb:9:bg:2:top')).toBe(PLATE_ORDER)
    expect(o(out.mediaOverlays, 'ri:9:a')).toBe(-10000); expect(o(out.textOverlays, 'rc:9:t')).toBe(0)
    expect(o(out.subtitles, 'rs:9:a')).toBe(10001); expect(o(out.subtitles, 'rs:9:b')).toBe(10002)
    expect(o(out.shapes, 'mine')).toBe(0); expect(o(out.mediaOverlays, 'mine-img')).toBe(0); expect(o(out.subtitles, 'my-sub')).toBe(-1)
    expect(PLATE_ORDER).toBeLessThan(-10000)
  })
  it('is idempotent and records what it did', () => {
    const once = applyComposition(snap(), 'recommended') as ReturnType<typeof snap> & { compositionReconstruction: { changes: unknown[]; counts: Record<string, number> } }
    expect(applyComposition(once, 'recommended')).toBe(once)
    expect(once.compositionReconstruction.changes).toHaveLength(4); expect(once.compositionReconstruction.counts).toEqual({ plate: 1, picture: 1, text: 0, subtitle: 2 })
  })
  it('buckets by where each property came from', () => {
    expect(bucketOf({ properties: { a: { basis: 'measured' }, b: { basis: 'measured' } } })).toBe('recovered')
    expect(bucketOf({ properties: { a: { basis: 'measured' }, b: { basis: 'inferred' } } })).toBe('inferred')
    expect(bucketOf({ properties: { a: { basis: 'measured' }, b: { basis: 'user' } } })).toBe('manual')
    expect(bucketOf(undefined)).toBe('inferred')
  })
})

describe('M2.3f manifest hook', () => {
  it('reports each plate and the stacking decision, with claims all false', () => {
    const plan = planBackground(buildPlateCandidates(evidence(goodMeas), CANVAS), {}, ctx)
    const m = backgroundManifest(plan)
    expect(m).toHaveLength(2); expect(m[0]).toMatchObject({ family: 'background', element: 'background_plate', bucket: 'inferred', scene: 1 })
    expect(Object.values(m[0].claims).every(v => v === false)).toBe(true)
    expect(backgroundManifest(null)).toEqual([])
    const comp = planComposition({ shapes: [{ id: 'rb:1:x', order: 0 }], mediaOverlays: [], textOverlays: [], subtitles: [] }, 'recommended')
    expect(compositionManifest(comp, 'recommended')[0]).toMatchObject({ family: 'composition', element: 'stacking_order' }); expect(compositionManifest(null, 'recommended')).toEqual([])
  })
})

// ── M2.3 task 3.4: a smooth gradient along an edge, rebuilt as two flat steps ──────────────────────────────────────────────────
// A band whose lines are flat across but whose colour drifts steadily inwards (the picture begins where the lines stop being flat). The two steps are the average colour of each half.
const gradientTop = (frac: number, from: RGB, to: RGB) => image(W, H, (x, y) => {
  const rows = Math.round(H * frac)
  if (y >= rows) return noise(x, y)
  const t = y / (rows - 1)
  return [0, 1, 2].map(k => Math.round(from[k] + (to[k] - from[k]) * t)) as RGB
})

describe('M2.3 / 3.4 gradient steps', () => {
  const m = measureFrame(gradientTop(0.2, [20, 20, 60], [100, 100, 160]))
  it('measures a gradient band along an edge: its size, and the average colour of each half (darker at the edge, lighter inwards)', () => {
    const g = m.gradients!.find(x => x.side === 'top')!
    expect(g.size).toBeCloseTo(Math.round(H * 0.2) / H, 2)
    const lum = (h: string) => parseInt(h.slice(1, 3), 16) + parseInt(h.slice(3, 5), 16) + parseInt(h.slice(5, 7), 16)
    expect(lum(g.halves[1])).toBeGreaterThan(lum(g.halves[0]) + 40); expect(g.uniformity).toBeGreaterThan(0.99)
    expect(m.bars).toEqual([]); expect(m.variance).toBe('gradient')
  })
  it('finds no gradient in a flat bar, a busy picture, or a frame that is one gradient from edge to edge', () => {
    expect(measureFrame(letterbox(0.12, [0, 0, 0])).gradients).toEqual([])
    expect(measureFrame(image(W, H, noise)).gradients).toEqual([])
    expect(measureFrame(image(W, H, (_x, y) => [Math.round((y / H) * 200), 40, 90])).gradients).toEqual([])
  })
  it('does not call a noisy wander or a barely changing colour a gradient', () => {
    expect(measureFrame(image(W, H, (x, y) => (y < 40 ? ([y % 2 ? 30 : 60, 40, 90] as RGB) : noise(x, y)))).gradients).toEqual([])
    expect(measureFrame(image(W, H, (x, y) => (y < 40 ? ([30 + (y > 20 ? 2 : 0), 40, 90] as RGB) : noise(x, y)))).gradients).toEqual([])
  })
  const meas = new Map<number, FrameBackground | null>([[1, m], [2, m]])
  const ev = evidence(meas)
  it('gives the scene two steps with the half-colours, the first against the edge and the second beginning where it ends', () => {
    const cs = buildPlateCandidates(ev, CANVAS)
    expect(cs.map(c => c.id)).toEqual(['bg:1:top:outer', 'bg:1:top:inner'])
    const [o, i] = cs
    expect(o.offset).toBe(0); expect(i.offset).toBeCloseTo(o.size, 3); expect(o.size + i.size).toBeCloseTo(ev.scenes[0].gradients[0].size, 3)
    expect(o.color).toBe(ev.scenes[0].gradients[0].halves[0]); expect(i.color).toBe(ev.scenes[0].gradients[0].halves[1])
    expect(o.flags.map(f => f.code)).toContain('gradient_step'); expect(o.includeByDefault).toBe(true)
  })
  it('writes each step as a native full-width banner at its own offset, with provenance saying which half of a gradient it is, claiming nothing recovered', () => {
    const cs = buildPlateCandidates(ev, CANVAS)
    const plan = planBackground(cs, {}, { referenceVideoId: 1, videoAnalysisId: 9, planSeconds: 20, existingShapes: [], createdAt: '2026-11-02T00:00:00.000Z' })
    expect(plan.shapes).toHaveLength(2)
    const [a, b] = plan.shapes
    expect(a).toMatchObject({ kind: 'banner', x: 0, y: 0, width: 100, fullWidth: true, order: PLATE_ORDER }); expect(b.y).toBeCloseTo(a.height, 2); expect(b.y + b.height).toBeCloseTo(ev.scenes[0].gradients[0].size * 100, 1)
    expect(a.reconstruction).toMatchObject({ side: 'top', gradientPart: 'outer', claims: { backgroundRecovered: false, contentBehindOverlaysRecovered: false, inpainted: false } }); expect(b.reconstruction?.gradientPart).toBe('inner')
    expect(a.fillColor).not.toBe(b.fillColor)
  })
  it('puts a step on the opposite edge from the bottom, and leaves out a step the footage would cover', () => {
    const g = measureFrame(image(W, H, (x, y) => (y >= H - 40 ? ([20 + Math.round(((H - 1 - y) / 39) * 80), 30, 60] as RGB) : noise(x, y))))
    const e = evidence(new Map<number, FrameBackground | null>([[1, g], [2, g]]))
    const cs = buildPlateCandidates(e, CANVAS)
    const plan = planBackground(cs, {}, { referenceVideoId: 1, videoAnalysisId: 9, planSeconds: 20, existingShapes: [], createdAt: 'x' })
    expect(plan.shapes.map(s => s.reconstruction?.side)).toEqual(['bottom', 'bottom']); expect(plan.shapes[0].y + plan.shapes[0].height).toBeCloseTo(100, 1)
    const covered = buildPlateCandidates(ev, CANVAS, { 1: [{ fit: 'fill' }] })                      // fill footage covers the whole canvas, so no step should be on by default
    expect(covered.every(c => !c.includeByDefault && c.flags.some(f => f.code === 'footage_overlap'))).toBe(true)
    const wide = buildPlateCandidates(ev, CANVAS, { 1: [{ width: 1920, height: 1080 }] })            // 16:9 footage centred on a 9:16 canvas leaves the top 34% free
    expect(wide.every(c => c.includeByDefault)).toBe(true)
  })
  it('a step can be recoloured and resized like a bar, and reach is checked from its own offset', () => {
    const cs = buildPlateCandidates(ev, CANVAS, { 1: [{ width: 1920, height: 1080 }] })
    const inner = cs.find(c => c.part === 'inner')!
    const plan = planBackground(cs, setPlateCorrection({}, inner.id, { color: '#336699', size: 0.1 }), { referenceVideoId: 1, videoAnalysisId: 9, planSeconds: 20, existingShapes: [], createdAt: 'x' })
    const shape = plan.shapes.find(s => s.reconstruction?.gradientPart === 'inner')!
    expect(shape.fillColor).toBe('#336699'); expect(shape.height).toBeCloseTo(10, 1); expect(shape.reconstruction?.properties.color.basis).toBe('user')
  })
})
