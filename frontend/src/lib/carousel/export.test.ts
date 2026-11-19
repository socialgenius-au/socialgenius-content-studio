import { describe, expect, it } from 'vitest'
import type { PostDocument } from '../postDocument'
import { createCarouselDocument } from './document'
import { addElement, makeImage, makeShape, makeText, moveSlide, setSlideBackground, updateElement, type OpContext } from './ops'
import { collectImageUrls, drawSlide, fitRects, gradientLine, wrapText, type Ctx2D, type DrawableImage } from './rasterize'
import { buildPdf } from './pdf'
import { buildZip, crc32 } from './zip'
import { exportAllSlides, exportAllSlidesZip, exportPdf, exportSlide, exportWarnings, slideFileName, type RasterBackend, type RasterSurface } from './exporter'

function ctxIds(): OpContext { let n = 0; return { newId: p => `${p}_${++n}`, now: () => new Date('2026-11-19T09:00:00Z') } }

type Call = [string, ...unknown[]]

/** A 2D context that records what is drawn. Text is 0.5em wide per character, which is deterministic and close enough for wrapping tests. */
function recorder() {
  const calls: Call[] = []
  const state = { fillStyle: '' as unknown, strokeStyle: '' as unknown, lineWidth: 1, globalAlpha: 1, font: '10px sans-serif', textBaseline: '', textAlign: '' }
  const stack: (typeof state)[] = []
  const grads: { args: number[]; stops: [number, string][] }[] = []
  const ctx = new Proxy(state, {
    get(t, k: string) {
      if (k in t) return (t as Record<string, unknown>)[k]
      if (k === 'save') return () => { stack.push({ ...state }); calls.push(['save']) }
      if (k === 'restore') return () => { Object.assign(state, stack.pop()); calls.push(['restore']) }
      if (k === 'measureText') return (s: string) => ({ width: s.length * parseFloat(/(\d+(?:\.\d+)?)px/.exec(state.font)?.[1] ?? '10') * 0.5 })
      if (k === 'createLinearGradient') return (...args: number[]) => { const g = { args, stops: [] as [number, string][] }; grads.push(g); calls.push(['gradient', ...args]); return { addColorStop: (o: number, c: string) => g.stops.push([o, c]), _g: g } }
      return (...args: unknown[]) => { calls.push([k, ...args, state.fillStyle, state.globalAlpha, state.font]) }
    },
    set(t, k: string, v) { (t as Record<string, unknown>)[k] = v; return true },
  }) as unknown as Ctx2D
  return { ctx, calls, state, grads }
}

const noImages = async (): Promise<DrawableImage | null> => null
const names = (calls: Call[]) => calls.map(c => c[0])

describe('text wrapping', () => {
  const m = (s: string) => s.length * 10
  it('wraps at word boundaries within the width, keeps explicit line breaks and respects maxLines', () => {
    expect(wrapText('one two three four', 100, m)).toEqual(['one two', 'three four'])
    expect(wrapText('a\n\nb', 100, m)).toEqual(['a', '', 'b'])
    expect(wrapText('aaa bbb ccc ddd eee', 70, m, 2)).toEqual(['aaa bbb', 'ccc ddd'])
  })
  it('splits a single word that is wider than the line instead of overflowing', () => {
    const lines = wrapText('abcdefghijklmnopqrstuvwxyz', 100, m)
    expect(lines.join('')).toBe('abcdefghijklmnopqrstuvwxyz')
    expect(lines.every(l => l.length * 10 <= 100)).toBe(true)
  })
})

