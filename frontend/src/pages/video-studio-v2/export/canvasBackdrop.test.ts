import { describe, expect, it } from 'vitest'
import { EXPORT_BLUR_SIGMA, previewBlurPx, validCanvasBackdrop } from './canvasBackdrop'

describe('canvas backdrop', () => {
  it('only "blur" is a backdrop; anything else (or nothing, as in every older draft) means the plain colour', () => {
    expect(validCanvasBackdrop('blur')).toBe('blur')
    for (const v of [undefined, null, '', 'color', 'Blur', 'gaussian', 1, {}]) expect(validCanvasBackdrop(v)).toBeUndefined()
  })
  it("the preview blur is the export's boxblur=20:2 expressed as a gaussian sigma (about 16.7 px at the canvas size), scaled to the preview box", () => {
    expect(EXPORT_BLUR_SIGMA).toBeCloseTo(16.73, 2)
    expect(previewBlurPx(1080, 1080)).toBeCloseTo(16.7, 1)
    expect(previewBlurPx(330, 1080)).toBeCloseTo(5.1, 1)
    expect(previewBlurPx(0, 1080)).toBe(0)
  })
})
