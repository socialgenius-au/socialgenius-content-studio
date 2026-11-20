// Carousel Creator - importing pictures, SVG files and PDFs. What becomes editable depends on the format, and the person is told plainly what was flattened:
//   pictures (PNG, JPEG, WebP, GIF) -> a picture layer you can move, resize, crop, mask and adjust
//   SVG                              -> converted to a PNG picture layer (flattened: its shapes and text are no longer separately editable)
//   PDF                              -> each page that is a picture (JPEG) becomes a slide with that picture as a layer. Text and vector pages are not imported.
//   project file (.sgcarousel.json)  -> the whole carousel with every layer still editable (see projectFile.ts)
import type { PostDocument, PostElement } from '../postDocument'
import { insertSlide, makeImage, newSlide, type OpContext } from './ops'

export type ImportKind = 'image' | 'svg' | 'pdf' | 'project' | 'audio' | 'unsupported'

export const IMPORT_LIMITS = { image: 15 * 1024 * 1024, svg: 5 * 1024 * 1024, pdf: 50 * 1024 * 1024, project: 80 * 1024 * 1024 } as const
export const MAX_PDF_PAGES = 100
/** The longest side of a converted SVG, in pixels. */
export const SVG_MAX_SIDE = 2400

export function importKindOf(file: { name: string; type?: string }): ImportKind {
  const n = file.name.toLowerCase()
  const t = (file.type ?? '').toLowerCase()
  if (n.endsWith('.sgcarousel.json') || n.endsWith('.sgcarousel')) return 'project'
  if (n.endsWith('.svg') || t === 'image/svg+xml') return 'svg'
  if (n.endsWith('.pdf') || t === 'application/pdf') return 'pdf'
  if (/\.(png|jpe?g|webp|gif)$/.test(n) || /^image\/(png|jpe?g|webp|gif)$/.test(t)) return 'image'
  if (/\.(mp3|wav|m4a|aac)$/.test(n)) return 'audio'
  return 'unsupported'
}

export function validateImportFile(file: { name: string; size: number; type?: string }): { kind: ImportKind; error: string | null } {
  const kind = importKindOf(file)
  if (kind === 'unsupported') return { kind, error: `"${file.name}" is not a type the editor can import. Use PNG, JPEG, WebP, GIF, SVG, PDF or a project file.` }
  if (kind === 'audio') return { kind, error: `"${file.name}" is audio. Add music in the Animate tab.` }
  if (file.size === 0) return { kind, error: `"${file.name}" is empty.` }
  const limit = IMPORT_LIMITS[kind]
  if (file.size > limit) return { kind, error: `"${file.name}" is larger than ${Math.round(limit / 1024 / 1024)} MB, which is too big to import as ${kind === 'project' ? 'a project file' : kind === 'pdf' ? 'a PDF' : 'a picture'}.` }
  return { kind, error: null }
}

// ── SVG ──────────────────────────────────────────────────────────────────────────────────────

export interface SvgInfo { width: number; height: number; warnings: string[] }

