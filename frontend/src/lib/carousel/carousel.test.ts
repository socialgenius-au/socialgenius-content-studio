import { describe, expect, it } from 'vitest'
import { assertValidPostDocument, validatePostDocument, elementIds, type PostDocument } from '../postDocument'
import {
  CarouselError, addElement, deleteElement, deleteSlide, duplicateElement, duplicateSlide, insertSlide, makeImage, makeShape, makeText, moveElementLayer, moveSlide,
  newSlide, reorderSlides, renameSlide, setSlideBackground, setSlideElements, updateElement, type OpContext,
} from './ops'
import { createCarouselDocument } from './document'
import { blockHeight, buildLayout, CAROUSEL_THEMES, ctaLabel, estimateLines, fitSize, LAYOUTS, themeById, type LayoutId } from './layouts'
import { carouselKey, CAROUSEL_INDEX_KEY, deleteCarousel, listCarousels, loadCarousel, memoryStorage, saveCarousel } from './storage'

/** Deterministic ids and clock, so every assertion is exact. */
function ctx(): OpContext {
  let n = 0
  let t = Date.UTC(2026, 10, 19, 9, 0, 0)
  return { newId: p => `${p}_${++n}`, now: () => new Date((t += 1000)) }
}

const fresh = (c = ctx()) => createCarouselDocument({ title: 'Tile tips', layouts: ['cover', 'title_body', 'list', 'cta'] }, c)
const ids = (d: PostDocument) => d.pages.map(p => p.id)

describe('a new carousel', () => {
  it('is a valid multi-page Instagram 4:5 document built from the registry', () => {
    const d = fresh()
    expect(validatePostDocument(d)).toEqual({ ok: true, errors: [] })
    expect(d.kind).toBe('post')
    expect(d.format).toMatchObject({ platformKey: 'instagram', formatKey: 'carousel', width: 1080, height: 1350, ratio: '4:5' })
    expect(d.pages).toHaveLength(4)
    expect(d.pages.map(p => p.name)).toEqual(['1. Cover', '2. Explain', '3. List', '4. Call to action'])
    expect(new Set(elementIds(d)).size).toBe(elementIds(d).length)         // unique ids across the whole document
  })

  it('works for any registry format (the same functions, a different canvas)', () => {
    const sq = createCarouselDocument({ platformKey: 'instagram', formatKey: 'square', layouts: ['cover', 'cta'] }, ctx())
    expect(sq.format).toMatchObject({ width: 1080, height: 1080, ratio: '1:1' })
    expect(validatePostDocument(sq).ok).toBe(true)
    expect(() => createCarouselDocument({ platformKey: 'nope', formatKey: 'x' })).toThrow(/Unknown format/)
  })

  it('every layout in every theme builds valid, in-canvas elements for portrait, square and tall formats', () => {
    for (const [platformKey, formatKey] of [['instagram', 'carousel'], ['instagram', 'square'], ['instagram', 'reel_story']] as const) {
      for (const theme of CAROUSEL_THEMES) {
        for (const l of LAYOUTS) {
          const d = createCarouselDocument({ platformKey, formatKey, themeId: theme.id, layouts: [l.id] }, ctx())
          const r = validatePostDocument(d)
          expect(r.errors, `${platformKey}/${formatKey} ${theme.id} ${l.id}`).toEqual([])
          for (const el of d.pages[0].elements) {
            expect(el.x + el.width, `${l.id} ${el.name} right edge`).toBeLessThanOrEqual(1.0001)
            expect(el.x).toBeGreaterThanOrEqual(0)
            if (el.height !== 'auto') expect(el.y + el.height, `${l.id} ${el.name} bottom edge`).toBeLessThanOrEqual(1.0001)
          }
        }
      }
    }
  })

  it('layout text uses the supplied content and falls back to sample copy otherwise', () => {
    const f = fresh().format
    const built = buildLayout('cta', f, themeById('ink'), { headline: 'Book a free survey', cta: 'Book now' }, ctx())
    const texts = built.elements.filter(e => e.type === 'text').map(e => (e.type === 'text' ? e.content : ''))
    expect(texts).toContain('Book a free survey')
    expect(texts).toContain('Book now')
    expect(texts.some(t => /next step|exactly what to do/i.test(t))).toBe(true)      // the body fell back to sample copy
    expect(built.background).toEqual({ kind: 'solid', color: themeById('ink').background })
  })
})

