// Carousel Creator - canvas formats: presets for every platform in the shared registry, orientation (portrait / landscape / square), custom sizes, and resizing a design to another format
// while keeping every layer editable. Export size is separate: a document stores its format once and any export scales it (see exporter.ts), independent of the editor's preview size.
import { MAX_CUSTOM_SIZE, MIN_CUSTOM_SIZE, PLATFORM_FORMATS, findPlacement, ratioLabelFor } from '../platformFormats'
import type { DocumentFormat, PostDocument, PostElement, PostPage, TextStyle } from '../postDocument'
import { touch, type OpContext } from './ops'

export type Orientation = 'portrait' | 'landscape' | 'square'
export const orientationOf = (width: number, height: number): Orientation => (Math.abs(width - height) / Math.max(width, height) < 0.02 ? 'square' : width > height ? 'landscape' : 'portrait')

export interface FormatOption { platformKey: string; formatKey: string; platformLabel: string; label: string; width: number; height: number; ratio: string; orientation: Orientation }

/** Every platform placement in the registry (Instagram, Facebook, LinkedIn, TikTok, YouTube, Pinterest, X, Google Business, website ...), except the free "Custom" slot. */
export function allFormatOptions(): FormatOption[] {
  return PLATFORM_FORMATS.flatMap(p => p.placements.filter(pl => pl.ratio !== 'CUSTOM').map(pl => ({
    platformKey: p.key, formatKey: pl.key, platformLabel: p.label, label: pl.label, width: pl.width, height: pl.height, ratio: pl.ratio, orientation: orientationOf(pl.width, pl.height),
  })))
}

export const CUSTOM_FORMAT = { platformKey: 'website', formatKey: 'custom' } as const
export const isCustomFormat = (f: Pick<DocumentFormat, 'platformKey' | 'formatKey'>) => f.platformKey === CUSTOM_FORMAT.platformKey && f.formatKey === CUSTOM_FORMAT.formatKey

export type CustomSizeCheck = { ok: true; width: number; height: number } | { ok: false; error: string }
export function checkCustomSize(width: number, height: number): CustomSizeCheck {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width !== Math.round(width) || height !== Math.round(height)) return { ok: false, error: 'Width and height must be whole numbers of pixels.' }
  if (width < MIN_CUSTOM_SIZE || height < MIN_CUSTOM_SIZE || width > MAX_CUSTOM_SIZE || height > MAX_CUSTOM_SIZE) return { ok: false, error: `Width and height must each be between ${MIN_CUSTOM_SIZE} and ${MAX_CUSTOM_SIZE} pixels.` }
  return { ok: true, width, height }
}

export const customFormat = (width: number, height: number): DocumentFormat => ({ ...CUSTOM_FORMAT, width, height, ratio: ratioLabelFor(width, height) })

export function formatFor(platformKey: string, formatKey: string): DocumentFormat | null {
  const p = findPlacement(platformKey, formatKey)
  return p && p.ratio !== 'CUSTOM' ? { platformKey, formatKey, width: p.width, height: p.height, ratio: p.ratio } : null
}

// ── resizing ─────────────────────────────────────────────────────────────────────────────────

/**
 * 'relative' keeps every element at the same FRACTION of the canvas, so the layout stretches or squeezes with it (text keeps its size relative to the shorter side).
 * 'fit' keeps the whole design at its original proportions: it is scaled to the largest size that fits the new canvas and centred, with the background filling the rest; text scales with it.
 */
export type ResizeMode = 'relative' | 'fit'

const scaleStyle = (s: TextStyle, f: number): TextStyle => ({
  ...s, fontSize: s.fontSize * f, letterSpacing: s.letterSpacing === undefined ? undefined : s.letterSpacing * f,
  stroke: s.stroke ? { ...s.stroke, width: s.stroke.width * f } : undefined,
  shadow: s.shadow ? { ...s.shadow, blur: s.shadow.blur * f, offsetX: s.shadow.offsetX * f, offsetY: s.shadow.offsetY * f } : undefined,
})

function scaleTypographic(e: PostElement, f: number): PostElement {
  switch (e.type) {
    case 'text': return { ...e, style: scaleStyle(e.style, f), box: e.box ? { ...e.box, radius: e.box.radius === undefined ? undefined : e.box.radius * f, paddingX: e.box.paddingX === undefined ? undefined : e.box.paddingX * f, paddingY: e.box.paddingY === undefined ? undefined : e.box.paddingY * f, stroke: e.box.stroke ? { ...e.box.stroke, width: e.box.stroke.width * f } : undefined } : undefined }
    case 'shape': return { ...e, cornerRadius: e.cornerRadius === undefined ? undefined : e.cornerRadius * f, stroke: e.stroke ? { ...e.stroke, width: e.stroke.width * f } : undefined, text: e.text ? { ...e.text, style: scaleStyle(e.text.style, f) } : undefined }
    case 'image': return { ...e, cornerRadius: e.cornerRadius === undefined ? undefined : e.cornerRadius * f }
    case 'group': return { ...e, children: e.children.map(c => scaleTypographic(c, f)) }
  }
}

const clampUnit = (n: number) => Math.min(1, Math.max(0, n))

export function resizeDocument(doc: PostDocument, to: DocumentFormat, mode: ResizeMode, ctx?: OpContext): PostDocument {
  const { width: w0, height: h0 } = doc.format
  const k = Math.min(to.width / w0, to.height / h0)
  const cw = (w0 * k) / to.width, ch = (h0 * k) / to.height
  const ox = (1 - cw) / 2, oy = (1 - ch) / 2
  const f = (Math.min(w0, h0) * k) / Math.min(to.width, to.height)
  const place = (e: PostElement): PostElement => {
    const t = mode === 'fit' ? scaleTypographic(e, f) : e
    if (mode !== 'fit') return t
    const height = t.height === 'auto' ? 'auto' as const : Math.min(1, t.height * ch)
    const width = Math.min(1, t.width * cw)
    return { ...t, x: clampUnit(ox + t.x * cw), y: clampUnit(oy + t.y * ch), width, height } as PostElement
  }
  const pages: PostPage[] = doc.pages.map(p => ({ ...p, elements: p.elements.map(place) }))
  return touch({ ...doc, format: to, pages }, ctx)
}

/** The new format, if it differs from the current one. */
export const sameFormat = (a: DocumentFormat, b: DocumentFormat) => a.width === b.width && a.height === b.height && a.platformKey === b.platformKey && a.formatKey === b.formatKey
