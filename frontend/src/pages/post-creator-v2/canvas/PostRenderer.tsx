// PostRenderer draws a PostDocument's first page. It contains NO creative content: every string, colour, size and position comes from the
// document. Geometry is canvas-relative (percentages of the canvas box); typography, strokes and radii are fractions of the canvas's shorter
// side, rendered with container-query units (cqmin) of the enclosing canvas box, which must be a size container (see PostCanvas and the CSS).
//
// Creative colours come only from the document (literal hex, or brand token -> fallback). Nothing here reads the SocialGenius UI theme,
// so Light/Dark mode cannot change a design.
import type { CSSProperties, ReactNode } from 'react'
import { Sparkles } from 'lucide-react'
import {
  primaryPage, resolveColor, resolveFont,
  type Background, type BrandTokens, type Gradient, type ImageElement, type Paint, type PostDocument, type PostElement, type ShapeElement, type TextElement,
} from '../../../lib/postDocument'
import { maskClipPath } from '../../../lib/carousel/masks'

/** Rounded so floating-point noise (7.000000000000001) never reaches the DOM. */
const r4 = (n: number) => Math.round(n * 1e4) / 1e4
const pct = (n: number) => `${r4(n * 100)}%`
/** A shorter-side fraction as a container-query length. */
const u = (n: number) => `${r4(n * 100)}cqmin`

function gradientCss(g: Gradient, tokens?: BrandTokens): string {
  return `linear-gradient(${g.angle}deg, ${g.stops.map(s => `${resolveColor(s.color, tokens)} ${r4(s.offset * 100)}%`).join(', ')})`
}

/** A paint as a CSS background value. */
function paintCss(p: Paint, tokens?: BrandTokens): string {
  return typeof p === 'object' && 'kind' in p ? gradientCss(p, tokens) : resolveColor(p, tokens)
}

/** Maps a stored media URL to the one to display (adds the current short-lived media token). Identity by default. */
export type ResolveUrl = (url: string) => string
const identity: ResolveUrl = u => u

function backgroundStyle(bg: Background, tokens?: BrandTokens, resolve: ResolveUrl = identity): CSSProperties {
  if (bg.kind === 'solid') return { background: resolveColor(bg.color, tokens) }
  if (bg.kind === 'gradient') return { background: gradientCss(bg, tokens) }
  if (bg.source.kind === 'asset' && bg.source.url) {
    return { backgroundImage: `url(${resolve(bg.source.url)})`, backgroundSize: bg.fit, backgroundPosition: `${(bg.focal?.x ?? 0.5) * 100}% ${(bg.focal?.y ?? 0.5) * 100}%`, backgroundRepeat: 'no-repeat' }
  }
  return { background: '#808080' }   // image background without a resolvable source: neutral fill
}

/** Position, size, opacity and rotation shared by every element type. All canvas-relative. */
function frameStyle(el: PostElement): CSSProperties {
  return {
    position: 'absolute',
    left: pct(el.x), top: pct(el.y), width: pct(el.width),
    height: el.height === 'auto' ? undefined : pct(el.height),
    opacity: el.opacity,
    transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
    boxSizing: 'border-box',
  }
}

function attrs(el: PostElement) {
  return {
    'data-element-id': el.id,
    'data-role': el.role,
    'data-type': el.type,
    'data-locked': el.locked ? 'true' : undefined,
  } as const
}

function renderText(el: TextElement, tokens?: BrandTokens): ReactNode {
  const { style, box } = el
  const css: CSSProperties = {
    ...frameStyle(el),
    fontFamily: resolveFont(style.fontFamily, tokens),
    fontSize: u(style.fontSize),
    fontWeight: style.fontWeight,
    fontStyle: style.italic ? 'italic' : undefined,
    lineHeight: style.lineHeight,
    letterSpacing: style.letterSpacing ? u(style.letterSpacing) : undefined,
    textAlign: style.align,
    color: resolveColor(style.color, tokens),
    whiteSpace: el.maxLines === 1 ? 'nowrap' : 'pre-wrap',
    overflowWrap: 'break-word',
    margin: 0,
  }
  if (el.autoSize === 'auto-width') { css.width = 'fit-content'; css.maxWidth = pct(el.width) }
  if (box) {
    if (box.fill) css.background = paintCss(box.fill, tokens)
    if (box.radius !== undefined) css.borderRadius = u(box.radius)
    if (box.stroke) css.border = `${u(box.stroke.width)} solid ${resolveColor(box.stroke.color, tokens)}`
    if (box.paddingX !== undefined || box.paddingY !== undefined) css.padding = `${u(box.paddingY ?? 0)} ${u(box.paddingX ?? 0)}`
  }
  return <div key={el.id} {...attrs(el)} style={css}>{el.content}</div>
}

