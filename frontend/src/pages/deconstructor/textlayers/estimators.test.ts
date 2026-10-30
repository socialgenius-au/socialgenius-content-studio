// M2.1a -- timing uncertainty, colour estimation and geometry/size estimation.
import { describe, expect, it } from 'vitest'
import { estimateAppearance, MIN_SEPARATION } from './appearance'
import { DEFAULT_CANVAS, estimateGeometry, MAX_FONT, MIN_FONT, RENDER_CALIBRATION } from './geometry'
import { readTextEvidence } from './evidence'
import { estimateTiming, isTimingUncertain, MIN_VISIBLE_SECONDS } from './timing'
import { CAST, reference, textRegion, type Rgb } from './testkit'

const group = (id: number, extra: Partial<(typeof CAST)[number]> = {}, opts: { duration?: number | null; shotEnd?: number } = {}) => {
  const spec = { ...CAST.find(c => c.id === id)!, ...extra }
  return readTextEvidence(reference({ texts: [spec], ...opts }), 1).groups[0]
}

describe('timing: between sampled frames, with an honest uncertainty', () => {
  const samples = [0, 3, 6, 9, 12]
  it('puts start and end in the middle of the unsampled gaps either side of the readings', () => {
    const g = group(1, { obs: [{ t: 6 }] })                                      // read at 6 s only; neighbours 3 s and 9 s
    const t = estimateTiming(g, samples)
    expect([t.start, t.end, t.startUncertainty, t.endUncertainty]).toEqual([4.5, 7.5, 1.5, 1.5])
    expect([t.observedFirst, t.observedLast, t.observations]).toEqual([6, 6, 1])
  })
  it('spans every reading of a group that was read more than once', () => {
    const g = group(1, { obs: [{ t: 3 }, { t: 6 }] })
    const t = estimateTiming(g, samples)
    expect([t.start, t.end]).toEqual([1.5, 7.5])                                 // prev sample 0, next sample 9
  })
  it('uses the shot’s own edges where there is no neighbouring sample', () => {
    const first = estimateTiming(group(1, { obs: [{ t: 0.15 }] }), [0.15, 3])
    expect(first.start).toBeCloseTo(0.075, 3); expect(first.startUncertainty).toBeCloseTo(0.075, 3)
    const last = estimateTiming(group(1, { obs: [{ t: 12 }] }), [9, 12])
    expect(last.end).toBeLessThanOrEqual(42.6); expect(last.end).toBeGreaterThan(12)
  })
  it('never ends past the shot, even when the next sample lies beyond its end', () => {
    const t = estimateTiming(group(1, { obs: [{ t: 12 }] }, { shotEnd: 13 }), [9, 12, 30])
    expect(t.end).toBeLessThanOrEqual(13)
  })
  it('never reports a flash shorter than the minimum visible time', () => {
    const t = estimateTiming(group(1, { obs: [{ t: 6 }] }), [5.9, 6, 6.1])
    expect(t.end - t.start).toBeGreaterThanOrEqual(MIN_VISIBLE_SECONDS - 1e-9)
  })
  it('flags uncertainty above half a second and not below', () => {
    expect(isTimingUncertain(estimateTiming(group(1, { obs: [{ t: 6 }] }), samples))).toBe(true)
    expect(isTimingUncertain(estimateTiming(group(1, { obs: [{ t: 6 }] }), [5.8, 6, 6.2]))).toBe(false)
  })
})

describe('colour: read from pixels, never from the stored light/dark pair', () => {
  const WHITE: Rgb = [245, 245, 245], NEAR_BLACK: Rgb = [28, 28, 28], DARK_GREY: Rgb = [50, 50, 54], LIGHT_GREY: Rgb = [215, 215, 210]
  it('reads light text on a dark picture as LIGHT (the case the stored colours get backwards)', () => {
    const { img, inner } = textRegion({ text: WHITE, box: NEAR_BLACK, ring: DARK_GREY })
    const a = estimateAppearance(img, inner)
    expect(a.textColor).toBe('#f5f5f5')
    expect(a.confidence).toBe('high')
    expect(a.backdropColor).toBe('#1c1c1c')
    expect(a.notes.join(' ')).toMatch(/lighter/)
  })
  it('reads dark text on a light picture as DARK', () => {
    const { img, inner } = textRegion({ text: NEAR_BLACK, box: LIGHT_GREY, ring: LIGHT_GREY })
    const a = estimateAppearance(img, inner)
    expect(a.textColor).toBe('#1c1c1c')
    expect(a.confidence).toBe('high')
  })
  it('reads coloured text, not just black or white', () => {
    const { img, inner } = textRegion({ text: [250, 200, 20], box: [20, 20, 40], ring: [30, 30, 50] })
    const a = estimateAppearance(img, inner)
    expect(a.textColor).toBe('#fac814')
  })
  it('survives noise on the pixels', () => {
    const { img, inner } = textRegion({ text: WHITE, box: NEAR_BLACK, ring: DARK_GREY, seed: 7 })
    const d = img.data as Uint8ClampedArray
    let s = 12345
    for (let i = 0; i < d.length; i += 4) { s = (s * 1103515245 + 12345) % 2147483648; const n = (s % 21) - 10; d[i] += n; d[i + 1] += n; d[i + 2] += n }
    const a = estimateAppearance(img, inner)
    expect(a.confidence).not.toBe('low')
    expect(parseInt(a.textColor!.slice(1, 3), 16)).toBeGreaterThan(200)
  })
  it('gives no colour, with low confidence, when text and background are too close to tell apart', () => {
    const { img, inner } = textRegion({ text: [110, 110, 110], box: [96, 96, 96], ring: [100, 100, 100] })
    const a = estimateAppearance(img, inner)
    expect(a).toMatchObject({ textColor: null, confidence: 'low' })
    expect(a.separation).toBeLessThan(MIN_SEPARATION)
  })
  it('gives no colour for a flat region, a missing image, or too few pixels', () => {
    const flat = textRegion({ text: NEAR_BLACK, box: NEAR_BLACK, ring: NEAR_BLACK })
    expect(estimateAppearance(flat.img, flat.inner).textColor).toBeNull()
    expect(estimateAppearance({ width: 0, height: 0, data: [] }, { x: 0, y: 0, w: 1, h: 1 }).textColor).toBeNull()
    const tiny = textRegion({ w: 2, h: 2, margin: 1, text: WHITE, box: NEAR_BLACK, ring: DARK_GREY })
    expect(estimateAppearance(tiny.img, tiny.inner).textColor).toBeNull()
    expect(estimateAppearance({ width: 10, height: 10, data: new Uint8ClampedArray(4) }, { x: 0, y: 0, w: 5, h: 5 }).confidence).toBe('low')
  })
  it('is only low-confidence when the two cues disagree (bright text on a dark box inside a bright picture)', () => {
    const { img, inner } = textRegion({ text: WHITE, box: NEAR_BLACK, ring: [235, 235, 235] })
    expect(estimateAppearance(img, inner).confidence).toBe('low')
  })
  it('ignores transparent pixels', () => {
    const { img, inner } = textRegion({ text: WHITE, box: NEAR_BLACK, ring: DARK_GREY })
    const d = img.data as Uint8ClampedArray
    for (let i = 3; i < 400; i += 4) d[i] = 0
    expect(estimateAppearance(img, inner).textColor).toBe('#f5f5f5')
  })
})

