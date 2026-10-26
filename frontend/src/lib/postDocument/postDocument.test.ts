import { describe, expect, it } from 'vitest'
import { PLATFORM_FORMATS } from '../platformFormats'
import { createAbcTilesMockDocument } from '../../pages/post-creator-v2/mock/abcTilesDocument'
import {
  allElements, elementIds, findElement, isPostElementRole, parsePostDocument, POST_ELEMENT_ROLES, resolveColor, serializePostDocument, shorterSide,
  validatePostDocument, walkElements, type DocumentFormat, type GroupElement, type PostDocument, type TextElement,
} from './index'

const IG_FEED: DocumentFormat = { platformKey: 'instagram', formatKey: 'feed_portrait', width: 1080, height: 1350, ratio: '4:5' }
const NOW = new Date('2026-09-26T00:00:00Z')
const seed = (f: DocumentFormat = IG_FEED): PostDocument => createAbcTilesMockDocument(f, NOW)
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
const errorsOf = (d: unknown) => validatePostDocument(d).errors.join('\n')

describe('seed document: schema', () => {
  it('is a valid PostDocument for EVERY platform x format in the registry (incl. Custom)', () => {
    let n = 0
    for (const p of PLATFORM_FORMATS) for (const pl of p.placements) {
      const doc = seed({ platformKey: p.key, formatKey: pl.key, width: pl.width, height: pl.height, ratio: pl.ratio })
      expect(validatePostDocument(doc).errors, `${p.key}/${pl.key}`).toEqual([])
      n++
    }
    expect(n).toBe(PLATFORM_FORMATS.reduce((t, p) => t + p.placements.length, 0))
    expect(n).toBeGreaterThanOrEqual(34)
  })

  it('has exactly one page in P2, schemaVersion 1, kind post, and a provider-neutral provenance', () => {
    const d = seed()
    expect(d.kind).toBe('post')
    expect(d.schemaVersion).toBe(1)
    expect(d.pages).toHaveLength(1)
    expect(d.provenance.origin).toBe('manual')
    expect(d.provenance.generation).toBeUndefined()
    expect(d.revision).toBe(0)
    expect(d.format).toEqual(IG_FEED)
    expect(d.createdAt).toBe(NOW.toISOString())
  })

  it('has unique page ids and unique element ids', () => {
    const d = seed()
    expect(new Set(d.pages.map(p => p.id)).size).toBe(d.pages.length)
    const ids = elementIds(d)
    expect(new Set(ids).size).toBe(ids.length)
    expect([...ids].sort()).toEqual(['el-cta', 'el-headline', 'el-logo', 'el-supporting'])
  })

  it('geometry is normalized canvas-relative (0..1) — never screen pixels', () => {
    const formats: DocumentFormat[] = [
      IG_FEED,
      { platformKey: 'instagram', formatKey: 'reel_story', width: 1080, height: 1920, ratio: '9:16' },
      { platformKey: 'instagram', formatKey: 'landscape', width: 1080, height: 566, ratio: '1.91:1' },
    ]
    for (const f of formats) {
      for (const el of allElements(seed(f))) {
        for (const v of [el.x, el.y, el.width, typeof el.height === 'number' ? el.height : 0]) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1) }
        expect(el.x + el.width).toBeLessThanOrEqual(1.0001)
        if (typeof el.height === 'number') expect(el.y + el.height).toBeLessThanOrEqual(1.0001)
        if (el.type === 'text') expect(el.style.fontSize).toBeLessThan(1)   // a fraction of the shorter side, not pixels
      }
    }
  })

  it('geometry is independent of the export pixel size (same ratio, different size -> same numbers)', () => {
    const a = seed({ ...IG_FEED, width: 1080, height: 1350 })
    const b = seed({ ...IG_FEED, width: 2160, height: 2700 })
    expect(allElements(a).map(e => [e.x, e.y, e.width, e.height])).toEqual(allElements(b).map(e => [e.x, e.y, e.width, e.height]))
    expect(shorterSide(a)).toBe(1080)
    expect(shorterSide(b)).toBe(2160)
  })
})