describe('image fitting and gradients', () => {
  it('cover fills the box and crops the source around the focal point; contain fits and centres', () => {
    expect(fitRects(2000, 1000, 500, 500, 'cover')).toEqual({ sx: 500, sy: 0, sw: 1000, sh: 1000, dx: 0, dy: 0, dw: 500, dh: 500 })
    expect(fitRects(2000, 1000, 500, 500, 'cover', { x: 0, y: 0 }).sx).toBe(0)
    expect(fitRects(2000, 1000, 500, 500, 'cover', { x: 1, y: 1 }).sx).toBe(1000)
    expect(fitRects(2000, 1000, 500, 500, 'contain')).toEqual({ sx: 0, sy: 0, sw: 2000, sh: 1000, dx: 0, dy: 125, dw: 500, dh: 250 })
    expect(fitRects(0, 0, 10, 10, 'cover').dw).toBe(0)
  })
  it('CSS gradient angles map to canvas lines (0 = to top, 90 = to right, 180 = to bottom)', () => {
    const up = gradientLine(0, 100, 200)
    expect([up.x0, up.y0, up.x1, up.y1].map(v => Math.round(v) + 0)).toEqual([50, 200, 50, 0])
    const right = gradientLine(90, 100, 200)
    expect([right.x0, right.y0, right.x1, right.y1].map(v => Math.round(v) + 0)).toEqual([0, 100, 100, 100])
    const down = gradientLine(180, 100, 200)
    expect([down.x0, down.y0, down.x1, down.y1].map(v => Math.round(v) + 0)).toEqual([50, 0, 50, 200])
  })
})

