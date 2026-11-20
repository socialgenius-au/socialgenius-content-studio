// Carousel Creator - image masks. One definition used by the on-screen renderer (CSS clip-path / border-radius) and the export rasterizer (canvas paths), so a masked picture
// looks the same on screen and in the PNG / JPEG / PDF.
import type { ImageMask } from '../postDocument'

export const IMAGE_MASKS: { id: ImageMask; label: string }[] = [
  { id: 'none', label: 'None' }, { id: 'rounded', label: 'Rounded' }, { id: 'circle', label: 'Circle / oval' }, { id: 'diamond', label: 'Diamond' }, { id: 'hexagon', label: 'Hexagon' }, { id: 'triangle', label: 'Triangle' },
]

/** Polygon masks as points in the unit square (x right, y down). */
export const MASK_POLYGONS: Partial<Record<ImageMask, [number, number][]>> = {
  diamond: [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]],
  hexagon: [[0.25, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0.25, 1], [0, 0.5]],
  triangle: [[0.5, 0], [1, 1], [0, 1]],
}

/** CSS clip-path for a polygon mask, or undefined for the others. */
export function maskClipPath(mask: ImageMask | undefined): string | undefined {
  const pts = mask ? MASK_POLYGONS[mask] : undefined
  return pts ? `polygon(${pts.map(([x, y]) => `${x * 100}% ${y * 100}%`).join(', ')})` : undefined
}
