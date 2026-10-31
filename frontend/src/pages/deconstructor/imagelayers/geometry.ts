// M2.2a -- where an image goes, and how big, without ever stretching it.
//
// A region is a rectangle on a reference frame (normalised 0..1, top-left origin). The editor's image layer is a box in percent of the canvas whose
// preview draws the picture "contain" (aspect kept, letterboxed) while the exporter scales the picture to exactly the box. Those two only agree when the box
// has the picture's own aspect ratio, so the layer's box is the LARGEST box of the picture's aspect that fits inside the region, centred in it. The region the
// person chose is kept as it was (in the provenance); the box is what fits in it.
import { DEFAULT_CANVAS } from '../textlayers/geometry'
import { MIN_REGION, clamp, round3, type Rect } from './contract'

export { DEFAULT_CANVAS }
export interface Canvas { width: number; height: number }
/** A box in percent of the canvas, the unit the editor's MediaOverlay uses. */
export interface Box { x: number; y: number; width: number; height: number }
export interface Fit { box: Box; pixelWidth: number; pixelHeight: number; /** Canvas pixels drawn per image pixel (above 1 = the picture is enlarged). */ scale: number }

export const isValidRegion = (r: Rect) => [r.x, r.y, r.w, r.h].every(Number.isFinite) && r.w >= MIN_REGION && r.h >= MIN_REGION

/** Keep a region inside the frame and no smaller than the minimum; a region that cannot be repaired stays invalid. */
export function clampRegion(r: Rect): Rect {
  const x = clamp(r.x, 0, 1), y = clamp(r.y, 0, 1)
  return { x: round3(x), y: round3(y), w: round3(clamp(r.w, 0, 1 - x)), h: round3(clamp(r.h, 0, 1 - y)) }
}

/** The rectangle between two points (any corner order), normalised and clamped to the frame. */
export function rectFromPoints(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  return clampRegion({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) })
}

export function sameRegion(a: Rect, b: Rect, tolerance = 0.0005) {
  return Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance && Math.abs(a.w - b.w) <= tolerance && Math.abs(a.h - b.h) <= tolerance
}

/** Largest box of the picture's own aspect ratio that fits inside the region, centred in it. Null when the region or the picture has no usable size. */
export function fitContain(region: Rect, image: { width: number; height: number }, canvas: Canvas = DEFAULT_CANVAS): Fit | null {
  if (!isValidRegion(region) || !(image.width > 0) || !(image.height > 0) || !(canvas.width > 0) || !(canvas.height > 0)) return null
  const slotW = region.w * canvas.width, slotH = region.h * canvas.height                 // the region in canvas pixels
  const aspect = image.width / image.height
  const pw = slotW / slotH > aspect ? slotH * aspect : slotW
  const ph = slotW / slotH > aspect ? slotH : slotW / aspect
  const box: Box = {
    x: round3(((region.x * canvas.width + (slotW - pw) / 2) / canvas.width) * 100), y: round3(((region.y * canvas.height + (slotH - ph) / 2) / canvas.height) * 100),
    width: round3((pw / canvas.width) * 100), height: round3((ph / canvas.height) * 100),
  }
  return { box, pixelWidth: Math.round(pw), pixelHeight: Math.round(ph), scale: round3(pw / image.width) }
}

/** The aspect ratio (width / height, in canvas pixels) a box actually draws at. Equal to the picture's own ratio for any box fitContain returned. */
export const boxAspect = (b: Box, canvas: Canvas = DEFAULT_CANVAS) => (b.width * canvas.width) / (b.height * canvas.height)

/** A frame's own pixel aspect, used to turn a normalised crop region into the crop's pixel size. */
export const cropPixels = (region: Rect, frame: { width: number | null; height: number | null }) =>
  frame.width && frame.height ? { width: Math.max(1, Math.round(region.w * frame.width)), height: Math.max(1, Math.round(region.h * frame.height)) } : null
