// Carousel Creator - image masks. A picture can be clipped to a circle, a rounded box or ANY polygon shape from the shape library (shapes.ts). One definition is used by the on-screen
// renderer (CSS clip-path / border-radius) and the export rasterizer (canvas paths), so a masked picture looks the same on screen and in the PNG / JPEG / PDF.
import type { ImageMask } from '../postDocument'
import { SHAPES, clipPathOf } from './shapes'

export const IMAGE_MASKS: { id: ImageMask; label: string }[] = [
  { id: 'none', label: 'None' }, { id: 'rounded', label: 'Rounded' }, { id: 'circle', label: 'Circle / oval' }, ...SHAPES.map(s => ({ id: s.id as ImageMask, label: s.label })),
]

/** Polygon masks as points in the unit square (x right, y down). */
export const MASK_POLYGONS: Partial<Record<ImageMask, [number, number][]>> = Object.fromEntries(SHAPES.map(s => [s.id, s.points]))

/** CSS clip-path for a polygon mask, or undefined for the others. */
export function maskClipPath(mask: ImageMask | undefined): string | undefined {
  return mask ? clipPathOf(mask) : undefined
}
