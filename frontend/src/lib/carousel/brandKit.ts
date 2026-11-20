// Carousel Creator - Brand Kits.
//
// A Brand Kit is an account-owned set of brand names, colours, logos, custom fonts and reusable pictures (stored by the server, see backend/app/routers/brand_kits.py). It reaches a carousel in
// two ways, both of which leave the person's own edits alone:
//   1. TOKENS. The kit is turned into brand tokens (brand.primary, brand.background, brand.font.heading ...). Document colours and fonts that are written as a token + literal fallback resolve
//      against the kit when drawn (on screen and in every export), and fall back to their literal value if the kit is missing. Changing the kit therefore restyles every carousel that uses it.
//   2. APPLY. "Apply to this carousel" rewrites ONLY the colours and fonts that still hold the carousel theme's own untouched values into tokens. A colour or font the person chose
//      themselves is never touched. It is safe to apply more than once, and to apply a different kit later.
// Logos and brand names are ordinary elements (image / text), so they can be moved, resized, layered, grouped and deleted like any other.
import type { BrandTokens, ColorRef, FontRef, GradientStop, ImageElement, Paint, PostDocument, PostElement, PostPage, TextElement } from '../postDocument'
import { makeImage, makeText, type OpContext } from './ops'
import type { CarouselTheme } from './layouts'

export interface KitName { id: string; label: string; text: string }
export interface KitLogo { id: string; label: string; asset_id: number; url: string }
export interface KitAsset { id: string; label: string; asset_id: number; url: string }
export interface KitFont { id: string; family: string; asset_id: number; url: string; weight: number; italic: boolean }
export interface KitColors { primary?: string; secondary?: string; accent?: string; background?: string; text?: string; extra?: { name: string; hex: string }[] }

export interface BrandKitData {
  brand_names: KitName[]
  colors: KitColors
  logos: KitLogo[]
  fonts: KitFont[]
  font_roles: { heading?: string; body?: string }
  assets: KitAsset[]
}

export interface BrandKit { id: number; name: string; kit: BrandKitData }
export interface BrandKitSummary { id: number; name: string; primary: string | null; logoCount: number; fontCount: number; updatedAt: string }

export const emptyKit = (): BrandKitData => ({ brand_names: [], colors: {}, logos: [], fonts: [], font_roles: {}, assets: [] })

// ── colour helpers ───────────────────────────────────────────────────────────────────────────

const norm = (hex: string): string => {
  const h = hex.trim().toUpperCase()
  return /^#[0-9A-F]{3}$/.test(h) ? `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}` : h
}
const rgb = (hex: string): [number, number, number] => { const h = norm(hex); return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)] }
const toHex = (c: [number, number, number]) => `#${c.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('').toUpperCase()}`

/** `amount` of `b` mixed into `a` (0 = a, 1 = b). */
export function mixHex(a: string, b: string, amount: number): string {
  const x = rgb(a), y = rgb(b)
  return toHex([x[0] + (y[0] - x[0]) * amount, x[1] + (y[1] - x[1]) * amount, x[2] + (y[2] - x[2]) * amount])
}

/** Relative luminance (WCAG). */
export function luminance(hex: string): number {
  const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
  const [r, g, b] = rgb(hex)
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}


