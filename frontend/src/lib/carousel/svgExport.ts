// Carousel Creator - SVG export. A slide is drawn by the SAME code as the PNG / JPEG / PDF export (rasterize.ts), but onto a recording context that writes SVG instead of pixels, so
// the SVG looks like the other exports without a second definition of shapes, patterns, QR codes or masks. Text stays text (editable in a vector editor); pictures are embedded.
//
// Limits (reported to the person as warnings): text needs its font installed where the SVG is opened; image adjustments and text shadows are written as CSS filters, which browsers show but
// some vector editors ignore; links are clickable in a browser but not in an editor or when the SVG is used as an <img>.
import type { BrandTokens, PostDocument, PostElement } from '../postDocument'
import { hasAdjust } from './adjust'
import { slug, exportPixelSize, type ExportFile, type ExportOptions } from './exporter'
import { pageLinks } from './pageLinks'
import { drawSlide, type Ctx2D, type DrawableImage, type GradientLike } from './rasterize'
import { buildZip } from './zip'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
const n = (v: number) => (Math.round(v * 1000) / 1000).toString()

type Matrix = [number, number, number, number, number, number]
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]
const mul = (m: Matrix, o: Matrix): Matrix => [m[0] * o[0] + m[2] * o[1], m[1] * o[0] + m[3] * o[1], m[0] * o[2] + m[2] * o[3], m[1] * o[2] + m[3] * o[3], m[0] * o[4] + m[2] * o[5] + m[4], m[1] * o[4] + m[3] * o[5] + m[5]]

/** A CSS colour as an SVG colour plus its own opacity (SVG 1.1 tools do not understand rgba()). */
export function svgColor(input: unknown): { color: string; opacity: number } {
  const s = String(input ?? '').trim()
  let m = /^#([0-9a-f]{3})$/i.exec(s)
  if (m) return { color: `#${m[1].split('').map(c => c + c).join('')}`.toLowerCase(), opacity: 1 }
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s)
  if (m) return { color: `#${m[1].toLowerCase()}`, opacity: m[2] ? parseInt(m[2], 16) / 255 : 1 }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(s)
  if (m) {
    const h = (v: string) => Math.max(0, Math.min(255, Math.round(Number(v)))).toString(16).padStart(2, '0')
    const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? Number.parseFloat(m[4]) / 100 : Number(m[4])
    return { color: `#${h(m[1])}${h(m[2])}${h(m[3])}`, opacity: Math.max(0, Math.min(1, a)) }
  }
  if (s === 'transparent' || s === '') return { color: '#000000', opacity: 0 }
  return { color: s, opacity: 1 }
}

interface Grad extends GradientLike { x0: number; y0: number; x1: number; y1: number; stops: { offset: number; color: string }[] }
const isGrad = (v: unknown): v is Grad => typeof v === 'object' && v !== null && 'stops' in v && 'x0' in v

export interface SvgStats { filters: boolean; shadows: boolean; text: boolean; images: number; imagesSkipped: number; fonts: Set<string> }

export interface SvgContextOptions {
  /** Width of `text` in `font` (a CSS font string) with the given letter spacing. Lets text wrap exactly as it does in the other exports. */
  measure: (font: string, text: string, letterSpacing: string | undefined) => number
  /** The data (or other) address of a loaded picture. */
  imageHref?: (img: unknown) => string | null
}

/** A recording 2D context that writes SVG. It implements exactly the drawing calls rasterize.ts uses. */
export class SvgContext implements Ctx2D {
  fillStyle: unknown = '#000000'
  strokeStyle: unknown = '#000000'
  lineWidth = 1
  globalAlpha = 1
  font = '10px sans-serif'
  textBaseline = 'alphabetic'
  textAlign = 'start'
  letterSpacing?: string
  lineJoin?: string = 'miter'
  lineCap?: string = 'butt'
  shadowColor?: string = 'rgba(0,0,0,0)'
  shadowBlur?: number = 0
  shadowOffsetX?: number = 0
  shadowOffsetY?: number = 0
  filter?: string = 'none'

