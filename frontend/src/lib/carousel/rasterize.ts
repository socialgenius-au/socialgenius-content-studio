// Carousel Creator — draws one slide of a PostDocument onto a 2D canvas (for PNG / JPEG / PDF export).
//
// It follows the SAME rules as PostRenderer (the on-screen renderer): geometry is canvas-relative (a group's children are relative to the group's box), typography, strokes and
// radii are fractions of the CANVAS's shorter side, paint order is array order, hidden elements are skipped, rotation is about the element's centre. It is written against a
// minimal 2D-context interface so it runs unchanged on a real <canvas> in the browser and on a recording stub in tests.
import { MASK_POLYGONS } from './masks'
import { elementBox } from './geometry'
import { polygonOf } from './shapes'
import { PATTERN_BY_ID, tilePx } from './patterns'
import { canvasFilter, hasAdjust } from './adjust'
import { displayText } from './dynamicText'
import { qrFor, QrError } from './qr'
import type { MotionState } from './animation'
import {
  resolveColor, resolveFont, type Background, type BrandTokens, type Gradient, type ImageElement, type Paint, type PostDocument, type PostElement, type Point, type ShapeElement, type TextElement,
} from '../postDocument'

export interface GradientLike { addColorStop(offset: number, color: string): void }

/** The subset of CanvasRenderingContext2D this module uses. A real context satisfies it. */
export interface Ctx2D {
  fillStyle: unknown
  strokeStyle: unknown
  lineWidth: number
  globalAlpha: number
  font: string
  textBaseline: string
  textAlign: string
  letterSpacing?: string
  save(): void
  restore(): void
  translate(x: number, y: number): void
  scale(x: number, y: number): void
  rotate(rad: number): void
  beginPath(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void
  closePath(): void
  ellipse(x: number, y: number, rx: number, ry: number, rot: number, a0: number, a1: number): void
  rect(x: number, y: number, w: number, h: number): void
  fill(): void
  stroke(): void
  clip(): void
  fillRect(x: number, y: number, w: number, h: number): void
  fillText(text: string, x: number, y: number): void
  strokeText(text: string, x: number, y: number): void
  lineJoin?: string
  lineCap?: string
  shadowColor?: string
  shadowBlur?: number
  shadowOffsetX?: number
  shadowOffsetY?: number
  /** CSS filter string (brightness, blur ...). Not supported by every browser; where it is missing the picture is drawn unadjusted. */
  filter?: string
  measureText(text: string): { width: number }
  drawImage(img: unknown, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): GradientLike
}

export interface DrawableImage { width: number; height: number }

export interface RasterOptions {
  width: number
  height: number
  tokens?: BrandTokens
  /** Resolves a stored URL to a loadable one (applies the current media token). */
  resolveUrl?: (url: string) => string
  /** Loads an image; null if it cannot be loaded. Provided by the caller so tests need no network. */
  loadImage: (url: string) => Promise<DrawableImage | null>
  /** Images already loaded (keyed by stored URL). When given, nothing is loaded again: animated video draws hundreds of frames from one set of pictures. */
  images?: Map<string, DrawableImage | null>
  /** Motion applied on top of an element's static look at this moment (animated video only). Static exports never set it. */
  motion?: (el: PostElement) => MotionState | null
  /** Milliseconds into the slide, for timers and countdowns (animated video). */
  timeMs?: number
  /** When the export started: countdowns run from it. */
  now?: Date
}

// ── geometry helpers (pure; exported for tests) ──────────────────────────────────────────────

/** Greedy word wrap of `content` into lines no wider than `maxWidth` (px). "\n" always breaks. A word wider than the line is split by characters. */
export function wrapText(content: string, maxWidth: number, measure: (s: string) => number, maxLines?: number): string[] {
  const out: string[] = []
  for (const para of content.split('\n')) {
    if (para === '') { out.push(''); continue }
    let line = ''
    for (const word of para.split(/(\s+)/).filter(w => w !== '')) {
      const trial = line + word
      if (line !== '' && measure(trial.trimEnd()) > maxWidth) {
        out.push(line.trimEnd()); line = word.trimStart()
      } else line = trial
      while (measure(line.trimEnd()) > maxWidth && line.trimEnd().length > 1) {        // a single over-long word (a trailing space is not part of the line's width)
        let cut = line.length - 1
        while (cut > 1 && measure(line.slice(0, cut)) > maxWidth) cut--
        out.push(line.slice(0, cut)); line = line.slice(cut)
      }
    }
    out.push(line.trimEnd())
  }
  return maxLines && out.length > maxLines ? out.slice(0, maxLines) : out
}

/** Source and destination rectangles for drawing an image of srcW x srcH into dstW x dstH. cover = fill and crop (focal point decides which part survives); contain = fit and centre. */
export function fitRects(srcW: number, srcH: number, dstW: number, dstH: number, fit: 'cover' | 'contain', focal: Point = { x: 0.5, y: 0.5 }) {
  if (srcW <= 0 || srcH <= 0) return { sx: 0, sy: 0, sw: 0, sh: 0, dx: 0, dy: 0, dw: 0, dh: 0 }
  const scale = fit === 'cover' ? Math.max(dstW / srcW, dstH / srcH) : Math.min(dstW / srcW, dstH / srcH)
  if (fit === 'cover') {
    const sw = dstW / scale
    const sh = dstH / scale
    return { sx: (srcW - sw) * focal.x, sy: (srcH - sh) * focal.y, sw, sh, dx: 0, dy: 0, dw: dstW, dh: dstH }
  }
  const dw = srcW * scale
  const dh = srcH * scale
  return { sx: 0, sy: 0, sw: srcW, sh: srcH, dx: (dstW - dw) / 2, dy: (dstH - dh) / 2, dw, dh }
}

/** CSS gradient angle (0 = to top, 90 = to right) to canvas start/end points covering the box. */
export function gradientLine(angleDeg: number, w: number, h: number) {
  const a = (angleDeg * Math.PI) / 180
  const dx = Math.sin(a)
  const dy = -Math.cos(a)
  const len = Math.abs(w * dx) + Math.abs(h * dy)
  const cx = w / 2
  const cy = h / 2
  return { x0: cx - (dx * len) / 2, y0: cy - (dy * len) / 2, x1: cx + (dx * len) / 2, y1: cy + (dy * len) / 2 }
}

function paintStyle(ctx: Ctx2D, paint: Paint, x: number, y: number, w: number, h: number, tokens?: BrandTokens): unknown {
  if (typeof paint === 'object' && 'kind' in paint) {
    const g = paint as Gradient
    const l = gradientLine(g.angle, w, h)
    const grad = ctx.createLinearGradient(x + l.x0, y + l.y0, x + l.x1, y + l.y1)
    for (const s of g.stops) grad.addColorStop(Math.max(0, Math.min(1, s.offset)), resolveColor(s.color, tokens))
    return grad
  }
  return resolveColor(paint, tokens)
}

function roundedRectPath(ctx: Ctx2D, x: number, y: number, w: number, h: number, radius: number) {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2))
  ctx.beginPath()
  if (r === 0) { ctx.rect(x, y, w, h); return }
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