describe('semantic roles', () => {
  it('the vocabulary has 16 controlled roles including legal_text', () => {
    expect(POST_ELEMENT_ROLES).toHaveLength(16)
    expect(POST_ELEMENT_ROLES).toContain('legal_text')
    for (const r of ['primary_headline', 'secondary_headline', 'supporting_text', 'body_text', 'price', 'proof_point', 'hero_image', 'product_image', 'brand_logo', 'primary_cta', 'secondary_cta', 'badge', 'decorative', 'background_graphic']) expect(isPostElementRole(r), r).toBe(true)
    expect(isPostElementRole('big_red_button')).toBe(false)
    expect(isPostElementRole(undefined)).toBe(false)
  })

  it('every seed element has a vocabulary role, and the roles describe WHY (headline, supporting text, CTA, logo)', () => {
    const d = seed()
    for (const el of allElements(d)) expect(isPostElementRole(el.role)).toBe(true)
    expect(Object.fromEntries(allElements(d).map(e => [e.id, e.role]))).toEqual({
      'el-headline': 'primary_headline', 'el-supporting': 'supporting_text', 'el-cta': 'primary_cta', 'el-logo': 'brand_logo',
    })
  })

  it('an unknown role is rejected', () => {
    const d = clone(seed())
    ;(d.pages[0].elements[0] as { role: string }).role = 'big_red_button'
    expect(errorsOf(d)).toMatch(/unknown role "big_red_button"/)
  })
})

describe('element modelling decisions', () => {
  it('the CTA is a TEXT element with box styling (not a shape + text pair)', () => {
    const cta = findElement(seed(), 'el-cta') as TextElement
    expect(cta.type).toBe('text')
    expect(cta.role).toBe('primary_cta')
    expect(cta.box?.fill).toBeTruthy()
    expect(cta.autoSize).toBe('auto-width')
    expect(cta.action).toEqual({ kind: 'none' })
    expect(allElements(seed()).filter(e => e.type === 'shape')).toHaveLength(0)
  })

  it('the logo is an IMAGE element with role brand_logo, a placeholder source and preserved aspect ratio', () => {
    const logo = findElement(seed(), 'el-logo')!
    expect(logo).toMatchObject({ type: 'image', role: 'brand_logo', lockAspect: true, source: { kind: 'placeholder', label: 'ABC TILES' } })
  })

  it('a brand_logo that does not preserve aspect ratio is invalid', () => {
    const d = clone(seed())
    ;(findElement(d, 'el-logo') as unknown as { lockAspect: boolean }).lockAspect = false
    expect(errorsOf(d)).toMatch(/brand_logo must preserve its aspect ratio/)
  })

  it('an image can never be stretched: only cover / contain', () => {
    const d = clone(seed())
    ;(findElement(d, 'el-logo') as unknown as { fit: string }).fit = 'fill'
    expect(errorsOf(d)).toMatch(/never stretched/)
  })
})

describe('layering: array order is the single paint-order authority', () => {
  it('the seed paints back -> front in array order (headline, supporting, CTA, logo) and has no zIndex / order / layer-order fields', () => {
    const d = seed()
    expect(d.pages[0].elements.map(e => e.id)).toEqual(['el-headline', 'el-supporting', 'el-cta', 'el-logo'])
    expect(serializePostDocument(d)).not.toMatch(/zIndex|"order"|layerOrder|"z"/)
  })

  it('group children follow the same rule inside their group', () => {
    const d = clone(seed())
    const group: GroupElement = {
      id: 'el-group', role: 'other', name: 'Group', type: 'group', x: 0.1, y: 0.1, width: 0.5, height: 0.5, rotation: 0, opacity: 1, visible: true, locked: false,
      children: [
        { id: 'g-back', role: 'decorative', name: 'Back', type: 'shape', shape: 'rect', fill: '#FF0000', x: 0, y: 0, width: 1, height: 1, rotation: 0, opacity: 1, visible: true, locked: false },
        { id: 'g-front', role: 'decorative', name: 'Front', type: 'shape', shape: 'ellipse', fill: '#00FF00', x: 0.2, y: 0.2, width: 0.5, height: 0.5, rotation: 0, opacity: 1, visible: true, locked: false },
      ],
    }
    d.pages[0].elements.unshift(group)
    expect(validatePostDocument(d).ok).toBe(true)
    const order: string[] = []
    walkElements(d.pages[0].elements, e => order.push(e.id))
    expect(order.slice(0, 3)).toEqual(['el-group', 'g-back', 'g-front'])
  })

  it('duplicate ids (also inside groups) are rejected', () => {
    const d = clone(seed())
    d.pages[0].elements.push({ ...clone(d.pages[0].elements[0]), id: 'el-headline' })
    expect(errorsOf(d)).toMatch(/duplicate id "el-headline"/)
    const d2 = clone(seed())
    d2.pages[0].elements.push({ id: 'grp', role: 'other', name: 'g', type: 'group', x: 0, y: 0, width: 0.5, height: 0.5, rotation: 0, opacity: 1, visible: true, locked: false, children: [{ ...clone(d2.pages[0].elements[1]), id: 'el-headline' }] })
    expect(errorsOf(d2)).toMatch(/duplicate id "el-headline"/)
  })
})