  readonly stats: SvgStats = { filters: false, shadows: false, text: false, images: 0, imagesSkipped: 0, fonts: new Set() }
  private body: string[] = []
  private defs: string[] = []
  private ids = 0
  private m: Matrix = IDENTITY
  private open = 0
  private path: string[] = []
  private pathM: Matrix = IDENTITY
  private cx = 0
  private cy = 0
  private sx = 0
  private sy = 0
  private gradIds = new Map<Grad, string>()
  private stack: { m: Matrix; open: number; style: Record<string, unknown> }[] = []

  constructor(private readonly opts: SvgContextOptions) {}

  private static STYLE_KEYS = ['fillStyle', 'strokeStyle', 'lineWidth', 'globalAlpha', 'font', 'textBaseline', 'textAlign', 'letterSpacing', 'lineJoin', 'lineCap', 'shadowColor', 'shadowBlur', 'shadowOffsetX', 'shadowOffsetY', 'filter'] as const
  save(): void {
    const style: Record<string, unknown> = {}
    for (const k of SvgContext.STYLE_KEYS) style[k] = (this as unknown as Record<string, unknown>)[k]
    this.stack.push({ m: this.m, open: this.open, style })
  }
  restore(): void {
    const s = this.stack.pop()
    if (!s) return
    while (this.open > s.open) { this.body.push('</g>'); this.open-- }
    this.m = s.m
    Object.assign(this, s.style)
  }
  translate(x: number, y: number): void { this.m = mul(this.m, [1, 0, 0, 1, x, y]) }
  scale(x: number, y: number): void { this.m = mul(this.m, [x, 0, 0, y, 0, 0]) }
  rotate(rad: number): void { const c = Math.cos(rad), s = Math.sin(rad); this.m = mul(this.m, [c, s, -s, c, 0, 0]) }

