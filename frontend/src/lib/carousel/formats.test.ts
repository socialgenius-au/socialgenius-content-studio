import { describe, expect, it } from 'vitest'
import { assertValidPostDocument, type PostDocument, type TextElement } from '../postDocument'
import { createCarouselDocument } from './document'
import { addElement, makeShape, type OpContext } from './ops'
import { CUSTOM_FORMAT, allFormatOptions, checkCustomSize, customFormat, formatFor, isCustomFormat, orientationOf, resizeDocument } from './formats'
import { checkLimits, describeLimits, limitsFor } from './platformLimits'

function ids(): OpContext { let n = 0; return { newId: p => `${p}_${++n}`, now: () => new Date('2026-11-21T09:00:00Z') } }
const base = (): PostDocument => { const c = ids(); let d = createCarouselDocument({ title: 'F', layouts: ['cover', 'title_body'] }, c); d = addElement(d, d.pages[0].id, makeShape({ x: 0.1, y: 0.2, width: 0.5, height: 0.25, stroke: { color: '#FFFFFF', width: 0.01 } }, c), c); return d }
const allEls = (d: PostDocument) => d.pages.flatMap(p => p.elements)

describe('format presets', () => {
  it('covers Instagram, Facebook, LinkedIn, TikTok, YouTube and Pinterest in portrait, landscape and square', () => {
    const o = allFormatOptions()
    for (const p of ['instagram', 'facebook', 'linkedin', 'tiktok', 'youtube', 'pinterest']) expect(o.some(x => x.platformKey === p), p).toBe(true)
    for (const orient of ['portrait', 'landscape', 'square']) expect(o.some(x => x.orientation === orient), orient).toBe(true)
    expect(o.find(x => x.platformKey === 'instagram' && x.formatKey === 'carousel')).toMatchObject({ width: 1080, height: 1350, orientation: 'portrait' })
    expect(o.find(x => x.platformKey === 'youtube' && x.formatKey === 'standard')).toMatchObject({ width: 1920, height: 1080, orientation: 'landscape' })
    expect(o.every(x => x.ratio !== 'CUSTOM')).toBe(true)
    expect(orientationOf(1080, 1080)).toBe('square'); expect(orientationOf(1080, 1100)).toBe('square'); expect(orientationOf(1920, 1080)).toBe('landscape'); expect(orientationOf(1080, 1920)).toBe('portrait')
    expect(formatFor('pinterest', 'pin')).toMatchObject({ width: 1000, height: 1500 }); expect(formatFor('nope', 'x')).toBeNull()
  })
  it('custom sizes are whole pixels inside the allowed range and carry their own ratio', () => {
    expect(checkCustomSize(1200, 628)).toEqual({ ok: true, width: 1200, height: 628 })
    for (const [w, h] of [[50, 500], [500, 5000], [100.5, 200], [NaN, 200]]) expect(checkCustomSize(w, h).ok).toBe(false)
    const f = customFormat(1600, 900)
    expect(isCustomFormat(f)).toBe(true); expect(f).toMatchObject({ ...CUSTOM_FORMAT, width: 1600, height: 900 })
  })
})