describe('drawing a slide', () => {
  it('paints the background first and then the elements in array (layer) order', async () => {
    const c = ctxIds()
    const d = createCarouselDocument({ layouts: ['cover'], themeId: 'ink' }, c)
    const r = recorder()
    await drawSlide(r.ctx, d, 0, { width: 1080, height: 1350, loadImage: noImages })
    const first = r.calls.find(x => x[0] === 'fillRect')!
    expect(first.slice(1, 5)).toEqual([0, 0, 1080, 1350])
    expect(first[5]).toBe('#111827')                                            // the theme background
    const textCalls = r.calls.filter(x => x[0] === 'fillText').map(x => x[1])
    expect(textCalls[0]).toBe('SWIPE THROUGH')                                  // Kicker is layered before the headline
    expect(textCalls.join(' ')).toContain('Swipe →')
    expect(textCalls.indexOf('SWIPE THROUGH')).toBeLessThan(textCalls.indexOf('Swipe →'))
  })

  it('skips hidden elements and applies opacity', async () => {
    const c = ctxIds()
    let d = createCarouselDocument({ layouts: ['title_body'] }, c)
    const pid = d.pages[0].id
    const head = d.pages[0].elements.find(e => e.name === 'Headline')!
    d = updateElement(d, pid, head.id, { visible: false }, c)
    const body = d.pages[0].elements.find(e => e.name === 'Body')!
    d = updateElement(d, pid, body.id, { opacity: 0.4 }, c)
    const r = recorder()
    await drawSlide(r.ctx, d, 0, { width: 1080, height: 1350, loadImage: noImages })
    const texts = r.calls.filter(x => x[0] === 'fillText')
    expect(texts.some(t => String(t[1]).startsWith('Make the point'))).toBe(false)      // hidden headline not drawn
    expect(texts.length).toBeGreaterThan(0)
    expect(texts.every(t => t[5] === 0.4)).toBe(true)                                   // globalAlpha = element opacity
  })

  it('sizes text from the shorter canvas side and wraps it to the element width', async () => {
    const c = ctxIds()
    let d = createCarouselDocument({ layouts: ['statement'] }, c)
    const pid = d.pages[0].id
    const el = d.pages[0].elements.find(e => e.name === 'Statement')!
    d = updateElement(d, pid, el.id, { content: 'alpha beta gamma delta epsilon zeta eta theta', width: 0.5, style: { fontSize: 0.1 } } as never, c)
    const r = recorder()
    await drawSlide(r.ctx, d, 0, { width: 1080, height: 1350, loadImage: noImages })
    const t = r.calls.filter(x => x[0] === 'fillText')
    expect(t[0][6]).toContain('108px')                                                  // 0.1 x shorter side (1080)
    expect(t.length).toBeGreaterThan(1)                                                 // wrapped into several lines
    expect(t.map(x => x[1]).join(' ')).toBe('alpha beta gamma delta epsilon zeta eta theta')
    const lineYs = t.map(x => x[3] as number)
    expect(lineYs).toEqual([...lineYs].sort((a, b) => a - b))
    expect(lineYs[1] - lineYs[0]).toBeCloseTo(108 * 1.1, 3)                             // line height
  })

  it('draws a text box (a CTA chip) behind its text and shapes with their fill', async () => {
    const c = ctxIds()
    const d = createCarouselDocument({ layouts: ['cta'], themeId: 'ivory' }, c)
    const r = recorder()
    await drawSlide(r.ctx, d, 0, { width: 1080, height: 1350, loadImage: noImages })
    const seq = names(r.calls)
    const lastFill = seq.lastIndexOf('fill')
    const lastText = seq.lastIndexOf('fillText')
    expect(lastFill).toBeGreaterThan(-1)
    expect(lastFill).toBeLessThan(lastText)                                             // chip painted before its label
    expect(r.calls.some(x => x[0] === 'arcTo')).toBe(true)                              // rounded corners
  })

  it('rotates an element about its centre', async () => {
    const c = ctxIds()
    let d = createCarouselDocument({ layouts: ['cover'] }, c)
    d = addElement(d, d.pages[0].id, makeShape({ x: 0.2, y: 0.2, width: 0.2, height: 0.1, rotation: 90 }, c), c)
    const r = recorder()
    await drawSlide(r.ctx, d, 0, { width: 1000, height: 1000, loadImage: noImages })
    const rot = r.calls.find(x => x[0] === 'rotate')!
    expect(rot[1]).toBeCloseTo(Math.PI / 2)
    const tr = r.calls.filter(x => x[0] === 'translate').slice(-2)
    expect(tr[0].slice(1, 3)).toEqual([300, 250])                                       // centre of x=200..400, y=200..300
    expect(tr[1].slice(1, 3)).toEqual([-300, -250])
  })

  it('draws real images (cover, clipped) and background images, loading each URL once and through resolveUrl', async () => {
    const c = ctxIds()
    let d = createCarouselDocument({ layouts: ['cover'] }, c)
    d = setSlideBackground(d, d.pages[0].id, { kind: 'image', source: { kind: 'asset', url: '/uploads/1/bg.png' }, fit: 'cover' }, c)
    d = addElement(d, d.pages[0].id, makeImage({ source: { kind: 'asset', assetId: 3, url: '/uploads/1/pic.png' }, x: 0.1, y: 0.1, width: 0.5, height: 0.25 }, c), c)
    d = addElement(d, d.pages[0].id, makeImage({ source: { kind: 'asset', assetId: 3, url: '/uploads/1/pic.png' }, x: 0.1, y: 0.5, width: 0.5, height: 0.25 }, c), c)
    expect(collectImageUrls(d, 0).sort()).toEqual(['/uploads/1/bg.png', '/uploads/1/pic.png'])
    const loaded: string[] = []
    const r = recorder()
    await drawSlide(r.ctx, d, 0, {
      width: 1000, height: 1000, resolveUrl: u => `${u}?mt=T`,
      loadImage: async u => { loaded.push(u); return { width: 2000, height: 1000 } },
    })
    expect(loaded.sort()).toEqual(['/uploads/1/bg.png?mt=T', '/uploads/1/pic.png?mt=T'])
    const draws = r.calls.filter(x => x[0] === 'drawImage')
    expect(draws).toHaveLength(3)                                                       // background + two image elements
    expect(draws[0].slice(2, 10)).toEqual([500, 0, 1000, 1000, 0, 0, 1000, 1000])        // background cover over the whole canvas
    expect(r.calls.some(x => x[0] === 'clip')).toBe(true)
  })

  it('leaves an unfilled image placeholder blank and survives an image that fails to load', async () => {
    const c = ctxIds()
    let d = createCarouselDocument({ layouts: ['image_caption'] }, c)
    const r = recorder()
    await drawSlide(r.ctx, d, 0, { width: 1080, height: 1350, loadImage: noImages })
    expect(r.calls.some(x => x[0] === 'drawImage')).toBe(false)
    d = addElement(d, d.pages[0].id, makeImage({ source: { kind: 'asset', url: '/uploads/1/x.png' } }, c), c)
    const r2 = recorder()
    await expect(drawSlide(r2.ctx, d, 0, { width: 1080, height: 1350, loadImage: () => Promise.reject(new Error('boom')) })).resolves.toBeUndefined()
    await expect(drawSlide(r2.ctx, d, 9, { width: 10, height: 10, loadImage: noImages })).rejects.toThrow(/does not exist/)
  })

  it('draws gradient backgrounds with the CSS angle and every colour stop', async () => {
    const c = ctxIds()
    let d = createCarouselDocument({ layouts: ['cover'] }, c)
    d = setSlideBackground(d, d.pages[0].id, { kind: 'gradient', angle: 180, stops: [{ offset: 0, color: '#112233' }, { offset: 1, color: '#445566' }] }, c)
    const r = recorder()
    await drawSlide(r.ctx, d, 0, { width: 200, height: 400, loadImage: noImages })
    expect(r.grads[0].args.map(Math.round)).toEqual([100, 0, 100, 400])
    expect(r.grads[0].stops).toEqual([[0, '#112233'], [1, '#445566']])
  })
})