describe('visibility and locking are data', () => {
  it('a hidden element is valid data and stays in the document', () => {
    const d = clone(seed())
    ;(d.pages[0].elements[1] as { visible: boolean }).visible = false
    expect(validatePostDocument(d).ok).toBe(true)
    expect(allElements(d)).toHaveLength(4)
  })

  it('locked and hidden flags survive a JSON round trip', () => {
    const d = clone(seed())
    ;(findElement(d, 'el-cta') as { locked: boolean }).locked = true
    ;(findElement(d, 'el-headline') as { visible: boolean }).visible = false
    const r = parsePostDocument(serializePostDocument(d))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(findElement(r.document, 'el-cta')!.locked).toBe(true)
    expect(findElement(r.document, 'el-headline')!.visible).toBe(false)
    expect(findElement(r.document, 'el-logo')!.locked).toBe(false)
  })
})

describe('JSON round trip and rejection of bad documents', () => {
  it('serialise -> parse yields a deeply equal, valid document', () => {
    const d = seed()
    const r = parsePostDocument(serializePostDocument(d))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.document).toEqual(d)
  })

  it('rejects malformed input without throwing', () => {
    expect(parsePostDocument('{nope')).toEqual({ ok: false, errors: ['not valid JSON'] })
    expect(parsePostDocument('[]').ok).toBe(false)
    expect(parsePostDocument('null').ok).toBe(false)
  })

  it('rejects a wrong schema version, no pages, and duplicate page ids', () => {
    const d = clone(seed())
    ;(d as unknown as { schemaVersion: number }).schemaVersion = 2
    expect(errorsOf(d)).toMatch(/schemaVersion/)
    const none = clone(seed())
    none.pages = []
    expect(errorsOf(none)).toMatch(/at least one page/)
    const dup = clone(seed())
    dup.pages.push({ ...clone(dup.pages[0]), elements: [] })
    expect(errorsOf(dup)).toMatch(/duplicate page id/)
  })

  it('accepts several pages structurally (carousel-ready); element ids must stay unique across the whole document', () => {
    const d = clone(seed())
    d.pages.push({ id: 'page-2', background: { kind: 'solid', color: '#FFFFFF' }, elements: [] })
    d.pages.push({ id: 'page-3', background: { kind: 'solid', color: '#000000' }, elements: [{ ...clone(d.pages[0].elements[0]), id: 'p3-headline' }] })
    expect(validatePostDocument(d).ok).toBe(true)
    d.pages[2].elements.push({ ...clone(d.pages[0].elements[0]) })          // same id as page 1's headline
    expect(errorsOf(d)).toMatch(/duplicate id/)
  })

  it('rejects screen-pixel geometry and other out-of-range values', () => {
    const px = clone(seed())
    ;(px.pages[0].elements[0] as { x: number }).x = 540
    expect(errorsOf(px)).toMatch(/x: must be a fraction 0..1/)
    const big = clone(seed())
    ;(big.pages[0].elements[3] as { width: number }).width = 250
    expect(errorsOf(big)).toMatch(/width/)
    const fpx = clone(seed())
    ;(fpx.pages[0].elements[0] as TextElement).style.fontSize = 48
    expect(errorsOf(fpx)).toMatch(/fontSize: must be a fraction/)
    const op = clone(seed())
    ;(op.pages[0].elements[0] as { opacity: number }).opacity = 1.5
    expect(errorsOf(op)).toMatch(/opacity/)
  })

  it("height 'auto' is valid only for text", () => {
    const d = clone(seed())
    ;(findElement(d, 'el-logo') as { height: number | 'auto' }).height = 'auto'
    expect(errorsOf(d)).toMatch(/'auto' is only valid for text/)
  })

  it('creative colours must be a hex or a brand token WITH a hex fallback (never a CSS var / theme reference)', () => {
    const d = clone(seed())
    ;(d.pages[0].elements[0] as TextElement).style.color = 'var(--pcv2-accent)'
    expect(errorsOf(d)).toMatch(/style.color/)
    const t = clone(seed())
    ;(t.pages[0].elements[0] as TextElement).style.color = { token: 'brand.primary', fallback: 'green' }
    expect(errorsOf(t)).toMatch(/style.color/)
  })
})

