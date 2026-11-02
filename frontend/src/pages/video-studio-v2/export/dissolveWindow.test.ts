import { describe, expect, it } from 'vitest'
import cases from './__fixtures__/dissolveWindow.cases.json'
import { activeBlendAt, planBlendWindows, sourceTimeAt, type BlendPolicy, type PlanClip } from './dissolveWindow'

describe('dissolveWindow follows the exporter planner (shared fixture generated from timeline_plan.py)', () => {
  it('agrees on every window of every generated case', () => {
    let windows = 0
    for (const c of cases as unknown as { name: string; policy: BlendPolicy; clips: PlanClip[]; expected: unknown[] }[]) {
      const got = planBlendWindows(c.clips.map(k => ({ ...k, duration: k.duration ?? undefined })), c.policy)
      expect({ name: c.name, got }).toEqual({ name: c.name, got: c.expected })
      windows += got.length
    }
    expect(windows).toBeGreaterThan(100)
  })
})

const clip = (id: string, startTime: number, endTime: number, o: Partial<PlanClip> = {}): PlanClip => ({ id, transition: 'cut', transitionDuration: 0.5, startTime, endTime, trimIn: 0, speed: 1, duration: 20, ...o })

describe('activeBlendAt', () => {
  const clips = [clip('a', 0, 4, { transition: 'dissolve', transitionDuration: 0.6, trimIn: 1 }), clip('b', 4, 8, { trimIn: 2 })]
  const windows = planBlendWindows(clips)
  it('plans a window centred on the join using real spare frames', () => {
    expect(windows).toEqual([expect.objectContaining({ outId: 'a', inId: 'b', joinFrame: 120, pre: 9, post: 9, requested: 18 })])
  })
  it('is 0 at the first frame of the window and rises to 1, and switches phase at the join', () => {
    expect(activeBlendAt(windows, 111 / 30 - 0.001)).toBeNull()
    const first = activeBlendAt(windows, 111 / 30)!
    expect(first.alpha).toBeCloseTo(0, 6); expect(first.phase).toBe('before')
    const join = activeBlendAt(windows, 4)!
    expect(join.alpha).toBeCloseTo(0.5, 6); expect(join.phase).toBe('after')
    expect(activeBlendAt(windows, 129 / 30 - 0.001)!.alpha).toBeGreaterThan(0.94)
    expect(activeBlendAt(windows, 129 / 30)).toBeNull()
  })
  it('only renders dissolve unless told otherwise (whip pan / zoom punch stay unpreviewed)', () => {
    const w = planBlendWindows([clip('a', 0, 4, { transition: 'whip_pan', trimIn: 1 }), clip('b', 4, 8, { trimIn: 2 })])
    expect(w).toHaveLength(1)
    expect(activeBlendAt(w, 4)).toBeNull()
    expect(activeBlendAt(w, 4, ['whip_pan'])).not.toBeNull()
  })
  it('shortens to what the source has: no spare footage at all means a hard cut, with no window', () => {
    expect(planBlendWindows([clip('a', 0, 4, { transition: 'dissolve', duration: 4 }), clip('b', 4, 8, { trimIn: 0 })])).toEqual([])
  })
  it('a gap ends the run: no blend across it', () => {
    expect(planBlendWindows([clip('a', 0, 4, { transition: 'dissolve', trimIn: 1 }), clip('b', 5, 8, { trimIn: 2 })])).toEqual([])
  })
})

describe('sourceTimeAt', () => {
  it('continues the clip mapping into pre-roll and post-roll, and never goes below the start of the file', () => {
    const b = clip('b', 4, 8, { trimIn: 2, speed: 2 })
    expect(sourceTimeAt(b, 4)).toBe(2)
    expect(sourceTimeAt(b, 3.7)).toBeCloseTo(1.4, 6)
    expect(sourceTimeAt(b, 0)).toBe(0)
    expect(sourceTimeAt(clip('a', 0, 4, { trimIn: 1 }), 4.3)).toBeCloseTo(5.3, 6)
  })
})
