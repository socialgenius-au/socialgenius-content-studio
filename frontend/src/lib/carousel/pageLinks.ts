// Carousel Creator - the clickable regions of a slide, for PDF export. Image and video exports cannot contain clickable links; a PDF can, so each element that has a link becomes a
// rectangle (canvas-relative, 0..1, y from the top) that the PDF writer turns into a link annotation. Pure functions, tested without a browser.
import type { PostDocument, PostElement } from '../postDocument'
import { isSafeLinkUrl, validateLinkUrl } from '../postDocument'
import { elementBox, type Box } from './geometry'

export interface PageLink { url: string; x: number; y: number; w: number; h: number; elementId: string; elementName: string }

/** The smallest axis-aligned box around `b` after rotating it by `deg` about its centre. */
export function rotatedBounds(b: Box, deg: number, aspect: number): Box {
  if (!deg) return b
  // work in a space where one unit is equal in x and y (the canvas is not square), then convert back
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2
  const hw = (b.w * aspect) / 2, hh = b.h / 2
  const r = (deg * Math.PI) / 180
  const c = Math.abs(Math.cos(r)), s = Math.abs(Math.sin(r))
  const w = (hw * c + hh * s) * 2, h = (hw * s + hh * c) * 2
  return { x: cx - w / aspect / 2, y: cy - h / 2, w: w / aspect, h }
}

/** Every link on slide `index`, in paint order (a later one is on top). Hidden elements and unsafe links are left out. */
export function pageLinks(doc: PostDocument, index: number): PageLink[] {
  const page = doc.pages[index]
  if (!page) return []
  const aspect = doc.format.width / doc.format.height
  const out: PageLink[] = []
  const walk = (els: PostElement[], parent: Box) => {
    for (const el of els) {
      if (!el.visible) continue
      const own = elementBox(el, doc.format)
      const abs: Box = { x: parent.x + own.x * parent.w, y: parent.y + own.y * parent.h, w: own.w * parent.w, h: own.h * parent.h }
      if (el.link && isSafeLinkUrl(el.link.url)) {
        const url = validateLinkUrl(el.link.url)
        const bb = rotatedBounds(abs, el.rotation, aspect)
        const x = Math.max(0, bb.x), y = Math.max(0, bb.y)
        const w = Math.min(1, bb.x + bb.w) - x, h = Math.min(1, bb.y + bb.h) - y
        if (url.ok && w > 0 && h > 0) out.push({ url: url.url, x, y, w, h, elementId: el.id, elementName: el.name })
      }
      if (el.type === 'group') walk(el.children, abs)
    }
  }
  walk(page.elements, { x: 0, y: 0, w: 1, h: 1 })
  return out
}

/** How many clickable links the PDF of these slides (default: all) would contain. */
export function countPdfLinks(doc: PostDocument, indices?: number[]): number {
  return (indices ?? doc.pages.map((_, i) => i)).reduce((n, i) => n + pageLinks(doc, i).length, 0)
}
