import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { assertValidPostDocument, validateLinkUrl, validatePostDocument, type PostDocument, type PostElement } from '../postDocument'
import { createCarouselDocument } from './document'
import { addElement, makeImage, makeShape, makeText, type OpContext } from './ops'
import { SHAPES, SHAPE_BY_ID, clipPathOf, svgPoints } from './shapes'
import { PATTERNS, tileDataUrl, tilePx } from './patterns'
import { ADJUST_DEFAULTS, canvasFilter, cssFilter, hasAdjust } from './adjust'
import { displayText, defaultDynamic, formatDuration } from './dynamicText'
import { QR_MAX_BYTES, QrError, encodeQr, qrFor, qrPath, qrSvg } from './qr'
import { drawSlide, type Ctx2D } from './rasterize'
import PostRenderer from '../../pages/post-creator-v2/canvas/PostRenderer'

function ids(): OpContext { let n = 0; return { newId: p => `${p}_${++n}`, now: () => new Date('2026-11-21T09:00:00Z') } }
function blank(): { d: PostDocument; page: string; c: OpContext } {
  const c = ids()
  const d0 = createCarouselDocument({ layouts: ['cover'] }, c)
  return { d: { ...d0, pages: [{ ...d0.pages[0], elements: [] }] }, page: d0.pages[0].id, c }
}
const render = (d: PostDocument) => renderToStaticMarkup(<div style={{ position: 'relative' }}><PostRenderer document={d} pageId={d.pages[0].id} /></div>)
const recorder = (calls: [string, ...unknown[]][]) => { const st: Record<string, unknown> = { globalAlpha: 1, font: '10px sans-serif' }; return new Proxy(st, { get(t, k: string) { if (k in t) return t[k]; if (k === 'measureText') return (s: string) => ({ width: s.length * 5 }); if (k === 'createLinearGradient') return () => ({ addColorStop: () => undefined }); return (...a: unknown[]) => { calls.push([k, ...a]) } }, set(t, k: string, v) { t[k] = v; calls.push([`set:${k}`, v]); return true } }) as unknown as Ctx2D }

describe('shape library', () => {
  it('has the shapes people expect, every polygon stays inside the unit square, and ids are unique', () => {
    const want = ['triangle', 'diamond', 'pentagon', 'hexagon', 'octagon', 'star-4', 'star-5', 'star-6', 'burst', 'arrow-right', 'arrow-left', 'arrow-up', 'arrow-down', 'arrow-double', 'chevron', 'heart', 'cross', 'bubble', 'bubble-round', 'line-arrow', 'parallelogram', 'trapezoid']
    for (const w of want) expect(SHAPE_BY_ID[w], w).toBeTruthy()
    expect(new Set(SHAPES.map(s => s.id)).size).toBe(SHAPES.length)
    for (const s of SHAPES) { expect(s.points.length).toBeGreaterThanOrEqual(3); for (const [x, y] of s.points) { expect(x).toBeGreaterThanOrEqual(-1e-6); expect(x).toBeLessThanOrEqual(1 + 1e-6); expect(y).toBeGreaterThanOrEqual(-1e-6); expect(y).toBeLessThanOrEqual(1 + 1e-6) } }
    expect(clipPathOf('triangle')).toBe('polygon(50% 0%, 100% 100%, 0% 100%)')
    expect(svgPoints([[0.5, 0], [1, 1]], 200, 100)).toBe('100,0 200,100')
  })
  it('arrows point the way they say and a star has alternating points', () => {
    const maxX = (id: string) => Math.max(...SHAPE_BY_ID[id].points.map(p => p[0])), minX = (id: string) => Math.min(...SHAPE_BY_ID[id].points.map(p => p[0]))
    expect(SHAPE_BY_ID['arrow-right'].points.some(p => p[0] === 1 && p[1] === 0.5)).toBe(true)
    expect(SHAPE_BY_ID['arrow-left'].points.some(p => p[0] === 0 && p[1] === 0.5)).toBe(true)
    expect(SHAPE_BY_ID['arrow-up'].points.some(p => p[0] === 0.5 && p[1] === 0)).toBe(true)
    expect(SHAPE_BY_ID['arrow-down'].points.some(p => p[0] === 0.5 && p[1] === 1)).toBe(true)
    expect(maxX('arrow-right')).toBe(1); expect(minX('arrow-left')).toBe(0)
    expect(SHAPE_BY_ID['star-5'].points).toHaveLength(10)
  })
  it('every polygon shape and mask is accepted by the document validator', () => {
    const { d, page, c } = blank()
    let doc = d
    for (const s of SHAPES) { doc = addElement(doc, page, makeShape({ shape: s.id }, c), c); doc = addElement(doc, page, makeImage({ mask: s.id, source: { kind: 'asset', assetId: 1, url: '/uploads/1/a.png' } }, c), c) }
    assertValidPostDocument(doc)
    const bad = JSON.parse(JSON.stringify(doc)); bad.pages[0].elements[0].shape = 'squiggle'; bad.pages[0].elements[1].mask = 'squiggle'
    expect(validatePostDocument(bad).errors.join('|')).toMatch(/shape: invalid.*mask: unknown/)
  })
})