  beginPath(): void { this.path = []; this.pathM = this.m }
  moveTo(x: number, y: number): void { this.path.push(`M${n(x)} ${n(y)}`); this.cx = this.sx = x; this.cy = this.sy = y }
  lineTo(x: number, y: number): void { this.path.push(`L${n(x)} ${n(y)}`); this.cx = x; this.cy = y }
  closePath(): void { this.path.push('Z'); this.cx = this.sx; this.cy = this.sy }
  rect(x: number, y: number, w: number, h: number): void { this.moveTo(x, y); this.lineTo(x + w, y); this.lineTo(x + w, y + h); this.lineTo(x, y + h); this.closePath() }
  /** The same rounded corner a canvas draws: a straight line to the first tangent point, then a circular arc to the second. */
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void {
    const x0 = this.cx, y0 = this.cy
    const ax = x0 - x1, ay = y0 - y1, bx = x2 - x1, by = y2 - y1
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by)
    const cross = ax * by - ay * bx
    if (r <= 0 || la === 0 || lb === 0 || Math.abs(cross) < 1e-9) { this.lineTo(x1, y1); return }
    const dot = (ax * bx + ay * by) / (la * lb)
    const t = r / Math.tan(Math.acos(Math.max(-1, Math.min(1, dot))) / 2)
    const p1x = x1 + (ax / la) * t, p1y = y1 + (ay / la) * t
    const p2x = x1 + (bx / lb) * t, p2y = y1 + (by / lb) * t
    this.lineTo(p1x, p1y)
    this.path.push(`A${n(r)} ${n(r)} 0 0 ${cross < 0 ? 1 : 0} ${n(p2x)} ${n(p2y)}`)
    this.cx = p2x; this.cy = p2y
  }
  ellipse(x: number, y: number, rx: number, ry: number, rot: number, a0: number, a1: number): void {
    const pt = (a: number) => { const px = rx * Math.cos(a), py = ry * Math.sin(a); return [x + px * Math.cos(rot) - py * Math.sin(rot), y + px * Math.sin(rot) + py * Math.cos(rot)] as const }
    const deg = (rot * 180) / Math.PI
    const full = Math.abs(a1 - a0) >= Math.PI * 2 - 1e-9
    const [sxp, syp] = pt(a0)
    this.path.push(`M${n(sxp)} ${n(syp)}`)
    if (full) {
      const [mx, my] = pt(a0 + Math.PI), [ex, ey] = pt(a0)
      this.path.push(`A${n(rx)} ${n(ry)} ${n(deg)} 1 1 ${n(mx)} ${n(my)}`, `A${n(rx)} ${n(ry)} ${n(deg)} 1 1 ${n(ex)} ${n(ey)}`, 'Z')
      this.cx = ex; this.cy = ey
    } else {
      const [ex, ey] = pt(a1)
      this.path.push(`A${n(rx)} ${n(ry)} ${n(deg)} ${Math.abs(a1 - a0) > Math.PI ? 1 : 0} ${a1 > a0 ? 1 : 0} ${n(ex)} ${n(ey)}`)
      this.cx = ex; this.cy = ey
    }
    this.sx = sxp; this.sy = syp
  }

  // ── painting ─────────────────────────────────────────────────────────────────────────────

  private matrixAttr(m: Matrix): string { return m.every((v, i) => Math.abs(v - IDENTITY[i]) < 1e-9) ? '' : ` transform="matrix(${m.map(n).join(' ')})"` }

  /** fill / stroke attributes for a colour or gradient, with the global alpha folded into the opacity. */
  private paint(kind: 'fill' | 'stroke', value: unknown): string {
    if (isGrad(value)) {
      let id = this.gradIds.get(value)
      if (!id) {
        id = `g${++this.ids}`
        this.gradIds.set(value, id)
        const stops = value.stops.map(s => { const c = svgColor(s.color); return `<stop offset="${n(s.offset)}" stop-color="${c.color}"${c.opacity < 1 ? ` stop-opacity="${n(c.opacity)}"` : ''}/>` }).join('')
        this.defs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${n(value.x0)}" y1="${n(value.y0)}" x2="${n(value.x1)}" y2="${n(value.y1)}"${this.matrixAttr(this.m).replace('transform', 'gradientTransform')}>${stops}</linearGradient>`)
      }
      return ` ${kind}="url(#${id})"${this.globalAlpha < 1 ? ` ${kind}-opacity="${n(this.globalAlpha)}"` : ''}`
    }
    const c = svgColor(value)
    const a = c.opacity * this.globalAlpha
    return ` ${kind}="${c.color}"${a < 1 ? ` ${kind}-opacity="${n(a)}"` : ''}`
  }
  /** A CSS filter for the active shadow and picture adjustments. */
  private cssFilter(withAdjust: boolean): string {
    const parts: string[] = []
    if (withAdjust && this.filter && this.filter !== 'none') { parts.push(this.filter); this.stats.filters = true }
    if ((this.shadowBlur || this.shadowOffsetX || this.shadowOffsetY) && svgColor(this.shadowColor).opacity > 0) {
      const c = svgColor(this.shadowColor)
      parts.push(`drop-shadow(${n(this.shadowOffsetX ?? 0)}px ${n(this.shadowOffsetY ?? 0)}px ${n((this.shadowBlur ?? 0) / 2)}px ${c.color}${c.opacity < 1 ? `${Math.round(c.opacity * 255).toString(16).padStart(2, '0')}` : ''})`)
      this.stats.shadows = true
    }
    return parts.length ? ` style="filter:${esc(parts.join(' '))}"` : ''
  }
  private d(): string { return this.path.join('') }

  fill(): void { if (!this.path.length) return; this.body.push(`<path d="${this.d()}"${this.paint('fill', this.fillStyle)}${this.matrixAttr(this.pathM)}${this.cssFilter(false)}/>`) }
  stroke(): void {
    if (!this.path.length || this.lineWidth <= 0) return
    this.body.push(`<path d="${this.d()}" fill="none"${this.paint('stroke', this.strokeStyle)} stroke-width="${n(this.lineWidth)}" stroke-linejoin="${this.lineJoin ?? 'miter'}"${this.matrixAttr(this.pathM)}${this.cssFilter(false)}/>`)
  }
  fillRect(x: number, y: number, w: number, h: number): void {
    this.body.push(`<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}"${this.paint('fill', this.fillStyle)}${this.matrixAttr(this.m)}/>`)
  }
  clip(): void {
    if (!this.path.length) return
    const id = `c${++this.ids}`
    this.defs.push(`<clipPath id="${id}"><path d="${this.d()}"${this.matrixAttr(this.pathM)}/></clipPath>`)
    this.body.push(`<g clip-path="url(#${id})">`)
    this.open++
  }

  measureText(text: string): { width: number } { return { width: this.opts.measure(this.font, text, this.letterSpacing) } }
  private textEl(text: string, x: number, y: number, mode: 'fill' | 'stroke'): void {
    const f = /^(italic )?(\d+)\s+([\d.]+)px\s+(.+)$/.exec(this.font)
    const weight = f ? f[2] : '400', size = f ? f[3] : '16', family = f ? f[4] : 'sans-serif'
    this.stats.text = true
    family.split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean).forEach(s => this.stats.fonts.add(s))
    const attrs = mode === 'fill' ? this.paint('fill', this.fillStyle) : ` fill="none"${this.paint('stroke', this.strokeStyle)} stroke-width="${n(this.lineWidth)}" stroke-linejoin="round"`
    const ls = this.letterSpacing && this.letterSpacing !== '0px' && this.letterSpacing !== 'normal' ? ` letter-spacing="${esc(this.letterSpacing)}"` : ''
    this.body.push(`<text x="${n(x)}" y="${n(y)}" font-family="${esc(family)}" font-size="${size}" font-weight="${weight}"${f && f[1] ? ' font-style="italic"' : ''}${ls} dominant-baseline="central" xml:space="preserve"${attrs}${this.matrixAttr(this.m)}${this.cssFilter(false)}>${esc(text)}</text>`)
  }
  fillText(text: string, x: number, y: number): void { this.textEl(text, x, y, 'fill') }
  strokeText(text: string, x: number, y: number): void { this.textEl(text, x, y, 'stroke') }

  drawImage(img: unknown, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void {
    const href = (img as { href?: string } | null)?.href ?? this.opts.imageHref?.(img) ?? null
    const src = img as DrawableImage
    if (!href) { this.stats.imagesSkipped++; return }
    this.stats.images++
    const alpha = this.globalAlpha < 1 ? ` opacity="${n(this.globalAlpha)}"` : ''
    // the transform, opacity and filter sit on a wrapping group: older renderers ignore them on a nested <svg>
    this.body.push(`<g${alpha}${this.matrixAttr(this.m)}${this.cssFilter(true)}><svg x="${n(dx)}" y="${n(dy)}" width="${n(dw)}" height="${n(dh)}" viewBox="${n(sx)} ${n(sy)} ${n(sw)} ${n(sh)}" preserveAspectRatio="none" overflow="hidden"><image width="${n(src.width)}" height="${n(src.height)}" href="${esc(href)}" xlink:href="${esc(href)}"/></svg></g>`)
  }
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): GradientLike {
    const g: Grad = { x0, y0, x1, y1, stops: [], addColorStop(offset, color) { this.stops.push({ offset, color }) } }
    return g
  }

  /** The finished document. `links` become transparent clickable rectangles over the picture. */
  toSvg(width: number, height: number, o: { title?: string; links?: { url: string; x: number; y: number; w: number; h: number }[] } = {}): string {
    while (this.open > 0) { this.body.push('</g>'); this.open-- }
    const links = (o.links ?? []).map(l => `<a href="${esc(l.url)}" xlink:href="${esc(l.url)}" target="_blank"><rect x="${n(l.x * width)}" y="${n(l.y * height)}" width="${n(l.w * width)}" height="${n(l.h * height)}" fill="#ffffff" fill-opacity="0"/></a>`).join('')
    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${o.title ? `<title>${esc(o.title)}</title>` : ''}<defs>${this.defs.join('')}</defs>${this.body.join('')}${links}</svg>\n`
  }
}

// ── whole-slide export ───────────────────────────────────────────────────────────────────────

export interface SvgBackend {
  /** Loads a picture and returns it with its embeddable address (`href`, normally a data: URL). */
  loadImage(url: string): Promise<(DrawableImage & { href?: string }) | null>
  measure(font: string, text: string, letterSpacing: string | undefined): number
}
export interface SvgExportOptions extends ExportOptions { tokens?: BrandTokens }
export interface SvgSlide { svg: string; warnings: string[] }

const walkAll = (els: PostElement[], f: (e: PostElement) => void) => { for (const e of els) { if (!e.visible) continue; f(e); if (e.type === 'group') walkAll(e.children, f) } }

export async function slideToSvg(doc: PostDocument, index: number, backend: SvgBackend, o: SvgExportOptions = {}): Promise<SvgSlide> {
  const { width, height } = exportPixelSize(doc, o.scale)
  const ctx = new SvgContext({ measure: backend.measure })
  let failed = 0
  const loadImage = async (url: string) => { const img = await backend.loadImage(url).catch(() => null); if (!img) failed++; return img }
  await drawSlide(ctx, doc, index, { width, height, resolveUrl: o.resolveUrl, tokens: o.tokens, loadImage })
  const links = pageLinks(doc, index)
  const svg = ctx.toSvg(width, height, { title: `${doc.title} - slide ${index + 1}`, links })
  const w: string[] = []
  const page = doc.pages[index]
  if (ctx.stats.text) w.push(`Slide ${index + 1}: text is kept as editable text, so the fonts (${[...ctx.stats.fonts].filter(f => !/^(sans-serif|serif|monospace|system-ui)$/i.test(f)).slice(0, 4).join(', ') || 'the ones you chose'}) must be installed where the SVG is opened, or another font is substituted.`)
  let adjusted = false
  const check = (e: PostElement) => { if (e.type === 'image' && hasAdjust(e.adjust)) adjusted = true }
  walkAll(page.elements, check)
  if (page.background.kind === 'image' && hasAdjust(page.background.adjust)) adjusted = true
  if (adjusted || ctx.stats.filters) w.push(`Slide ${index + 1}: picture adjustments (brightness, blur and so on) are written as CSS filters. Browsers show them; some vector editors ignore them.`)
  if (ctx.stats.shadows) w.push(`Slide ${index + 1}: text shadows are written as CSS filters. Browsers show them; some vector editors ignore them.`)
  if (failed + ctx.stats.imagesSkipped > 0) w.push(`Slide ${index + 1}: ${failed + ctx.stats.imagesSkipped} picture(s) could not be loaded, so they are missing from the SVG.`)
  if (ctx.stats.images > 0) w.push(`Slide ${index + 1}: ${ctx.stats.images} picture(s) are embedded as pixels, so they do not scale like vector shapes.`)
  if (links.length > 0) w.push(`Slide ${index + 1}: ${links.length} link(s) are clickable when the SVG is opened in a web browser, but not in image viewers or when the SVG is used as a picture.`)
  return { svg, warnings: w }
}

export function svgFileName(doc: PostDocument, index: number, base?: string): string {
  const width = Math.max(2, String(doc.pages.length).length)
  return `${base ? slug(base) : slug(doc.title)}-slide-${String(index + 1).padStart(width, '0')}.svg`
}

export interface SvgExportResult { file: ExportFile; warnings: string[] }

export async function exportSvgSlide(doc: PostDocument, index: number, backend: SvgBackend, o: SvgExportOptions & { fileBase?: string } = {}): Promise<SvgExportResult> {
  if (index < 0 || index >= doc.pages.length) throw new Error(`Slide ${index + 1} does not exist`)
  const s = await slideToSvg(doc, index, backend, o)
  return { file: { name: svgFileName(doc, index, o.fileBase), mime: 'image/svg+xml', bytes: new TextEncoder().encode(s.svg) }, warnings: s.warnings }
}

export async function exportSvgZip(doc: PostDocument, backend: SvgBackend, o: SvgExportOptions & { fileBase?: string } = {}): Promise<SvgExportResult> {
  const idx = (o.indices ?? doc.pages.map((_, i) => i)).filter(i => i >= 0 && i < doc.pages.length)
  const files: ExportFile[] = []
  const warnings: string[] = []
  for (const i of idx) {
    if (o.signal?.aborted) { const e = new Error('Export cancelled'); e.name = 'AbortError'; throw e }
    await new Promise<void>(r => setTimeout(r, 0))
    const r = await exportSvgSlide(doc, i, backend, o)
    files.push(r.file); warnings.push(...r.warnings)
    o.onProgress?.(files.length, idx.length)
  }
  return { file: { name: `${o.fileBase ? slug(o.fileBase) : slug(doc.title)}-slides-svg.zip`, mime: 'application/zip', bytes: buildZip(files.map(f => ({ name: f.name, data: f.bytes })), o.now) }, warnings }
}
