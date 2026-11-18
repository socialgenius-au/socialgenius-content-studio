// C3 -- the optional blurred backdrop behind a letterboxed ("fit") clip. It lives on the canvas format (`canvasFormat.backdrop`), so it is saved in the draft and restored with it. Absent (every draft
// written before it existed) = the plain colour/black bars, exactly as before. Anything other than "blur" is ignored.
export type CanvasBackdrop = 'blur'
export const validCanvasBackdrop = (v: unknown): CanvasBackdrop | undefined => (v === 'blur' ? 'blur' : undefined)

// The exporter blurs the covering copy with ffmpeg `boxblur=20:2` at the canvas size (backend ffmpeg_svc.BACKDROP_BLUR_RADIUS / _PASSES): a box of 2*20+1 = 41 px applied twice has variance 2 * (41^2 - 1) / 12
// = 280 px^2, i.e. a gaussian-equivalent sigma of about 16.7 px at the canvas size. CSS `blur()` takes the standard deviation directly, so the preview scales the same sigma by how much smaller the preview box is.
export const EXPORT_BLUR_RADIUS = 20
export const EXPORT_BLUR_PASSES = 2
export const EXPORT_BLUR_SIGMA = Math.sqrt(EXPORT_BLUR_PASSES * ((2 * EXPORT_BLUR_RADIUS + 1) ** 2 - 1) / 12)

/** CSS blur radius (px) that looks like the export's blur on a preview box `boxWidth` px wide for a canvas `canvasWidth` px wide. */
export const previewBlurPx = (boxWidth: number, canvasWidth: number) => (canvasWidth > 0 && boxWidth > 0 ? Math.round(EXPORT_BLUR_SIGMA * (boxWidth / canvasWidth) * 10) / 10 : 0)
