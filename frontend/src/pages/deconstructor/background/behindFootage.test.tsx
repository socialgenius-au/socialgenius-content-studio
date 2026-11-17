// "Place behind footage" in the Reconstructor's Background panel (Option C). Explicit, off by default; when chosen it writes `behindFootage: true` on the generated plate layer and nothing else, and the existing
// Option C export/preview pipeline does the rest. Not a protected file; no new composition mechanism.
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { applyComposition, buildPlateCandidates, mergeBackground, planBackground, planComposition, setPlateCorrection, type BackgroundPlan, type PlateCorrections } from '.'
import { BackgroundReviewView, type BackgroundReviewViewProps } from './BackgroundReviewView'
import type { BackgroundEvidence } from './evidence'

const evidence: BackgroundEvidence = {
  referenceVideoId: 1, videoAnalysisId: 9, frameSize: { width: 480, height: 864 }, durationSeconds: 20, frameCount: 4,
  scenes: [
    { sceneNumber: 1, startTime: 0, endTime: 10, framesMeasured: 2, framesUnreadable: 0, gradients: [], variance: 'solid', palette: [{ color: '#090909', share: 0.85 }], bars: [{ side: 'top', size: 0.189, color: '#080808', uniformity: 1, framesSeen: 2, frameIds: [1, 2] }, { side: 'bottom', size: 0.12, color: '#101010', uniformity: 1, framesSeen: 2, frameIds: [1, 2] }] },
  ],
}
const ctx = { referenceVideoId: 1, videoAnalysisId: 9, planSeconds: 20, existingShapes: [], createdAt: '2026-11-03T00:00:00.000Z' }
const candidates = buildPlateCandidates(evidence, { width: 1080, height: 1920 })
const plan = (c: PlateCorrections = {}) => planBackground(candidates, c, ctx)
type WithBehind = { behindFootage?: boolean }

describe('the correction', () => {
  it('is off unless a person turns it on, and turning it off removes the key (no residue)', () => {
    expect(setPlateCorrection({}, 'bg:1:top', { behindFootage: true })).toEqual({ 'bg:1:top': { behindFootage: true } })
    expect(setPlateCorrection({ 'bg:1:top': { behindFootage: true } }, 'bg:1:top', { behindFootage: false })).toEqual({})
    expect(setPlateCorrection({ 'bg:1:top': { behindFootage: true, color: '#112233' } }, 'bg:1:top', { behindFootage: undefined })).toEqual({ 'bg:1:top': { color: '#112233' } })
    expect(setPlateCorrection({}, 'bg:1:top', { behindFootage: 'yes' })).toEqual({})                           // only a real boolean true counts
  })
})

