import { describe, expect, it } from 'vitest'
import type { PostDocument, PostElement } from '../postDocument'
import { createCarouselDocument } from './document'
import type { OpContext } from './ops'
import { countPdfLinks, pageLinks, rotatedBounds } from './pageLinks'
import { buildPdf, pdfUri } from './pdf'
import { exportPdf, type RasterBackend } from './exporter'
import { newShape } from './designLibrary'

function ids(): OpContext { let n = 0; return { newId: p => `${p}_${++n}`, now: () => new Date('2026-11-21T09:00:00Z') } }
const base = (n = 2): PostDocument => createCarouselDocument({ title: 'Links', layouts: Array.from({ length: n }, () => 'statement' as const) }, ids())
const withEls = (d: PostDocument, pageIndex: number, els: PostElement[]): PostDocument => ({ ...d, pages: d.pages.map((p, i) => (i === pageIndex ? { ...p, elements: els } : p)) })
const FORMAT = base(1).format
const box = (id: string, over: Partial<PostElement> = {}): PostElement => ({ ...newShape('rect', FORMAT, { accent: { token: 'accent', fallback: '#ff5500' } } as never, ids()), id, name: id, x: 0.1, y: 0.2, width: 0.4, height: 0.1, ...over } as PostElement)
const text = (s: Uint8Array) => new TextDecoder('latin1').decode(s)

describe('which parts of a slide are clickable', () => {
  it('uses each linked, visible element box; an element without a link, a hidden one and an unsafe one are not clickable', () => {
    const d = withEls(base(), 0, [
      box('a', { link: { url: 'https://example.com/menu' } }),
      box('b'),
      box('c', { link: { url: 'https://example.com' }, visible: false }),
      box('d', { link: { url: 'javascript:alert(1)' } }),
      box('e', { link: { url: 'example.com/x' }, x: 0.5, y: 0.5, width: 0.2, height: 0.2 }),
    ])
    const l = pageLinks(d, 0)
    expect(l.map(x => x.elementId)).toEqual(['a', 'e'])
    expect(l[0]).toMatchObject({ url: 'https://example.com/menu', x: 0.1, y: 0.2, w: 0.4 })
    expect(l[0].h).toBeCloseTo(0.1, 6)
    expect(l[1].url).toBe('https://example.com/x')                                   // a bare address becomes https
    expect(countPdfLinks(d)).toBe(2); expect(countPdfLinks(d, [1])).toBe(0)
  })
  it('puts links inside a group in the right place, and a group can be a link itself', () => {
    const g = { ...box('g', { x: 0.2, y: 0.2, width: 0.5, height: 0.5 }), type: 'group', children: [box('c', { x: 0.5, y: 0.5, width: 0.5, height: 0.5, link: { url: 'tel:+61400000000' } })], link: { url: 'https://example.com' } } as unknown as PostElement
    const l = pageLinks(withEls(base(), 0, [g]), 0)
    expect(l.map(x => x.elementId)).toEqual(['g', 'c'])
    expect(l[1]).toMatchObject({ x: 0.45, y: 0.45 }); expect(l[1].w).toBeCloseTo(0.25, 6); expect(l[1].h).toBeCloseTo(0.25, 6)
  })
  it('covers a rotated element, and never extends past the slide', () => {
    const r = rotatedBounds({ x: 0.4, y: 0.4, w: 0.2, h: 0.1 }, 90, 1)
    expect(r.w).toBeCloseTo(0.1, 6); expect(r.h).toBeCloseTo(0.2, 6); expect(r.x + r.w / 2).toBeCloseTo(0.5, 6)
    const l = pageLinks(withEls(base(), 0, [box('a', { x: 0.9, y: 0.95, width: 0.3, height: 0.3, link: { url: 'https://example.com' } })]), 0)[0]
    expect(l.x + l.w).toBeLessThanOrEqual(1); expect(l.y + l.h).toBeLessThanOrEqual(1)
  })
})

