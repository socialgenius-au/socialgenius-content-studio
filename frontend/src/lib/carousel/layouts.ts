// Carousel Creator — slide layouts and colour themes, expressed as plain PostElements.
//
// Layouts are DATA generators, not components: each builds the elements of one slide for the document's own canvas, using the same rules as the rest of the Post Document
// (x/width fractions of the canvas width, y/height fractions of the canvas height, typography/radii as fractions of the shorter side). Because the numbers are derived from
// the format, the same layout works for 4:5, 1:1, 9:16 or any registry format. Nothing here is creative content for a particular client: copy is clearly-marked sample text.
import type { Background, DocumentFormat, PostElement } from '../postDocument'
import { makeImage, makeShape, makeText, type OpContext } from './ops'

export interface CarouselTheme {
  id: string
  label: string
  background: string
  foreground: string
  muted: string
  accent: string
  onAccent: string
  fontFamily: string
}

const SANS = 'Inter, ui-sans-serif, system-ui, sans-serif'
const DISPLAY = 'Montserrat, Inter, ui-sans-serif, system-ui, sans-serif'

export const CAROUSEL_THEMES: CarouselTheme[] = [
  { id: 'forest', label: 'Forest', background: '#1E4D2B', foreground: '#F7F3E8', muted: '#C9D6C5', accent: '#E8B04A', onAccent: '#1E2A1B', fontFamily: DISPLAY },
  { id: 'ivory', label: 'Ivory', background: '#F7F3E8', foreground: '#1B2A1F', muted: '#5C6B5F', accent: '#1E8A55', onAccent: '#FFFFFF', fontFamily: DISPLAY },
  { id: 'ink', label: 'Ink', background: '#111827', foreground: '#F9FAFB', muted: '#9CA3AF', accent: '#38BDF8', onAccent: '#0B1220', fontFamily: SANS },
  { id: 'sunrise', label: 'Sunrise', background: '#FFE8D1', foreground: '#3A1F0F', muted: '#7A4B2E', accent: '#E4572E', onAccent: '#FFFFFF', fontFamily: DISPLAY },
]

export const DEFAULT_THEME_ID = 'forest'
export const themeById = (id: string | undefined): CarouselTheme => CAROUSEL_THEMES.find(t => t.id === id) ?? CAROUSEL_THEMES[0]

export type LayoutId = 'cover' | 'title_body' | 'statement' | 'list' | 'image_caption' | 'quote' | 'cta'

export interface LayoutDef {
  id: LayoutId
  label: string
  description: string
  /** Suggested purpose when planning from a Deconstructor blueprint. */
  purpose: 'opening' | 'explain' | 'proof' | 'steps' | 'closing'
}

export const LAYOUTS: LayoutDef[] = [
  { id: 'cover', label: 'Cover', description: 'Big hook headline with a swipe prompt', purpose: 'opening' },
  { id: 'title_body', label: 'Title + text', description: 'Headline with a paragraph of explanation', purpose: 'explain' },
  { id: 'statement', label: 'Big statement', description: 'One strong line, centred', purpose: 'explain' },
  { id: 'list', label: 'List', description: 'Headline with three short points', purpose: 'steps' },
  { id: 'image_caption', label: 'Image + caption', description: 'Hero image with headline and caption', purpose: 'proof' },
  { id: 'quote', label: 'Quote', description: 'Pull quote with attribution', purpose: 'proof' },
  { id: 'cta', label: 'Call to action', description: 'Closing slide with a button-style action', purpose: 'closing' },
]

export interface LayoutContent {
  headline?: string
  body?: string
  items?: string[]
  caption?: string
  cta?: string
  kicker?: string
}

export interface BuiltLayout { background: Background; elements: PostElement[] }

const r5 = (n: number) => Math.round(n * 1e5) / 1e5

/** Canvas size in shorter-side units, so layouts can be written once in the units typography uses. */
function units(format: DocumentFormat) {
  const s = Math.min(format.width, format.height)
  const cw = format.width / s
  const ch = format.height / s
  return { s, cw, ch, X: (u: number) => r5(u / cw), Y: (u: number) => r5(u / ch) }
}