// ── export files ─────────────────────────────────────────────────────────────────────────────

/** A drawing backend whose "encoded" bytes name the slide that was drawn (the first text on it), so file contents prove ordering. */
function fakeBackend(log: { sizes: [number, number][]; encoded: string[] } = { sizes: [], encoded: [] }): RasterBackend & { log: typeof log } {
  return {
    log,
    loadImage: noImages,
    createSurface(width, height): RasterSurface {
      log.sizes.push([width, height])
      const r = recorder()
      return {
        ctx: r.ctx,
        async toBytes(mime) {
          const firstText = String(r.calls.find(x => x[0] === 'fillText')?.[1] ?? 'blank')
          log.encoded.push(`${mime}:${firstText}`)
          const body = new TextEncoder().encode(`${mime}|${firstText}`)
          return mime === 'image/png' ? new Uint8Array([0x89, 0x50, 0x4e, 0x47, ...body]) : new Uint8Array([0xff, 0xd8, ...body, 0xff, 0xd9])
        },
      }
    },
  }
}

function tagged(): PostDocument {
  const c = ctxIds()
  let d = createCarouselDocument({ title: 'Tile Tips!', layouts: ['statement', 'statement', 'statement'] }, c)
  d.pages.forEach((p, i) => { d = updateElement(d, p.id, p.elements.find(e => e.name === 'Statement')!.id, { content: `Slide-${i + 1}` } as never, c) })
  return d
}

describe('slide image export', () => {
  it('exports one slide as PNG or JPEG at the format size, with a sortable name', async () => {
    const d = tagged()
    const b = fakeBackend()
    const png = await exportSlide(d, 1, 'png', b)
    const jpg = await exportSlide(d, 2, 'jpeg', b)
    expect(png).toMatchObject({ name: 'tile-tips-slide-02.png', mime: 'image/png' })
    expect(Array.from(png.bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47])
    expect(jpg).toMatchObject({ name: 'tile-tips-slide-03.jpg', mime: 'image/jpeg' })
    expect(Array.from(jpg.bytes.slice(0, 2))).toEqual([0xff, 0xd8])
    expect(b.log.sizes).toEqual([[1080, 1350], [1080, 1350]])
    expect(b.log.encoded).toEqual(['image/png:Slide-2', 'image/jpeg:Slide-3'])
    await expect(exportSlide(d, 5, 'png', b)).rejects.toThrow(/does not exist/)
  })

  it('exports at 2x scale when asked', async () => {
    const b = fakeBackend()
    await exportSlide(tagged(), 0, 'png', b, { scale: 2 })
    expect(b.log.sizes).toEqual([[2160, 2700]])
  })

  it('exports all slides in slide order, and in the NEW order after a reorder', async () => {
    const c = ctxIds()
    let d = tagged()
    const b = fakeBackend()
    expect((await exportAllSlides(d, 'png', b)).map(f => f.name)).toEqual(['tile-tips-slide-01.png', 'tile-tips-slide-02.png', 'tile-tips-slide-03.png'])
    expect(b.log.encoded).toEqual(['image/png:Slide-1', 'image/png:Slide-2', 'image/png:Slide-3'])
    d = moveSlide(d, d.pages[2].id, 0, c)
    const b2 = fakeBackend()
    await exportAllSlides(d, 'jpeg', b2)
    expect(b2.log.encoded).toEqual(['image/jpeg:Slide-3', 'image/jpeg:Slide-1', 'image/jpeg:Slide-2'])
  })

  it('file names pad to the slide count so they sort correctly past 9 and 99 slides', () => {
    const c = ctxIds()
    let d = createCarouselDocument({ title: 'x' }, c)
    const many = { ...d, pages: Array.from({ length: 12 }, (_, i) => ({ ...d.pages[0], id: `p${i}` })) }
    expect(slideFileName(many, 0, 'png')).toBe('x-slide-01.png')
    expect(slideFileName(many, 11, 'jpeg')).toBe('x-slide-12.jpg')
    d = { ...d, title: '  ÅÄÖ / weird *name* ' }
    expect(slideFileName(d, 0, 'png')).toMatch(/^[a-z0-9-]+-slide-01\.png$/)
    expect(slideFileName({ ...d, title: '***' }, 0, 'png')).toBe('carousel-slide-01.png')
  })
})

