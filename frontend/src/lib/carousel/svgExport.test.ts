import { describe, expect, it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import type { PostDocument, PostElement } from '../postDocument'
import { createCarouselDocument } from './document'
import { addElement, makeImage, makeText, setSlideBackground, type OpContext } from './ops'
import { newQr, newShape, patternBackground, gradientBackground, GRADIENT_PRESETS } from './designLibrary'
import { SvgContext, exportSvgSlide, exportSvgZip, slideToSvg, svgColor, svgFileName, type SvgBackend } from './svgExport'

function ids(): OpContext { let n = 0; return { newId: p => `${p}_${++n}`, now: () => new Date('2026-11-21T09:00:00Z') } }
const THEME = { accent: '#e11d48', background: '#fffaf0', foreground: '#111827' } as never
const measure = (font: string, text: string) => text.length * parseFloat(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? '10') * 0.5
const backend: SvgBackend = { measure, loadImage: async url => (url.includes('missing') ? null : { width: 200, height: 100, href: 'data:image/png;base64,AAAA' }) }

/** Checks the markup is well formed: every tag closes, attributes are quoted, entities are escaped. (A real XML parser also checks it in the browser test.) */
function wellFormed(svg: string): void {
  const body = svg.replace(/^<\?xml[^>]*\?>\s*/, '')
  const stack: string[] = []
  const re = /<(\/?)([A-Za-z][\w:-]*)((?:\s+[\w:-]+="[^"<]*")*)\s*(\/?)>|([^<]+)/g
  let m: RegExpExecArray | null
  let pos = 0
  while ((m = re.exec(body))) {
    expect(m.index, `unparseable markup near: ${body.slice(pos, pos + 80)}`).toBe(pos)
    pos = re.lastIndex
    if (m[5] !== undefined) { expect(m[5]).not.toMatch(/&(?!amp;|lt;|gt;|quot;|#39;)/); continue }
    if (m[4] === '/') continue
    if (m[1] === '/') { expect(stack.pop()).toBe(m[2]) } else stack.push(m[2])
  }
  expect(pos).toBe(body.length)
  expect(stack).toEqual([])
}

function sample(): PostDocument {
  let d = createCarouselDocument({ title: 'Café & <Menu>', layouts: ['statement', 'statement'] }, ids())
  const p = d.pages[0].id
  d = setSlideBackground(d, p, gradientBackground(GRADIENT_PRESETS[0]), ids())
  const star = { ...newShape('star-5', d.format, THEME, ids()), id: 'star', name: 'Star', link: { url: 'https://example.com/menu?a=1&b=2' }, rotation: 15, stroke: { color: '#ffffff', width: 0.004 } } as PostElement
  const round = { ...newShape('rect', d.format, THEME, ids()), id: 'round', cornerRadius: 0.03, fill: 'rgba(17,24,39,0.5)', opacity: 0.8 } as PostElement
  const oval = { ...newShape('ellipse', d.format, THEME, ids()), id: 'oval' } as PostElement
  const txt = makeText(d.format, { id: 'shadowed', content: 'Hello "world" <b> & more', style: { fontFamily: '"Playfair Display", serif', fontSize: 0.06, fontWeight: 700, italic: true, lineHeight: 1.2, align: 'center', color: '#ffffff', letterSpacing: 0.01, shadow: { color: 'rgba(0,0,0,0.4)', blur: 0.01, offsetX: 0.004, offsetY: 0.004 }, stroke: { color: '#000000', width: 0.003 } }, link: { url: 'tel:+61400000000' } } as never, ids())
  const img = makeImage({ id: 'photo', source: { kind: 'asset', assetId: 3, url: '/uploads/1/photo.png' }, mask: 'circle', adjust: { brightness: 120, blur: 0.002 }, flipX: true } as never, ids())
  const gone = makeImage({ id: 'gone', source: { kind: 'asset', assetId: 4, url: '/uploads/1/missing.png' } } as never, ids())
  const qr = newQr('https://example.com/offer', ids())
  for (const e of [round, oval, star, txt, img, gone, qr]) d = addElement(d, p, e, ids())
  return d
}

describe('colours', () => {
  it('turns CSS colours into SVG colour plus opacity', () => {
    expect(svgColor('#abc')).toEqual({ color: '#aabbcc', opacity: 1 })
    expect(svgColor('#11223380').opacity).toBeCloseTo(128 / 255, 5)
    expect(svgColor('rgba(255, 0, 128, 0.25)')).toEqual({ color: '#ff0080', opacity: 0.25 })
    expect(svgColor('rgb(0 0 0 / 50%)')).toEqual({ color: '#000000', opacity: 0.5 })
    expect(svgColor('transparent').opacity).toBe(0); expect(svgColor('red')).toEqual({ color: 'red', opacity: 1 })
  })
})

describe('the SVG drawing context', () => {
  const ctx = () => new SvgContext({ measure })
  it('records paths with their transform, fills with opacity, and rounded corners as arcs', () => {
    const c = ctx()
    c.save(); c.translate(10, 20); c.rotate(Math.PI / 2); c.globalAlpha = 0.5; c.fillStyle = 'rgba(255,0,0,0.5)'
    c.beginPath(); c.moveTo(0, 0); c.arcTo(100, 0, 100, 100, 10); c.lineTo(100, 100); c.closePath(); c.fill(); c.restore()
    const svg = c.toSvg(100, 100)
    expect(svg).toContain('d="M0 0L90 0A10 10 0 0 1 100 10L100 100Z"')
    expect(svg).toContain('fill="#ff0000" fill-opacity="0.25"')
    expect(svg).toMatch(/transform="matrix\(0 1 -1 0 10 20\)"/)
    wellFormed(svg)
  })
  it('draws a full ellipse as two arcs and a clipped group is closed by restore', () => {
    const c = ctx()
    c.save(); c.beginPath(); c.ellipse(50, 50, 40, 20, 0, 0, Math.PI * 2); c.clip(); c.fillStyle = '#00f'; c.fillRect(0, 0, 100, 100); c.restore()
    c.fillStyle = '#0f0'; c.fillRect(0, 0, 5, 5)
    const svg = c.toSvg(100, 100)
    expect(svg).toContain('<clipPath id="c1"><path d="M90 50A40 20 0 1 1 10 50A40 20 0 1 1 90 50Z"/></clipPath>')
    expect(svg.indexOf('</g>')).toBeLessThan(svg.indexOf('fill="#00ff00"'))   // the second rectangle is outside the clip
    wellFormed(svg)
  })
  it('turns a gradient into a definition used by reference, and shadows and adjustments into CSS filters', () => {
    const c = ctx()
    const g = c.createLinearGradient(0, 0, 100, 0); g.addColorStop(0, '#000'); g.addColorStop(1, 'rgba(255,255,255,0.5)')
    c.fillStyle = g; c.fillRect(0, 0, 100, 100); c.fillRect(0, 0, 10, 10)
    c.shadowColor = 'rgba(0,0,0,0.5)'; c.shadowBlur = 8; c.shadowOffsetX = 2; c.shadowOffsetY = 3; c.font = '700 20px "A B", serif'; c.fillText('x', 1, 2)
    const svg = c.toSvg(100, 100)
    expect(svg.match(/<linearGradient/g)).toHaveLength(1)                                    // one definition however often it is used
    expect(svg).toContain('stop-opacity="0.5"'); expect(svg).toContain('fill="url(#g1)"')
    expect(svg).toContain('filter:drop-shadow(2px 3px 4px #00000080)')
    expect(c.stats.shadows).toBe(true); expect([...c.stats.fonts]).toEqual(['A B', 'serif'])
    wellFormed(svg)
  })
})

describe('a whole slide as SVG', () => {
  it('is a well-formed vector document with live text, shapes, a QR code, embedded pictures and clickable links', async () => {
    const d = sample()
    const s = await slideToSvg(d, 0, backend, { scale: 0.5 })
    wellFormed(s.svg)
    expect(s.svg).toContain('width="540" height="675" viewBox="0 0 540 675"')
    expect(s.svg).toContain('<title>Café &amp; &lt;Menu&gt; - slide 1</title>')
    expect(s.svg).toContain('Hello &quot;world&quot; &lt;b&gt; &amp; more')                  // text stays text, escaped
    expect(s.svg).toContain('font-family="&quot;Playfair Display&quot;, serif"'); expect(s.svg).toContain('font-style="italic"'); expect(s.svg).toContain('letter-spacing=')
    expect(s.svg).toContain('stroke-linejoin="round"')                                      // the outline pass
    expect(s.svg).toContain('<linearGradient')                                              // gradient background
    expect(s.svg).toContain('xlink:href="data:image/png;base64,AAAA"')                      // picture embedded, not linked
    expect(s.svg).toContain('filter:brightness(120%)')
    expect(s.svg).toMatch(/<clipPath/)                                                      // circular mask
    expect(s.svg).toContain('<a href="https://example.com/menu?a=1&amp;b=2"')
    expect(s.svg).toContain('<a href="tel:+61400000000"'); expect(s.svg).toContain('<a href="https://example.com/offer"')   // the QR's own link
    expect(s.svg).not.toContain('missing.png')
    expect(s.svg.match(/<rect /g)!.length).toBeGreaterThan(40)                              // the QR's dark modules
    expect(s.warnings.join('\n')).toMatch(/editable text, so the fonts/); expect(s.warnings.join('\n')).toMatch(/CSS filters/)
    expect(s.warnings.join('\n')).toMatch(/1 picture\(s\) could not be loaded/); expect(s.warnings.join('\n')).toMatch(/link\(s\) are clickable when the SVG is opened in a web browser/)
  })
  it('draws patterns and shows no warning about things the slide does not use', async () => {
    let d = createCarouselDocument({ title: 'P', layouts: ['statement'] }, ids())
    d = setSlideBackground(d, d.pages[0].id, patternBackground('dots', THEME, 1), ids())
    d = { ...d, pages: d.pages.map(p => ({ ...p, elements: [] })) }
    const s = await slideToSvg(d, 0, backend, { scale: 0.25 })
    wellFormed(s.svg); expect(s.svg.match(/<path /g)!.length).toBeGreaterThan(50); expect(s.warnings).toEqual([])
  })
  it('names files in swipe order and exports one slide or a ZIP of them, reporting progress and honouring a slide range and cancel', async () => {
    const d = sample()
    expect(svgFileName(d, 0)).toBe('caf-menu-slide-01.svg'); expect(svgFileName(d, 1, 'My Post!')).toBe('my-post-slide-02.svg')
    const one = await exportSvgSlide(d, 1, backend, { scale: 0.2, fileBase: 'offer' })
    expect(one.file).toMatchObject({ name: 'offer-slide-02.svg', mime: 'image/svg+xml' }); expect(new TextDecoder().decode(one.file.bytes)).toMatch(/^<\?xml/)
    const seen: number[] = []
    const zip = await exportSvgZip(d, backend, { scale: 0.2, indices: [1, 0], onProgress: done => seen.push(done) })
    expect(zip.file).toMatchObject({ name: 'caf-menu-slides-svg.zip', mime: 'application/zip' }); expect(seen).toEqual([1, 2])
    const text = new TextDecoder('latin1').decode(zip.file.bytes)
    expect(text).toContain('caf-menu-slide-02.svg'); expect(text.indexOf('slide-02.svg')).toBeLessThan(text.indexOf('slide-01.svg'))   // the order asked for
    const ctl = new AbortController(); ctl.abort()
    await expect(exportSvgZip(d, backend, { signal: ctl.signal })).rejects.toMatchObject({ name: 'AbortError' })
    await expect(exportSvgSlide(d, 9, backend)).rejects.toThrow(/does not exist/)
  })
  it('writes sample files for the in-browser check when asked', async () => {
    const dir = process.env.SVG_DUMP_DIR
    if (!dir) return
    mkdirSync(dir, { recursive: true })
    const d = sample()
    // Pictures are replaced by a real tiny PNG so the browser renders them
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAECAIAAAAmkwkpAAAAEklEQVR4nGP8z8Dwn4EIwDiqEAAdSQH5ifcOHwAAAABJRU5ErkJggg=='
    const real: SvgBackend = { measure, loadImage: async url => (url.includes('missing') ? null : { width: 8, height: 4, href: `data:image/png;base64,${png}` }) }
    for (let i = 0; i < d.pages.length; i++) writeFileSync(`${dir}/slide-${i + 1}.svg`, (await slideToSvg(d, i, real, { scale: 0.6 })).svg)
  })
})
