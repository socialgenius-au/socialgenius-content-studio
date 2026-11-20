import { describe, expect, it } from 'vitest'
import { assertValidPostDocument, resolveColor, resolveFont, type PostDocument, type PostElement, type TextElement } from '../postDocument'
import { createCarouselDocument } from './document'
import { themeById } from './layouts'
import { updateElement, type OpContext } from './ops'
import { BRAND, absoluteUploadUrl, applyBrandKit, contrastRatio, detachBrandKit, emptyKit, kitFontFamilies, kitIdOf, kitSwatches, kitTokens, loadKitFonts, makeBrandLogo, makeBrandName, mixHex, readableOn, type BrandKit } from './brandKit'
import { applyTemplateSlides, carouselFromTemplate, templateDocumentFrom, type Template } from './templates'
import { createHttpBrandKitStore, createHttpTemplateStore } from './assetsStore'
import { drawSlide, type Ctx2D } from './rasterize'

function ids(): OpContext { let n = 0; return { newId: p => `${p}_${++n}`, now: () => new Date('2026-11-20T09:00:00Z') } }
const forest = themeById('forest')
const acme = (over: Partial<BrandKit['kit']> = {}): BrandKit => ({
  id: 7, name: 'Acme',
  kit: { ...emptyKit(), colors: { primary: '#C2185B', secondary: '#FFC107', accent: '#00ACC1', background: '#102A43', text: '#F0F4F8' }, font_roles: { heading: 'Acme Sans', body: 'Acme Serif' },
    fonts: [{ id: 'f1', family: 'Acme Sans', asset_id: 3, url: '/uploads/1/a.ttf', weight: 700, italic: false }, { id: 'f2', family: 'Acme Serif', asset_id: 4, url: '/uploads/1/b.otf', weight: 400, italic: false }],
    logos: [{ id: 'l1', label: 'Main', asset_id: 9, url: '/uploads/1/logo.png' }], brand_names: [{ id: 'n1', label: 'Full', text: 'Acme Tiles' }], ...over },
})
const allEls = (d: PostDocument): PostElement[] => d.pages.flatMap(p => p.elements)

describe('brand tokens', () => {
  it('turns a kit into tokens, with readable text on the accent and a derived muted colour', () => {
    const t = kitTokens(acme().kit, forest)
    expect(t[BRAND.background]).toBe('#102A43'); expect(t[BRAND.text]).toBe('#F0F4F8'); expect(t[BRAND.accent]).toBe('#00ACC1'); expect(t[BRAND.primary]).toBe('#C2185B')
    expect(t[BRAND.onAccent]).toBe(readableOn('#00ACC1'))
    expect(contrastRatio(t[BRAND.onAccent], t[BRAND.accent])).toBeGreaterThan(4.5)
    expect(t[BRAND.muted]).toBe(mixHex('#F0F4F8', '#102A43', 0.4))
    expect(t[BRAND.fontHeading]).toBe(`"Acme Sans", ${forest.fontFamily}`)
  })
  it('a partial kit falls back to the carousel theme so nothing is half-styled', () => {
    const t = kitTokens({ ...emptyKit(), colors: { primary: '#C2185B' } }, forest)
    expect(t[BRAND.background]).toBe(forest.background); expect(t[BRAND.text]).toBe(forest.foreground); expect(t[BRAND.muted]).toBe(forest.muted)
    expect(t[BRAND.accent]).toBe('#C2185B')                                 // primary stands in for the accent
    expect(t[BRAND.fontHeading]).toBe(forest.fontFamily)
  })
  it('swatches carry token + fallback so they follow the kit; extra colours are literal', () => {
    const s = kitSwatches({ ...acme().kit, colors: { ...acme().kit.colors, extra: [{ name: 'Grout', hex: '#999999' }] } })
    expect(s.map(x => x.label)).toEqual(['Primary', 'Secondary', 'Accent', 'Background', 'Text', 'Grout'])
    expect(s[0].ref).toEqual({ token: BRAND.primary, fallback: '#C2185B' }); expect(s[5].ref).toBe('#999999')
  })
  it('font families for the editor are the kit custom fonts by name', () => { expect(kitFontFamilies(acme().kit)).toEqual(['Acme Sans', 'Acme Serif']) })
})

