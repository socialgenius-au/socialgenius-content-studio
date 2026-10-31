// Shared Platform & Format Registry — pure helpers (no React, no DOM).
import { DEFAULT_FORMAT_KEY, DEFAULT_PLATFORM_KEY, PLATFORM_FORMATS } from './registry'
import type { FormatSelection, MediaType, Placement, PlatformGroup, ResolvedCanvas } from './types'

/** Media types a still-image / post creation tool works with. */
export const POST_MEDIA_TYPES: MediaType[] = ['image', 'carousel']

export const MIN_CUSTOM_SIZE = 100
export const MAX_CUSTOM_SIZE = 4096

const asList = (m: MediaType | MediaType[]): MediaType[] => (Array.isArray(m) ? m : [m])

/** Fits a width/height ratio inside a bounding box without ever stretching it (letterbox-to-fit). Identical maths to Video Studio V2. */
export function fitCanvasBox(width: number, height: number, maxW: number, maxH: number): { w: number; h: number } {
  const ratio = width / height
  let w = maxW
  let h = w / ratio
  if (h > maxH) {
    h = maxH
    w = h * ratio
  }
  return { w: Math.round(w), h: Math.round(h) }
}

export const findPlatform = (platformKey: string): PlatformGroup | undefined => PLATFORM_FORMATS.find(p => p.key === platformKey)

export const findPlacement = (platformKey: string, formatKey: string): Placement | undefined =>
  findPlatform(platformKey)?.placements.find(pl => pl.key === formatKey)

/** First placement of a platform (Video Studio's convention). */
export const defaultPlacementForPlatform = (platformKey: string): Placement | undefined => findPlatform(platformKey)?.placements[0]

/** Placements of one platform that can carry ANY of the given media types, in registry order. */
export function placementsFor(platformKey: string, mediaTypes: MediaType | MediaType[]): Placement[] {
  const wanted = asList(mediaTypes)
  return findPlatform(platformKey)?.placements.filter(pl => pl.mediaTypes.some(m => wanted.includes(m))) ?? []
}

/** Platforms that have at least one placement for the media types; each returned group only lists its applicable placements. */
export function platformsFor(mediaTypes: MediaType | MediaType[]): PlatformGroup[] {
  return PLATFORM_FORMATS
    .map(p => ({ ...p, placements: placementsFor(p.key, mediaTypes) }))
    .filter(p => p.placements.length > 0)
}

/** Label to show for a placement in a post/image context (falls back to the Video Studio label). */
export const postLabel = (pl: Placement): string => pl.postLabel ?? pl.label

/** The format a post tool should select first for a platform (explicit default if applicable, else the first applicable placement). */
export function defaultFormatKeyFor(platformKey: string, mediaTypes: MediaType | MediaType[]): string | undefined {
  const applicable = placementsFor(platformKey, mediaTypes)
  const preferred = findPlatform(platformKey)?.defaultPostFormatKey
  return applicable.find(pl => pl.key === preferred)?.key ?? applicable[0]?.key
}

/** Legacy `/studio` `Platform` key -> the registry placement it corresponds to. */
export function findByLegacyKey(legacyKey: string): { platformKey: string; placement: Placement } | undefined {
  for (const p of PLATFORM_FORMATS) {
    const placement = p.placements.find(pl => pl.legacyAliases?.includes(legacyKey))
    if (placement) return { platformKey: p.key, placement }
  }
  return undefined
}

// ── custom size + ratio text ─────────────────────────────────────────────────────────────────

const clampInt = (n: number) => Math.min(MAX_CUSTOM_SIZE, Math.max(MIN_CUSTOM_SIZE, Math.round(Number.isFinite(n) ? n : MIN_CUSTOM_SIZE)))
export const sanitizeCustomSize = (s: { width: number; height: number }) => ({ width: clampInt(s.width), height: clampInt(s.height) })

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))

/** "4:5" style text for any size. Uses the reduced ratio (e.g. 1200×900 -> "4:3"); large reduced terms fall back to one-decimal ("1.5:1"). */
export function ratioLabelFor(width: number, height: number): string {
  const g = gcd(Math.round(width), Math.round(height))
  const a = Math.round(width) / g, b = Math.round(height) / g
  if (a <= 32 && b <= 32) return `${a}:${b}`
  const r = width / height
  return r >= 1 ? `${Math.round(r * 10) / 10}:1` : `1:${Math.round((1 / r) * 10) / 10}`
}

