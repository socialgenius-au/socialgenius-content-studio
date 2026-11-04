// Background bar placement: position (distance from the edge) next to size and colour, a clear "may cover your footage" indicator, and a shortcut to clear the footage. Defaults and saved drafts are unchanged.
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { buildPlateCandidates, clearSize, planBackground, planComposition, resolvePlate, setPlateCorrection, type PlateCorrections } from '.'
import { BackgroundReviewView, type BackgroundReviewViewProps } from './BackgroundReviewView'
import type { BackgroundEvidence } from './evidence'
import type { SceneFootage } from './footageReach'

const evidence = {
  referenceVideoId: 1, videoAnalysisId: 9, frameSize: { width: 480, height: 864 }, durationSeconds: 20, frameCount: 4,
  scenes: [{ sceneNumber: 1, startTime: 0, endTime: 10, framesMeasured: 2, framesUnreadable: 0, gradients: [], variance: 'solid', palette: [{ color: '#090909', share: 0.85 }],
    bars: [{ side: 'top', size: 0.189, color: '#080808', uniformity: 1, framesSeen: 2, frameIds: [1, 2] }, { side: 'bottom', size: 0.1, color: '#102a5e', uniformity: 1, framesSeen: 2, frameIds: [1, 2] }] }],
} as unknown as BackgroundEvidence
const canvas = { width: 1080, height: 1920 }
const ctx = { referenceVideoId: 1, videoAnalysisId: 9, planSeconds: 10, existingShapes: [], createdAt: '2026-11-02T00:00:00.000Z' }
const cands = buildPlateCandidates(evidence, canvas)

describe('position correction', () => {
  it('accepts a sensible distance from the edge and ignores anything else', () => {
    expect(setPlateCorrection({}, 'bg:1:top', { offset: 0.1 })['bg:1:top']).toEqual({ offset: 0.1 })
    for (const bad of [-0.1, 0.6, NaN, Infinity, '0.1', null]) expect(setPlateCorrection({}, 'bg:1:top', { offset: bad })).toEqual({})
    expect(setPlateCorrection({ 'bg:1:top': { offset: 0.1 } }, 'bg:1:top', { offset: undefined })).toEqual({})                 // reversible
  })
  it('is measured (against the edge) until you set it, and then yours', () => {
    const c = cands.find(x => x.id === 'bg:1:top')!
    expect(resolvePlate(c, undefined).offset).toMatchObject({ value: 0, basis: 'measured' })
    expect(resolvePlate(c, { offset: 0.05 }).offset).toMatchObject({ value: 0.05, basis: 'user' })
    expect(resolvePlate(c, { offset: 0 }).corrected).not.toContain('offset')                                                      // the same as measured is not a correction
  })
})

describe('the layer written for a placed bar', () => {
  const shape = (corr: PlateCorrections, id: string) => planBackground(cands, corr, ctx).shapes.find(s => s.id.endsWith(id))!
  it('is exactly as before when no position was set', () => {
    const s = shape({}, 'bg:1:top')
    expect(s).toMatchObject({ x: 0, y: 0, width: 100, height: 18.9 })
    expect(s.reconstruction?.properties.region.basis).toBe('measured')
  })
  it('moves in from the chosen edge, for top and bottom bars, stays on the canvas, and records that you set it', () => {
    expect(shape({ 'bg:1:top': { offset: 0.1 } }, 'bg:1:top')).toMatchObject({ y: 10, height: 18.9 })
    expect(shape({ 'bg:1:bottom': { offset: 0.05 } }, 'bg:1:bottom')).toMatchObject({ y: 85, height: 10 })                          // 100 - 5 - 10
    const far = shape({ 'bg:1:top': { offset: 0.5, size: 0.45 } }, 'bg:1:top')
    expect(far.y + far.height).toBeLessThanOrEqual(100.0001)
    const r = shape({ 'bg:1:top': { offset: 0.1 } }, 'bg:1:top').reconstruction!.properties.region
    expect(r.basis).toBe('user'); expect(r.note).toContain('starting 10.0% in from the edge, as set by you')
    expect(shape({ 'bg:1:top': { offset: 0.1 } }, 'bg:1:top').reconstruction!.claims).toEqual({ backgroundRecovered: false, contentBehindOverlaysRecovered: false, inpainted: false })
  })
})