describe('slide operations', () => {
  it('adds a slide at a position, bumps the revision, and never mutates the input', () => {
    const c = ctx()
    const d = fresh(c)
    const before = JSON.stringify(d)
    const built = buildLayout('statement', d.format, themeById('forest'), {}, c)
    const s = newSlide(built.background, built.elements, 'New', c)
    const d2 = insertSlide(d, s, 1, c)
    expect(JSON.stringify(d)).toBe(before)
    expect(ids(d2)).toEqual([d.pages[0].id, s.id, d.pages[1].id, d.pages[2].id, d.pages[3].id])
    expect(d2.revision).toBe(d.revision + 1)
    expect(Date.parse(d2.updatedAt)).toBeGreaterThan(Date.parse(d.updatedAt))
    assertValidPostDocument(d2)
  })

  it('deletes a slide but refuses to delete the last one', () => {
    const c = ctx()
    const d = fresh(c)
    const d2 = deleteSlide(d, d.pages[1].id, c)
    expect(ids(d2)).toEqual([d.pages[0].id, d.pages[2].id, d.pages[3].id])
    let one = d2
    while (one.pages.length > 1) one = deleteSlide(one, one.pages[0].id, c)
    expect(() => deleteSlide(one, one.pages[0].id, c)).toThrow(CarouselError)
    expect(() => deleteSlide(one, one.pages[0].id, c)).toThrow(/at least one slide/)
    expect(() => deleteSlide(d, 'nope', c)).toThrow(/does not exist/)
  })

  it('duplicates a slide right after the original with brand-new ids for the slide and every element, and the copy is independent', () => {
    const c = ctx()
    const d = fresh(c)
    const { doc: d2, slideId } = duplicateSlide(d, d.pages[0].id, c)
    expect(ids(d2).slice(0, 3)).toEqual([d.pages[0].id, slideId, d.pages[1].id])
    const orig = d2.pages[0]
    const copy = d2.pages[1]
    expect(copy.name).toBe('1. Cover (copy)')
    expect(copy.elements).toHaveLength(orig.elements.length)
    expect(copy.elements.map(e => e.id).filter(id => orig.elements.some(o => o.id === id))).toEqual([])
    expect(copy.elements.map(e => ({ ...e, id: '' }))).toEqual(orig.elements.map(e => ({ ...e, id: '' })))      // same content
    assertValidPostDocument(d2)                                                                                 // ids unique across the document
    const edited = updateElement(d2, slideId, copy.elements[1].id, { content: 'Changed' } as never, c)
    expect((orig.elements[1] as { content: string }).content).not.toBe('Changed')                              // original untouched
    expect((edited.pages[1].elements[1] as { content: string }).content).toBe('Changed')
    expect((edited.pages[0].elements[1] as { content: string }).content).toBe((orig.elements[1] as { content: string }).content)
  })

  it('duplicates group children with fresh ids too', () => {
    const c = ctx()
    let d = fresh(c)
    const group = { id: 'g1', type: 'group' as const, role: 'other' as const, name: 'G', x: 0.1, y: 0.1, width: 0.5, height: 0.2, rotation: 0, opacity: 1, visible: true, locked: false, children: [makeShape({ id: 'c1' }, c)] }
    d = addElement(d, d.pages[0].id, group, c)
    const { doc } = duplicateSlide(d, d.pages[0].id, c)
    assertValidPostDocument(doc)
    expect(elementIds(doc)).toHaveLength(new Set(elementIds(doc)).size)
  })

  it('moves a slide, clamps the target, and leaves the document untouched when nothing changes', () => {
    const c = ctx()
    const d = fresh(c)
    const [a, b, cc, dd] = ids(d)
    expect(ids(moveSlide(d, a, 2, c))).toEqual([b, cc, a, dd])
    expect(ids(moveSlide(d, dd, 0, c))).toEqual([dd, a, b, cc])
    expect(ids(moveSlide(d, a, 99, c))).toEqual([b, cc, dd, a])
    expect(moveSlide(d, b, 1, c)).toBe(d)
    expect(() => moveSlide(d, 'zzz', 0, c)).toThrow(/does not exist/)
  })

  it('reorders every slide at once and rejects anything that is not a permutation', () => {
    const c = ctx()
    const d = fresh(c)
    const [a, b, cc, dd] = ids(d)
    expect(ids(reorderSlides(d, [dd, cc, b, a], c))).toEqual([dd, cc, b, a])
    expect(reorderSlides(d, [a, b, cc, dd], c)).toBe(d)
    expect(() => reorderSlides(d, [a, b, cc], c)).toThrow(/every slide exactly once/)
    expect(() => reorderSlides(d, [a, a, b, cc], c)).toThrow(CarouselError)
    expect(() => reorderSlides(d, [a, b, cc, 'x'], c)).toThrow(CarouselError)
  })

  it('has no slide cap: a carousel can grow far past 20 slides and stays valid, ordered and uniquely identified', () => {
    const c = ctx()
    let d = createCarouselDocument({ layouts: ['cover'] }, c)
    while (d.pages.length < 120) d = insertSlide(d, newSlide({ kind: 'solid', color: '#fff' }, [], undefined, c), undefined, c)
    d = duplicateSlide(d, d.pages[0].id, c).doc
    expect(d.pages).toHaveLength(121)
    expect(new Set(d.pages.map(p => p.id)).size).toBe(121)
    assertValidPostDocument(d)
    expect(deleteSlide(d, d.pages[60].id, c).pages).toHaveLength(120)
  })

  it('renames a slide and changes its background', () => {
    const c = ctx()
    const d = fresh(c)
    const d2 = setSlideBackground(renameSlide(d, d.pages[1].id, '  Why tiles  ', c), d.pages[1].id, { kind: 'gradient', angle: 90, stops: [{ offset: 0, color: '#111827' }, { offset: 1, color: '#1E8A55' }] }, c)
    expect(d2.pages[1].name).toBe('Why tiles')
    expect(d2.pages[1].background.kind).toBe('gradient')
    expect(renameSlide(d2, d.pages[1].id, '   ', c).pages[1].name).toBeUndefined()
    assertValidPostDocument(d2)
  })
})