export function contrastRatio(a: string, b: string): number {
  const la = luminance(a), lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** Black or white, whichever reads better on `background`. */
export const readableOn = (background: string): string => (contrastRatio(background, '#111111') >= contrastRatio(background, '#FFFFFF') ? '#111111' : '#FFFFFF')

// ── tokens ───────────────────────────────────────────────────────────────────────────────────

export const BRAND = {
  background: 'brand.background', text: 'brand.text', muted: 'brand.muted', accent: 'brand.accent', onAccent: 'brand.onAccent', primary: 'brand.primary', secondary: 'brand.secondary',
  fontHeading: 'brand.font.heading', fontBody: 'brand.font.body',
} as const

const quote = (family: string) => (/^[A-Za-z0-9_-]+$/.test(family) ? family : `"${family.replace(/"/g, '')}"`)

/** The kit as render tokens. Anything the kit does not define falls back to the carousel theme, so a partial kit never produces a half-styled slide. */
export function kitTokens(kit: BrandKitData, theme: CarouselTheme): BrandTokens {
  const c = kit.colors
  const background = c.background ?? theme.background
  const text = c.text ?? theme.foreground
  const accent = c.accent ?? c.primary ?? c.secondary ?? theme.accent
  const customMuted = c.text || c.background
  const t: BrandTokens = {
    [BRAND.background]: norm(background),
    [BRAND.text]: norm(text),
    [BRAND.muted]: customMuted ? mixHex(text, background, 0.4) : theme.muted,
    [BRAND.accent]: norm(accent),
    [BRAND.onAccent]: c.accent || c.primary || c.secondary ? readableOn(accent) : theme.onAccent,
    [BRAND.primary]: norm(c.primary ?? accent),
    [BRAND.secondary]: norm(c.secondary ?? c.primary ?? accent),
  }
  const heading = kit.font_roles.heading
  const body = kit.font_roles.body
  t[BRAND.fontHeading] = heading ? `${quote(heading)}, ${theme.fontFamily}` : theme.fontFamily
  t[BRAND.fontBody] = body ? `${quote(body)}, ${theme.fontFamily}` : theme.fontFamily
  return t
}

/** The colours a person can pick from in the editor, each as a token with a literal fallback so it follows the kit. */
export function kitSwatches(kit: BrandKitData): { label: string; ref: ColorRef; hex: string }[] {
  const out: { label: string; ref: ColorRef; hex: string }[] = []
  const add = (label: string, key: keyof KitColors, token: string) => { const v = kit.colors[key]; if (typeof v === 'string' && v) out.push({ label, ref: { token, fallback: norm(v) }, hex: norm(v) }) }
  add('Primary', 'primary', BRAND.primary); add('Secondary', 'secondary', BRAND.secondary); add('Accent', 'accent', BRAND.accent); add('Background', 'background', BRAND.background); add('Text', 'text', BRAND.text)
  for (const e of kit.colors.extra ?? []) out.push({ label: e.name, ref: norm(e.hex), hex: norm(e.hex) })
  return out
}

// ── apply to a carousel (never overwrites a person's own colours or fonts) ───────────────────

export interface ApplyReport { recoloured: number; refonted: number; kept: number }

export function applyBrandKit(doc: PostDocument, kit: BrandKit, theme: CarouselTheme, now: () => Date = () => new Date()): { doc: PostDocument; report: ApplyReport } {
  const report: ApplyReport = { recoloured: 0, refonted: 0, kept: 0 }
  const themeColours: Record<string, string> = {
    [norm(theme.background)]: BRAND.background, [norm(theme.foreground)]: BRAND.text, [norm(theme.muted)]: BRAND.muted, [norm(theme.accent)]: BRAND.accent, [norm(theme.onAccent)]: BRAND.onAccent,
  }

  const colour = (c: ColorRef): ColorRef => {
    if (typeof c !== 'string') return c                                       // already a token: leave it
    const token = themeColours[norm(c)]
    if (!token) { report.kept++; return c }                                   // the person's own colour: untouched
    report.recoloured++
    return { token, fallback: norm(c) }
  }
  const paint = (p: Paint): Paint => {
    if (typeof p === 'object' && 'kind' in p) return { ...p, stops: p.stops.map((s): GradientStop => ({ ...s, color: colour(s.color) })) }
    return colour(p)
  }
  const font = (f: FontRef, weight: number): FontRef => {
    if (typeof f !== 'string' || f !== theme.fontFamily) return f
    report.refonted++
    return { token: weight >= 700 ? BRAND.fontHeading : BRAND.fontBody, fallback: theme.fontFamily }
  }

  const el = (e: PostElement): PostElement => {
    switch (e.type) {
      case 'text': return { ...e, style: { ...e.style, color: colour(e.style.color), fontFamily: font(e.style.fontFamily, e.style.fontWeight) },
        box: e.box ? { ...e.box, fill: e.box.fill ? paint(e.box.fill) : undefined, stroke: e.box.stroke ? { ...e.box.stroke, color: colour(e.box.stroke.color) } : undefined } : undefined } as TextElement
      case 'shape': return { ...e, fill: e.fill ? paint(e.fill) : undefined, stroke: e.stroke ? { ...e.stroke, color: colour(e.stroke.color) } : undefined }
      case 'group': return { ...e, children: e.children.map(el) }
      default: return e
    }
  }
  const page = (p: PostPage): PostPage => ({
    ...p,
    background: p.background.kind === 'solid' ? { ...p.background, color: colour(p.background.color) } : p.background.kind === 'gradient' ? (paint(p.background) as typeof p.background) : p.background,
    elements: p.elements.map(el),
  })
  const pages = doc.pages.map(page)
  const next: PostDocument = {
    ...doc, pages, revision: doc.revision + 1, updatedAt: now().toISOString(),
    context: { ...doc.context, brand: { ...doc.context.brand, brandKitId: String(kit.id) } },
  }
  return { doc: next, report }
}

/** Detaches the document from its kit. Colours and fonts that were tokens keep resolving to their literal fallbacks, so nothing changes visually. */
export function detachBrandKit(doc: PostDocument, now: () => Date = () => new Date()): PostDocument {
  const { brandKitId: _gone, ...brand } = doc.context.brand ?? {}
  void _gone
  return { ...doc, revision: doc.revision + 1, updatedAt: now().toISOString(), context: { ...doc.context, brand: Object.keys(brand).length ? brand : undefined } }
}

export const kitIdOf = (doc: PostDocument): number | null => { const v = doc.context.brand?.brandKitId; const n = v === undefined ? NaN : Number(v); return Number.isInteger(n) && n > 0 ? n : null }

// ── logos and brand names as ordinary canvas elements ────────────────────────────────────────

export function makeBrandLogo(logo: KitLogo, over: Partial<ImageElement> = {}, ctx?: OpContext): ImageElement {
  return makeImage({
    role: 'brand_logo', name: `Logo - ${logo.label}`.slice(0, 80), source: { kind: 'asset', assetId: logo.asset_id, url: logo.url }, fit: 'contain', lockAspect: true, alt: `${logo.label} logo`,
    x: 0.06, y: 0.05, width: 0.24, height: 0.1, ...over,
  }, ctx)
}

export function makeBrandName(name: KitName, format: PostDocument['format'], theme: CarouselTheme, over: Partial<TextElement> = {}, ctx?: OpContext): TextElement {
  return makeText(format, {
    role: 'other', name: `Brand - ${name.label}`.slice(0, 80), content: name.text, x: 0.06, y: 0.06, width: 0.5, autoSize: 'auto-height',
    style: { fontFamily: { token: BRAND.fontHeading, fallback: theme.fontFamily }, fontSize: 0.032, fontWeight: 800, lineHeight: 1.1, letterSpacing: 0.002, align: 'left', color: { token: BRAND.text, fallback: theme.foreground } },
    ...over,
  }, ctx)
}

// ── custom fonts ─────────────────────────────────────────────────────────────────────────────

/** A stored upload URL as a loadable one: the API serves /uploads from its own address, which is not the page's address when the app and the API are hosted separately. */
export const absoluteUploadUrl = (url: string, base: string = (import.meta.env?.VITE_API_URL as string | undefined) ?? ''): string => (url.startsWith('/') && !url.startsWith('//') ? `${base.replace(/\/$/, '')}${url}` : url)

export interface FontFaceSpec { family: string; url: string; weight: number; italic: boolean }
export const fontFaceSpecs = (kit: BrandKitData): FontFaceSpec[] => kit.fonts.map(f => ({ family: f.family, url: f.url, weight: f.weight, italic: f.italic }))

/** Every family a kit offers for text: its custom fonts, by name. */
export const kitFontFamilies = (kit: BrandKitData): string[] => [...new Set(kit.fonts.map(f => f.family))]

/** Loads a kit's custom fonts into the page (so text drawn on screen AND exported to canvas uses them). Resolves with the families that loaded; a font that fails is skipped, never fatal. */
export async function loadKitFonts(kit: BrandKitData, resolveUrl: (u: string) => string = u => u, fonts: { add(f: unknown): void } | undefined = typeof document !== 'undefined' ? document.fonts : undefined,
  FontFaceCtor: (new (family: string, source: string, descriptors?: Record<string, string>) => { load(): Promise<unknown> }) | undefined = typeof FontFace !== 'undefined' ? (FontFace as never) : undefined): Promise<string[]> {
  if (!fonts || !FontFaceCtor) return []
  const loaded: string[] = []
  await Promise.all(fontFaceSpecs(kit).map(async s => {
    try {
      const face = new FontFaceCtor(s.family, `url(${JSON.stringify(resolveUrl(absoluteUploadUrl(s.url)))})`, { weight: String(s.weight), style: s.italic ? 'italic' : 'normal' })
      await face.load()
      fonts.add(face)
      loaded.push(s.family)
    } catch { /* a font that cannot be loaded falls back to the next one in the stack */ }
  }))
  return loaded
}

export const walkTop = (doc: PostDocument): PostElement[] => doc.pages.flatMap(p => p.elements)