function renderImage(el: ImageElement, resolve: ResolveUrl = identity): ReactNode {
  const css: CSSProperties = { ...frameStyle(el), borderRadius: el.cornerRadius ? u(el.cornerRadius) : undefined, overflow: 'hidden' }
  if (el.mask === 'circle') css.borderRadius = '50%'
  else if (el.mask === 'rounded' && !el.cornerRadius) css.borderRadius = u(0.04)
  const clip = maskClipPath(el.mask)
  if (clip) css.clipPath = clip
  const src = el.source
  let inner: ReactNode = null
  if (src.kind === 'asset' && src.url) {
    const zoom = el.fit === 'cover' && el.zoom && el.zoom > 1 ? el.zoom : 1
    const fx = (el.focal?.x ?? 0.5) * 100
    const fy = (el.focal?.y ?? 0.5) * 100
    inner = <img src={resolve(src.url)} alt={el.alt ?? ''} draggable={false} style={{ width: '100%', height: '100%', objectFit: el.fit, objectPosition: `${fx}% ${fy}%`, display: 'block', transform: zoom > 1 ? `scale(${zoom})` : undefined, transformOrigin: `${fx}% ${fy}%` }} />
  } else if (src.kind === 'placeholder' || src.kind === 'brand') {
    // No real image yet: a wordmark placeholder sized from the element's own box (never stretched; the content keeps its own proportions).
    const label = src.kind === 'placeholder' ? src.label : 'LOGO'
    const glyph = src.kind === 'placeholder' ? src.glyph : undefined
    const h = typeof el.height === 'number' ? el.height : 0.05
    const isSlot = src.kind === 'placeholder' && (el.role === 'hero_image' || el.role === 'product_image')
    if (isSlot) {
      // A picture slot (not a logo wordmark): a soft panel with a dashed outline and a small centred label, so an empty carousel slide reads as "put an image here".
      css.display = 'flex'; css.alignItems = 'center'; css.justifyContent = 'center'
      css.background = 'rgba(255,255,255,0.10)'
      css.border = '0.4cqmin dashed rgba(255,255,255,0.55)'
      css.fontSize = '2.6cqmin'; css.fontWeight = 600; css.color = 'rgba(255,255,255,0.85)'; css.lineHeight = 1.2; css.textAlign = 'center'
      return <div key={el.id} {...attrs(el)} role={el.alt ? 'img' : undefined} aria-label={el.alt} style={css}><span>{label}</span></div>
    }
    css.display = 'flex'
    css.alignItems = 'center'
    css.justifyContent = 'flex-start'
    css.gap = '0.5em'
    css.fontSize = `${r4(h * 0.76 * 100)}cqh`     // text height follows the element's own box height (cqh = 1% of the canvas height)
    css.fontWeight = 800
    css.letterSpacing = '0.03em'
    css.whiteSpace = 'nowrap'
    css.color = '#FFFFFF'
    css.lineHeight = 1
    inner = (
      <>
        {glyph === 'sparkles' && <Sparkles size="1.25em" aria-hidden />}
        <span>{label}</span>
      </>
    )
  }
  return <div key={el.id} {...attrs(el)} role={el.alt ? 'img' : undefined} aria-label={el.alt} style={css}>{inner}</div>
}

function renderShape(el: ShapeElement, tokens?: BrandTokens): ReactNode {
  const css: CSSProperties = { ...frameStyle(el) }
  if (el.fill) css.background = paintCss(el.fill, tokens)
  if (el.stroke) css.border = `${u(el.stroke.width)} solid ${resolveColor(el.stroke.color, tokens)}`
  if (el.shape === 'ellipse') css.borderRadius = '50%'
  else if (el.cornerRadius) css.borderRadius = u(el.cornerRadius)
  return <div key={el.id} {...attrs(el)} style={css} />
}

function renderElement(el: PostElement, tokens?: BrandTokens, resolve: ResolveUrl = identity): ReactNode {
  if (!el.visible) return null        // hidden elements stay in the data (a Layers panel will list them) but are not painted
  switch (el.type) {
    case 'text': return renderText(el, tokens)
    case 'image': return renderImage(el, resolve)
    case 'shape': return renderShape(el, tokens)
    case 'group':
      return (
        <div key={el.id} {...attrs(el)} style={{ ...frameStyle(el), overflow: el.clip ? 'hidden' : undefined }}>
          {el.children.map(c => renderElement(c, tokens, resolve))}
        </div>
      )
  }
}

/** Draws one page of the document (by default pages[0]; a carousel passes the slide to show), filling its (positioned, size-container) parent. */
export default function PostRenderer({ document: doc, brandTokens, pageId, resolveUrl }: { document: PostDocument; brandTokens?: BrandTokens; pageId?: string; resolveUrl?: ResolveUrl }) {
  const page = (pageId && doc.pages.find(p => p.id === pageId)) || primaryPage(doc)
  return (
    <div
      data-testid="pcv2-post-page"
      data-document-id={doc.id}
      data-page-id={page.id}
      data-page-count={doc.pages.length}
      style={{ position: 'absolute', inset: 0, overflow: 'hidden', ...backgroundStyle(page.background, brandTokens, resolveUrl) }}
    >
      {/* Array order IS paint order: later siblings paint on top. */}
      {page.elements.map(el => renderElement(el, brandTokens, resolveUrl))}
    </div>
  )
}
