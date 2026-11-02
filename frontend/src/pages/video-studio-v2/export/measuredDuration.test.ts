import { describe, expect, it } from 'vitest'
import { durationCorrection } from './measuredDuration'

describe('durationCorrection', () => {
  const clip = { duration: 10, trimOut: 4 }
  it('never uses an invalid measurement', () => {
    for (const bad of [0, -1, NaN, Infinity, -Infinity, undefined, null, '6', {}, 1e9]) expect(durationCorrection(clip, bad)).toBeNull()
  })
  it('leaves a recorded duration alone when the measurement agrees with it', () => {
    expect(durationCorrection(clip, 10)).toBeNull()
    expect(durationCorrection(clip, 10.015)).toBeNull()
    expect(durationCorrection(clip, 9.985)).toBeNull()
  })
  it('replaces a wrong recorded duration, moving trimOut by the same amount so the clip span is unchanged', () => {
    const fix = durationCorrection({ duration: 10, trimOut: 4 }, 12)!
    expect(fix).toEqual({ duration: 12, trimOut: 6 })
    const span = (c: { duration: number; trimOut: number }) => c.duration - 2 - c.trimOut
    expect(span(fix)).toBe(span({ duration: 10, trimOut: 4 }))
    expect(durationCorrection({ duration: 10, trimOut: 4 }, 6)).toEqual({ duration: 6, trimOut: 0 })      // the 10 s fallback on a 6 s file
  })
  it('never lets trimOut go negative (a clip that reaches past the end of its file keeps its timeline, trimOut 0)', () => {
    expect(durationCorrection({ duration: 10, trimOut: 1 }, 6)).toEqual({ duration: 6, trimOut: 0 })
  })
  it('repairs a recorded duration that is itself invalid, keeping a valid trimOut', () => {
    expect(durationCorrection({ duration: 0, trimOut: 2 }, 7.25)).toEqual({ duration: 7.25, trimOut: 2 })
    expect(durationCorrection({ duration: NaN, trimOut: NaN }, 7.25)).toEqual({ duration: 7.25, trimOut: 0 })
  })
})
