// Carousel Creator - picture adjustments (brightness, contrast, saturation, blur, grayscale, sepia, hue). The same values drive the on-screen CSS filter and the export canvas filter.
// Canvas `filter` is supported by current Chrome, Edge and Firefox; a browser without it exports the picture unadjusted (the editor warns about this in the export panel).
import type { ImageAdjust } from '../postDocument'

export const ADJUST_DEFAULTS = { brightness: 100, contrast: 100, saturation: 100, blur: 0, grayscale: 0, sepia: 0, hue: 0 } as const

export function hasAdjust(a: ImageAdjust | undefined): boolean {
  if (!a) return false
  return (Object.keys(ADJUST_DEFAULTS) as (keyof typeof ADJUST_DEFAULTS)[]).some(k => a[k] !== undefined && a[k] !== ADJUST_DEFAULTS[k])
}

/** A CSS/canvas filter string. `blurLength` turns the blur (a fraction of the shorter side) into a length. Returns undefined when nothing is adjusted. */
export function filterString(a: ImageAdjust | undefined, blurLength: (fraction: number) => string): string | undefined {
  if (!hasAdjust(a)) return undefined
  const v = { ...ADJUST_DEFAULTS, ...a }
  const parts: string[] = []
  if (v.brightness !== 100) parts.push(`brightness(${v.brightness}%)`)
  if (v.contrast !== 100) parts.push(`contrast(${v.contrast}%)`)
  if (v.saturation !== 100) parts.push(`saturate(${v.saturation}%)`)
  if (v.grayscale) parts.push(`grayscale(${v.grayscale}%)`)
  if (v.sepia) parts.push(`sepia(${v.sepia}%)`)
  if (v.hue) parts.push(`hue-rotate(${v.hue}deg)`)
  if (v.blur) parts.push(`blur(${blurLength(v.blur)})`)
  return parts.join(' ')
}

export const cssFilter = (a: ImageAdjust | undefined): string | undefined => filterString(a, f => `${Math.round(f * 1e5) / 1e3}cqmin`)
export const canvasFilter = (a: ImageAdjust | undefined, S: number): string => filterString(a, f => `${Math.round(f * S * 100) / 100}px`) ?? 'none'