/** Reads the size of an SVG and notes anything that will not survive conversion. Throws a plain-language error if it is not a usable SVG. */
export function inspectSvg(text: string): SvgInfo {
  const head = /<svg\b[^>]*>/i.exec(text)
  if (!head) throw new Error('That does not look like an SVG file.')
  const tag = head[0]
  const attr = (name: string) => new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag)?.[1]
  const len = (v: string | undefined) => { const m = v ? /^\s*([\d.]+)\s*(px|pt|mm|cm|in)?\s*$/i.exec(v) : null; if (!m) return 0; const k = { pt: 96 / 72, mm: 96 / 25.4, cm: 96 / 2.54, in: 96 }[(m[2] ?? '').toLowerCase()] ?? 1; return Number(m[1]) * k }
  let width = len(attr('width')), height = len(attr('height'))
  const vb = attr('viewBox')?.trim().split(/[\s,]+/).map(Number)
  if ((!width || !height) && vb && vb.length === 4 && vb[2] > 0 && vb[3] > 0) { width = width || (height ? (height * vb[2]) / vb[3] : vb[2]); height = height || (width * vb[3]) / vb[2] }
  if (!width || !height) { width = 1080; height = 1080 }
  const warnings = ['SVG files are converted to a picture. The shapes and text inside are no longer separately editable (flattened); you can still move, resize, crop, mask and adjust the picture.']
  if (/<script\b|\son[a-z]+\s*=/i.test(text)) warnings.push('Scripts inside the SVG were ignored.')
  if (/<foreignObject\b/i.test(text)) warnings.push('Embedded web content (foreignObject) may not appear.')
  if (/(?:xlink:)?href\s*=\s*["']https?:/i.test(text)) warnings.push('Pictures or fonts the SVG loads from the internet are not fetched, so they may be missing.')
  if (/<text\b/i.test(text)) warnings.push('Text in the SVG is drawn with the fonts available in this browser, which may differ from the original.')
  return { width, height, warnings }
}

/** The converted picture's size: the SVG's own size, scaled so its longest side is at most SVG_MAX_SIDE (and at least 600 so small icons stay sharp). */
export function svgRasterSize(info: { width: number; height: number }): { width: number; height: number } {
  const longest = Math.max(info.width, info.height)
  const k = longest > SVG_MAX_SIDE ? SVG_MAX_SIDE / longest : longest < 600 ? 600 / longest : 1
  return { width: Math.max(1, Math.round(info.width * k)), height: Math.max(1, Math.round(info.height * k)) }
}

// ── PDF ──────────────────────────────────────────────────────────────────────────────────────

export interface PdfPicture { jpeg: Uint8Array; width: number; height: number }
export interface PdfImportResult { pictures: PdfPicture[]; pageCount: number; warnings: string[] }

const latin1 = (b: Uint8Array, from: number, to: number) => { let s = ''; for (let i = from; i < to; i += 8192) s += String.fromCharCode(...b.subarray(i, Math.min(to, i + 8192))); return s }
const indexOfStr = (hay: Uint8Array, needle: string, from: number): number => {
  const n = needle.length
  outer: for (let i = from; i <= hay.length - n; i++) { for (let j = 0; j < n; j++) if (hay[i + j] !== needle.charCodeAt(j)) continue outer; return i }
  return -1
}

/**
 * Pulls the JPEG pictures out of a PDF in file order. This reads PDFs whose pages are pictures (scans, exports from this editor, slide decks saved as images). It does NOT render text or
 * vector pages, and does not read pictures stored in compressed object streams or with other encodings; in those cases it says so rather than guessing.
 */
export function extractPdfPictures(bytes: Uint8Array): PdfImportResult {
  if (latin1(bytes, 0, 5) !== '%PDF-') throw new Error('That does not look like a PDF file.')
  if (indexOfStr(bytes, '/Encrypt', Math.max(0, bytes.length - 4096)) >= 0 || indexOfStr(bytes, '/Encrypt', 0) >= 0) throw new Error('That PDF is password protected, so its pages cannot be imported.')
  const pictures: PdfPicture[] = []
  let pageCount = 0
  let otherImages = 0
  let at = 0
  while (true) {
    const o = indexOfStr(bytes, ' obj', at)
    if (o < 0) break
    const s = indexOfStr(bytes, 'stream', o)
    const e = indexOfStr(bytes, 'endobj', o)
    if (e < 0) break
    const hasStream = s >= 0 && s < e
    const dict = latin1(bytes, o, hasStream ? s : e)
    if (/\/Type\s*\/Page(?![a-z])/i.test(dict)) pageCount++
    if (!hasStream) { at = e + 6; continue }
    // where the stream's data begins and ends: the direct /Length when there is one, otherwise up to "endstream"
    let start = s + 6
    if (bytes[start] === 0x0d) start++
    if (bytes[start] === 0x0a) start++
    const lenM = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict)
    let end = lenM ? start + Number(lenM[1]) : indexOfStr(bytes, 'endstream', start)
    if (end < start) end = start
    if (!lenM) { while (end > start && (bytes[end - 1] === 0x0a || bytes[end - 1] === 0x0d)) end-- }
    if (/\/Subtype\s*\/Image/.test(dict)) {
      const w = Number(/\/Width\s+(\d+)/.exec(dict)?.[1] ?? 0)
      const h = Number(/\/Height\s+(\d+)/.exec(dict)?.[1] ?? 0)
      const isJpeg = /\/DCTDecode/.test(dict) && !/\/SMask/.test(dict) && bytes[start] === 0xff && bytes[start + 1] === 0xd8 && w > 0 && h > 0 && end > start && end <= bytes.length
      if (isJpeg) pictures.push({ jpeg: bytes.slice(start, end), width: w, height: h }); else otherImages++
    }
    const es = indexOfStr(bytes, 'endstream', end)
    at = (es >= 0 ? es : e) + 9
  }
  const warnings: string[] = []
  if (pictures.length === 0) throw new Error('No importable pictures were found in that PDF. Only PDFs whose pages are pictures (scans, or PDFs made from images) can be imported; text and vector pages are not converted.')
  if (pictures.length > MAX_PDF_PAGES) { warnings.push(`Only the first ${MAX_PDF_PAGES} of ${pictures.length} pictures were imported.`); pictures.length = MAX_PDF_PAGES }
  warnings.push('PDF pages are imported as pictures (flattened): their text is not editable. Each becomes its own slide.')
  if (pageCount > 0 && pageCount !== pictures.length) warnings.push(`The PDF has ${pageCount} page${pageCount === 1 ? '' : 's'} but ${pictures.length} importable picture${pictures.length === 1 ? '' : 's'}. Pages without a picture (text or vector pages) were skipped.`)
  if (otherImages > 0) warnings.push(`${otherImages} other image${otherImages === 1 ? '' : 's'} in the PDF (not JPEG, or with transparency) could not be imported.`)
  return { pictures, pageCount, warnings }
}

// ── placing imported pictures ────────────────────────────────────────────────────────────────

export interface UploadedPicture { assetId: number; url: string; name: string; width?: number; height?: number }

/** A full-slide picture layer, contained (never stretched or cropped) and centred, so a PDF page keeps its own proportions on the slide. */
export function fullBleedPicture(p: UploadedPicture, ctx?: OpContext): PostElement {
  return makeImage({ name: p.name.slice(0, 80) || 'Imported page', source: { kind: 'asset', assetId: p.assetId, url: p.url }, alt: p.name.slice(0, 120), x: 0, y: 0, width: 1, height: 1, fit: 'contain' }, ctx)
}

/** Appends one slide per picture (in order) to the end of the carousel, each holding its picture as an editable layer. */
export function addPicturesAsSlides(doc: PostDocument, pictures: UploadedPicture[], ctx?: OpContext): { doc: PostDocument; slideIds: string[] } {
  let d = doc
  const slideIds: string[] = []
  for (const p of pictures) {
    const page = newSlide({ kind: 'solid', color: '#FFFFFF' }, [fullBleedPicture(p, ctx)], p.name.slice(0, 40) || undefined, ctx)
    d = insertSlide(d, page, undefined, ctx)
    slideIds.push(page.id)
  }
  return { doc: d, slideIds }
}