// ── drawing ──────────────────────────────────────────────────────────────────────────────────

interface Box { x: number; y: number; w: number; h: number }

/** Every image URL a slide needs (backgrounds, image elements, group children), so they can be loaded before the synchronous draw. */
export function collectImageUrls(doc: PostDocument, pageIndex: number): string[] {
  const urls = new Set<string>()
  const page = doc.pages[pageIndex]
  if (page.background.kind === 'image' && page.background.source.kind === 'asset' && page.background.source.url) urls.add(page.background.source.url)
  const walk = (els: PostElement[]) => {
    for (const e of els) {
      if (!e.visible) continue
      if (e.type === 'image' && e.source.kind === 'asset' && e.source.url) urls.add(e.source.url)
      if (e.type === 'group') walk(e.children)
    }
  }
  walk(page.elements)
  return [...urls]
}

/** Draws slide `pageIndex` of `doc` at opts.width x opts.height. The caller supplies the canvas context; nothing here creates DOM. */
export async function drawSlide(ctx: Ctx2D, doc: PostDocument, pageIndex: number, opts: RasterOptions): Promise<void> {
  const page = doc.pages[pageIndex]
  if (!page) throw new Error(`Slide ${pageIndex + 1} does not exist`)
  const W = opts.width
  const H = opts.height
  const S = Math.min(W, H)
  const images = opts.images ?? new Map<string, DrawableImage | null>()
  if (!opts.images) await Promise.all(collectImageUrls(doc, pageIndex).map(async u => { images.set(u, await opts.loadImage(opts.resolveUrl ? opts.resolveUrl(u) : u).catch(() => null)) }))

  // background
  ctx.save()
  const bg = page.background
  if (bg.kind === 'solid') { ctx.fillStyle = resolveColor(bg.color, opts.tokens); ctx.fillRect(0, 0, W, H) }
  else if (bg.kind === 'gradient') { ctx.fillStyle = paintStyle(ctx, bg, 0, 0, W, H, opts.tokens); ctx.fillRect(0, 0, W, H) }
  else if (bg.kind === 'pattern') drawPattern(ctx, bg, W, H, S, opts.tokens)
  else {
    ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, W, H)
    const img = bg.source.kind === 'asset' && bg.source.url ? images.get(bg.source.url) : null
    if (img) {
      const r = fitRects(img.width, img.height, W, H, bg.fit, bg.focal)
      if (hasAdjust(bg.adjust)) ctx.filter = canvasFilter(bg.adjust, S)
      ctx.drawImage(img, r.sx, r.sy, r.sw, r.sh, r.dx, r.dy, r.dw, r.dh)
      if (hasAdjust(bg.adjust)) ctx.filter = 'none'
    }
    if (bg.overlay && bg.overlay.opacity > 0) { ctx.globalAlpha = bg.overlay.opacity; ctx.fillStyle = resolveColor(bg.overlay.color, opts.tokens); ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1 }
  }
  ctx.restore()

  const drawEl = (el: PostElement, parent: Box, motion: MotionState | null = null) => {
    if (!el.visible) return
    const x = parent.x + el.x * parent.w
    const y = parent.y + el.y * parent.h
    const w = el.width * parent.w
    ctx.save()
    ctx.globalAlpha = ctx.globalAlpha * el.opacity * (motion ? Math.max(0, Math.min(1, motion.opacity)) : 1)
    const heightPx = el.height === 'auto' ? 0 : el.height * parent.h
    if (motion && (motion.dx || motion.dy || motion.scale !== 1 || motion.rotation)) {
      const ebox = elementBox(el, doc.format)                    // an automatic-height text box has no stored height: use its estimated one to find the centre
      const mcx = x + w / 2, mcy = y + (el.height === 'auto' ? ebox.h * parent.h : heightPx) / 2
      ctx.translate(motion.dx * W, motion.dy * H)
      ctx.translate(mcx, mcy)
      if (motion.rotation) ctx.rotate((motion.rotation * Math.PI) / 180)
      if (motion.scale !== 1) ctx.scale(motion.scale, motion.scale)
      ctx.translate(-mcx, -mcy)
    }
    if (el.rotation) {
      const cx = x + w / 2
      const cy = y + (el.height === 'auto' ? 0 : heightPx / 2)
      ctx.translate(cx, cy); ctx.rotate((el.rotation * Math.PI) / 180); ctx.translate(-cx, -cy)
    }
    switch (el.type) {
      case 'text': drawText(ctx, el, x, y, w, heightPx, S, opts.tokens, motion?.reveal ?? null, displayText(el, opts.timeMs ?? 0, opts.now)); break
      case 'shape': drawShape(ctx, el, { x, y, w, h: heightPx }, S, opts.tokens); break
      case 'image': drawImageEl(ctx, el, { x, y, w, h: heightPx }, S, images); break
      case 'group': {
        const box: Box = { x, y, w, h: heightPx }
        if (el.clip) { ctx.beginPath(); ctx.rect(x, y, w, heightPx); ctx.clip() }
        for (const c of el.children) drawEl(c, box)
        break
      }
    }
    ctx.restore()
  }
  for (const el of page.elements) drawEl(el, { x: 0, y: 0, w: W, h: H }, opts.motion?.(el) ?? null)
}

