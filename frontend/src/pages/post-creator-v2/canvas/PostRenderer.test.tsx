// P2 acceptance: the canvas is DATA-DRIVEN. PostDocument -> PostPage -> PostElements -> PostRenderer -> canvas.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import PostRenderer from './PostRenderer'
import PostCanvas from '../components/PostCanvas'
import { PostFormatProvider } from '../format/PostFormatContext'
import { initialPostFormatState, postCreatorFormats, postCreatorPlatforms, postFormatReducer } from '../format/formatState'
import { createAbcTilesMockDocument } from '../mock/abcTilesDocument'
import { findElement, type DocumentFormat, type PostDocument, type TextElement } from '../../../lib/postDocument'

const NOW = new Date('2026-09-26T00:00:00Z')
const IG_FEED: DocumentFormat = { platformKey: 'instagram', formatKey: 'feed_portrait', width: 1080, height: 1350, ratio: '4:5' }
const seed = (f: DocumentFormat = IG_FEED): PostDocument => createAbcTilesMockDocument(f, NOW)
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
const html = (doc: PostDocument, tokens?: Record<string, string>) => renderToStaticMarkup(<PostRenderer document={doc} brandTokens={tokens} />)
const textOf = (doc: PostDocument, id: string) => (findElement(doc, id) as TextElement).content
const setText = (doc: PostDocument, id: string, content: string) => { (findElement(doc, id) as TextElement).content = content; return doc }

describe('the creative comes from data, not from the renderer', () => {
  const HEADLINE = 'LARGE FORMAT.\nPREMIUM FINISH.'

  it('renders the ABC Tiles seed with all four elements, their roles and their document text', () => {
    const out = html(seed())
    for (const [id, role] of [['el-headline', 'primary_headline'], ['el-supporting', 'supporting_text'], ['el-cta', 'primary_cta'], ['el-logo', 'brand_logo']]) {
      expect(out).toContain(`data-element-id="${id}"`)
      expect(out).toContain(`data-role="${role}"`)
    }
    expect(out).toContain(HEADLINE)
    expect(out).toContain('BUILT FOR QUALITY. MADE FOR BUILDERS.')
    expect(out).toContain('SEND YOUR TILE SCHEDULE →')
    expect(out).toContain('ABC TILES')
  })

  it.each([
    ['headline', 'el-headline', 'SPACIOUS KITCHENS.\nBUILT TO LAST.'],
    ['supporting text', 'el-supporting', 'FROM SLAB TO SPLASHBACK.'],
    ['CTA', 'el-cta', 'BOOK A SHOWROOM VISIT'],
  ])('changing the %s DATA changes the rendered text and NOTHING else in the markup', (_label, id, replacement) => {
    const base = seed()
    const before = html(base)
    const original = textOf(base, id)
    const changed = setText(clone(base), id, replacement)
    const after = html(changed)
    expect(after).toContain(replacement)
    expect(after).not.toContain(original)
    // identical markup once the one string is swapped back: the renderer's structure did not change
    expect(after.replace(replacement, original)).toBe(before)
  })

  it('changing geometry / colour / visibility DATA changes the matching styles only', () => {
    const base = seed()
    const moved = clone(base); const cta = findElement(moved, 'el-cta') as TextElement
    cta.x = 0.5
    expect(html(moved)).toContain('left:50%')
    cta.box = { ...cta.box!, fill: '#FF00AA' }
    expect(html(moved)).toContain('background:#FF00AA')
    expect(html(moved)).not.toContain('#1E8A55')
    const hidden = clone(base); (findElement(hidden, 'el-supporting') as { visible: boolean }).visible = false
    expect(html(hidden)).not.toContain('MADE FOR BUILDERS')
    expect(html(hidden)).not.toContain('data-element-id="el-supporting"')
  })

  it('renders a completely different document with the same renderer (no ABC Tiles content leaks in)', () => {
    const other = clone(seed())
    other.id = 'other-doc'
    other.pages[0].background = { kind: 'solid', color: '#102A43' }
    other.pages[0].elements = [
      { id: 'a', role: 'secondary_headline', name: 'A', type: 'text', x: 0.1, y: 0.2, width: 0.8, height: 'auto', rotation: 0, opacity: 1, visible: true, locked: false,
        content: 'Grand opening Saturday', style: { fontFamily: 'Georgia', fontSize: 0.06, fontWeight: 700, lineHeight: 1.2, align: 'center', color: '#FFD166' }, autoSize: 'auto-height' },
      { id: 'b', role: 'decorative', name: 'B', type: 'shape', shape: 'ellipse', fill: '#EF476F', x: 0.6, y: 0.5, width: 0.3, height: 0.3, rotation: 15, opacity: 0.5, visible: true, locked: false },
    ]
    const out = html(other)
    expect(out).toContain('Grand opening Saturday')
    expect(out).toContain('background:#EF476F')
    expect(out).toContain('background:#102A43')
    expect(out).toContain('rotate(15deg)')
    expect(out).toContain('font-size:6cqmin')
    for (const s of ['LARGE FORMAT', 'PREMIUM', 'ABC TILES', 'TILE SCHEDULE', '#1E8A55', 'BUILDERS']) expect(out).not.toContain(s)
  })

  it('the renderer and canvas SOURCE contain no ABC Tiles creative, colours or class-based creative styling', () => {
    const root = join(process.cwd(), 'src/pages/post-creator-v2')
    const sources = ['canvas/PostRenderer.tsx', 'components/PostCanvas.tsx'].map(f => readFileSync(join(root, f), 'utf8')).join('\n')
    for (const s of ['LARGE FORMAT', 'PREMIUM FINISH', 'ABC TILES', 'TILE SCHEDULE', 'BUILT FOR QUALITY', '#1E8A55', '#2C3532', 'pcv2-mock-post']) expect(sources, s).not.toContain(s)
    const css = readFileSync(join(root, 'PostCreatorV2.css'), 'utf8')
    expect(css).not.toContain('pcv2-mock-post')
    expect(css).not.toContain('LARGE FORMAT')
  })
})