describe('the PDF writer', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9])
  it('writes one link annotation per clickable region, with the page rectangle flipped to the PDF origin', () => {
    const pdf = buildPdf([{ jpeg, width: 1000, height: 2000, links: [{ url: 'https://example.com/a?b=(1)', x: 100, y: 200, w: 300, h: 400 }, { url: 'tel:+61400000000', x: 0, y: 0, w: 10, h: 10 }] }, { jpeg, width: 1000, height: 2000 }], { now: () => new Date('2026-11-21T00:00:00Z') })
    const s = text(pdf)
    expect(s.match(/\/Subtype \/Link/g)).toHaveLength(2)
    expect(s).toContain('/Rect [75 1050 300 1350]')                                  // 100,200 + 300x400 px at 0.75 pt/px on a 1500 pt tall page
    expect(s).toContain('/URI (https://example.com/a?b=\\(1\\))'); expect(s).toContain('/URI (tel:+61400000000)')
    expect(s).toContain('/Annots [')
    expect(s.match(/\/Annots/g)).toHaveLength(1)                                    // the page without links has none
    // the cross-reference table must still point at every object
    const xref = Number(/startxref\n(\d+)/.exec(s)![1]); expect(s.slice(xref, xref + 4)).toBe('xref')
    const size = Number(/\/Size (\d+)/.exec(s)![1]); const entries = s.slice(xref).match(/^\d{10} \d{5} [nf] $/gm) ?? []
    expect(entries).toHaveLength(size)
    for (const [i, line] of entries.slice(1).entries()) { const off = Number(line.slice(0, 10)); expect(s.slice(off, off + 12).startsWith(`${i + 1} 0 obj`), `object ${i + 1}`).toBe(true) }
  })
  it('keeps the address safe inside the PDF: non-ASCII is percent-encoded and brackets are escaped', () => {
    expect(pdfUri('https://example.com/café')).toBe('(https://example.com/caf%C3%A9)')
    expect(pdfUri('https://e.com/a)b\\c')).toBe('(https://e.com/a\\)b\\\\c)')
  })
  it('is unchanged when nothing is linked', () => {
    const a = buildPdf([{ jpeg, width: 100, height: 100 }], { now: () => new Date('2026-11-21T00:00:00Z') })
    const b = buildPdf([{ jpeg, width: 100, height: 100, links: [] }], { now: () => new Date('2026-11-21T00:00:00Z') })
    expect(text(b)).toBe(text(a)); expect(text(a)).not.toContain('/Annots')
  })
})

describe('exporting a carousel to PDF', () => {
  const backend: RasterBackend = { createSurface: () => ({ ctx: new Proxy({ globalAlpha: 1, font: '10px sans-serif' } as Record<string, unknown>, { get: (t, k: string) => (k in t ? t[k] : k === 'measureText' ? (x: string) => ({ width: x.length * 5 }) : () => ({ addColorStop: () => undefined })), set: (t, k: string, v) => { t[k] = v; return true } }) as never, toBytes: async () => new Uint8Array([0xff, 0xd8, 0xff, 0xd9]) }), loadImage: async () => null }
  it('makes the linked elements clickable on the right pages, and only for the slides exported', async () => {
    const d = withEls(withEls(base(3), 0, [box('a', { link: { url: 'https://example.com/one' } })]), 2, [box('z', { link: { url: 'mailto:hi@example.com' } })])
    const all = text((await exportPdf(d, backend, { scale: 0.1, now: () => new Date('2026-11-21T00:00:00Z') })).bytes)
    expect(all).toContain('/URI (https://example.com/one)'); expect(all).toContain('/URI (mailto:hi@example.com)')
    const only = text((await exportPdf(d, backend, { scale: 0.1, indices: [2] })).bytes)
    expect(only).not.toContain('example.com/one'); expect(only).toContain('mailto:hi@example.com')
  })
})
