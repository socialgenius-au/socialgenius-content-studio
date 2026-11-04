// M2.3 editing: does the user's footage reach a bar (plates sit above footage), the plate's size is editable and recorded as the user's, and the generated layers are listed per scene in painting order.
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { BackgroundReviewView } from './BackgroundReviewView'
import { reachFlag } from './candidates'
import { buildPlateCandidates, footageBox, layersByScene, planBackground, planComposition, plateReach, sceneFootageOf, setPlateCorrection, PLATE_ORDER, type BackgroundEvidence, type SceneFootage } from '.'

const CANVAS = { width: 1080, height: 1920 }
const evidence: BackgroundEvidence = {
  referenceVideoId: 1, videoAnalysisId: 9, frameSize: { width: 480, height: 864 }, durationSeconds: 20, frameCount: 4,
  scenes: [{ sceneNumber: 1, startTime: 0, endTime: 10, framesMeasured: 2, framesUnreadable: 0, gradients: [], variance: 'solid', palette: [{ color: '#080808', share: 0.85 }], bars: [{ side: 'top', size: 0.189, color: '#080808', uniformity: 1, framesSeen: 2, frameIds: [1, 2] }] }],
}
const ctx = { referenceVideoId: 1, videoAnalysisId: 9, planSeconds: 20, existingShapes: [], createdAt: '2026-11-02T00:00:00.000Z' }

describe('where footage sits on the canvas', () => {
  it('a landscape clip in Fit mode is letterboxed: it leaves the top and bottom of a portrait canvas free', () => {
    const b = footageBox({ width: 1920, height: 1080 }, CANVAS)!
    expect(b.x).toBe(0); expect(b.w).toBe(1); expect(b.h).toBeCloseTo(0.316, 2); expect(b.y).toBeCloseTo(0.342, 2)
  })
  it('a portrait clip of the canvas shape fills it; Fill mode always fills; an unknown size is unknown', () => {
    expect(footageBox({ width: 1080, height: 1920 }, CANVAS)).toEqual({ x: 0, y: 0, w: 1, h: 1 })
    expect(footageBox({ fit: 'fill', width: 10, height: 10 }, CANVAS)).toEqual({ x: 0, y: 0, w: 1, h: 1 })
    expect(footageBox({}, CANVAS)).toBeNull()
  })
  it('collects each scene’s clips with their sizes and Fit/Fill, leaving out footage it does not know', () => {
    const out = sceneFootageOf([{ sceneNumber: 1, clips: [{ footageKey: 'a', fit: 'fill' }, { footageKey: 'zz' }] }, { sceneNumber: 2, clips: [{ footageKey: 'b' }] }], [{ key: 'a', width: 100, height: 50 }, { key: 'b' }])
    expect(out).toEqual({ 1: [{ width: 100, height: 50, fit: 'fill' }], 2: [{}] })
  })
})

describe('does the footage reach the bar', () => {
  it('no footage yet / unknown size / known share', () => {
    expect(plateReach('top', 0.189, undefined, CANVAS)).toEqual({ kind: 'no_footage' })
    expect(plateReach('top', 0.189, [{}], CANVAS)).toEqual({ kind: 'unknown' })
    expect(plateReach('top', 0.189, [{ width: 1920, height: 1080 }], CANVAS)).toEqual({ kind: 'known', share: 0 })          // letterboxed landscape clip: the top bar is free
    expect(plateReach('top', 0.189, [{ width: 1080, height: 1920 }], CANVAS)).toEqual({ kind: 'known', share: 1 })         // a full-height portrait clip is under all of it
  })
  it('takes the worst clip of the scene, and handles side bars', () => {
    expect(plateReach('top', 0.1, [{ width: 1920, height: 1080 }, { width: 1080, height: 1920 }], CANVAS)).toMatchObject({ share: 1 })
    expect(plateReach('left', 0.1, [{ width: 1920, height: 1080 }], CANVAS)).toEqual({ kind: 'known', share: 0.316 })      // a landscape clip is as wide as the canvas but only 31.6% as tall: it covers that much of a full-height side bar
  })
  it('a plate the footage would cover is flagged and left out by default; one the footage does not reach stays included', () => {
    const covered: SceneFootage = { 1: [{ width: 1080, height: 1920 }] }, free: SceneFootage = { 1: [{ width: 1920, height: 1080 }] }
    const c1 = buildPlateCandidates(evidence, CANVAS, covered)[0], c2 = buildPlateCandidates(evidence, CANVAS, free)[0], c0 = buildPlateCandidates(evidence, CANVAS)[0]
    expect(c1.includeByDefault).toBe(false); expect(c1.flags.some(f => f.code === 'footage_overlap' && f.severity === 'warning')).toBe(true)
    expect(c2.includeByDefault).toBe(true); expect(c2.flags.some(f => f.code === 'footage_overlap')).toBe(false)
    expect(c0.includeByDefault).toBe(true); expect(c0.flags.some(f => f.code === 'no_footage_yet')).toBe(true)              // nothing assigned yet: not excluded, but said plainly
    expect(planBackground([c1], {}, ctx).items[0]).toMatchObject({ status: 'excluded_default' })
    expect(planBackground([c1], setPlateCorrection({}, c1.id, { include: true }), ctx).shapes).toHaveLength(1)           // the person can still choose to include it
  })
})

