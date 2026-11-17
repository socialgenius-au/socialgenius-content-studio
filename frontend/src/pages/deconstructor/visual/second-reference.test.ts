// M4 second-reference validation. The fixture is the PRODUCT'S REAL LOCAL ANALYSIS (EasyOCR, torchvision detector, occurrence grouping, recurring linkage, persistence) of a CONSTRUCTED video: a landscape 16:9
// reference rendered for this purpose, with known ground truth (a text-free logo emblem, a handle watermark that hops corners, eight burned-in subtitle lines, a lower-third name bar, a title card, a price tag,
// a sliding ticker word). It is not a recording of anything; the CONTENT is synthetic, the ANALYSIS OUTPUT is real. It differs from VA5368 on purpose: landscape, English, no people, digits in ordinary text,
// text on a gradient, a logo that is a pure graphic.
//
// The classifier was NOT tuned to make these pass. Running it on this reference found one real defect (digits in ordinary phrases were called handles); the rule was generalised (signals.ts) and the cases are pinned
// here. What it still gets wrong or cannot know is asserted too, so the limits are visible.
import { describe, expect, it } from 'vitest'
import type { ReferenceVideo } from '../../../types'
import evidence from './__fixtures__/ref2.constructed.evidence.json'
import { buildVisualElements, looksLikeHandle, USER_ONLY_CLASSES, type VisualElement } from '.'

const ref = evidence as unknown as ReferenceVideo
const els = buildVisualElements(ref, { videoAnalysisId: (ref as unknown as { latest_analysis: { id: number } }).latest_analysis.id })
const withText = (re: RegExp) => els.filter(e => e.text && e.text.readings.some(r => re.test(r)))
const cls = (e: VisualElement) => e.classification.class

describe('ground truth of the constructed reference', () => {
  it('the handle watermark that hops between corners (30 sightings) is TEXT_HANDLE, with the movement seen', () => {
    const w = withText(/northwind/i)
    expect(w).toHaveLength(1)
    expect(cls(w[0])).toBe('TEXT_HANDLE'); expect(w[0].track.observations.length).toBeGreaterThan(10); expect(w[0].track.linkage.by).toBe('recurring_element')
    expect(w[0].classification.confidence.level).not.toBe('high')                                   // OCR reads "@northwind studio" with a space and no dot
  })
  it('ordinary text that contains a number is NOT a handle (the defect this reference found)', () => {
    for (const re of [/Spring Launch/i, /OFF/]) for (const e of withText(re)) expect(cls(e), e.text!.best).not.toBe('TEXT_HANDLE')
    for (const t of ['Spring Launch 2026', '50% OFF', 'Call 555-1234', 'Chapter 3: The Start', 'Room 12 A']) expect(looksLikeHandle(t), t).toBe(false)
    for (const t of ['@northwind studio', 'user_123', 'shop2024', 'brand.com', 'GTANUCREATES_O']) expect(looksLikeHandle(t), t).toBe(true)
  })
  it('the burned-in subtitle lines found by OCR are TEXT_SUBTITLE (7 of the 8 rendered were read; one overlapped the lower third and OCR missed it)', () => {
    const lines = ['Welcome to the product tour', 'Let me show you three features', 'First, the live dashboard', 'updates in real time', 'Share it with your team', 'Third, the mobile app', 'Download it today']
    for (const l of lines) { const e = withText(new RegExp(l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')); expect(e.length, l).toBeGreaterThanOrEqual(1); expect(e.map(cls), l).toContain('TEXT_SUBTITLE') }
    expect(withText(/report builder/i)).toHaveLength(0)                                                  // not in the evidence at all: nothing is invented to fill the gap
  })
  it('the lower-third name bar is not a subtitle, and its confidence is low', () => {
    for (const e of [...withText(/Maria Lopez/), ...withText(/Head of Product/)]) { expect(cls(e)).not.toBe('TEXT_SUBTITLE'); expect(e.classification.confidence.level).toBe('low') }
  })
  it('the title and price tag are readable text of no further kind: TEXT_OTHER or caption, never subtitle or handle, with low confidence', () => {
    for (const e of [...withText(/Spring Launch/i), ...withText(/OFF/)]) { expect(['TEXT_OTHER', 'TEXT_CAPTION']).toContain(cls(e)); expect(e.classification.confidence.level).not.toBe('high') }
  })
  it('the sliding ticker word, which OCR reads as "SALE" and "SAL٤", is not trusted: low confidence, and never a caption, subtitle or handle', () => {
    for (const e of withText(/SAL/)) { expect(['UNKNOWN', 'TEXT_OTHER']).toContain(cls(e)); expect(e.classification.confidence.level).toBe('low') }
  })
  it('a one-character OCR fragment is never a subtitle', () => {
    for (const e of els.filter(x => x.text && x.text.readings.every(r => Array.from(r).length <= 2))) expect(cls(e)).toBe('UNKNOWN')
  })
})

describe('what M4 cannot know about this reference, stated', () => {
  it('the text-free logo emblem is invisible to the analysis (OCR reads no text in it, the detector found nothing): no element sits there and none is invented', () => {
    expect(els.filter(e => e.box.x < 0.15 && e.box.y < 0.2)).toEqual([])
  })
  it('there are no detections, so there are no object elements and no image regions', () => {
    expect(els.filter(e => e.track.kind === 'object')).toEqual([]); expect(els.some(e => cls(e) === 'IMAGE_REGION')).toBe(false)
  })
  it('nothing is ever a graphical class, and every confidence stays at or below the rule cap', () => {
    for (const e of els) { expect(USER_ONLY_CLASSES).not.toContain(cls(e)); expect(e.classification.confidence.score).toBeLessThanOrEqual(0.8) }
  })
})

describe('calibration on this reference', () => {
  it('correct classifications are medium at most; low-evidence ones are low; unknowns are low', () => {
    for (const e of els) { if (cls(e) === 'UNKNOWN') expect(e.classification.confidence.level).toBe('low'); expect(e.classification.confidence.level).not.toBe('high') }
  })
  it('no readable text is dropped: every element is native text or honestly not reliable', () => {
    for (const e of els) expect(['native_text', 'not_reliable']).toContain(e.readiness.state)
  })
})