describe('applying a Brand Kit never destroys the person\'s own edits', () => {
  function edited() {
    const c = ids()
    let d = createCarouselDocument({ title: 'Mine', layouts: ['cover', 'title_body', 'cta'] }, c)
    const headline = d.pages[0].elements.find(e => e.type === 'text' && e.role === 'primary_headline') as TextElement
    d = updateElement(d, d.pages[0].id, headline.id, { style: { color: '#FF0000' } }, c)                                // the person made this headline red
    const body = d.pages[1].elements.find(e => e.type === 'text' && e.role !== 'primary_headline') as TextElement
    d = updateElement(d, d.pages[1].id, body.id, { style: { fontFamily: 'Georgia, "Times New Roman", serif' } }, c)   // and chose their own font here
    return { d, headline, body }
  }

  it('turns untouched theme colours and fonts into tokens and keeps custom ones exactly', () => {
    const { d, headline, body } = edited()
    const r = applyBrandKit(d, acme(), forest, ids().now)
    assertValidPostDocument(r.doc)
    expect(r.doc.revision).toBe(d.revision + 1)
    expect(kitIdOf(r.doc)).toBe(7)
    const h2 = allEls(r.doc).find(e => e.id === headline.id) as TextElement
    expect(h2.style.color).toBe('#FF0000')                                                  // custom colour untouched
    const b2 = allEls(r.doc).find(e => e.id === body.id) as TextElement
    expect(b2.style.fontFamily).toBe('Georgia, "Times New Roman", serif')                   // custom font untouched
    expect(r.report.recoloured).toBeGreaterThan(5); expect(r.report.refonted).toBeGreaterThan(0); expect(r.report.kept).toBeGreaterThanOrEqual(1)
    const bg = r.doc.pages[0].background
    expect(bg.kind === 'solid' && bg.color).toEqual({ token: BRAND.background, fallback: forest.background })
    // every other element's content, geometry and order is exactly as before
    expect(allEls(r.doc).map(e => [e.id, e.x, e.y, e.width, e.height, e.name])).toEqual(allEls(d).map(e => [e.id, e.x, e.y, e.width, e.height, e.name]))
    expect(allEls(r.doc).filter(e => e.type === 'text').map(e => (e as TextElement).content)).toEqual(allEls(d).filter(e => e.type === 'text').map(e => (e as TextElement).content))
    expect(JSON.stringify(d)).toContain('"#FF0000"')                                         // and the input document itself was not mutated
    expect(d.context.brand).toBeUndefined()
  })

  it('is idempotent: applying again changes nothing more, and a different kit can be applied later', () => {
    const { d } = edited()
    const once = applyBrandKit(d, acme(), forest).doc
    const twice = applyBrandKit(once, acme(), forest)
    expect(twice.report.recoloured).toBe(0); expect(twice.report.refonted).toBe(0)
    expect(JSON.stringify(twice.doc.pages)).toBe(JSON.stringify(once.pages))
    const other = applyBrandKit(once, { ...acme(), id: 8, name: 'Other' }, forest).doc
    expect(kitIdOf(other)).toBe(8)
  })

  it('tokens resolve to the kit when it is loaded and to the original colours when it is not', async () => {
    const { d } = edited()
    const applied = applyBrandKit(d, acme(), forest).doc
    const tokens = kitTokens(acme().kit, forest)
    const bg = applied.pages[0].background
    if (bg.kind !== 'solid') throw new Error('solid expected')
    expect(resolveColor(bg.color, tokens)).toBe('#102A43')                                  // with the kit
    expect(resolveColor(bg.color)).toBe(forest.background)                                  // without it (kit deleted / offline): exactly as before
    const heading = allEls(applied).find(e => e.type === 'text' && typeof e.style.fontFamily === 'object') as TextElement
    expect(resolveFont(heading.style.fontFamily, tokens)).toContain('Acme')
    expect(resolveFont(heading.style.fontFamily)).toBe(forest.fontFamily)
    // the exporter draws with the same tokens
    const fills: unknown[] = []
    const ctx = new Proxy({} as Record<string, unknown>, { get: (t, k: string) => (k in t ? t[k] : k === 'measureText' ? () => ({ width: 10 }) : () => ({ addColorStop: () => undefined })), set: (t, k: string, v) => { t[k] = v; if (k === 'fillStyle') fills.push(v); return true } }) as unknown as Ctx2D
    await drawSlide(ctx, applied, 0, { width: 100, height: 125, tokens, loadImage: async () => null })
    expect(fills[0]).toBe('#102A43')
    fills.length = 0
    await drawSlide(ctx, applied, 0, { width: 100, height: 125, loadImage: async () => null })
    expect(fills[0]).toBe(forest.background)
  })

  it('detaching stops using the kit without changing how anything looks', () => {
    const { d } = edited()
    const applied = applyBrandKit(d, acme(), forest).doc
    const detached = detachBrandKit(applied)
    expect(kitIdOf(detached)).toBeNull()
    expect(JSON.stringify(detached.pages)).toBe(JSON.stringify(applied.pages))              // tokens remain, resolving to their fallbacks
    assertValidPostDocument(detached)
  })
})

