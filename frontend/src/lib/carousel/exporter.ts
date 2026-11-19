// Carousel Creator — export orchestration: PNG / JPEG for one slide or all slides (as a ZIP), and one multi-page PDF in slide order.
//
// The drawing backend is injected (`RasterBackend`), so the same code runs on real <canvas> elements in the browser (see browserBackend.ts) and on stubs in tests.
import type { PostDocument } from '../postDocument'
import { drawSlide, type Ctx2D, type DrawableImage } from './rasterize'
import { buildPdf, type PdfPage } from './pdf'
import { buildZip } from './zip'

export type ImageKind = 'png' | 'jpeg'
export const MIME: Record<ImageKind, string> = { png: 'image/png', jpeg: 'image/jpeg' }
export const EXT: Record<ImageKind, string> = { png: 'png', jpeg: 'jpg' }

export interface RasterSurface {
  ctx: Ctx2D
  /** Encodes the drawn pixels. */
  toBytes(mime: string, quality?: number): Promise<Uint8Array>
}

export interface RasterBackend {
  createSurface(width: number, height: number): RasterSurface
  loadImage(url: string): Promise<DrawableImage | null>
}

export interface ExportOptions {
  /** Output scale relative to the format's pixel size (1 = 1080 x 1350 for Instagram 4:5). */
  scale?: number
  /** JPEG quality 0..1 (ignored for PNG). */
  quality?: number
  resolveUrl?: (url: string) => string
  now?: () => Date
}

export interface ExportFile { name: string; mime: string; bytes: Uint8Array }

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'carousel'

/** "my-carousel-slide-03.png" — numbers are zero-padded to the width of the slide count, so files sort in swipe order. */
export function slideFileName(doc: PostDocument, index: number, kind: ImageKind): string {
  const width = Math.max(2, String(doc.pages.length).length)
  return `${slug(doc.title)}-slide-${String(index + 1).padStart(width, '0')}.${EXT[kind]}`
}

export const exportPixelSize = (doc: PostDocument, scale = 1) => ({ width: Math.round(doc.format.width * scale), height: Math.round(doc.format.height * scale) })

async function drawToSurface(doc: PostDocument, index: number, backend: RasterBackend, o: ExportOptions): Promise<{ surface: RasterSurface; width: number; height: number }> {
  const { width, height } = exportPixelSize(doc, o.scale)
  const surface = backend.createSurface(width, height)
  await drawSlide(surface.ctx, doc, index, { width, height, resolveUrl: o.resolveUrl, loadImage: backend.loadImage })
  return { surface, width, height }
}

export async function exportSlide(doc: PostDocument, index: number, kind: ImageKind, backend: RasterBackend, o: ExportOptions = {}): Promise<ExportFile> {
  if (index < 0 || index >= doc.pages.length) throw new Error(`Slide ${index + 1} does not exist`)
  const { surface } = await drawToSurface(doc, index, backend, o)
  return { name: slideFileName(doc, index, kind), mime: MIME[kind], bytes: await surface.toBytes(MIME[kind], kind === 'jpeg' ? o.quality ?? 0.92 : undefined) }
}

/** Every slide as an image, in slide order. */
export async function exportAllSlides(doc: PostDocument, kind: ImageKind, backend: RasterBackend, o: ExportOptions = {}): Promise<ExportFile[]> {
  const files: ExportFile[] = []
  for (let i = 0; i < doc.pages.length; i++) files.push(await exportSlide(doc, i, kind, backend, o))      // sequential: one canvas of memory at a time
  return files
}

export async function exportAllSlidesZip(doc: PostDocument, kind: ImageKind, backend: RasterBackend, o: ExportOptions = {}): Promise<ExportFile> {
  const files = await exportAllSlides(doc, kind, backend, o)
  return { name: `${slug(doc.title)}-slides-${kind}.zip`, mime: 'application/zip', bytes: buildZip(files.map(f => ({ name: f.name, data: f.bytes })), o.now) }
}

/** One page per slide, in slide order. Pages are JPEG-encoded (a PDF page image), at the export scale. */
export async function exportPdf(doc: PostDocument, backend: RasterBackend, o: ExportOptions = {}): Promise<ExportFile> {
  const pages: PdfPage[] = []
  for (let i = 0; i < doc.pages.length; i++) {
    const { surface, width, height } = await drawToSurface(doc, i, backend, o)
    pages.push({ jpeg: await surface.toBytes(MIME.jpeg, o.quality ?? 0.92), width, height })
  }
  return { name: `${slug(doc.title)}.pdf`, mime: 'application/pdf', bytes: buildPdf(pages, { title: doc.title, now: o.now }) }
}

// ── pre-export check ─────────────────────────────────────────────────────────────────────────

/** Things a person would want to know before exporting: empty image slots (they export as blank space) and leftover planning placeholders. */
export function exportWarnings(doc: PostDocument): string[] {
  const out: string[] = []
  doc.pages.forEach((p, i) => {
    const walk = (els: typeof p.elements) => {
      for (const e of els) {
        if (!e.visible) continue
        if (e.type === 'image' && !(e.source.kind === 'asset' && e.source.url)) out.push(`Slide ${i + 1}: the image "${e.name}" is still empty and will export as blank space.`)
        if (e.type === 'text' && /^\s*(PLACEHOLDER|TEXT PLACEHOLDER)\b/i.test(e.content)) out.push(`Slide ${i + 1}: "${e.name}" still holds planning placeholder text.`)
        if (e.type === 'group') walk(e.children)
      }
    }
    walk(p.elements)
  })
  return out
}