describe('an editable plate size', () => {
  const [cand] = buildPlateCandidates(evidence, CANVAS)
  it('changes the layer’s geometry, keeps the measured size in the evidence and says it was set by you', () => {
    const plan = planBackground([cand], setPlateCorrection({}, cand.id, { size: 0.25 }), ctx)
    const s = plan.shapes[0]
    expect(s.height).toBe(25); expect(s.y).toBe(0)
    expect(s.reconstruction?.evidence.size).toBe(0.189); expect(s.reconstruction?.properties.region.basis).toBe('user'); expect(s.reconstruction?.properties.region.note).toMatch(/set by you.*measured: 18\.9%/)
    const bottom = planBackground([{ ...cand, side: 'bottom' as const, id: 'bg:1:bottom' }], setPlateCorrection({}, 'bg:1:bottom', { size: 0.25 }), ctx).shapes[0]
    expect(bottom.y).toBe(75)
  })
  it('only accepts a sensible thickness, can be reset, and the measured size is the default', () => {
    expect(setPlateCorrection({}, 'x', { size: 0.9 })).toEqual({}); expect(setPlateCorrection({}, 'x', { size: 0.01 })).toEqual({}); expect(setPlateCorrection({}, 'x', { size: NaN })).toEqual({})
    expect(setPlateCorrection(setPlateCorrection({}, 'x', { size: 0.2 }), 'x', { size: undefined })).toEqual({})
    expect(planBackground([cand], {}, ctx).shapes[0].height).toBeCloseTo(18.9, 1); expect(planBackground([cand], {}, ctx).shapes[0].reconstruction?.properties.region.basis).toBe('measured')
  })
  it('enlarging a plate until it reaches the footage warns at the size you set, even though the measured size did not', () => {
    const free: SceneFootage = { 1: [{ width: 1920, height: 1080 }] }               // the footage occupies y 34%..66% of a portrait canvas
    expect(reachFlag('top', 0.189, free[1], CANVAS)).toBeNull()
    expect(reachFlag('top', 0.45, free[1], CANVAS)).toMatchObject({ code: 'footage_overlap', severity: 'warning' })        // 45% reaches into it
    const base = { state: { kind: 'ready' as const }, evidence, candidates: [cand], policy: 'as_generated' as const, composition: planComposition({ shapes: [], mediaOverlays: [], textOverlays: [], subtitles: [] }, 'as_generated'), scenes: [], footage: free, onCorrect: () => {}, onPolicy: () => {} }
    const corr = { [cand.id]: { size: 0.45 } }
    const html = renderToStaticMarkup(createElement(BackgroundReviewView, { ...base, corrections: corr, plan: planBackground([cand], corr, ctx) }))
    expect(html).toContain('data-testid="background-flag-size"'); expect(html).toMatch(/At the size you set: Your footage in this scene reaches/)
  })
  it('the panel offers the size, in percent, with the reset only after a change', () => {
    const base = { state: { kind: 'ready' as const }, evidence, candidates: [cand], plan: planBackground([cand], {}, ctx), policy: 'as_generated' as const, composition: planComposition({ shapes: [], mediaOverlays: [], textOverlays: [], subtitles: [] }, 'as_generated'), scenes: [], onCorrect: () => {}, onPolicy: () => {} }
    const html = (corrections: Record<string, { size?: number }>) => renderToStaticMarkup(createElement(BackgroundReviewView, { ...base, corrections, plan: planBackground([cand], corrections, ctx) })).replace(/<!-- -->/g, '')
    const plain = html({}), edited = html({ [cand.id]: { size: 0.25 } })
    expect(plain).toContain('data-testid="background-size"'); expect(plain).toContain('value="18.9"'); expect(plain).toContain('Size measured'); expect(plain).not.toContain('Use the measured size')
    expect(edited).toContain('value="25"'); expect(edited).toContain('Size set by you'); expect(edited).toContain('Use the measured size')
  })
})

describe('generated layers by scene', () => {
  const scenes = [{ sceneNumber: 1, startTime: 0, endTime: 10 }, { sceneNumber: 2, startTime: 10, endTime: 20 }, { sceneNumber: 3, startTime: 20, endTime: 30 }]
  const input = {
    shapes: [{ id: 'rb:9:bg:1:top', order: PLATE_ORDER, startTime: 0, endTime: 10, reconstruction: { properties: { color: { basis: 'measured' } } } }],
    mediaOverlays: [{ id: 'ri:9:a', order: 0, startTime: 2, endTime: 6 }],
    textOverlays: [{ id: 'rc:9:t', order: 0, startTime: 12, endTime: 15, reconstruction: { properties: { text: { basis: 'inferred' } } } }],
    subtitles: [{ id: 'rs:9:a', order: -1, startTime: 3, endTime: 5 }],
  }
  it('groups by the scene a layer starts in, bottom to top, and shows what the recommended policy moves', () => {
    const groups = layersByScene(planComposition(input, 'recommended'), scenes)
    expect(groups.map(g => g.sceneNumber)).toEqual([1, 2])                                              // scene 3 has nothing: not listed
    const s1 = groups[0].rows
    expect(s1.map(r => r.kind)).toEqual(['plate', 'picture', 'subtitle'])                               // plate under picture under subtitle
    expect(s1.find(r => r.kind === 'subtitle')).toMatchObject({ before: -1, after: 10001, moved: true })
    expect(s1.find(r => r.kind === 'plate')).toMatchObject({ moved: false, bucket: 'recovered' })
    expect(groups[1].rows[0]).toMatchObject({ kind: 'text', bucket: 'inferred', after: 0 })
  })
  it('with nothing moved the order shown is the order each layer already has, and the editor tie rule decides equal orders', () => {
    const rows = layersByScene(planComposition({ ...input, shapes: [{ id: 'rb:9:x', order: 0, startTime: 1, endTime: 9 }] }, 'as_generated'), scenes)[0].rows
    expect(rows.filter(r => r.kind !== 'subtitle').map(r => r.kind)).toEqual(['picture', 'plate'])      // at order 0 a shape paints above a picture (the editor's tie rule)
    expect(rows.every(r => !r.moved)).toBe(true)
  })
})
