// Telling a probable watermark from a recurring caption word. The two real cases come from the VA5368 analysis (positions, readings and times copied from its stored text elements).
import { describe, expect, it } from 'vitest'
import { classifyRecurring, distinctSpots, looksLikeHandle, looksLikeWords, type Sighting } from './recurring'

const s = (text: string, x: number, y: number, w: number, h: number, time: number): Sighting => ({ text, box: { x, y, w, h }, time })
const DURATION = 43

// the creator handle: hops between two fixed spots, OCR reads it a little differently each time, from 3 s to the end
const handle = [
  s('GTANUCREATES_O', 0.688, 0.282, 0.25, 0.028, 3.1), s('GTANUCREATESO', 0.11, 0.707, 0.246, 0.023, 10), s('GTANUGREATES_O', 0.688, 0.282, 0.25, 0.028, 18.4),
  s('GTANUCREATESO', 0.11, 0.707, 0.246, 0.023, 24.9), s('GTANUGREATES_O', 0.688, 0.282, 0.25, 0.028, 33.7), s('@TANUCREATES_0', 0.35, 0.542, 0.3, 0.03, 42.6),
]
// the caption word "Aap": the same word, sliding along one line of text, for 44% of the video
const word = [s('Aap', 0.107, 0.74, 0.13, 0.049, 6.1), s('Aap', 0.229, 0.741, 0.122, 0.042, 10), s('Aap', 0.679, 0.742, 0.122, 0.041, 15), s('Aap', 0.188, 0.742, 0.12, 0.042, 18.4), s('Aap', 0.111, 0.74, 0.13, 0.049, 24.5)]

describe('the two real recurring elements of VA5368', () => {
  it('the creator handle is a probable mark, with the reasons', () => {
    const c = classifyRecurring(handle, DURATION, 3.067, 42.556)
    expect(c.kind).toBe('probable_mark'); expect(c.score).toBeGreaterThanOrEqual(3)
    const why = c.reasons.join(' ')
    expect(why).toMatch(/handle or code/); expect(why).toMatch(/92% of the video/); expect(why).toMatch(/same 3 spots/); expect(why).toMatch(/reads it slightly differently/)
  })
  it('the caption word is caption text, not a logo', () => {
    const c = classifyRecurring(word, DURATION, 6.133, 24.879)
    expect(c.kind).toBe('caption_text'); expect(c.score).toBeLessThanOrEqual(0)
    expect(c.reasons.join(' ')).toMatch(/plain word/); expect(c.reasons.join(' ')).toMatch(/slides along one line of text/)
  })
})

describe('other plausible cases (synthetic)', () => {
  it('a static corner mark with a short brand name is a probable mark', () => {
    const brand = [0, 8, 16, 24, 32, 40].map(t => s('BRAND', 0.8, 0.05, 0.15, 0.04, t))
    expect(classifyRecurring(brand, DURATION, 0, 40).kind).toBe('probable_mark')
  })
  it('a plain word that returns at fixed spots for a short time stays unclear, not a mark', () => {
    const w = [s('Welcome', 0.2, 0.3, 0.3, 0.05, 1), s('Welcome', 0.2, 0.3, 0.3, 0.05, 3), s('Welcome', 0.2, 0.3, 0.3, 0.05, 5)]
    expect(classifyRecurring(w, DURATION, 1, 5).kind).not.toBe('probable_mark')
  })
  it('too few sightings are unclear, with that as the reason', () => {
    const c = classifyRecurring(handle.slice(0, 2), DURATION, 3, 10)
    expect(c.kind).toBe('unclear'); expect(c.reasons[0]).toMatch(/Only 2 sightings/)
  })
  it('does not use the video length when it is unknown, and never throws on odd input', () => {
    expect(() => classifyRecurring(handle, null, 3, 42)).not.toThrow()
    expect(() => classifyRecurring([], 0, 0, 0)).not.toThrow()
    expect(classifyRecurring(handle, null, 3, 42).reasons.join(' ')).not.toMatch(/of the video/)
  })
})

describe('the text and position helpers', () => {
  it('tells a handle from words', () => {
    for (const h of ['@creator', 'GTANUCREATES_O', 'shop2024', 'www.brand.com', 'ABCDEFGHIJ']) expect(looksLikeHandle(h)).toBe(true)
    for (const w of ['Aap', 'Welcome back', "Don't", 'Kabhi Wapas Laut Kar Nahi Aati']) { expect(looksLikeHandle(w)).toBe(false); expect(looksLikeWords(w)).toBe(true) }
    expect(looksLikeWords('BRAND')).toBe(false)
  })
  it('counts places, treating boxes within 2% as the same place', () => {
    expect(distinctSpots(handle.map(x => x.box))).toBe(3)
    expect(distinctSpots(word.map(x => x.box))).toBe(4)                       // 0.107 and 0.111 are one place
  })
})