describe('array order is paint order', () => {
  it('DOM order equals array order; reversing the data reverses the DOM', () => {
    const domOrder = (d: PostDocument) => [...html(d).matchAll(/data-element-id="([^"]+)"/g)].map(m => m[1])
    const d = seed()
    expect(domOrder(d)).toEqual(['el-headline', 'el-supporting', 'el-cta', 'el-logo'])
    const r = clone(d); r.pages[0].elements.reverse()
    expect(domOrder(r)).toEqual(['el-logo', 'el-cta', 'el-supporting', 'el-headline'])
  })

  it('renders only pages[0] (carousel-ready data, no page navigation)', () => {
    const d = clone(seed())
    d.pages.push({ id: 'page-2', background: { kind: 'solid', color: '#FFFFFF' }, elements: [{ ...clone(d.pages[0].elements[0]), id: 'p2-headline', content: 'SECOND PAGE TEXT' } as TextElement] })
    const out = html(d)
    expect(out).toContain('data-page-id="page-1"')
    expect(out).toContain('data-page-count="2"')
    expect(out).not.toContain('SECOND PAGE TEXT')
  })

  it('hidden elements are not painted, locked elements are marked, and both stay in the data', () => {
    const d = clone(seed())
    ;(findElement(d, 'el-cta') as { locked: boolean }).locked = true
    ;(findElement(d, 'el-logo') as { visible: boolean }).visible = false
    const out = html(d)
    expect(out).toMatch(/data-element-id="el-cta"[^>]*data-locked="true"|data-locked="true"[^>]*data-element-id="el-cta"/)
    expect(out).not.toContain('data-element-id="el-logo"')
    expect(findElement(d, 'el-logo')).toBeTruthy()
  })
})