const SAMPLE: Record<LayoutId, LayoutContent> = {
  cover: { kicker: 'SWIPE THROUGH', headline: 'Your big idea in one bold line', body: 'A short promise that makes people swipe', cta: 'Swipe →' },
  title_body: { headline: 'Make the point clearly', body: 'Explain the idea in two or three short sentences. Keep one idea per slide so every swipe has a reason.' },
  statement: { headline: 'One strong line that people remember' },
  list: { headline: 'Three things to know', items: ['First key point', 'Second key point', 'Third key point'] },
  image_caption: { headline: 'Show it, then say it', caption: 'A caption that adds context to the picture above.' },
  quote: { body: 'A short line from a customer or expert that proves the point.', caption: '— Name, role' },
  cta: { headline: 'Ready to take the next step?', body: 'Say exactly what to do and why it is worth it.', cta: 'Get in touch' },
}

// ── text fitting ─────────────────────────────────────────────────────────────────────────────
//
// Layout cannot measure fonts (it is pure data), so it ESTIMATES how many lines a text takes from its length, size and weight, shrinks long text to a readable minimum, and stacks the
// elements below it by the estimated height. A real measurement happens at draw time (PostRenderer / the rasterizer); the estimate only has to be close enough that nothing overlaps.

/** Average glyph width as a multiple of the font size (wider for heavy weights). Slightly generous so the estimate errs on the side of more lines. */
const avgEm = (weight: number) => (weight >= 700 ? 0.6 : weight >= 600 ? 0.56 : 0.52)

/** Estimated number of wrapped lines for `text` at `size` (shorter-side fraction) inside `widthUnits` (shorter-side units). */
export function estimateLines(text: string, size: number, weight: number, widthUnits: number): number {
  const perLine = Math.max(1, Math.floor(widthUnits / (size * avgEm(weight))))
  let lines = 0
  for (const para of text.split('\n')) lines += Math.max(1, Math.ceil((para.length * 1.06) / perLine))
  return lines
}

/** The largest size from `max` down to `min` at which the text fits in `maxLines`. */
export function fitSize(text: string, weight: number, widthUnits: number, max: number, min: number, maxLines: number): number {
  for (let s = max; s >= min - 1e-9; s -= 0.003) if (estimateLines(text, s, weight, widthUnits) <= maxLines) return r5(s)
  return min
}

/** Estimated painted height (shorter-side units) of a text block. */
export const blockHeight = (text: string, size: number, weight: number, lineHeight: number, widthUnits: number) => estimateLines(text, size, weight, widthUnits) * size * lineHeight

/** Short call-to-action labels read best: collapse "a/b/c" into "a / b / c" so a long label can wrap at its separators instead of mid-word. */
export const ctaLabel = (s: string) => s.replace(/\s*\/\s*/g, ' / ').replace(/\s+/g, ' ').trim()