describe('ZIP of all slides', () => {
  it('stores every file, in order, with correct sizes, CRCs and a valid central directory', async () => {
    const d = tagged()
    const f = await exportAllSlidesZip(d, 'png', fakeBackend(), { now: () => new Date('2026-11-19T09:00:00Z') })
    expect(f).toMatchObject({ name: 'tile-tips-slides-png.zip', mime: 'application/zip' })
    const z = f.bytes
    const dv = new DataView(z.buffer, z.byteOffset, z.byteLength)
    expect(dv.getUint32(z.length - 22, true)).toBe(0x06054b50)                              // end of central directory
    const count = dv.getUint16(z.length - 22 + 10, true)
    const cdSize = dv.getUint32(z.length - 22 + 12, true)
    const cdOffset = dv.getUint32(z.length - 22 + 16, true)
    expect(count).toBe(3)
    expect(cdOffset + cdSize + 22).toBe(z.length)
    let p = cdOffset
    const files: { name: string; crc: number; size: number; localAt: number }[] = []
    for (let i = 0; i < count; i++) {
      expect(dv.getUint32(p, true)).toBe(0x02014b50)
      const nameLen = dv.getUint16(p + 28, true)
      files.push({ crc: dv.getUint32(p + 16, true), size: dv.getUint32(p + 20, true), localAt: dv.getUint32(p + 42, true), name: new TextDecoder().decode(z.slice(p + 46, p + 46 + nameLen)) })
      p += 46 + nameLen
    }
    expect(files.map(x => x.name)).toEqual(['tile-tips-slide-01.png', 'tile-tips-slide-02.png', 'tile-tips-slide-03.png'])
    files.forEach((file, i) => {
      expect(dv.getUint32(file.localAt, true)).toBe(0x04034b50)
      const nameLen = dv.getUint16(file.localAt + 26, true)
      const data = z.slice(file.localAt + 30 + nameLen, file.localAt + 30 + nameLen + file.size)
      expect(crc32(data)).toBe(file.crc)
      expect(new TextDecoder().decode(data.slice(4))).toBe(`image/png|Slide-${i + 1}`)       // contents are slide i+1, in order
    })
  })

  it('crc32 matches the standard check value', () => {
    expect(crc32(new TextEncoder().encode('123456789')).toString(16)).toBe('cbf43926')
    expect(buildZip([]).length).toBe(22)
  })
})

/** Parses the PDF this module writes: objects by offset, the page tree, and each page's image bytes. */
function parsePdf(bytes: Uint8Array) {
  const latin = new TextDecoder('latin1').decode(bytes)
  expect(latin.startsWith('%PDF-1.4')).toBe(true)
  expect(latin.trimEnd().endsWith('%%EOF')).toBe(true)
  const startxref = Number(/startxref\n(\d+)\n%%EOF/.exec(latin)![1])
  expect(latin.slice(startxref, startxref + 4)).toBe('xref')
  const size = Number(/trailer\n<< \/Size (\d+)/.exec(latin)![1])
  const xrefRows = latin.slice(startxref).split('\n').slice(3, 3 + size - 1).map(r => Number(r.slice(0, 10)))
  xrefRows.forEach((off, i) => expect(latin.slice(off, off + `${i + 1} 0 obj`.length), `xref entry for object ${i + 1}`).toBe(`${i + 1} 0 obj`))
  const kids = [...(/\/Kids \[([^\]]*)\]/.exec(latin)![1].matchAll(/(\d+) 0 R/g))].map(m => Number(m[1]))
  const pages = kids.map(k => {
    const obj = latin.slice(xrefRows[k - 1], xrefRows[k])
    const media = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(obj)!
    const img = Number(/\/Im0 (\d+) 0 R/.exec(obj)![1])
    const imgStart = xrefRows[img - 1]
    const header = latin.slice(imgStart, latin.indexOf('stream\n', imgStart))
    const len = Number(/\/Length (\d+)/.exec(header)![1])
    const dataStart = latin.indexOf('stream\n', imgStart) + 7
    return { width: Number(media[1]), height: Number(media[2]), imgW: Number(/\/Width (\d+)/.exec(header)![1]), imgH: Number(/\/Height (\d+)/.exec(header)![1]), filter: /\/Filter \/(\w+)/.exec(header)![1], data: bytes.slice(dataStart, dataStart + len) }
  })
  return { size, pageCount: Number(/\/Type \/Pages \/Count (\d+)/.exec(latin)![1]), pages, latin }
}

