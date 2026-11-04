// D2 -- the editor fades through black at the JOIN, with the exporter's own split of the window (backend timeline_plan.py: out = total // 2 frames, in = the rest, total = max(2, round(d * 30))).
import { describe, expect, it } from 'vitest'
import { clipFadeOpacity, fadeParts, type FadeClip } from './transitionFade'

const A: FadeClip = { id: 'a', transition: 'fade_black', transitionDuration: 0.5, startTime: 0, endTime: 4 }
const B: FadeClip = { id: 'b', transition: 'cut', transitionDuration: 0.5, startTime: 4, endTime: 8 }
const C: FadeClip = { id: 'c', transition: 'fade_black', transitionDuration: 1, startTime: 8, endTime: 12 }
const clips = [A, B, C]
const at = (c: FadeClip, t: number, list = clips) => clipFadeOpacity(list, c, t)

describe('window split', () => {
  it('matches the exporter: 0.5 s = 15 frames = 7 out + 8 in; 1 s = 30 = 15 + 15; very short durations keep at least 2 frames', () => {
    expect(fadeParts(0.5)).toEqual({ out: 7 / 30, in: 8 / 30 }); expect(fadeParts(1)).toEqual({ out: 0.5, in: 0.5 }); expect(fadeParts(0.01)).toEqual({ out: 1 / 30, in: 1 / 30 })
  })
})

describe('fade through black at the join', () => {
  it('fades the OUTGOING clip over its own last frames only, and the INCOMING clip over its own first frames only', () => {
    expect(at(A, 0)).toBe(1)                                   // the first clip is not faded in at the project start (the old editor did)
    expect(at(A, 3.7)).toBe(1)                                 // before the window
    expect(at(A, 4 - 7 / 60)).toBeCloseTo(0.5, 5)              // half-way through the outgoing 7 frames
    expect(at(A, 4 - 1e-6)).toBeLessThan(0.001)                // black at the join
    expect(at(B, 4)).toBe(0)                                   // the incoming clip starts from black
    expect(at(B, 4 + 4 / 30)).toBeCloseTo(0.5, 5)              // half-way through the incoming 8 frames
    expect(at(B, 4 + 8 / 30)).toBeCloseTo(1, 9); expect(at(B, 4.5)).toBe(1); expect(at(B, 6)).toBe(1)
  })
  it('a clip whose own transition is "cut" is not faded at its end, and the last clip is not faded at the project end even with a transition set', () => {
    expect(at(B, 8 - 1e-3)).toBe(1)                            // B's own transition is a cut, so B is not faded at its end
    expect(at(C, 12 - 1e-3)).toBe(1)                           // nothing follows C: no fade at the end of the project
  })
  it('a clip that is both incoming and outgoing takes the darker of the two', () => {
    const mid: FadeClip = { ...B, transition: 'fade_black', transitionDuration: 1 }
    const list = [A, mid, C]
    expect(at(mid, 4)).toBe(0); expect(at(mid, 4 + 8 / 30)).toBeCloseTo(1, 9); expect(at(mid, 8 - 0.25)).toBeCloseTo(0.5, 5)
  })
  it('no fade across a gap (the exporter does no transition between runs), and other transition types are not ramped', () => {
    const gapped = [A, { ...B, startTime: 5, endTime: 9 }]
    expect(at(A, 4 - 1e-3, gapped)).toBe(1); expect(at(gapped[1], 5, gapped)).toBe(1)
    const dissolve = [{ ...A, transition: 'dissolve' }, B]
    expect(at(dissolve[0], 4 - 1e-3, dissolve)).toBe(1); expect(at(B, 4, dissolve)).toBe(1)
  })
  it('independent of array order, and a clip that is not in the list is left alone', () => {
    expect(at(B, 4, [C, B, A])).toBe(0)
    expect(clipFadeOpacity([], A, 1)).toBe(1)
  })
})