function drawText(ctx: Ctx2D, el: Pick<TextElement, 'style' | 'box' | 'autoSize' | 'height' | 'maxLines'> & { content: string }, x: number, y: number, boxW: number, boxH: number, S: number, tokens?: BrandTokens, reveal: number | null = null, text?: string, vMiddle = false) {
  const st = el.style
  const px = st.fontSize * S
  const lh = px * st.lineHeight
  const padX = (el.box?.paddingX ?? 0) * S
  const padY = (el.box?.paddingY ?? 0) * S
  ctx.font = `${st.italic ? 'italic ' : ''}${st.fontWeight} ${px}px ${resolveFont(st.fontFamily, tokens)}`
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  if (st.letterSpacing && 'letterSpacing' in ctx) ctx.letterSpacing = `${st.letterSpacing * S}px`
  const measure = (s: string) => ctx.measureText(s).width
  const maxLines = el.maxLines
  const lines = wrapText(text ?? el.content, Math.max(1, boxW - 2 * padX), measure, maxLines)
  const widest = Math.max(0, ...lines.map(measure))
  const w = el.autoSize === 'auto-width' ? Math.min(boxW, widest + 2 * padX) : boxW
  const h = el.autoSize === 'fixed' || el.height !== 'auto' ? boxH : lines.length * lh + 2 * padY
  const box = el.box
  if (box && (box.fill || box.stroke)) {
    roundedRectPath(ctx, x, y, w, h, (box.radius ?? 0) * S)
    if (box.fill) { ctx.fillStyle = paintStyle(ctx, box.fill, x, y, w, h, tokens); ctx.fill() }
    if (box.stroke && box.stroke.width > 0) { ctx.strokeStyle = resolveColor(box.stroke.color, tokens); ctx.lineWidth = box.stroke.width * S; ctx.stroke() }
  }
  ctx.fillStyle = resolveColor(st.color, tokens)
  // Typewriter: the text is laid out in full (so lines never jump as it grows) and only the first `reveal` fraction of its characters is drawn.
  let remaining = reveal === null ? Infinity : Math.ceil(Math.max(0, Math.min(1, reveal)) * lines.reduce((n, l) => n + l.length, 0))
  const top = vMiddle ? y + (boxH - lines.length * lh) / 2 : y + padY
  lines.forEach((line, i) => {
    const lineW = measure(line)
    const lx = st.align === 'center' ? x + (w - lineW) / 2 : st.align === 'right' ? x + w - padX - lineW : x + padX
    const shown = remaining >= line.length ? line : line.slice(0, Math.max(0, remaining))
    remaining -= line.length
    if (!shown) return
    const ty = top + lh * (i + 0.5)
    if (st.shadow) { ctx.shadowColor = resolveColor(st.shadow.color, tokens); ctx.shadowBlur = st.shadow.blur * S; ctx.shadowOffsetX = st.shadow.offsetX * S; ctx.shadowOffsetY = st.shadow.offsetY * S }
    if (st.stroke && st.stroke.width > 0) {          // outline first, so the fill sits on top (matches the screen: paint-order stroke fill)
      ctx.strokeStyle = resolveColor(st.stroke.color, tokens); ctx.lineWidth = st.stroke.width * S; ctx.lineJoin = 'round'
      ctx.strokeText(shown, lx, ty)
      ctx.shadowColor = 'rgba(0,0,0,0)'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0
      if (st.shadow) { ctx.shadowColor = resolveColor(st.shadow.color, tokens); ctx.shadowBlur = st.shadow.blur * S; ctx.shadowOffsetX = st.shadow.offsetX * S; ctx.shadowOffsetY = st.shadow.offsetY * S }
    }
    ctx.fillText(shown, lx, ty)
    if (st.shadow) { ctx.shadowColor = 'rgba(0,0,0,0)'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0 }
  })
}