describe('logos and brand names are ordinary elements', () => {
  it('a logo is an image that keeps its proportions and a brand name is text; both can be edited like any element', () => {
    const c = ids()
    const d = createCarouselDocument({ layouts: ['cover'] }, c)
    const page = d.pages[0].id
    const logo = makeBrandLogo(acme().kit.logos[0], {}, c)
    const name = makeBrandName(acme().kit.brand_names[0], d.format, forest, {}, c)
    expect(logo).toMatchObject({ role: 'brand_logo', lockAspect: true, fit: 'contain', source: { kind: 'asset', assetId: 9, url: '/uploads/1/logo.png' } })
    expect(name.content).toBe('Acme Tiles')
    expect(name.style.color).toEqual({ token: BRAND.text, fallback: forest.foreground })
    const withBoth = { ...d, pages: [{ ...d.pages[0], elements: [...d.pages[0].elements, logo, name] }] }
    const moved = updateElement(withBoth, page, logo.id, { x: 0.5, y: 0.5, width: 0.3, height: 0.12, rotation: 10, opacity: 0.8 }, c)
    const renamed = updateElement(moved, page, name.id, { content: 'ACME' } as never, c)
    assertValidPostDocument(renamed)
    const l2 = renamed.pages[0].elements.find(e => e.id === logo.id)!
    expect([l2.x, l2.y, l2.width, l2.rotation, l2.opacity]).toEqual([0.5, 0.5, 0.3, 10, 0.8])
  })
})

describe('custom fonts', () => {
  it('loads every font of the kit through the page font set and skips one that fails', async () => {
    const added: string[] = []
    class FakeFace { constructor(public family: string, public src: string, public d?: Record<string, string>) {} async load() { if (this.family === 'Acme Serif') throw new Error('bad font'); return this } }
    const srcs: string[] = []
    class SpyFace extends FakeFace { constructor(family: string, src: string, d?: Record<string, string>) { super(family, src, d); srcs.push(src) } }
    const loaded = await loadKitFonts(acme().kit, u => `${u}?mt=T`, { add: (f: unknown) => added.push((f as FakeFace).family) }, SpyFace as never)
    expect(srcs[0]).toContain('/uploads/1/a.ttf?mt=T')
    expect(loaded).toEqual(['Acme Sans']); expect(added).toEqual(['Acme Sans'])
    expect(await loadKitFonts(acme().kit, u => u, undefined, undefined)).toEqual([])      // no FontFace support: nothing happens, nothing throws
  })
})