describe('creative colours do not follow the app theme', () => {
  const wrap = (theme: 'light' | 'dark', doc: PostDocument) => renderToStaticMarkup(<div className="pcv2" data-theme={theme}><PostRenderer document={doc} /></div>)

  it('Light and Dark render the CREATIVE identically; the CTA keeps its literal document colour (not the cyan UI accent)', () => {
    const light = wrap('light', seed()), dark = wrap('dark', seed())
    expect(dark.replace('data-theme="dark"', 'data-theme="light"')).toBe(light)
    for (const out of [light, dark]) {
      expect(out).toContain('background:#1E8A55')
      expect(out).not.toMatch(/#19e3eb|#19E3EB/)
      expect(out).not.toContain('var(--pcv2')
    }
  })

  it('a brand token overrides the fallback (document/brand-driven), still independent of the theme', () => {
    const tokens = { 'brand.accent': '#0055AA' }
    const a = renderToStaticMarkup(<div data-theme="light"><PostRenderer document={seed()} brandTokens={tokens} /></div>)
    const b = renderToStaticMarkup(<div data-theme="dark"><PostRenderer document={seed()} brandTokens={tokens} /></div>)
    expect(a).toContain('background:#0055AA')
    expect(b.replace('dark', 'light')).toBe(a)
  })
})

describe('typography and geometry use canvas-relative units', () => {
  it('positions are percentages; type is in shorter-side (cqmin) units; no pixel values in the creative', () => {
    const out = html(seed())
    expect(out).toContain('font-size:7cqmin')       // headline
    expect(out).toContain('font-size:3.2cqmin')     // supporting text and CTA
    expect(out).toMatch(/left:[\d.]+%;top:[\d.]+%;width:[\d.]+%/)
    expect(out).not.toMatch(/\d+(\.\d+)?px/)
  })
})

describe('several substantially different canvas ratios', () => {
  const FORMATS: DocumentFormat[] = [
    { platformKey: 'instagram', formatKey: 'reel_story', width: 1080, height: 1920, ratio: '9:16' },
    IG_FEED,
    { platformKey: 'instagram', formatKey: 'square', width: 1080, height: 1080, ratio: '1:1' },
    { platformKey: 'instagram', formatKey: 'landscape', width: 1080, height: 566, ratio: '1.91:1' },
    { platformKey: 'youtube', formatKey: 'standard', width: 1920, height: 1080, ratio: '16:9' },
    { platformKey: 'pinterest', formatKey: 'pin', width: 1000, height: 1500, ratio: '2:3' },
    { platformKey: 'website', formatKey: 'custom', width: 1600, height: 600, ratio: '8:3' },
  ]

  it.each(FORMATS.map(f => [`${f.platformKey}/${f.formatKey} ${f.ratio}`, f] as const))('%s: all elements sit inside the canvas, stacked headline -> supporting -> CTA, logo top-left', (_n, f) => {
    const d = seed(f)
    const el = (id: string) => findElement(d, id)!
    const H = f.height / Math.min(f.width, f.height)      // canvas height in shorter-side units
    for (const id of ['el-headline', 'el-supporting', 'el-cta', 'el-logo']) {
      expect(el(id).x).toBeGreaterThanOrEqual(0)
      expect(el(id).x + el(id).width).toBeLessThanOrEqual(1.0001)
      expect(el(id).y).toBeGreaterThanOrEqual(0)
      expect(el(id).y).toBeLessThan(1)
    }
    expect(el('el-headline').y).toBeLessThan(el('el-supporting').y)
    expect(el('el-supporting').y).toBeLessThan(el('el-cta').y)
    expect(el('el-logo').y).toBeLessThan(el('el-headline').y)
    // the CTA's bottom edge (its y + line + padding, in shorter-side units) leaves the same 7% bottom padding on every ratio
    const ctaBottomU = el('el-cta').y * H + 0.032 * 1.2 + 2 * 0.021
    expect(H - ctaBottomU).toBeCloseTo(0.07, 3)
    // and it renders
    const out = html(d)
    expect(out).toContain('data-element-id="el-cta"')
    expect(out).toContain('SEND YOUR TILE SCHEDULE →')
  })

  it('the layout differs by ratio (data is recomputed per canvas) but the creative content is identical', () => {
    const story = seed(FORMATS[0]), wide = seed(FORMATS[3])
    expect(findElement(story, 'el-headline')!.y).not.toBeCloseTo(findElement(wide, 'el-headline')!.y, 2)
    expect(textOf(story, 'el-headline')).toBe(textOf(wide, 'el-headline'))
  })
})

describe('PostCanvas: P1 platform/format switching still drives the data-driven canvas', () => {
  const withState = (state: ReturnType<typeof initialPostFormatState>, node = <PostCanvas />) => renderToStaticMarkup(<PostFormatProvider initialState={state}>{node}</PostFormatProvider>)

  it('for every platform x applicable format, the canvas renders the document for that format with one page and the four seed elements', () => {
    let n = 0
    for (const p of postCreatorPlatforms()) for (const f of postCreatorFormats(p.key)) {
      let s = postFormatReducer(initialPostFormatState(), { type: 'platform', platformKey: p.key })
      s = postFormatReducer(s, { type: 'format', formatKey: f.key })
      const out = withState(s)
      expect(out, `${p.key}/${f.key}`).toContain('data-testid="pcv2-post-page"')
      expect(out).toContain('data-page-count="1"')
      expect(out).toContain('data-document-id="mock-abc-tiles-post"')
      expect(out).toContain(`data-format="${f.key}"`)
      for (const role of ['primary_headline', 'supporting_text', 'primary_cta', 'brand_logo']) expect(out).toContain(`data-role="${role}"`)
      n++
    }
    expect(n).toBeGreaterThanOrEqual(25)
  })

  it('an injected document is what the canvas draws (the canvas has no built-in creative)', () => {
    const d = seed(); setText(d, 'el-headline', 'INJECTED HEADLINE')
    const out = renderToStaticMarkup(<PostFormatProvider><PostCanvas document={d} /></PostFormatProvider>)
    expect(out).toContain('INJECTED HEADLINE')
    expect(out).not.toContain('LARGE FORMAT')
  })
})