function polygonPath(ctx: Ctx2D, pts: [number, number][], b: Box) {
  ctx.beginPath()
  pts.forEach(([px, py], k) => (k === 0 ? ctx.moveTo(b.x + px * b.w, b.y + py * b.h) : ctx.lineTo(b.x + px * b.w, b.y + py * b.h)))
  ctx.closePath()
}

function drawShape(ctx: Ctx2D, el: ShapeElement, b: Box, S: number, tokens?: BrandTokens) {
  const poly = polygonOf(el.shape)
  if (poly) polygonPath(ctx, poly, b)
  else if (el.shape === 'ellipse') { ctx.beginPath(); ctx.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2, 0, 0, Math.PI * 2) }
  else roundedRectPath(ctx, b.x, b.y, b.w, b.h, (el.cornerRadius ?? 0) * S)
  if (el.fill) { ctx.fillStyle = paintStyle(ctx, el.fill, b.x, b.y, b.w, b.h, tokens); ctx.fill() }
  if (el.stroke && el.stroke.width > 0) { ctx.strokeStyle = resolveColor(el.stroke.color, tokens); ctx.lineWidth = el.stroke.width * S; ctx.lineJoin = 'round'; ctx.stroke() }
  if (el.text && el.text.content !== '') {
    const box = { style: { ...el.text.style, align: el.text.style.align }, box: undefined, autoSize: 'fixed' as const, height: 1, maxLines: undefined, content: el.text.content }
    drawText(ctx, box, b.x + b.w * 0.05, b.y, b.w * 0.9, b.h, S, tokens, null, el.text.content, true)
  }
}

