import { describe, expect, it } from 'vitest'
import { buildPlateCandidates, canvasColourChange, canvasColourOptions, setPlateCorrection, validCanvasColour, withCanvasColour } from '.'
import type { BackgroundEvidence } from './evidence'

const ev: BackgroundEvidence = {
  referenceVideoId: 1, videoAnalysisId: 9, frameSize: { width: 480, height: 864 }, durationSeconds: 20, frameCount: 4,
  scenes: [
    { sceneNumber: 1, startTime: 0, endTime: 10, framesMeasured: 2, framesUnreadable: 0, gradients: [], variance: 'solid', palette: [{ color: '#080808', share: 0.85 }], bars: [{ side: 'top', size: 0.189, color: '#080808', uniformity: 1, framesSeen: 2, frameIds: [1, 2] }, { side: 'bottom', size: 0.1, color: '#080808', uniformity: 1, framesSeen: 2, frameIds: [1, 2] }] },
    { sceneNumber: 2, startTime: 10, endTime: 20, framesMeasured: 2, framesUnreadable: 0, gradients: [], variance: 'solid', palette: [{ color: '#1f6f3f', share: 0.5 }], bars: [{ side: 'top', size: 0.1, color: '#1f6f3f', uniformity: 1, framesSeen: 2, frameIds: [3, 4] }] },
  ],
} as unknown as BackgroundEvidence
const candidates = buildPlateCandidates(ev, { width: 1080, height: 1920 })

describe('canvas colour options', () => {
  it('lists each distinct measured bar colour once, with the bars that carry it', () => {
    const o = canvasColourOptions(candidates, {})
    expect(o.map(x => x.colour)).toEqual(['#080808', '#1f6f3f'])
    expect(o[0].bars).toEqual(['scene 1 top bar', 'scene 1 bottom bar']); expect(o[1].bars).toEqual(['scene 2 top bar'])
  })
  it('follows a colour you set on a bar, and still offers a bar you left out as a layer', () => {
    const o = canvasColourOptions(candidates, setPlateCorrection(setPlateCorrection({}, 'bg:1:top', { color: '#336699' }), 'bg:2:top', { include: false }))
    expect(o.map(x => x.colour)).toEqual(['#336699', '#080808', '#1f6f3f'])
  })
})

describe('what will change, shown before it is applied', () => {
  it('says nothing changes until a colour is chosen, then names the one colour and what stays', () => {
    expect(canvasColourChange(null).changes).toEqual([])
    const c = canvasColourChange('#080808')
    expect(c.changes).toHaveLength(1); expect(c.changes[0]).toContain('#080808')
    expect(c.unchanged.join(' ')).toMatch(/format: platform, placement, size and aspect ratio stay/)
  })
})

describe('withCanvasColour', () => {
  const snap = { videoClips: [1], shapes: [] }
  it('returns the SAME snapshot when no valid colour was chosen', () => {
    for (const v of [null, undefined, '', 'red', '#abc', '#gg0000', 'x#080808']) expect(withCanvasColour(snap, v)).toBe(snap)
    expect(validCanvasColour('#ABCDEF')).toBe('#abcdef')
  })
  it('adds only canvasBackground and never a canvas format', () => {
    const out = withCanvasColour(snap, '#080808') as Record<string, unknown>
    expect(out).toEqual({ ...snap, canvasBackground: '#080808' }); expect(out).not.toHaveProperty('canvasFormat'); expect(snap).not.toHaveProperty('canvasBackground')
  })
})