describe('element operations', () => {
  it('adds text, shape and image elements to the front of one slide only', () => {
    const c = ctx()
    const d = fresh(c)
    const pid = d.pages[1].id
    let d2 = addElement(d, pid, makeText(d.format, { content: 'Hello' }, c), c)
    d2 = addElement(d2, pid, makeShape({}, c), c)
    d2 = addElement(d2, pid, makeImage({}, c), c)
    expect(d2.pages[1].elements.slice(-3).map(e => e.type)).toEqual(['text', 'shape', 'image'])
    expect(d2.pages[0]).toBe(d.pages[0])             // other slides are the very same objects
    assertValidPostDocument(d2)
  })

  it('updates text content and style without touching other fields, and keeps geometry valid', () => {
    const c = ctx()
    const d = fresh(c)
    const pid = d.pages[0].id
    const el = d.pages[0].elements.find(e => e.name === 'Headline')!
    const d2 = updateElement(d, pid, el.id, { x: 1.4, width: 3, opacity: 7, style: { fontSize: 0.12, color: '#FF0000' } }, c)
    const out = d2.pages[0].elements.find(e => e.id === el.id)!
    expect(out.x).toBeLessThanOrEqual(1)
    expect(out.x + out.width).toBeLessThanOrEqual(1.0001)
    expect(out.width).toBe(1)
    expect(out.opacity).toBe(1)
    if (out.type !== 'text' || el.type !== 'text') throw new Error('expected text')
    expect(out.style.fontSize).toBe(0.12)
    expect(out.style.color).toBe('#FF0000')
    expect(out.style.fontWeight).toBe(el.style.fontWeight)      // untouched
    assertValidPostDocument(d2)
  })

  it('refuses to edit a locked element, but allows unlocking it', () => {
    const c = ctx()
    let d = fresh(c)
    const pid = d.pages[0].id
    const el = d.pages[0].elements[0]
    d = updateElement(d, pid, el.id, { locked: true }, c)
    expect(() => updateElement(d, pid, el.id, { x: 0.3 }, c)).toThrow(/locked/)
    expect(updateElement(d, pid, el.id, { locked: false }, c).pages[0].elements[0].locked).toBe(false)
  })

  it('deletes and duplicates elements, and rejects an element from another slide', () => {
    const c = ctx()
    const d = fresh(c)
    const pid = d.pages[0].id
    const el = d.pages[0].elements[2]
    const { doc: d2, elementId } = duplicateElement(d, pid, el.id, c)
    const i = d2.pages[0].elements.findIndex(e => e.id === el.id)
    expect(d2.pages[0].elements[i + 1].id).toBe(elementId)         // right above the original
    expect(d2.pages[0].elements[i + 1].name).toBe(`${el.name} (copy)`)
    const d3 = deleteElement(d2, pid, elementId, c)
    expect(d3.pages[0].elements.map(e => e.id)).toEqual(d.pages[0].elements.map(e => e.id))
    expect(() => deleteElement(d, d.pages[1].id, el.id, c)).toThrow(/not on this slide/)
  })

  it('layers are array order: forward/backward/front/back move one element within the slide', () => {
    const c = ctx()
    const d = fresh(c)
    const pid = d.pages[0].id
    const order = () => (cur: PostDocument) => cur.pages[0].elements.map(e => e.id)
    const e = d.pages[0].elements.map(x => x.id)
    expect(order()(moveElementLayer(d, pid, e[0], 'front', c))).toEqual([...e.slice(1), e[0]])
    expect(order()(moveElementLayer(d, pid, e[e.length - 1], 'back', c))).toEqual([e[e.length - 1], ...e.slice(0, -1)])
    expect(order()(moveElementLayer(d, pid, e[1], 'forward', c))).toEqual([e[0], e[2], e[1], ...e.slice(3)])
    expect(order()(moveElementLayer(d, pid, e[1], 'backward', c))).toEqual([e[1], e[0], ...e.slice(2)])
    expect(moveElementLayer(d, pid, e[e.length - 1], 'front', c)).toBe(d)         // already on top: unchanged
  })

  it('applying a layout replaces the slide elements and keeps the slide id', () => {
    const c = ctx()
    const d = fresh(c)
    const pid = d.pages[1].id
    const built = buildLayout('quote', d.format, themeById('ivory'), {}, c)
    const d2 = setSlideElements(setSlideBackground(d, pid, built.background, c), pid, built.elements, c)
    expect(d2.pages[1].id).toBe(pid)
    expect(d2.pages[1].elements.map(e => e.name)).toEqual(['Quote mark', 'Quote', 'Attribution'])
    assertValidPostDocument(d2)
  })
})