function drawPattern(ctx: Ctx2D, bg: Extract<Background, { kind: 'pattern' }>, W: number, H: number, S: number, tokens?: BrandTokens) {
  const def = PATTERN_BY_ID[bg.pattern]
  const back = resolveColor(bg.background, tokens), fg = resolveColor(bg.color, tokens)
  ctx.fillStyle = back; ctx.fillRect(0, 0, W, H)
  if (!def) return
  const size = tilePx(def, bg.scale, S)
  const k = size / def.tile.w
  ctx.fillStyle = fg; ctx.strokeStyle = fg
  for (let ty = 0; ty * size < H + size; ty++) for (let tx = 0; tx * size < W + size; tx++) {
    const ox = tx * size, oy = ty * size
    for (const it of def.tile.items) {
      if (it.t === 'rect') ctx.fillRect(ox + it.x * k, oy + it.y * k, it.w * k, it.h * k)
      else if (it.t === 'circle') { ctx.beginPath(); ctx.ellipse(ox + it.cx * k, oy + it.cy * k, it.r * k, it.r * k, 0, 0, Math.PI * 2); ctx.fill() }
      else { ctx.lineWidth = it.w * k; ctx.beginPath(); ctx.moveTo(ox + it.x1 * k, oy + it.y1 * k); ctx.lineTo(ox + it.x2 * k, oy + it.y2 * k); ctx.stroke() }
    }
  }
}

function drawImageEl(ctx: Ctx2D, el: ImageElement, b: Box, S: number, images: Map<string, DrawableImage | null>) {
  const clipToMask = () => {
    const poly = el.mask ? MASK_POLYGONS[el.mask] : undefined
    if (poly) polygonPath(ctx, poly, b)
    else if (el.mask === 'circle') { ctx.beginPath(); ctx.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2, 0, 0, Math.PI * 2) }
    else roundedRectPath(ctx, b.x, b.y, b.w, b.h, (el.mask === 'rounded' && !el.cornerRadius ? 0.04 : el.cornerRadius ?? 0) * S)
    ctx.clip()
  }
  if (el.source.kind === 'qr') {                                   // a QR code is generated, never loaded
    const q = qrFor(el.source.data)
    if (q instanceof QrError) return
    ctx.save(); clipToMask()
    const n = q.size + 4
    const cell = Math.min(b.w, b.h) / n
    const ox = b.x + (b.w - cell * n) / 2, oy = b.y + (b.h - cell * n) / 2
    ctx.fillStyle = el.source.bg ?? '#FFFFFF'; ctx.fillRect(ox, oy, cell * n, cell * n)
    ctx.fillStyle = el.source.fg ?? '#000000'
    q.modules.forEach((row, y) => { let x = 0; while (x < q.size) { if (row[x]) { let end = x; while (end < q.size && row[end]) end++; ctx.fillRect(ox + (x + 2) * cell, oy + (y + 2) * cell, (end - x) * cell, cell); x = end } else x++ } })
    ctx.restore()
    return
  }
  // Only real images are exported: an empty placeholder is a slot for the user's picture and must not appear in the finished slide (see exportWarnings).
  const url = el.source.kind === 'asset' ? el.source.url : undefined
  const img = url ? images.get(url) : null
  if (!img) return
  ctx.save()
  clipToMask()
  const t = el.trim
  if (t && (t.top || t.right || t.bottom || t.left)) { ctx.beginPath(); ctx.rect(b.x + t.left * b.w, b.y + t.top * b.h, b.w * (1 - t.left - t.right), b.h * (1 - t.top - t.bottom)); ctx.clip() }
  if (el.flipX || el.flipY) { const cx = b.x + b.w / 2, cy = b.y + b.h / 2; ctx.translate(cx, cy); ctx.scale(el.flipX ? -1 : 1, el.flipY ? -1 : 1); ctx.translate(-cx, -cy) }
  const r = fitRects(img.width, img.height, b.w, b.h, el.fit, el.focal)
  const zoom = el.fit === 'cover' && el.zoom && el.zoom > 1 ? el.zoom : 1
  if (zoom > 1) {            // zoom about the focal point of the frame, exactly like the on-screen transform-origin
    const ox = b.x + (el.focal?.x ?? 0.5) * b.w
    const oy = b.y + (el.focal?.y ?? 0.5) * b.h
    ctx.translate(ox, oy); ctx.scale(zoom, zoom); ctx.translate(-ox, -oy)
  }
  if (hasAdjust(el.adjust)) ctx.filter = canvasFilter(el.adjust, S)
  ctx.drawImage(img, r.sx, r.sy, r.sw, r.sh, b.x + r.dx, b.y + r.dy, r.dw, r.dh)
  if (hasAdjust(el.adjust)) ctx.filter = 'none'
  ctx.restore()
}
