// Carousel Creator — a small, dependency-free multi-page PDF writer.
//
// One slide = one page, in slide order. Each page holds a single full-bleed JPEG (DCT-encoded image XObject), so the PDF looks exactly like the PNG/JPEG export.
// Page size follows the slide's pixel size at 96 dpi (1 px = 0.75 pt), so a 1080 x 1350 slide is a 810 x 1012.5 pt page.
/** A clickable rectangle on a page, in page pixels measured from the top-left. */
export interface PdfLink { url: string; x: number; y: number; w: number; h: number }
export interface PdfPage { jpeg: Uint8Array; width: number; height: number; links?: PdfLink[] }

/** A URI as a PDF literal string: ASCII only (anything else is percent-encoded as UTF-8), with PDF escaping. */
export function pdfUri(url: string): string {
  const ascii7 = Array.from(url).map(ch => (/[!-~]/.test(ch) ? ch : encodeURIComponent(ch))).join('')
  return '(' + ascii7.replace(/([\\()])/g, '\\$1') + ')'
}

const enc = new TextEncoder()
const ascii = (s: string) => enc.encode(s)

/** PDF literal-string escaping for the Info dictionary (ASCII only; anything else becomes '?'). */
function pdfString(s: string): string {
  return '(' + s.replace(/[^\x20-\x7e]/g, '?').replace(/([\\()])/g, '\\$1') + ')'
}

const num = (n: number) => (Math.round(n * 1000) / 1000).toString()

export function buildPdf(pages: PdfPage[], opts: { title?: string; pxToPt?: number; now?: () => Date } = {}): Uint8Array {
  if (pages.length === 0) throw new Error('A PDF needs at least one page')
  const k = opts.pxToPt ?? 0.75
  const chunks: Uint8Array[] = []
  const offsets: number[] = []      // byte offset of object n (index n-1)
  let pos = 0
  const push = (b: Uint8Array) => { chunks.push(b); pos += b.length }
  const text = (s: string) => push(ascii(s))
  const beginObj = (n: number) => { offsets[n - 1] = pos; text(`${n} 0 obj\n`) }

  // object numbering: 1 catalog, 2 pages, then per page i: 3+3i page, 4+3i content, 5+3i image, then the info dictionary, then one object per link annotation
  const pageObj = (i: number) => 3 + 3 * i
  const infoObj = 3 + 3 * pages.length
  const annotStart: number[] = []
  let annotTotal = 0
  pages.forEach((p, i) => { annotStart[i] = infoObj + 1 + annotTotal; annotTotal += p.links?.length ?? 0 })

  text('%PDF-1.4\n')
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]))       // binary marker comment

  beginObj(1); text('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')
  beginObj(2); text(`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${pageObj(i)} 0 R`).join(' ')}] >>\nendobj\n`)

  pages.forEach((p, i) => {
    const wPt = p.width * k
    const hPt = p.height * k
    const content = `q ${num(wPt)} 0 0 ${num(hPt)} 0 0 cm /Im0 Do Q`
    beginObj(pageObj(i))
    text(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(wPt)} ${num(hPt)}] /Resources << /XObject << /Im0 ${pageObj(i) + 2} 0 R >> /ProcSet [/PDF /ImageC] >> /Contents ${pageObj(i) + 1} 0 R${p.links?.length ? ` /Annots [${p.links.map((_, j) => `${annotStart[i] + j} 0 R`).join(' ')}]` : ''} >>\nendobj\n`)
    beginObj(pageObj(i) + 1)
    text(`<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`)
    beginObj(pageObj(i) + 2)
    text(`<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`)
    push(p.jpeg)
    text('\nendstream\nendobj\n')
  })

  const d = (opts.now ?? (() => new Date()))()
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = `D:${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  beginObj(infoObj)
  text(`<< /Title ${pdfString(opts.title ?? 'Carousel')} /Producer ${pdfString('SocialGenius Carousel Creator')} /CreationDate (${stamp}) >>\nendobj\n`)

  pages.forEach((p, i) => {
    ;(p.links ?? []).forEach((l, j) => {
      const x1 = l.x * k, x2 = (l.x + l.w) * k
      const y1 = (p.height - (l.y + l.h)) * k, y2 = (p.height - l.y) * k          // PDF's origin is the bottom-left corner
      beginObj(annotStart[i] + j)
      text(`<< /Type /Annot /Subtype /Link /Rect [${num(x1)} ${num(y1)} ${num(x2)} ${num(y2)}] /Border [0 0 0] /F 4 /A << /Type /Action /S /URI /URI ${pdfUri(l.url)} >> >>
endobj
`)
    })
  })

  const xrefAt = pos
  const total = infoObj + 1 + annotTotal
  text(`xref\n0 ${total}\n0000000000 65535 f \n`)
  for (let n = 1; n < total; n++) text(`${String(offsets[n - 1]).padStart(10, '0')} 00000 n \n`)
  text(`trailer\n<< /Size ${total} /Root 1 0 R /Info ${infoObj} 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`)

  const out = new Uint8Array(pos)
  let at = 0
  for (const c of chunks) { out.set(c, at); at += c.length }
  return out
}