describe('persistence', () => {
  it('saves every slide in order and restores them exactly, with the theme and the open slide', () => {
    const c = ctx()
    let d = fresh(c)
    d = moveSlide(d, d.pages[3].id, 1, c)
    d = updateElement(d, d.pages[0].id, d.pages[0].elements.find(e => e.name === 'Headline')!.id, { content: 'Saved headline' } as never, c)
    const s = memoryStorage()
    const res = saveCarousel(s, d, { themeId: 'ink', activeSlideId: d.pages[2].id }, { now: () => new Date('2026-11-19T10:00:00Z') })
    expect(res).toEqual({ ok: true, savedAt: '2026-11-19T10:00:00.000Z' })
    const loaded = loadCarousel(s, d.id)
    if (!loaded.ok) throw new Error(loaded.error)
    expect(loaded.record.document).toEqual(d)
    expect(loaded.record.document.pages.map(p => p.name)).toEqual(d.pages.map(p => p.name))
    expect(loaded.record.themeId).toBe('ink')
    expect(loaded.record.activeSlideId).toBe(d.pages[2].id)
  })

  it('keeps an index of saved carousels (newest first), updates it on re-save and removes deleted ones', () => {
    const c = ctx()
    const s = memoryStorage()
    const a = createCarouselDocument({ title: 'A' }, c)
    const b = createCarouselDocument({ title: 'B' }, c)
    saveCarousel(s, a, { themeId: 'forest' })
    saveCarousel(s, b, { themeId: 'forest' })
    expect(listCarousels(s).map(x => x.title)).toEqual(['B', 'A'])
    const a2 = insertSlide(a, newSlide({ kind: 'solid', color: '#fff' }, [], undefined, c), undefined, c)
    saveCarousel(s, a2, { themeId: 'forest' })
    expect(listCarousels(s).map(x => [x.title, x.slideCount])).toEqual([['A', 4], ['B', 3]])
    deleteCarousel(s, a.id)
    expect(listCarousels(s).map(x => x.title)).toEqual(['B'])
    expect(loadCarousel(s, a.id)).toEqual({ ok: false, error: 'That carousel was not found.' })
  })

  it('reports damaged, invalid and unsupported saved data instead of crashing', () => {
    const c = ctx()
    const d = fresh(c)
    const s = memoryStorage({ [carouselKey('x')]: '{not json' })
    expect(loadCarousel(s, 'x')).toMatchObject({ ok: false, error: expect.stringMatching(/damaged/) })
    s.setItem(carouselKey('y'), JSON.stringify({ recordVersion: 99, document: d }))
    expect(loadCarousel(s, 'y')).toMatchObject({ ok: false, error: expect.stringMatching(/unsupported version/) })
    s.setItem(carouselKey('z'), JSON.stringify({ recordVersion: 1, document: { ...d, pages: [] } }))
    expect(loadCarousel(s, 'z')).toMatchObject({ ok: false, error: expect.stringMatching(/invalid/) })
  })

  it('falls back to the first slide when the remembered open slide no longer exists', () => {
    const c = ctx()
    const d = fresh(c)
    const s = memoryStorage()
    saveCarousel(s, d, { themeId: 'forest', activeSlideId: 'gone' })
    const l = loadCarousel(s, d.id)
    expect(l.ok && l.record.activeSlideId).toBe(d.pages[0].id)
  })

  it('reports a full browser storage clearly and never throws', () => {
    const full = { getItem: () => null, setItem: () => { throw new DOMException('quota', 'QuotaExceededError') }, removeItem: () => undefined }
    const r = saveCarousel(full, fresh(), { themeId: 'forest' })
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toMatch(/storage is full/i)
  })

  it('never persists a media token in an image URL', () => {
    const c = ctx()
    let d = fresh(c)
    const img = makeImage({ source: { kind: 'asset', assetId: 7, url: '/uploads/1/pic.png?mt=SECRET' } }, c)
    d = addElement(d, d.pages[0].id, img, c)
    d = setSlideBackground(d, d.pages[1].id, { kind: 'image', source: { kind: 'asset', url: '/uploads/1/bg.png?mt=SECRET' }, fit: 'cover' }, c)
    const s = memoryStorage()
    saveCarousel(s, d, { themeId: 'forest' }, { stripToken: u => u.replace(/\?mt=[^&]*/, '') })
    const raw = s.getItem(carouselKey(d.id))!
    expect(raw).not.toContain('SECRET')
    expect(raw).toContain('/uploads/1/pic.png')
    expect(raw).toContain('/uploads/1/bg.png')
    expect(s.getItem(CAROUSEL_INDEX_KEY)).toContain(d.id)
  })
})