describe('geometry: units, size and position the export will actually reproduce', () => {
  const g = (id: number, extra = {}) => group(id, extra)
  it('sizes the font by the smaller of the height-based and width-based estimates, and says both', () => {
    const e = estimateGeometry(g(1), 'Welcome to the show')
    // 0.035*864 px tall in a 480-wide frame -> x2.25 into the editor's 1080 units -> /0.95 ink-per-em; 0.6*480 px wide -> x2.25 / (19 chars * 0.5 em)
    expect(e.fontSizeFromHeight).toBe(Math.round(0.035 * 864 * 2.25 / RENDER_CALIBRATION.inkHeightEm))
    expect(e.fontSizeFromWidth).toBe(Math.round(0.6 * 480 * 2.25 / (19 * RENDER_CALIBRATION.advanceEm)))
    expect(e.fontSize).toBe(Math.min(e.fontSizeFromHeight, e.fontSizeFromWidth!))
  })
  it('sizes very short text by height alone', () => {
    expect(estimateGeometry(g(4), 'X').fontSizeFromWidth).toBeNull()
  })
  it('keeps the font inside the supported range', () => {
    expect(estimateGeometry({ box: { x: 0.1, y: 0.1, w: 0.5, h: 0.001 }, frame: { path: null, width: 480, height: 864 } }, 'Tiny').fontSize).toBe(MIN_FONT)
    expect(estimateGeometry({ box: { x: 0.1, y: 0.1, w: 0.9, h: 0.5 }, frame: { path: null, width: 480, height: 864 } }, 'Huge words here').fontSize).toBeLessThanOrEqual(MAX_FONT)
  })
  it('places the layer so the exporter’s ink lands on the detected box (round trip)', () => {
    const grp = g(1)
    const e = estimateGeometry(grp, 'Welcome to the show', DEFAULT_CANVAS)
    const C = RENDER_CALIBRATION
    const inkLeft = (e.x / 100) * DEFAULT_CANVAS.width + C.padLeftPx + C.inkLeftEm * e.fontSize
    const inkTop = (e.y / 100) * DEFAULT_CANVAS.height + C.padTopPx + C.inkTopEm * e.fontSize
    expect(Math.abs(inkLeft - grp.box.x * DEFAULT_CANVAS.width)).toBeLessThan(1.5)
    expect(Math.abs(inkTop - grp.box.y * DEFAULT_CANVAS.height)).toBeLessThan(1.5)
  })
  it('keeps the same fractional position on a different canvas', () => {
    const a = estimateGeometry(g(1), 'Welcome to the show', { width: 1080, height: 1920 })
    const b = estimateGeometry(g(1), 'Welcome to the show', { width: 1080, height: 1080 })
    expect(a.x).toBeCloseTo(b.x, 1)
    expect(Math.abs(a.y - b.y)).toBeLessThan(1)                                  // only the padding/ink offsets differ in percent
  })
  it('holds the box inside the canvas and wide enough for one line', () => {
    const flush = estimateGeometry({ box: { x: 0, y: 0, w: 0.95, h: 0.03 }, frame: { path: null, width: 480, height: 864 } }, 'Edge to edge text line')
    expect(flush.x).toBe(0); expect(flush.y).toBe(0); expect(flush.x + flush.width).toBeLessThanOrEqual(100.0001)
    const e = estimateGeometry(g(1), 'Welcome to the show')
    expect(e.width).toBeGreaterThan(0.6 * 100)
  })
  it('says when it had to assume a 9:16 frame', () => {
    const noFrame = readTextEvidence(reference({ texts: CAST, frame: null }), 1).groups[0]
    expect(estimateGeometry(noFrame, 'Welcome').frameAssumed).toBe(true)
    expect(estimateGeometry(g(1), 'Welcome').frameAssumed).toBe(false)
  })
})