describe('PDF export', () => {
  it('writes a structurally valid PDF with one correctly sized page per slide, in slide order', () => {
    const jpeg = (tag: string) => new Uint8Array([0xff, 0xd8, ...new TextEncoder().encode(tag), 0xff, 0xd9])
    const pdf = buildPdf([{ jpeg: jpeg('A'), width: 1080, height: 1350 }, { jpeg: jpeg('B'), width: 1080, height: 1350 }, { jpeg: jpeg('C'), width: 1080, height: 1350 }], { title: 'Tile (tips)', now: () => new Date('2026-11-19T09:00:00Z') })
    const p = parsePdf(pdf)
    expect(p.pageCount).toBe(3)
    expect(p.pages).toHaveLength(3)
    expect(p.pages.map(x => [x.width, x.height])).toEqual([[810, 1012.5], [810, 1012.5], [810, 1012.5]])
    expect(p.pages.map(x => [x.imgW, x.imgH, x.filter])).toEqual([[1080, 1350, 'DCTDecode'], [1080, 1350, 'DCTDecode'], [1080, 1350, 'DCTDecode']])
    expect(p.pages.map(x => new TextDecoder().decode(x.data.slice(2, -2)))).toEqual(['A', 'B', 'C'])         // page order = slide order
    expect(p.latin).toContain('/Title (Tile \\(tips\\))')
    expect(p.latin).toContain('D:20261119090000Z')
  })

  it('refuses to write an empty PDF and supports mixed page sizes', () => {
    expect(() => buildPdf([])).toThrow(/at least one page/)
    const j = new Uint8Array([0xff, 0xd8, 0xff, 0xd9])
    const p = parsePdf(buildPdf([{ jpeg: j, width: 1080, height: 1080 }, { jpeg: j, width: 1080, height: 1920 }]))
    expect(p.pages.map(x => [x.width, x.height])).toEqual([[810, 810], [810, 1440]])
  })

  it('exports a carousel as a PDF whose pages are the slides in their current order', async () => {
    const c = ctxIds()
    let d = tagged()
    d = moveSlide(d, d.pages[0].id, 2, c)                                                  // slide order is now 2, 3, 1
    const b = fakeBackend()
    const f = await exportPdf(d, b)
    expect(f).toMatchObject({ name: 'tile-tips.pdf', mime: 'application/pdf' })
    const p = parsePdf(f.bytes)
    expect(p.pageCount).toBe(3)
    expect(p.pages.map(x => new TextDecoder().decode(x.data.slice(2, -2)))).toEqual(['image/jpeg|Slide-2', 'image/jpeg|Slide-3', 'image/jpeg|Slide-1'])
    expect(p.pages.every(x => x.imgW === 1080 && x.imgH === 1350)).toBe(true)
    expect(b.log.encoded.every(e => e.startsWith('image/jpeg'))).toBe(true)
  })
})

describe('pre-export check', () => {
  it('warns about empty image slots and leftover planning placeholders, by slide number', () => {
    const c = ctxIds()
    let d = createCarouselDocument({ layouts: ['cover', 'image_caption'] }, c)
    expect(exportWarnings(d)).toEqual(['Slide 2: the image "Hero image" is still empty and will export as blank space.'])
    d = updateElement(d, d.pages[0].id, d.pages[0].elements.find(e => e.name === 'Headline')!.id, { content: 'PLACEHOLDER — explain the offer' } as never, c)
    d = addElement(d, d.pages[0].id, makeText(d.format, { name: 'Hidden', visible: false, content: 'PLACEHOLDER — hidden' }, c), c)
    expect(exportWarnings(d)).toEqual(['Slide 1: "Headline" still holds planning placeholder text.', 'Slide 2: the image "Hero image" is still empty and will export as blank space.'])
  })
})