/** Builds a layout for `format` in `theme`. Any field of `content` that is missing falls back to clearly-marked sample copy. Long copy shrinks to a readable minimum and later elements move down with it. */
export function buildLayout(layoutId: LayoutId, format: DocumentFormat, theme: CarouselTheme, content: LayoutContent = {}, ctx?: OpContext): BuiltLayout {
  const { X, Y, ch, cw } = units(format)
  const c = { ...SAMPLE[layoutId], ...Object.fromEntries(Object.entries(content).filter(([, v]) => v !== undefined && v !== '')) } as LayoutContent
  const PAD = 0.075
  const innerW = r5(1 - 2 * X(PAD))
  const innerU = cw - 2 * PAD                        // inner width in shorter-side units
  const bg: Background = { kind: 'solid', color: theme.background }
  const H = (size: number, over = {}) => ({ fontFamily: theme.fontFamily, fontSize: size, fontWeight: 800, lineHeight: 1.1, align: 'left' as const, color: theme.foreground, ...over })
  const T = (el: Parameters<typeof makeText>[1]) => makeText(format, el, ctx)
  const bottom = ch - 0.12                            // keep clear of the bottom edge / platform UI
  const bar = (x: number, y: number, w = 0.14) => makeShape({ name: 'Accent bar', x: X(x), y: Y(y), width: X(w), height: Y(0.012), fill: theme.accent, role: 'decorative' }, ctx)
  /** Body copy sized to the room left between `top` and `limit` (default: the bottom margin). */
  const bodySize = (text: string, weight: number, lh: number, top: number, max: number, min: number, limit = bottom) => {
    for (let s = max; s >= min - 1e-9; s -= 0.002) if (top + blockHeight(text, s, weight, lh, innerU) <= limit) return r5(s)
    return min
  }

  switch (layoutId) {
    case 'cover': {
      const hs = fitSize(c.headline!, 800, innerU, 0.1, 0.05, 5)
      const y0 = 0.3
      const hEnd = y0 + blockHeight(c.headline!, hs, 800, 1.1, innerU)
      const subTop = hEnd + 0.05
      const ss = bodySize(c.body!, 500, 1.25, subTop, 0.04, 0.026, ch - 0.17 - 0.05)      // stay clear of the swipe chip
      return { background: bg, elements: [
        bar(PAD, 0.12, 0.16),
        T({ name: 'Kicker', role: 'secondary_headline', x: X(PAD), y: Y(0.15), width: innerW, content: c.kicker!, style: { ...H(0.03, { fontWeight: 700, color: theme.accent }), letterSpacing: 0.004 } as never }),
        T({ name: 'Headline', role: 'primary_headline', x: X(PAD), y: Y(y0), width: innerW, content: c.headline!, style: H(hs) as never }),
        T({ name: 'Subtitle', role: 'supporting_text', x: X(PAD), y: Y(subTop), width: r5(innerW * 0.92), content: c.body!, style: H(ss, { fontWeight: 500, lineHeight: 1.25, color: theme.muted }) as never }),
        T({ name: 'Swipe prompt', role: 'secondary_cta', x: X(PAD), y: Y(ch - 0.17), width: X(0.4), autoSize: 'auto-width', content: c.cta!, style: H(0.032, { fontWeight: 700, color: theme.onAccent }) as never, box: { fill: theme.accent, radius: 0.05, paddingX: 0.04, paddingY: 0.02 } }),
      ] }
    }
    case 'title_body': {
      const hs = fitSize(c.headline!, 800, innerU, 0.075, 0.042, 4)
      const hEnd = 0.17 + blockHeight(c.headline!, hs, 800, 1.1, innerU)
      const bTop = hEnd + 0.06
      const bs = bodySize(c.body!, 500, 1.35, bTop, 0.042, 0.026)
      return { background: bg, elements: [
        bar(PAD, 0.12, 0.12),
        T({ name: 'Headline', role: 'primary_headline', x: X(PAD), y: Y(0.17), width: innerW, content: c.headline!, style: H(hs) as never }),
        T({ name: 'Body', role: 'body_text', x: X(PAD), y: Y(bTop), width: innerW, content: c.body!, style: H(bs, { fontWeight: 500, lineHeight: 1.35, color: theme.muted }) as never }),
      ] }
    }
    case 'statement': {
      const hs = fitSize(c.headline!, 800, innerU, 0.085, 0.045, 7)
      const hH = blockHeight(c.headline!, hs, 800, 1.1, innerU)
      const y0 = Math.max(0.22, (ch - hH) / 2)
      return { background: bg, elements: [
        bar(0.5 * cw - 0.07, y0 - 0.1),
        T({ name: 'Statement', role: 'primary_headline', x: X(PAD), y: Y(y0), width: innerW, content: c.headline!, style: H(hs, { align: 'center' }) as never }),
      ] }
    }
    case 'list': {
      const items = (c.items && c.items.length ? c.items : SAMPLE.list.items!).slice(0, 5)
      const hs = fitSize(c.headline!, 800, innerU, 0.07, 0.042, 3)
      const hEnd = 0.14 + blockHeight(c.headline!, hs, 800, 1.1, innerU)
      const text = items.map((t, i) => `${i + 1}  ${t}`).join('\n\n')
      const ps = bodySize(text, 600, 1.3, hEnd + 0.07, 0.045, 0.026)
      return { background: bg, elements: [
        T({ name: 'Headline', role: 'primary_headline', x: X(PAD), y: Y(0.14), width: innerW, content: c.headline!, style: H(hs) as never }),
        T({ name: 'Points', role: 'body_text', x: X(PAD), y: Y(hEnd + 0.07), width: innerW, content: text, style: H(ps, { fontWeight: 600, lineHeight: 1.3 }) as never }),
      ] }
    }
    case 'image_caption': {
      const imgH = ch * 0.46
      const top = PAD + imgH + 0.05
      const hs = fitSize(c.headline!, 800, innerU, 0.06, 0.038, 3)
      const hEnd = top + blockHeight(c.headline!, hs, 800, 1.1, innerU)
      const cs = bodySize(c.caption!, 500, 1.3, hEnd + 0.03, 0.036, 0.024)
      return { background: bg, elements: [
        makeImage({ name: 'Hero image', role: 'hero_image', x: X(PAD), y: Y(PAD), width: innerW, height: Y(imgH), cornerRadius: 0.03 }, ctx),
        T({ name: 'Headline', role: 'primary_headline', x: X(PAD), y: Y(top), width: innerW, content: c.headline!, style: H(hs) as never }),
        T({ name: 'Caption', role: 'supporting_text', x: X(PAD), y: Y(hEnd + 0.03), width: innerW, content: c.caption!, style: H(cs, { fontWeight: 500, lineHeight: 1.3, color: theme.muted }) as never }),
      ] }
    }
    case 'quote': {
      const qTop = 0.32
      const qs = bodySize(c.body!, 700, 1.25, qTop + 0.1, 0.058, 0.03)        // the room left below the quote mark, leaving space for the attribution
      const qEnd = qTop + blockHeight(c.body!, qs, 700, 1.25, innerU)
      return { background: bg, elements: [
        T({ name: 'Quote mark', role: 'decorative', x: X(PAD), y: Y(0.1), width: X(0.3), content: '“', style: H(0.24, { color: theme.accent, lineHeight: 1 }) as never }),
        T({ name: 'Quote', role: 'proof_point', x: X(PAD), y: Y(qTop), width: innerW, content: c.body!, style: H(qs, { fontWeight: 700, lineHeight: 1.25 }) as never }),
        T({ name: 'Attribution', role: 'supporting_text', x: X(PAD), y: Y(qEnd + 0.05), width: innerW, content: c.caption!, style: H(0.034, { fontWeight: 600, color: theme.muted }) as never }),
      ] }
    }
    case 'cta': {
      const label = ctaLabel(c.cta!)
      const hs = fitSize(c.headline!, 800, innerU, 0.082, 0.045, 5)
      const y0 = 0.22
      const hEnd = y0 + blockHeight(c.headline!, hs, 800, 1.1, innerU)
      const ctaSize = fitSize(label, 700, innerU - 0.1, 0.04, 0.026, 2)
      const ctaH = blockHeight(label, ctaSize, 700, 1.1, innerU - 0.1) + 0.05
      const ts = bodySize(c.body!, 500, 1.3, hEnd + 0.05, 0.04, 0.026, ch - 0.1 - ctaH - 0.05)     // stay clear of the button
      return { background: bg, elements: [
        T({ name: 'Headline', role: 'primary_headline', x: X(PAD), y: Y(y0), width: innerW, content: c.headline!, style: H(hs) as never }),
        T({ name: 'Supporting text', role: 'supporting_text', x: X(PAD), y: Y(hEnd + 0.05), width: innerW, content: c.body!, style: H(ts, { fontWeight: 500, lineHeight: 1.3, color: theme.muted }) as never }),
        T({ name: 'Call to action', role: 'primary_cta', x: X(PAD), y: Y(ch - 0.1 - ctaH), width: innerW, autoSize: 'auto-width', content: label, style: H(ctaSize, { fontWeight: 700, lineHeight: 1.1, color: theme.onAccent }) as never, box: { fill: theme.accent, radius: 0.03, paddingX: 0.05, paddingY: 0.025 } }),
      ] }
    }
  }
}