describe('templates', () => {
  const make = (): { doc: PostDocument; t: Template } => {
    const c = ids()
    const doc = createCarouselDocument({ title: 'Starter', layouts: ['cover', 'list', 'cta'] }, c)
    const t: Template = { id: 5, name: 'Starter', description: '', kind: 'carousel', slideCount: 3, platformKey: 'instagram', formatKey: 'carousel', brandKitId: null, updatedAt: 'x', document: templateDocumentFrom(doc, undefined, c) }
    return { doc, t }
  }
  const idsOf = (d: PostDocument) => [...d.pages.map(p => p.id), ...d.pages.flatMap(p => p.elements.map(e => e.id))]

  it('a carousel made from a template is a copy with all-new ids, and the template is untouched', () => {
    const { t } = make()
    const before = JSON.stringify(t.document)
    const c = ids()
    for (let i = 0; i < 300; i++) c.newId!('warm')
    const a = carouselFromTemplate(t, 'Spring', c)
    const b = carouselFromTemplate(t, 'Summer', c)
    assertValidPostDocument(a); assertValidPostDocument(b)
    expect(a.title).toBe('Spring'); expect(a.provenance).toEqual({ origin: 'template', templateId: '5' }); expect(a.pages).toHaveLength(3)
    const original = new Set(idsOf(t.document))
    expect(idsOf(a).some(i => original.has(i))).toBe(false)                                 // no id is shared with the template...
    expect(idsOf(a).some(i => idsOf(b).includes(i))).toBe(false)                            // ...or with another carousel made from it
    expect(JSON.stringify(t.document)).toBe(before)
    expect(a.pages.map(p => p.elements.length)).toEqual(t.document.pages.map(p => p.elements.length))
  })

  it('inserts template slides after the open slide, at the end, or in place of it, always with fresh ids', () => {
    const { t } = make()
    const c = ids()
    for (let i = 0; i < 300; i++) c.newId!('x')
    const base = createCarouselDocument({ title: 'Mine', layouts: ['cover', 'title_body'] }, c)
    const first = base.pages[0].id
    const after = applyTemplateSlides(base, t, 'after', first, c)
    expect(after.doc.pages).toHaveLength(5); expect(after.doc.pages[0].id).toBe(first); expect(after.doc.pages[1].id).toBe(after.slideIds[0]); expect(after.doc.pages[4].id).toBe(base.pages[1].id)
    const end = applyTemplateSlides(base, t, 'end', first, c)
    expect(end.doc.pages.slice(-3).map(p => p.id)).toEqual(end.slideIds)
    const replaced = applyTemplateSlides(base, t, 'replace', first, c)
    expect(replaced.doc.pages).toHaveLength(4); expect(replaced.doc.pages.some(p => p.id === first)).toBe(false); expect(replaced.doc.pages[3].id).toBe(base.pages[1].id)
    for (const r of [after, end, replaced]) { assertValidPostDocument(r.doc); const all = idsOf(r.doc); expect(new Set(all).size).toBe(all.length); expect(r.doc.title).toBe('Mine') }
    expect(after.formatDiffers).toBe(false)
    expect(applyTemplateSlides({ ...base, format: { ...base.format, ratio: '1:1' } }, t, 'end', first, c).formatDiffers).toBe(true)
  })

  it('saves the whole carousel or only chosen slides as a template', () => {
    const c = ids()
    const doc = createCarouselDocument({ layouts: ['cover', 'list', 'cta'] }, c)
    expect(templateDocumentFrom(doc, undefined, c).pages).toHaveLength(3)
    const one = templateDocumentFrom(doc, [doc.pages[1].id], c)
    expect(one.pages).toHaveLength(1); expect(one.pages[0].id).not.toBe(doc.pages[1].id)
    expect(() => templateDocumentFrom(doc, ['nope'], c)).toThrow(/at least one slide/)
    assertValidPostDocument(one)
  })
})

