import { describe, expect, it } from 'vitest'
import type { PostDocument } from '../postDocument'
import { assertValidPostDocument } from '../postDocument'
import { createCarouselDocument } from './document'
import { insertSlide, newSlide, type OpContext } from './ops'
import { exportAllSlides, exportAllSlidesZip, exportPdf, ExportCancelled, type RasterBackend } from './exporter'
import { estimateImageExport, exportAdvice, videoAdvice } from './resources'
import type { Ctx2D } from './rasterize'

function ids(): OpContext { let n = 0; return { newId: p => `${p}_${++n}`, now: () => new Date('2026-11-19T09:00:00Z') } }

function bigDoc(n: number, platformKey = 'instagram'): PostDocument {
  const c = ids()
  let d = createCarouselDocument({ title: 'Big', layouts: ['cover'] }, c)
  while (d.pages.length < n) d = insertSlide(d, newSlide({ kind: 'solid', color: '#123456' }, [], `S${d.pages.length + 1}`, c), undefined, c)
  return platformKey === 'instagram' ? d : { ...d, format: { ...d.format, platformKey } }
}

/** A backend that draws nothing and encodes a tiny file, so the loop and bookkeeping are what is tested. */
function nullBackend(): RasterBackend & { surfaces: number } {
  const b = {
    surfaces: 0,
    createSurface() {
      b.surfaces++
      const ctx = new Proxy({} as Record<string, unknown>, { get: (t, k: string) => (k in t ? t[k] : (k === 'measureText' ? () => ({ width: 10 }) : () => ({ addColorStop: () => undefined }))), set: (t, k: string, v) => { t[k] = v; return true } }) as unknown as Ctx2D
      return { ctx, toBytes: async (mime: string) => new Uint8Array([mime === 'image/png' ? 1 : 2]) }
    },
    loadImage: async () => null,
  }
  return b
}

describe('large carousels', () => {
  it('a 300-slide document is valid, keeps every slide in order, and exports every slide with progress', async () => {
    const d = bigDoc(300)
    assertValidPostDocument(d)
    expect(d.pages).toHaveLength(300)
    const progress: Array<[number, number]> = []
    const files = await exportAllSlides(d, 'png', nullBackend(), { onProgress: (a, b) => progress.push([a, b]) })
    expect(files).toHaveLength(300)
    expect(files[0].name).toBe('big-slide-001.png')
    expect(files[299].name).toBe('big-slide-300.png')
    expect(progress[0]).toEqual([1, 300])
    expect(progress[299]).toEqual([300, 300])
  }, 30000)

  it('exports only the chosen slides, in the order given, using one canvas at a time', async () => {
    const d = bigDoc(50)
    const b = nullBackend()
    const files = await exportAllSlides(d, 'jpeg', b, { indices: [9, 10, 11, 99] })       // 99 is out of range and ignored
    expect(files.map(f => f.name)).toEqual(['big-slide-10.jpg', 'big-slide-11.jpg', 'big-slide-12.jpg'])
    expect(b.surfaces).toBe(3)
    const zip = await exportAllSlidesZip(d, 'png', nullBackend(), { indices: [0, 1] })
    expect(zip.name).toBe('big-slides-png.zip')
    const pdf = await exportPdf(d, nullBackend(), { indices: [4, 5, 6] })
    expect(new TextDecoder('latin1').decode(pdf.bytes)).toMatch(/\/Count 3/)
  })

  it('can be cancelled mid-way: it stops promptly, rejects with AbortError and renders no further slides', async () => {
    const d = bigDoc(200)
    const ctl = new AbortController()
    const b = nullBackend()
    await expect(exportAllSlides(d, 'png', b, { signal: ctl.signal, onProgress: done => { if (done === 25) ctl.abort() } })).rejects.toBeInstanceOf(ExportCancelled)
    expect(b.surfaces).toBe(25)
    const already = new AbortController(); already.abort()
    await expect(exportPdf(d, nullBackend(), { signal: already.signal })).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('resource advice (advice only, never a refusal)', () => {
  it('is quiet for an ordinary carousel and notes Instagram\'s per-post limit without blocking anything', () => {
    expect(exportAdvice(bigDoc(10), 'png', 1).level).toBe('ok')
    const a = exportAdvice(bigDoc(40), 'jpeg', 1)
    expect(a.level).toBe('notice')
    expect(a.messages.join(' ')).toMatch(/Instagram currently accepts up to 20/)
    expect(a.messages.join(' ')).toMatch(/Every slide is still exported/)
    expect(exportAdvice(bigDoc(40, 'linkedin'), 'jpeg', 1).messages.join(' ')).not.toMatch(/Instagram/)
  })

  it('warns as memory needs grow: heavy, then extreme, and suggests batches', () => {
    const heavy = exportAdvice(bigDoc(200), 'png', 1)
    expect(heavy.level).toBe('heavy')
    const extreme = exportAdvice(bigDoc(1000), 'png', 2)
    expect(extreme.level).toBe('extreme')
    expect(extreme.messages.join(' ')).toMatch(/slide range/)
    expect(extreme.peakBytes).toBeGreaterThan(heavy.peakBytes)
  })

  it('the same export is estimated smaller as JPEG and at 1x, and a batch is smaller than the whole', () => {
    const d = bigDoc(100)
    expect(estimateImageExport(d, 'jpeg', 1).totalBytes).toBeLessThan(estimateImageExport(d, 'png', 1).totalBytes)
    expect(estimateImageExport(d, 'png', 1).totalBytes).toBeLessThan(estimateImageExport(d, 'png', 2).totalBytes)
    expect(estimateImageExport(d, 'png', 1, 10).totalBytes).toBeLessThan(estimateImageExport(d, 'png', 1).totalBytes)
  })

  it('long animated videos get a duration warning', () => {
    expect(videoAdvice(30, 1080, 1350, 30).level).toBe('ok')
    expect(videoAdvice(240, 1080, 1350, 30).level).toBe('heavy')
    expect(videoAdvice(900, 1080, 1350, 30).level).toBe('extreme')
  })
})