describe('colours are independent of the UI theme', () => {
  it('the seed uses only literal hex / brand tokens with literal fallbacks', () => {
    const json = serializePostDocument(seed())
    expect(json).not.toMatch(/var\(|--pcv2|theme|currentColor/i)
    const cta = findElement(seed(), 'el-cta') as TextElement
    expect(cta.box?.fill).toEqual({ token: 'brand.accent', fallback: '#1E8A55' })
    expect(resolveColor(cta.box!.fill as { token: string; fallback: string })).toBe('#1E8A55')
    expect(resolveColor({ token: 'brand.accent', fallback: '#1E8A55' }, { 'brand.accent': '#123456' })).toBe('#123456')
    expect(resolveColor('#ABCDEF', { 'brand.accent': '#123456' })).toBe('#ABCDEF')
  })
})

describe('reserved schema (no behaviour yet)', () => {
  it('adaptation hints validate when present and reject nonsense', () => {
    const d = clone(seed())
    ;(d.pages[0].elements[3] as { adapt?: unknown }).adapt = { anchor: 'top-left', priority: 'must', scale: { min: 0.6, max: 1.6 }, keepAspect: true, safeArea: 'inside', minFontSize: 0.02 }
    expect(validatePostDocument(d).ok).toBe(true)
    ;(d.pages[0].elements[3] as { adapt?: unknown }).adapt = { anchor: 'sideways', priority: 'urgent' }
    expect(errorsOf(d)).toMatch(/adapt.anchor/)
  })

  it('a variants block validates structurally; the master stays authoritative and untouched', () => {
    const d = clone(seed())
    d.variants = { 'linkedin/link_post': { key: 'linkedin/link_post', format: { platformKey: 'linkedin', formatKey: 'link_post', width: 1200, height: 627, ratio: '1.91:1' }, mode: 'linked', basedOnRevision: 0, overrides: { 'el-headline': { content: 'SHORTER HEADLINE', fontSize: 0.05 } } } }
    expect(validatePostDocument(d).ok).toBe(true)
    expect((findElement(d, 'el-headline') as TextElement).content).toBe('LARGE FORMAT.\nPREMIUM FINISH.')
    d.variants['linkedin/link_post'].key = 'mismatch'
    expect(errorsOf(d)).toMatch(/invalid variant/)
  })

  it('the provenance model supports every origin without naming a provider', () => {
    for (const origin of ['manual', 'template', 'ai_generated', 'imported', 'adapted'] as const) {
      const d = clone(seed())
      d.provenance = { origin, generation: { briefRef: 'brief-1', engine: 'any free-text label' } }
      expect(validatePostDocument(d).ok, origin).toBe(true)
    }
    const bad = clone(seed())
    ;(bad.provenance as { origin: string }).origin = 'magic'
    expect(errorsOf(bad)).toMatch(/provenance.origin/)
  })
})