describe('content-aware layouts (real blueprint copy is long)', () => {
  const LONG_HEAD = 'Establish one bold framing of the tile decision before any explanation of the options that follow'
  const LONG_BODY = 'PLACEHOLDER — Open with a bold, general claim that a single tile choice can change the whole result of a renovation, stated before any explanation of the options and well before price comes up.'
  const CASES: [LayoutId, Parameters<typeof buildLayout>[3]][] = [
    ['cover', { headline: LONG_HEAD, body: LONG_BODY }],
    ['title_body', { headline: LONG_HEAD, body: LONG_BODY }],
    ['list', { headline: LONG_HEAD, items: ['PLACEHOLDER — The renovation situation the audience recognises', 'PLACEHOLDER — The two tile options to be compared (to be supplied)', 'PLACEHOLDER — Showroom access details'] }],
    ['image_caption', { headline: LONG_HEAD, caption: LONG_BODY }],
    ['quote', { body: LONG_BODY, caption: '— Name, role' }],
    ['cta', { headline: LONG_HEAD, body: LONG_BODY, cta: 'visit/showroom/contact for guidance' }],
    ['statement', { headline: LONG_HEAD }],
  ]

  it('shrinks long text to a readable floor and never below it', () => {
    const f = fresh().format
    const w = 1 - 2 * 0.075
    const big = fitSize('x'.repeat(400), 800, w, 0.1, 0.05, 5)
    expect(big).toBe(0.05)                                                                            // cannot fit: stays at the floor, never unreadable
    expect(fitSize('Short', 800, w, 0.1, 0.05, 5)).toBe(0.1)                                         // short text keeps the full size
    const mid = fitSize(LONG_HEAD, 800, w, 0.1, 0.05, 5)
    expect(mid).toBeLessThan(0.1)
    expect(mid).toBeGreaterThanOrEqual(0.05)
    expect(estimateLines(LONG_HEAD, mid, 800, w)).toBeLessThanOrEqual(5)
    expect(f.width).toBe(1080)
  })

  it('stacked text never overlaps: each text block ends above the next one starts, for every layout and format', () => {
    for (const [platformKey, formatKey] of [['instagram', 'carousel'], ['instagram', 'square'], ['instagram', 'reel_story']] as const) {
      const format = createCarouselDocument({ platformKey, formatKey }, ctx()).format
      const s = Math.min(format.width, format.height)
      const ch = format.height / s
      const cw = format.width / s
      for (const [layout, content] of CASES) {
        const built = buildLayout(layout, format, themeById('forest'), content, ctx())
        const blocks = built.elements.filter(e => e.type === 'text' && ['primary_headline', 'supporting_text', 'body_text', 'proof_point'].includes(e.role) && e.name !== 'Quote mark')
        blocks.forEach((e, i) => {
          if (e.type !== 'text') return
          const h = blockHeight(e.content, e.style.fontSize, e.style.fontWeight, e.style.lineHeight, e.width * cw) / ch
          const next = blocks[i + 1]
          if (next) expect(e.y + h, `${platformKey}/${formatKey} ${layout}: "${e.name}" overlaps "${next.name}"`).toBeLessThanOrEqual(next.y + 1e-6)
          expect(e.y + h, `${platformKey}/${formatKey} ${layout}: "${e.name}" runs off the bottom`).toBeLessThanOrEqual(1.02)
          expect(e.style.fontSize, `${layout} ${e.name} readable`).toBeGreaterThanOrEqual(0.024)
        })
      }
    }
  })

  it('a long call-to-action label wraps at its separators inside a full-width chip, not mid-word', () => {
    expect(ctaLabel('visit/showroom/contact for guidance')).toBe('visit / showroom / contact for guidance')
    expect(ctaLabel('  Book   now ')).toBe('Book now')
    const format = fresh().format
    const built = buildLayout('cta', format, themeById('ink'), { headline: 'Go', body: 'Now', cta: 'visit/showroom/contact for guidance' }, ctx())
    const cta = built.elements.find(e => e.name === 'Call to action')!
    expect(cta.type === 'text' && cta.content).toBe('visit / showroom / contact for guidance')
    expect(cta.width).toBeGreaterThan(0.8)                                                            // room for the label, not a 60% chip
    expect(cta.type === 'text' && cta.autoSize).toBe('auto-width')
  })
})