describe('patterns and textures', () => {
  it('provides dots, stripes, grids, checks and textures; tile images are safe SVG with escaped markup', () => {
    expect(PATTERNS.length).toBeGreaterThanOrEqual(8)
    expect(PATTERNS.some(p => p.category === 'Texture')).toBe(true)
    for (const p of PATTERNS) { const u = tileDataUrl(p, '#112233', '#FFFFFF'); expect(u.startsWith('url("data:image/svg+xml,')).toBe(true); expect(u).not.toMatch(/<|script/i); expect(decodeURIComponent(u)).toContain('<svg') }
    expect(decodeURIComponent(tileDataUrl(PATTERNS[0], 'red;}</svg><script>', '#fff'))).not.toContain('script')      // an unsafe colour is replaced, never inserted
    expect(tilePx(PATTERNS[0], 2, 1000)).toBe(PATTERNS[0].size * 2 * 1000)
  })
  it('renders on screen as a repeating background and is drawn by the exporter with the same tile', async () => {
    const { d, c } = blank()
    const withPattern: PostDocument = { ...d, pages: [{ ...d.pages[0], background: { kind: 'pattern', pattern: 'checker', color: '#FFFFFF', background: '#1E4D2B', scale: 2 } }] }
    assertValidPostDocument(withPattern)
    const html = render(withPattern)
    expect(html).toMatch(/background-image:url\(&quot;data:image\/svg\+xml,/)
    expect(html).toContain('background-size:16cqmin'); expect(html).toContain('background-color:#1E4D2B')
    const calls: [string, ...unknown[]][] = []
    await drawSlide(recorder(calls), withPattern, 0, { width: 400, height: 500, loadImage: async () => null })
    expect(calls.filter(x => x[0] === 'fillRect').length).toBeGreaterThan(20)                      // tiles drawn across the slide
    void c
  })
})

describe('text: outline, shadow, dynamic values', () => {
  it('outline and shadow render in CSS and in the exporter (outline first, then fill, with the shadow reset after)', async () => {
    const { d, page, c } = blank()
    const t = makeText(d.format, { content: 'SALE', style: { fontFamily: 'Inter', fontSize: 0.1, fontWeight: 800, lineHeight: 1.1, align: 'left', color: '#FFFFFF', letterSpacing: 0.01, italic: true, stroke: { color: '#000000', width: 0.006 }, shadow: { color: '#112233', blur: 0.02, offsetX: 0.01, offsetY: 0.012 } } }, c)
    const doc = addElement(d, page, t, c)
    assertValidPostDocument(doc)
    const html = render(doc)
    expect(html).toContain('-webkit-text-stroke:0.6cqmin #000000'); expect(html).toContain('paint-order:stroke fill'); expect(html).toContain('text-shadow:1cqmin 1.2cqmin 2cqmin #112233'); expect(html).toContain('font-style:italic')
    const calls: [string, ...unknown[]][] = []
    await drawSlide(recorder(calls), doc, 0, { width: 1000, height: 1250, loadImage: async () => null })
    const names = calls.map(x => x[0])
    expect(names.indexOf('strokeText')).toBeGreaterThan(-1)
    expect(names.indexOf('strokeText')).toBeLessThan(names.indexOf('fillText'))
    expect(calls.find(x => x[0] === 'set:lineWidth' && x[1] === 6)).toBeTruthy()
    expect(calls.some(x => x[0] === 'set:shadowBlur' && x[1] === 20)).toBe(true)
    expect(calls.filter(x => x[0] === 'set:shadowBlur').pop()![1]).toBe(0)                           // reset so nothing after it casts a shadow
  })
  it('dates, times, countdowns and timers compute their text, and a timer counts frame by frame', () => {
    const now = new Date('2026-12-01T10:00:00')
    const dyn = (kind: string, extra = {}) => ({ content: 'x', dynamic: { kind, ...extra } as never })
    expect(displayText(dyn('date', { iso: '2026-12-31T18:30', style: 'long' }), 0, now)).toBe('Thursday 31 December 2026')
    expect(displayText(dyn('date', { iso: '2026-12-31T18:30', style: 'numeric' }), 0, now)).toBe('31/12/2026')
    expect(displayText(dyn('time', { iso: '2026-12-31T18:30', style: '12h' }), 0, now)).toMatch(/^6:30 ?PM$/)
    expect(displayText(dyn('time', { iso: '2026-12-31T18:30', style: '24h' }), 0, now)).toBe('18:30')
    expect(displayText(dyn('countdown', { iso: '2026-12-03T12:30:15' }), 0, now)).toBe('2d 02h 30m 15s')
    expect(displayText(dyn('countdown', { iso: '2026-12-03T12:30:15' }), 5000, now)).toBe('2d 02h 30m 10s')              // ticks with the video clock
    expect(displayText(dyn('timer', { seconds: 10, direction: 'down' }), 0, now)).toBe('00:10')
    expect(displayText(dyn('timer', { seconds: 10, direction: 'down' }), 4200, now)).toBe('00:06')
    expect(displayText(dyn('timer', { seconds: 10, direction: 'down' }), 99999, now)).toBe('00:00')
    expect(displayText(dyn('timer', { seconds: 10, direction: 'up' }), 3999, now)).toBe('00:03')
    expect(displayText(dyn('timer', { seconds: 90, format: 'ss' }), 0, now)).toBe('90')
    expect(displayText({ content: 'Plain', dynamic: undefined }, 0, now)).toBe('Plain')
    expect(displayText(dyn('timer', { seconds: 5, label: 'Starts in' }), 0, now)).toBe('Starts in 00:05')
    expect(formatDuration(3725, 'hh:mm:ss')).toBe('01:02:05'); expect(defaultDynamic('timer').seconds).toBe(10)
  })
  it('a timer on a slide renders its value on screen and in the video frame at that moment', async () => {
    const { d, page, c } = blank()
    const t = makeText(d.format, { content: 'fallback', dynamic: { kind: 'timer', seconds: 10, direction: 'down' } }, c)
    const doc = addElement(d, page, t, c)
    assertValidPostDocument(doc)
    expect(render(doc)).toContain('>00:10<')
    const calls: [string, ...unknown[]][] = []
    await drawSlide(recorder(calls), doc, 0, { width: 800, height: 1000, timeMs: 6500, loadImage: async () => null })
    expect(calls.find(x => x[0] === 'fillText')![1]).toBe('00:04')
  })
})

describe('shapes with text, pictures with adjustments', () => {
  it('a polygon shape clips its fill, draws its outline on top and centres its text; a plain rectangle keeps its simple markup', () => {
    const { d, page, c } = blank()
    const star = makeShape({ shape: 'star-5', fill: '#E8B04A', stroke: { color: '#FFFFFF', width: 0.004 }, width: 0.4, height: 0.3, text: { content: 'NEW', style: { fontFamily: 'Inter', fontSize: 0.05, fontWeight: 800, lineHeight: 1.1, align: 'center', color: '#111111' } } }, c)
    const rect = makeShape({ shape: 'rect', fill: '#112233' }, c)
    const doc = addElement(addElement(d, page, star, c), page, rect, c)
    assertValidPostDocument(doc)
    const html = render(doc)
    expect(html).toContain('clip-path:polygon('); expect(html).toContain('<polygon points='); expect(html).toContain('vector-effect="non-scaling-stroke"'); expect(html).toContain('>NEW<')
    expect(html.match(/<polygon/g)).toHaveLength(1)
  })
  it('the exporter draws a polygon shape as a path with its text in the middle', async () => {
    const { d, page, c } = blank()
    const doc = addElement(d, page, makeShape({ shape: 'hexagon', fill: '#E8B04A', width: 0.5, height: 0.2, text: { content: 'HI', style: { fontFamily: 'Inter', fontSize: 0.05, fontWeight: 800, lineHeight: 1.1, align: 'center', color: '#111111' } } }, c), c)
    const calls: [string, ...unknown[]][] = []
    await drawSlide(recorder(calls), doc, 0, { width: 1000, height: 1000, loadImage: async () => null })
    expect(calls.filter(x => x[0] === 'lineTo')).toHaveLength(5)                                    // hexagon: moveTo + 5 lineTo + close
    const text = calls.find(x => x[0] === 'fillText')!
    expect(text[1]).toBe('HI'); expect(Number(text[3])).toBeGreaterThan(100); expect(Number(text[3])).toBeLessThan(400)      // vertically inside the shape's box
  })
  it('flip, crop (trim) and adjustments appear on screen and in the export, in the right order', async () => {
    const { d, page, c } = blank()
    const img = makeImage({ x: 0.1, y: 0.1, width: 0.5, height: 0.4, source: { kind: 'asset', assetId: 1, url: '/uploads/1/a.png' }, flipX: true, trim: { top: 0.1, right: 0, bottom: 0, left: 0.2 }, adjust: { brightness: 120, contrast: 90, saturation: 0, blur: 0.01 } }, c)
    const doc = addElement(d, page, img, c)
    assertValidPostDocument(doc)
    const html = render(doc)
    expect(html).toContain('transform:scaleX(-1)'); expect(html).toContain('clip-path:inset(10% 0% 0% 20%)'); expect(html).toContain('filter:brightness(120%) contrast(90%) saturate(0%) blur(1cqmin)')
    const calls: [string, ...unknown[]][] = []
    await drawSlide(recorder(calls), doc, 0, { width: 1000, height: 1000, loadImage: async () => ({ width: 800, height: 600 }) })
    const names = calls.map(x => x[0])
    expect(calls.find(x => x[0] === 'set:filter' && String(x[1]).includes('brightness(120%)'))![1]).toBe('brightness(120%) contrast(90%) saturate(0%) blur(10px)')
    expect(calls.filter(x => x[0] === 'rect').some(x => x[1] === 200 && x[2] === 140)).toBe(true)   // the trim rectangle: 20% from the left, 10% from the top of the 500x400 frame at (100,100)
    expect(calls.find(x => x[0] === 'scale' && x[1] === -1)).toBeTruthy()
    expect(names.indexOf('scale')).toBeLessThan(names.indexOf('drawImage'))
    expect(calls.filter(x => x[0] === 'set:filter').pop()![1]).toBe('none')
    expect(hasAdjust({})).toBe(false); expect(hasAdjust(ADJUST_DEFAULTS)).toBe(false); expect(hasAdjust({ hue: 5 })).toBe(true)
    expect(cssFilter({ grayscale: 100 })).toBe('grayscale(100%)'); expect(canvasFilter(undefined, 1000)).toBe('none')
  })
  it('background pictures take adjustments and a colour overlay, in the screen and the export', async () => {
    const { d, c } = blank()
    const bgDoc: PostDocument = { ...d, pages: [{ ...d.pages[0], background: { kind: 'image', source: { kind: 'asset', assetId: 1, url: '/uploads/1/a.png' }, fit: 'cover', adjust: { blur: 0.02, brightness: 80 }, overlay: { color: '#000000', opacity: 0.4 } } }] }
    assertValidPostDocument(bgDoc)
    const html = render(bgDoc)
    expect(html).toContain('data-testid="pcv2-bg-layer"'); expect(html).toContain('filter:brightness(80%) blur(2cqmin)'); expect(html).toContain('data-testid="pcv2-bg-overlay"'); expect(html).toContain('opacity:0.4')
    const calls: [string, ...unknown[]][] = []
    await drawSlide(recorder(calls), bgDoc, 0, { width: 500, height: 500, loadImage: async () => ({ width: 100, height: 100 }) })
    expect(calls.some(x => x[0] === 'set:filter' && String(x[1]).includes('blur(10px)'))).toBe(true)
    expect(calls.some(x => x[0] === 'set:globalAlpha' && x[1] === 0.4)).toBe(true)
    void c
  })
})

describe('links', () => {
  it('accepts web, email, phone and app links and fixes a bare address; refuses scripts, data, files and credentials', () => {
    expect(validateLinkUrl('https://example.com/menu')).toMatchObject({ ok: true, kind: 'web' })
    expect(validateLinkUrl('example.com/menu')).toMatchObject({ ok: true, url: 'https://example.com/menu' })
    expect(validateLinkUrl('http://example.com')).toMatchObject({ ok: true, warning: expect.stringMatching(/not secure/) })
    expect(validateLinkUrl('mailto:hello@example.com')).toMatchObject({ ok: true, kind: 'mailto' })
    expect(validateLinkUrl('tel:+61412345678')).toMatchObject({ ok: true, kind: 'tel' })
    expect(validateLinkUrl('myapp://open/offer')).toMatchObject({ ok: true, kind: 'app', warning: expect.stringMatching(/installed/) })
    for (const bad of ['javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'vbscript:x', 'https://u:p@example.com', 'https://nodot', 'https://a b.com', '', '   ', 'not a link', 'ftp://example.com/x', 'mailto:nobody', 'tel:abc', 'myapp:/one-slash', 'https://' + 'a'.repeat(2100) + '.com']) expect(validateLinkUrl(bad).ok, bad).toBe(false)
  })
  it('the validator refuses an element link or QR destination that is not allowed', () => {
    const { d, page, c } = blank()
    const ok = addElement(d, page, makeShape({ link: { url: 'mailto:a@b.co', label: 'Email us' } }, c), c)
    assertValidPostDocument(ok)
    const bad = JSON.parse(JSON.stringify(ok)); bad.pages[0].elements[0].link.url = 'javascript:alert(1)'
    expect(validatePostDocument(bad).errors.join('|')).toMatch(/link: not a valid/)
  })
})

describe('QR codes', () => {
  it('builds a valid-looking code: finder patterns, timing pattern, right size for the version, deterministic', () => {
    const q = encodeQr('https://example.com/menu')
    expect(q.size).toBe(q.version * 4 + 17)
    const finder = (ox: number, oy: number) => [0, 1, 2, 3, 4, 5, 6].every(i => q.modules[oy][ox + i] && q.modules[oy + 6][ox + i] && q.modules[oy + i][ox] && q.modules[oy + i][ox + 6]) && !q.modules[oy + 1][ox + 1] && q.modules[oy + 3][ox + 3]
    expect(finder(0, 0) && finder(q.size - 7, 0) && finder(0, q.size - 7)).toBe(true)
    for (let i = 8; i < q.size - 8; i++) expect(q.modules[6][i]).toBe(i % 2 === 0)
    expect(q.modules[q.size - 8][8]).toBe(true)                                                     // the always-dark module
    expect(encodeQr('https://example.com/menu').modules).toEqual(q.modules)
    expect(encodeQr('https://example.com/menu2').modules).not.toEqual(q.modules)
  })
  it('grows with the text (bigger versions), accepts up to the stated limit and refuses more with a clear message', () => {
    const v = (n: number) => encodeQr('https://e.co/' + 'x'.repeat(n)).version
    expect(v(0)).toBeLessThan(v(60)); expect(v(60)).toBeLessThan(v(150))
    expect(encodeQr('x'.repeat(QR_MAX_BYTES)).version).toBe(10)
    expect(() => encodeQr('x'.repeat(QR_MAX_BYTES + 1))).toThrow(/too long/)
    expect(() => encodeQr('')).toThrow(QrError)
    expect(qrFor('x'.repeat(500))).toBeInstanceOf(QrError)
    expect(qrFor('https://example.com')).toMatchObject({ version: expect.any(Number) })
  })
  it('draws on screen as SVG and in the export as rectangles, and an over-long destination shows a message instead of breaking', async () => {
    const { d, page, c } = blank()
    const qr = makeImage({ role: 'other', x: 0.2, y: 0.2, width: 0.4, height: 0.32, fit: 'contain', lockAspect: true, source: { kind: 'qr', data: 'https://example.com/menu', fg: '#112233', bg: '#FFFFFF' } }, c)
    const doc = addElement(d, page, qr, c)
    assertValidPostDocument(doc)
    const html = render(doc)
    expect(html).toContain('<svg viewBox="0 0 29 29"'); expect(html).toContain('fill="#112233"'); expect(html).toContain('M2 2h7v1h-7z')
    const calls: [string, ...unknown[]][] = []
    await drawSlide(recorder(calls), doc, 0, { width: 1000, height: 1250, loadImage: async () => null })
    expect(calls.filter(x => x[0] === 'fillRect').length).toBeGreaterThan(40)
    const long = JSON.parse(JSON.stringify(doc)); long.pages[0].elements[0].source.data = 'https://example.com/' + 'x'.repeat(400)
    expect(render(long)).toContain('too long')
    const svg = qrSvg(encodeQr('hi'))
    expect(svg).toContain('<svg') ; expect(qrPath(encodeQr('hi'))).toMatch(/^M/)
  })
})

export type { PostElement }