describe('resizing keeps every layer editable', () => {
  it('"fit" scales the whole design into the new canvas, centred, keeping proportions, ids, order and text scale', () => {
    const d = base()
    const r = resizeDocument(d, formatFor('youtube', 'standard')!, 'fit', ids())          // 1920x1080 from 1080x1350
    assertValidPostDocument(r)
    expect(r.format).toMatchObject({ width: 1920, height: 1080 })
    expect(allEls(r).map(e => e.id)).toEqual(allEls(d).map(e => e.id))                    // same layers, same order
    const k = 1080 / 1350                                                                 // limited by height
    const sb = d.pages[0].elements.find(e => e.type === 'shape' && !!e.stroke)!, sa = r.pages[0].elements.find(e => e.id === sb.id)!
    expect(sa.width * 1920).toBeCloseTo(sb.width * 1080 * k, 3)                           // same pixel proportions
    expect((sa.height as number) * 1080).toBeCloseTo((sb.height as number) * 1350 * k, 3)
    expect(sa.x).toBeGreaterThan(sb.x)                                                    // centred with side margins
    const tb = d.pages[0].elements.find(e => e.type === 'text') as TextElement, ta = r.pages[0].elements.find(e => e.id === tb.id) as TextElement
    expect(ta.style.fontSize * 1080).toBeCloseTo(tb.style.fontSize * 1080 * k, 5)         // text pixels scale with the design
    expect(sa.type === 'shape' && sb.type === 'shape' && sa.stroke!.width).toBeCloseTo((sb.type === 'shape' ? sb.stroke!.width : 0) * k, 6)
    expect(d.format.width).toBe(1080)                                                     // the original is untouched
  })
  it('"relative" keeps every element at the same share of the canvas and leaves typography alone', () => {
    const d = base()
    const r = resizeDocument(d, formatFor('instagram', 'square')!, 'relative', ids())
    assertValidPostDocument(r)
    expect(allEls(r).map(e => [e.x, e.y, e.width, e.height])).toEqual(allEls(d).map(e => [e.x, e.y, e.width, e.height]))
    const t0 = d.pages[0].elements.find(e => e.type === 'text') as TextElement, t1 = r.pages[0].elements.find(e => e.id === t0.id) as TextElement
    expect(t1.style.fontSize).toBe(t0.style.fontSize)
    expect(r.revision).toBe(d.revision + 1)
  })
  it('resizing through several formats never loses, reorders or flattens a layer, and the result stays valid', () => {
    let d = base()
    const ids0 = allEls(d).map(e => e.id), types0 = allEls(d).map(e => e.type)
    for (const [p, f] of [['tiktok', 'vertical'], ['youtube', 'standard'], ['instagram', 'square'], ['pinterest', 'pin']] as const) { d = resizeDocument(d, formatFor(p, f)!, 'fit', ids()); assertValidPostDocument(d) }
    d = resizeDocument(d, formatFor('instagram', 'carousel')!, 'relative', ids())
    expect(allEls(d).map(e => e.id)).toEqual(ids0); expect(allEls(d).map(e => e.type)).toEqual(types0)
    for (const e of allEls(d)) { expect(e.x).toBeGreaterThanOrEqual(0); expect(e.x + e.width).toBeLessThanOrEqual(1.0001) }
  })
})

describe('platform limits (advice only)', () => {
  const doc = (platform: string, format: string): PostDocument => ({ ...base(), format: { ...base().format, platformKey: platform, formatKey: format } })
  it('warns about too many slides, over-long videos and oversized PDFs, and always says to confirm with the platform', () => {
    expect(limitsFor('instagram', 'carousel').maxSlides).toBe(20)
    const w = checkLimits(doc('instagram', 'carousel'), { kind: 'image', slideCount: 35 })
    expect(w.join(' ')).toMatch(/35 slides is more than Instagram allows in one post \(20\)/); expect(w[w.length - 1]).toMatch(/confirm them with the platform/)
    expect(checkLimits(doc('instagram', 'carousel'), { kind: 'image', slideCount: 10 })).toEqual([])
    expect(checkLimits(doc('youtube', 'shorts'), { kind: 'video', slideCount: 5, videoSeconds: 200 }).join(' ')).toMatch(/200 seconds long; Youtube allows up to 180/)
    expect(checkLimits(doc('youtube', 'shorts'), { kind: 'video', slideCount: 5, videoSeconds: 60 })).toEqual([])
    expect(checkLimits(doc('linkedin', 'square'), { kind: 'pdf', slideCount: 20, estimatedMB: 150 }).join(' ')).toMatch(/over Linkedin's 100 MB/)
    expect(checkLimits(doc('pinterest', 'pin'), { kind: 'image', slideCount: 8 }).join(' ')).toMatch(/more than Pinterest allows.*\(5\)/)
    expect(checkLimits(doc('tiktok', 'vertical'), { kind: 'video', slideCount: 100, videoSeconds: 900 }).join(' ')).toMatch(/allows up to 600/)
  })
  it('a GIF is flagged as silent; platforms without limits stay quiet; describeLimits lists the published limits', () => {
    expect(checkLimits(doc('website', 'square'), { kind: 'gif', slideCount: 3, videoSeconds: 5 }).join(' ')).toMatch(/GIFs are silent/)
    expect(checkLimits(doc('website', 'square'), { kind: 'image', slideCount: 99 })).toEqual([])
    expect(describeLimits(doc('instagram', 'carousel')).join(' ')).toMatch(/up to 20 slides/)
    expect(describeLimits(doc('website', 'square'))).toEqual([])
  })
})