// ── selection ────────────────────────────────────────────────────────────────────────────────

export const defaultSelection = (mediaTypes: MediaType | MediaType[] = POST_MEDIA_TYPES): FormatSelection => {
  const formatKey = defaultFormatKeyFor(DEFAULT_PLATFORM_KEY, mediaTypes) ?? DEFAULT_FORMAT_KEY
  const custom = findPlacement('website', 'custom')
  return { platformKey: DEFAULT_PLATFORM_KEY, formatKey, customSize: { width: custom?.width ?? 1080, height: custom?.height ?? 1080 } }
}

/** Is this (platform, format) an applicable choice for the media types? */
export const isApplicable = (platformKey: string, formatKey: string, mediaTypes: MediaType | MediaType[]) =>
  placementsFor(platformKey, mediaTypes).some(pl => pl.key === formatKey)

/** Returns a valid selection: an inapplicable/unknown platform or format is repaired to the nearest sensible default, never left dangling. */
export function normalizeSelection(sel: FormatSelection, mediaTypes: MediaType | MediaType[] = POST_MEDIA_TYPES): FormatSelection {
  const customSize = sanitizeCustomSize(sel.customSize)
  const platformKey = platformsFor(mediaTypes).some(p => p.key === sel.platformKey) ? sel.platformKey : DEFAULT_PLATFORM_KEY
  const formatKey = isApplicable(platformKey, sel.formatKey, mediaTypes) ? sel.formatKey : defaultFormatKeyFor(platformKey, mediaTypes) ?? DEFAULT_FORMAT_KEY
  return { platformKey, formatKey, customSize }
}

/**
 * Change platform. Keeps the current format when the new platform has one with the same key, else one with the same ratio (so a 4:5 design
 * stays 4:5 across Instagram -> Facebook), else the platform's default post format.
 */
export function selectPlatform(sel: FormatSelection, platformKey: string, mediaTypes: MediaType | MediaType[] = POST_MEDIA_TYPES): FormatSelection {
  if (!platformsFor(mediaTypes).some(p => p.key === platformKey)) return normalizeSelection(sel, mediaTypes)
  if (platformKey === sel.platformKey) return normalizeSelection(sel, mediaTypes)
  const applicable = placementsFor(platformKey, mediaTypes)
  const current = findPlacement(sel.platformKey, sel.formatKey)
  const sameKey = applicable.find(pl => pl.key === sel.formatKey && pl.ratio === current?.ratio)
  const sameRatio = current && current.ratio !== 'CUSTOM' ? applicable.find(pl => pl.ratio === current.ratio) : undefined
  const formatKey = sameKey?.key ?? sameRatio?.key ?? defaultFormatKeyFor(platformKey, mediaTypes) ?? applicable[0].key
  return { ...sel, platformKey, formatKey }
}

export function selectFormat(sel: FormatSelection, formatKey: string, mediaTypes: MediaType | MediaType[] = POST_MEDIA_TYPES): FormatSelection {
  return isApplicable(sel.platformKey, formatKey, mediaTypes) ? { ...sel, formatKey } : normalizeSelection(sel, mediaTypes)
}

export const setCustomSize = (sel: FormatSelection, size: { width: number; height: number }): FormatSelection => ({ ...sel, customSize: sanitizeCustomSize(size) })

/** Concrete canvas for a selection (uses `customSize` for CUSTOM placements). undefined if the selection does not exist in the registry. */
export function resolveCanvas(sel: FormatSelection): ResolvedCanvas | undefined {
  const platform = findPlatform(sel.platformKey)
  const pl = findPlacement(sel.platformKey, sel.formatKey)
  if (!platform || !pl) return undefined
  const isCustom = pl.ratio === 'CUSTOM'
  const size = isCustom ? sanitizeCustomSize(sel.customSize) : { width: pl.width, height: pl.height }
  return {
    platformKey: platform.key, platformLabel: platform.label, formatKey: pl.key, formatLabel: postLabel(pl),
    ratio: pl.ratio, width: size.width, height: size.height, kind: pl.kind, isCustom,
    ratioLabel: isCustom ? ratioLabelFor(size.width, size.height) : pl.ratio, safeArea: pl.safeArea,
  }
}