describe('clearSize: how thick a bar can be without covering known footage', () => {
  const wide = [{ width: 640, height: 360, fit: 'fit' as const }]
  it('is the gap between the canvas edge and the footage', () => {
    expect(clearSize('top', 0, wide, canvas)).toBeCloseTo(0.342, 3)
    expect(clearSize('bottom', 0, wide, canvas)).toBeCloseTo(0.342, 3)
    expect(clearSize('top', 0.1, wide, canvas)).toBeCloseTo(0.242, 3)
    expect(clearSize('left', 0, wide, canvas)).toBe(0)                                                                                // fit to the width: no side bar can clear it
  })
  it('is 0 when the footage fills the canvas, and null when nothing is known', () => {
    expect(clearSize('top', 0, [{ fit: 'fill' }], canvas)).toBe(0)
    expect(clearSize('top', 0, undefined, canvas)).toBeNull(); expect(clearSize('top', 0, [], canvas)).toBeNull(); expect(clearSize('top', 0, [{}], canvas)).toBeNull()
  })
})

describe('the panel', () => {
  const view = (footage: SceneFootage | undefined, corr: PlateCorrections = {}) => {
    const plan = planBackground(cands, corr, ctx)
    const p: BackgroundReviewViewProps = { state: { kind: 'ready' }, evidence, candidates: cands, corrections: corr, plan, policy: 'as_generated', composition: planComposition({ shapes: plan.shapes, mediaOverlays: [], textOverlays: [], subtitles: [] }, 'as_generated'),
      scenes: [{ sceneNumber: 1, startTime: 0, endTime: 10 }], footage, onCorrect: () => {}, onPolicy: () => {} }
    return renderToStaticMarkup(<BackgroundReviewView {...p} />).replace(/<!-- -->/g, '')
  }
  it('shows the position control with its provenance next to size and colour', () => {
    const m = view(undefined, { 'bg:1:top': { offset: 0.1 } })
    expect(m).toContain('data-testid="background-offset"'); expect(m).toContain('Position set by you'); expect(m).toContain('data-testid="background-offset-reset"'); expect(m).toContain('Position measured')
  })
  it('says nothing about footage when the footage is clear of every included bar', () => {
    const m = view({ 1: [{ width: 640, height: 360, fit: 'fit' }] })
    expect(m).not.toContain('background-obscure'); expect(m).not.toContain('may cover your footage')
  })
  it('flags every included bar that may hide footage, in the summary and on the bar, and offers to shrink it', () => {
    const m = view({ 1: [{ width: 640, height: 360, fit: 'fit' }] }, { 'bg:1:top': { size: 0.4 } })
    expect(m).toContain('data-testid="background-obscure-summary"'); expect(m).toMatch(/<strong>1<\/strong> bar you have included may cover your footage \(scene 1\)/)
    expect(m).toContain('data-testid="background-obscure-badge"'); expect(m).toContain('May cover your footage'); expect(m).toContain('Shrink to 34.2% so it clears your footage')
  })
  it('when footage fills the canvas there is no shrink offer, only the honest options', () => {
    const m = view({ 1: [{ fit: 'fill' }] }, { 'bg:1:top': { include: true } })
    expect(m).toContain('data-testid="background-clear-none"'); expect(m).toContain('use its colour as the canvas colour'); expect(m).not.toContain('data-testid="background-clear"')
  })
  it('a bar left out does not count as hiding anything', () => {
    const m = view({ 1: [{ fit: 'fill' }] }, { 'bg:1:top': { include: false }, 'bg:1:bottom': { include: false } })
    expect(m).not.toContain('background-obscure-summary')
  })
})
