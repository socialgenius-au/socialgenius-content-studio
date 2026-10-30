// M2.1a -- reading the OCR evidence: faithful, frozen, tolerant of partial data, and the input is never touched.
import { describe, expect, it } from 'vitest'
import { readTextEvidence } from './evidence'
import { CAST, DURATION, FRAME_H, FRAME_PATH, FRAME_W, reference } from './testkit'

const ev = () => readTextEvidence(reference({ texts: CAST }), 5368)

describe('reading evidence', () => {
  it('turns every group into one evidence item with its own id, reading, confidence and normalised box', () => {
    const e = ev()
    expect(e.groups.map(g => g.id)).toEqual([1, 6, 2, 3, 4, 5, 7])                                           // ordered by first sampled instant, then id
    const g1 = e.groups.find(g => g.id === 1)!
    expect(g1).toMatchObject({ text: 'Welcome to the show', confidence: 0.92, first: 3, last: 6, shotId: 9 })
    expect(g1.box).toEqual({ x: 0.1, y: 0.75, w: 0.6, h: 0.035 })
    expect(g1.observations).toHaveLength(2)
    expect(g1.observations[0]).toMatchObject({ timestamp: 3, confidence: 0.92 })
  })
  it('orders groups by when they were first read', () => {
    const firsts = ev().groups.map(g => g.first)
    expect([...firsts].sort((a, b) => a - b)).toEqual(firsts)
  })
  it('collects every instant OCR demonstrably read something, once, ascending', () => {
    expect(ev().sampleTimes).toEqual([3, 6, 9, 12, 15, 18, 21, 24, 27])
  })
  it('takes the video length from the probe, else from the last shot', () => {
    expect(ev().durationSeconds).toBe(DURATION)
    expect(readTextEvidence(reference({ texts: CAST, duration: null, shotEnd: 40 }), 1).durationSeconds).toBe(40)
  })
  it('finds the source frame’s real size, and falls back to the video’s size, and else says it does not know', () => {
    expect(ev().groups[0].frame).toEqual({ path: FRAME_PATH, width: FRAME_W, height: FRAME_H })
    const noFrames = readTextEvidence(reference({ texts: [{ ...CAST[0], frame: '/data/uploads/1/other.jpg' }] }), 1)
    expect(noFrames.groups[0].frame).toMatchObject({ width: FRAME_W, height: FRAME_H })           // from technical_details.video
    const none = readTextEvidence(reference({ texts: CAST, frame: null }), 1)
    expect(none.groups[0].frame).toMatchObject({ width: null, height: null })
  })
  it('records which recurring elements a group belongs to, and keeps the stored style as evidence only', () => {
    const e = readTextEvidence(reference({ texts: CAST, recurring: [{ id: 77, members: [6, 7] }] }), 1)
    expect(e.groups.find(g => g.id === 6)!.recurringIds).toEqual([77])
    expect(e.groups.find(g => g.id === 1)!.recurringIds).toEqual([])
    expect(e.groups[0].storedStyle).toEqual({ dominant_text_color_rgb: [30, 30, 30], dominant_background_color_rgb: [160, 160, 160] })
    expect(e.rightsStatus).toBe('unknown_third_party')
  })
})

describe('evidence is immutable and the input is never touched', () => {
  it('is deep-frozen: changing any part throws', () => {
    const e = ev()
    expect(Object.isFrozen(e) && Object.isFrozen(e.groups) && Object.isFrozen(e.groups[0]) && Object.isFrozen(e.groups[0].observations[0]) && Object.isFrozen(e.groups[0].box)).toBe(true)
    expect(() => { (e.groups[0] as { text: string }).text = 'edited' }).toThrow()
    expect(() => { (e.groups[0].observations as unknown[]).push({}) }).toThrow()
    expect(() => { (e.sampleTimes as number[]).push(99) }).toThrow()
  })
  it('does not mutate or freeze the object it was given', () => {
    const input = reference({ texts: CAST, recurring: [{ id: 77, members: [6] }] })
    const before = JSON.stringify(input)
    readTextEvidence(input, 1)
    expect(JSON.stringify(input)).toBe(before)
    expect(Object.isFrozen(input.shots[0].text_elements[0])).toBe(false)
    expect(Object.isFrozen(input.shots[0].text_elements[0].style_details)).toBe(false)           // the stored style was COPIED before freezing
  })
})

describe('partial and malformed analyses', () => {
  it('skips items that are not evidence of text (empty wording, no usable box) instead of failing', () => {
    const e = readTextEvidence(reference({ texts: [
      { id: 1, text: '   ', box: [0.1, 0.1, 0.2, 0.03], conf: 0.9 },
      { id: 2, text: 'ok', box: [0.1, 0.1, 0, 0.03], conf: 0.9 },
      { id: 3, text: 'fine', box: [0.1, Number.NaN, 0.2, 0.03], conf: 0.9 },
      { id: 4, text: 'kept', box: [0.1, 0.1, 0.2, 0.03], conf: 0.9 },
    ] }), 1)
    expect(e.groups.map(g => g.id)).toEqual([4])
  })
  it('works from the group’s own span when the raw observations are missing', () => {
    const input = reference({ texts: [{ id: 4, text: 'kept', box: [0.1, 0.1, 0.2, 0.03], conf: 0.9 }] })
    input.shots[0].text_elements[0].observations = undefined as never
    input.shots[0].text_elements[0].start_time = 5; input.shots[0].text_elements[0].end_time = 8
    const g = readTextEvidence(input, 1).groups[0]
    expect([g.first, g.last, g.observations.length]).toEqual([5, 8, 0])
  })
  it('handles an analysis with no shots, no text, or no recurring list', () => {
    expect(readTextEvidence({ id: 1, shots: [] }, 1)).toMatchObject({ groups: [], sampleTimes: [], durationSeconds: null })
    expect(readTextEvidence({ id: 1, shots: undefined as never }, 1).groups).toEqual([])
  })
  it('treats an unreported OCR confidence as unknown, not as zero or one', () => {
    const g = readTextEvidence(reference({ texts: [{ id: 4, text: 'kept', box: [0.1, 0.1, 0.2, 0.03], conf: null }] }), 1).groups[0]
    expect(g.confidence).toBeNull()
  })
})
