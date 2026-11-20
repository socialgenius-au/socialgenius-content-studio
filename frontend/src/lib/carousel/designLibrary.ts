// Carousel Creator - the built-in design library (colours, gradients, patterns, shapes) and factories for information elements (dates, countdowns, location, address, map, QR codes).
import type { Background, DocumentFormat, DynamicKind, ImageElement, PostElement, ShapeElement, TextElement } from '../postDocument'
import { defaultDynamic } from './dynamicText'
import type { CarouselTheme } from './layouts'
import { makeImage, makeShape, makeText, type OpContext } from './ops'
import { PATTERNS, type PatternId } from './patterns'
import { SHAPE_BY_ID } from './shapes'

export const SOLID_PRESETS = ['#FFFFFF', '#F7F3E8', '#E5E7EB', '#111827', '#1E4D2B', '#0F766E', '#1D4ED8', '#7C3AED', '#BE185D', '#DC2626', '#EA580C', '#F59E0B', '#10B981', '#38BDF8']

export interface GradientPreset { id: string; label: string; angle: number; from: string; to: string }
export const GRADIENT_PRESETS: GradientPreset[] = [
  { id: 'sunset', label: 'Sunset', angle: 160, from: '#F97316', to: '#BE185D' }, { id: 'ocean', label: 'Ocean', angle: 160, from: '#38BDF8', to: '#1D4ED8' }, { id: 'forest', label: 'Forest', angle: 160, from: '#34D399', to: '#14532D' },
  { id: 'berry', label: 'Berry', angle: 135, from: '#C026D3', to: '#4C1D95' }, { id: 'gold', label: 'Gold', angle: 135, from: '#FDE68A', to: '#D97706' }, { id: 'night', label: 'Night', angle: 180, from: '#1E293B', to: '#020617' },
  { id: 'peach', label: 'Peach', angle: 135, from: '#FFE8D1', to: '#FDA4AF' }, { id: 'mint', label: 'Mint', angle: 135, from: '#ECFDF5', to: '#5EEAD4' }, { id: 'ember', label: 'Ember', angle: 200, from: '#FACC15', to: '#DC2626' },
  { id: 'slate', label: 'Slate', angle: 160, from: '#64748B', to: '#0F172A' }, { id: 'sky', label: 'Sky', angle: 180, from: '#E0F2FE', to: '#7DD3FC' }, { id: 'rose', label: 'Rose', angle: 135, from: '#FFE4E6', to: '#FB7185' },
]
export const gradientBackground = (g: GradientPreset): Background => ({ kind: 'gradient', angle: g.angle, stops: [{ offset: 0, color: g.from }, { offset: 1, color: g.to }] })

/** A pattern background in colours that suit the carousel's theme (a faint foreground tint over the theme's background). */
export function patternBackground(pattern: PatternId, theme: Pick<CarouselTheme, 'background' | 'foreground'>, scale = 1): Background {
  const texture = PATTERNS.find(p => p.id === pattern)?.category === 'Texture'
  return { kind: 'pattern', pattern, color: `${theme.foreground}${texture ? '26' : '33'}`, background: theme.background, scale }
}

// ── shapes ───────────────────────────────────────────────────────────────────────────────────

/** A new shape of `kind`, sized sensibly for its form (lines and arrows are wide and thin) and coloured from the theme. */
export function newShape(kind: string, format: DocumentFormat, theme: Pick<CarouselTheme, 'accent'>, ctx?: OpContext): ShapeElement {
  const aspect = format.width / format.height
  const wide = kind === 'line' || kind.startsWith('line-arrow') || kind === 'arrow-double'
  const arrow = kind.startsWith('arrow-') || kind === 'chevron'
  const width = wide ? 0.5 : arrow ? 0.34 : 0.3
  const height = kind === 'line' ? 0.01 : wide ? 0.07 : arrow ? 0.16 * 0.9 : Math.min(0.9, 0.3 * aspect)
  const label = SHAPE_BY_ID[kind]?.label ?? (kind === 'ellipse' ? 'Ellipse' : kind === 'line' ? 'Line' : 'Rectangle')
  return makeShape({ shape: kind as ShapeElement['shape'], name: label, x: 0.5 - width / 2, y: 0.5 - height / 2, width, height, fill: theme.accent, cornerRadius: kind === 'rect' ? 0.02 : undefined }, ctx)
}

// ── information elements ─────────────────────────────────────────────────────────────────────

const labelStyle = (theme: Pick<CarouselTheme, 'foreground' | 'fontFamily'>, size = 0.05, weight = 700) => ({ fontFamily: theme.fontFamily, fontSize: size, fontWeight: weight, lineHeight: 1.2, align: 'left' as const, color: theme.foreground })

export const DYNAMIC_NAMES: Record<DynamicKind, string> = { date: 'Date', time: 'Time', datetime: 'Date and time', countdown: 'Countdown', timer: 'Timer' }

export function newDynamicText(kind: DynamicKind, format: DocumentFormat, theme: Pick<CarouselTheme, 'foreground' | 'fontFamily'>, ctx?: OpContext, now?: Date): TextElement {
  const dyn = defaultDynamic(kind, now)
  return makeText(format, { role: 'other', name: DYNAMIC_NAMES[kind], content: DYNAMIC_NAMES[kind], dynamic: dyn, y: 0.42, style: labelStyle(theme, kind === 'timer' || kind === 'countdown' ? 0.09 : 0.055, 800), autoSize: 'auto-height' }, ctx)
}

export const mapsLinkFor = (address: string): string => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address.replace(/\s*\n\s*/g, ', ').trim())}`

export function newLocationText(format: DocumentFormat, theme: Pick<CarouselTheme, 'foreground' | 'fontFamily'>, ctx?: OpContext): TextElement {
  return makeText(format, { role: 'other', name: 'Location', content: 'Venue name, Suburb', y: 0.62, style: labelStyle(theme, 0.05, 700), autoSize: 'auto-height' }, ctx)
}

export function newAddressText(format: DocumentFormat, theme: Pick<CarouselTheme, 'foreground' | 'fontFamily'>, ctx?: OpContext): TextElement {
  const content = '123 Example Street\nSuburb NSW 2000'
  return makeText(format, { role: 'other', name: 'Address', content, y: 0.7, style: labelStyle(theme, 0.04, 500), autoSize: 'auto-height', link: { url: mapsLinkFor(content), label: 'Open in maps' } }, ctx)
}

/** An empty picture slot for a map. No map service is called: upload a screenshot or exported map image and it fills the slot. */
export function newMapImage(ctx?: OpContext): ImageElement {
  return makeImage({ role: 'product_image', name: 'Map image', x: 0.08, y: 0.45, width: 0.84, height: 0.4, source: { kind: 'placeholder', label: 'Add a map image (upload a screenshot)', glyph: 'none' }, alt: 'Map' }, ctx)
}

export function newQr(data: string, ctx?: OpContext): ImageElement {
  return makeImage({ role: 'other', name: 'QR code', x: 0.3, y: 0.45, width: 0.4, height: 0.32, fit: 'contain', lockAspect: true, source: { kind: 'qr', data, fg: '#111111', bg: '#FFFFFF' }, alt: `QR code for ${data}`, link: { url: data } } as Partial<ImageElement>, ctx)
}

export type { PostElement }