describe('HTTP stores map the server JSON and never send media tokens', () => {
  it('brand kit store maps summaries, fills missing kit sections and strips tokens from font urls', async () => {
    const sent: unknown[] = []
    const store = createHttpBrandKitStore({
      list: async () => ({ data: [{ id: 1, name: 'A', primary: '#112233', logo_count: 2, font_count: 1, updated_at: 't' }] }),
      get: async () => ({ data: { id: 1, name: 'A', kit: { colors: { primary: '#112233' } } } }),
      create: async b => { sent.push(b); return { data: { id: 2, name: 'B', kit: {} } } }, update: async () => ({ data: { id: 1, name: 'A', kit: {} } }), duplicate: async () => ({ data: { id: 3, name: 'A (copy)', kit: {} } }), delete: async () => ({}),
      uploadFont: async () => ({ data: { asset_id: 5, url: '/uploads/1/f.ttf?mt=SECRET', filename: 'f.ttf', family_guess: 'F' } }),
    })
    expect(await store.list()).toEqual([{ id: 1, name: 'A', primary: '#112233', logoCount: 2, fontCount: 1, updatedAt: 't' }])
    const k = await store.get(1)
    expect(k.kit.logos).toEqual([]); expect(k.kit.colors.primary).toBe('#112233')              // sections the server omitted exist as empty lists
    expect((await store.uploadFont(new File(['x'], 'f.ttf'))).url).toMatch(/\/uploads\/1\/f\.ttf$/)                       // token removed; absolute when the API lives at another address
    expect(absoluteUploadUrl('/uploads/1/f.ttf', 'https://api.example.com/')).toBe('https://api.example.com/uploads/1/f.ttf')
    expect(absoluteUploadUrl('https://cdn.example.com/a.ttf', 'https://api.example.com')).toBe('https://cdn.example.com/a.ttf')
    expect(absoluteUploadUrl('/uploads/1/f.ttf', '')).toBe('/uploads/1/f.ttf')
    await store.create('B', emptyKit()); expect(sent[0]).toMatchObject({ name: 'B', kit: { logos: [] } })
  })

  it('template store sends token-free documents and reports a damaged saved template instead of crashing', async () => {
    const { t } = make2()
    const sent: Record<string, unknown>[] = []
    const withToken = JSON.parse(JSON.stringify(t.document).replace('"title":"Starter"', '"title":"Starter"')) as PostDocument
    withToken.pages[0].background = { kind: 'image', source: { kind: 'asset', assetId: 1, url: '/uploads/1/bg.png?mt=SECRET' }, fit: 'cover' }
    const store = createHttpTemplateStore({
      list: async () => ({ data: [] }),
      get: async () => ({ data: { id: 9, name: 'Broken', description: '', kind: 'carousel', slide_count: 1, platform_key: 'x', format_key: 'y', brand_kit_id: null, updated_at: 't', document: { nope: true } } }),
      create: async b => { sent.push(b); return { data: { id: 1, name: 'T', description: '', kind: 'carousel', slide_count: 3, platform_key: 'instagram', format_key: 'carousel', brand_kit_id: null, updated_at: 't', document: t.document } } },
      update: async (_id, b) => { sent.push(b); return { data: { id: 1, name: 'T', description: '', kind: 'carousel', slide_count: 3, platform_key: 'instagram', format_key: 'carousel', brand_kit_id: null, updated_at: 't', document: t.document } } }, duplicate: async () => ({ data: {} }), delete: async () => ({}),
    })
    await store.create({ name: 'T', description: '', kind: 'carousel', document: withToken })
    await store.update(1, { document: withToken })
    for (const b of sent) { expect(JSON.stringify(b)).not.toContain('SECRET'); expect(JSON.stringify(b)).toContain('/uploads/1/bg.png') }
    await expect(store.get(9)).rejects.toMatchObject({ kind: 'invalid' })
  })
})

function make2(): { t: Template } {
  const c = ids()
  const doc = createCarouselDocument({ title: 'Starter', layouts: ['cover', 'list', 'cta'] }, c)
  return { t: { id: 5, name: 'Starter', description: '', kind: 'carousel', slideCount: 3, platformKey: 'instagram', formatKey: 'carousel', brandKitId: null, updatedAt: 'x', document: templateDocumentFrom(doc, undefined, c) } }
}
