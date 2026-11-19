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

/** Builds a layout for `format` in `theme`. Any field of `content` that is missing falls back to clearly-marked sample copy. */
export function buildLayout(layoutId: LayoutId, format: DocumentFormat, theme: CarouselTheme, content: LayoutContent = {}, ctx?: OpContext): BuiltLayout {
  const { X, Y, ch, cw } = units(format)
  const c = { ...SAMPLE[layoutId], ...Object.fromEntries(Object.entries(content).filter(([, v]) => v !== undefined && v !== '')) } as LayoutContent
  const PAD = 0.075
  const innerW = r5(1 - 2 * X(PAD))
  const bg: Background = { kind: 'solid', color: theme.background }
  const H = (size: number, over = {}) => ({ fontFamily: theme.fontFamily, fontSize: size, fontWeight: 800, lineHeight: 1.1, align: 'left' as const, color: theme.foreground, ...over })
  const T = (el: Parameters<typeof makeText>[1]) => makeText(format, el, ctx)

  switch (layoutId) {
    case 'cover': {
      const els: PostElement[] = [
        makeShape({ name: 'Accent bar', x: X(PAD), y: Y(0.12), width: X(0.16), height: Y(0.012), fill: theme.accent, role: 'decorative' }, ctx),
        T({ name: 'Kicker', role: 'secondary_headline', x: X(PAD), y: Y(0.15), width: innerW, content: c.kicker!, style: { ...H(0.03, { fontWeight: 700, color: theme.accent }), letterSpacing: 0.004 } as never }),
        T({ name: 'Headline', role: 'primary_headline', x: X(PAD), y: Y(ch * 0.34), width: innerW, content: c.headline!, style: H(0.1) as never }),
        T({ name: 'Subtitle', role: 'supporting_text', x: X(PAD), y: Y(ch * 0.34 + 0.46), width: X(cw * 0.8), content: c.body!, style: H(0.04, { fontWeight: 500, lineHeight: 1.25, color: theme.muted }) as never }),
        T({
          name: 'Swipe prompt', role: 'secondary_cta', x: X(PAD), y: Y(ch - 0.17), width: X(0.4), autoSize: 'auto-width', content: c.cta!,
          style: H(0.032, { fontWeight: 700, color: theme.onAccent }) as never, box: { fill: theme.accent, radius: 0.05, paddingX: 0.04, paddingY: 0.02 },
        }),
      ]
      return { background: bg, elements: els }
    }
    case 'title_body':
      return { background: bg, elements: [
        makeShape({ name: 'Accent bar', x: X(PAD), y: Y(0.12), width: X(0.12), height: Y(0.012), fill: theme.accent }, ctx),
        T({ name: 'Headline', role: 'primary_headline', x: X(PAD), y: Y(0.17), width: innerW, content: c.headline!, style: H(0.075) as never }),
        T({ name: 'Body', role: 'body_text', x: X(PAD), y: Y(0.17 + 0.075 * 1.1 * 2 + 0.07), width: innerW, content: c.body!, style: H(0.042, { fontWeight: 500, lineHeight: 1.35, color: theme.muted }) as never }),
      ] }
    case 'statement':
      return { background: bg, elements: [
        T({ name: 'Statement', role: 'primary_headline', x: X(PAD), y: Y(ch * 0.32), width: innerW, content: c.headline!, style: H(0.085, { align: 'center' }) as never }),
        makeShape({ name: 'Accent bar', x: r5(0.5 - X(0.07)), y: Y(ch * 0.32 - 0.1), width: X(0.14), height: Y(0.012), fill: theme.accent }, ctx),
      ] }
    case 'list': {
      const items = (c.items && c.items.length ? c.items : SAMPLE.list.items!).slice(0, 5)
      return { background: bg, elements: [
        T({ name: 'Headline', role: 'primary_headline', x: X(PAD), y: Y(0.14), width: innerW, content: c.headline!, style: H(0.07) as never }),
        T({ name: 'Points', role: 'body_text', x: X(PAD), y: Y(0.14 + 0.07 * 1.1 * 2 + 0.08), width: innerW, content: items.map((t, i) => `${i + 1}  ${t}`).join('\n\n'), style: H(0.045, { fontWeight: 600, lineHeight: 1.3 }) as never }),
      ] }
    }
    case 'image_caption':
      return { background: bg, elements: [
        makeImage({ name: 'Hero image', role: 'hero_image', x: X(PAD), y: Y(PAD), width: innerW, height: Y(ch * 0.52), cornerRadius: 0.03 }, ctx),
        T({ name: 'Headline', role: 'primary_headline', x: X(PAD), y: Y(PAD + ch * 0.52 + 0.06), width: innerW, content: c.headline!, style: H(0.06) as never }),
        T({ name: 'Caption', role: 'supporting_text', x: X(PAD), y: Y(PAD + ch * 0.52 + 0.06 + 0.06 * 1.1 * 2 + 0.04), width: innerW, content: c.caption!, style: H(0.036, { fontWeight: 500, lineHeight: 1.3, color: theme.muted }) as never }),
      ] }
    case 'quote':
      return { background: bg, elements: [
        T({ name: 'Quote mark', role: 'decorative', x: X(PAD), y: Y(0.1), width: X(0.3), content: '“', style: H(0.24, { color: theme.accent, lineHeight: 1 }) as never }),
        T({ name: 'Quote', role: 'proof_point', x: X(PAD), y: Y(ch * 0.3), width: innerW, content: c.body!, style: H(0.058, { fontWeight: 700, lineHeight: 1.25 }) as never }),
        T({ name: 'Attribution', role: 'supporting_text', x: X(PAD), y: Y(ch * 0.3 + 0.58), width: innerW, content: c.caption!, style: H(0.034, { fontWeight: 600, color: theme.muted }) as never }),
      ] }
    case 'cta':
      return { background: bg, elements: [
        T({ name: 'Headline', role: 'primary_headline', x: X(PAD), y: Y(ch * 0.26), width: innerW, content: c.headline!, style: H(0.082) as never }),
        T({ name: 'Supporting text', role: 'supporting_text', x: X(PAD), y: Y(ch * 0.26 + 0.082 * 1.1 * 3 + 0.05), width: innerW, content: c.body!, style: H(0.04, { fontWeight: 500, lineHeight: 1.3, color: theme.muted }) as never }),
        T({
          name: 'Call to action', role: 'primary_cta', x: X(PAD), y: Y(ch - 0.24), width: X(0.6), autoSize: 'auto-width', content: c.cta!,
          style: H(0.04, { fontWeight: 700, color: theme.onAccent }) as never, box: { fill: theme.accent, radius: 0.03, paddingX: 0.05, paddingY: 0.026 },
        }),
      ] }
  }
}