describe('the generated layer', () => {
  it('by default is exactly what it always was: no behindFootage key, same signature, same item messages', () => {
    const p = plan()
    expect(p.shapes.length).toBeGreaterThan(0)
    for (const s of p.shapes) expect('behindFootage' in s).toBe(false)
    expect(p.items.every(i => !('behindFootage' in i))).toBe(true)
    expect(p.signature).not.toContain('behind')
    expect(plan({ 'bg:1:top': { color: '#336699' } }).shapes.every(s => !('behindFootage' in s))).toBe(true)      // other corrections do not turn it on
  })
  it('when chosen, only that bar carries behindFootage: true, with its geometry, colour, timing and provenance untouched and still an ordinary editable shape', () => {
    const base = plan(), on = plan(setPlateCorrection({}, 'bg:1:top', { behindFootage: true }))
    const a = base.shapes.find(s => s.id.endsWith('bg:1:top'))!, b = on.shapes.find(s => s.id.endsWith('bg:1:top'))!
    expect((b as WithBehind).behindFootage).toBe(true)
    expect({ ...b, behindFootage: undefined }).toEqual({ ...a, behindFootage: undefined })                          // the only difference is the flag
    expect(b.reconstruction?.kind).toBe('background'); expect(b.kind).toBe('banner'); expect(typeof b.fillColor).toBe('string')
    const other = on.shapes.find(s => s.id.endsWith('bg:1:bottom'))!
    expect('behindFootage' in other).toBe(false)
    expect(on.items.find(i => i.candidateId === 'bg:1:top')).toMatchObject({ status: 'included', behindFootage: true })
    expect(on.items.find(i => i.candidateId === 'bg:1:top')!.message).toMatch(/behind your footage/)
    expect(on.signature).not.toBe(base.signature)                                                                       // so a save writes the change
  })
  it('a bar that is not included produces no layer even when behind is chosen (the choice never adds a layer by itself)', () => {
    const p = plan(setPlateCorrection(setPlateCorrection({}, 'bg:1:top', { include: false }), 'bg:1:top', { behindFootage: true }))
    expect(p.shapes.find(s => s.id.endsWith('bg:1:top'))).toBeUndefined()
    expect(p.items.find(i => i.candidateId === 'bg:1:top')).toMatchObject({ status: 'excluded_user', behindFootage: true })
  })
  it('survives the draft merge chain: merged into a snapshot and re-ordered by the stacking policy, the flag is still on the shape', () => {
    const on = plan(setPlateCorrection({}, 'bg:1:top', { behindFootage: true }))
    const merged = mergeBackground({ shapes: [] as unknown[] }, on) as { shapes: (WithBehind & { id: string })[] }
    const ordered = applyComposition({ shapes: merged.shapes, mediaOverlays: [], textOverlays: [], subtitles: [] } as never, 'recommended') as unknown as { shapes: (WithBehind & { id: string })[] }
    expect(ordered.shapes.find(s => s.id.endsWith('bg:1:top'))!.behindFootage).toBe(true)
    expect(ordered.shapes.find(s => s.id.endsWith('bg:1:bottom'))!.behindFootage).toBeUndefined()
  })
})

describe('the panel', () => {
  const view = (corrections: PlateCorrections = {}, onCorrect = vi.fn()): { html: string; props: BackgroundReviewViewProps } => {
    const p = plan(corrections)
    const props = { state: { kind: 'ready' }, evidence, candidates, corrections, plan: p, policy: 'as_generated', composition: planComposition({ shapes: p.shapes, mediaOverlays: [], textOverlays: [], subtitles: [] }, 'as_generated'), scenes: [{ sceneNumber: 1, startTime: 0, endTime: 10 }], onCorrect, onPolicy: () => {} } as unknown as BackgroundReviewViewProps
    return { html: renderToStaticMarkup(<BackgroundReviewView {...props} />).replace(/<!-- -->/g, ''), props }
  }
  it('shows one plainly-worded checkbox per bar, unchecked by default, with a hint a non-technical person can follow', () => {
    const { html } = view()
    expect(html.match(/data-testid="background-behind"/g)).toHaveLength(2)
    expect(html).not.toMatch(/data-testid="background-behind"[^>]*checked/)
    expect(html).toContain('Place behind footage'); expect(html).toContain('shows only around your video, never over it')
    expect(html).not.toContain('data-testid="background-behind-note"')
  })
  it('when on: says what it means, labels it as the person\'s choice, and drops the "may cover your footage" warnings that no longer apply', () => {
    const { html } = view(setPlateCorrection({}, 'bg:1:top', { behindFootage: true }))
    expect(html).toMatch(/data-testid="background-behind"[^>]*checked/)
    expect(html).toContain('data-testid="background-behind-note"'); expect(html).toContain('never covers it'); expect(html).toContain('Where your video fills the whole frame it will not be visible'); expect(html).toContain('Set by you')
    expect(html).toContain('behind your footage: it shows only around the picture')
  })
  it('says the bar is only added once it is ticked, if it is not', () => {
    const { html } = view(setPlateCorrection(setPlateCorrection({}, 'bg:1:top', { include: false }), 'bg:1:top', { behindFootage: true }))
    expect(html).toContain('It is only added once you tick the bar above')
  })
})
