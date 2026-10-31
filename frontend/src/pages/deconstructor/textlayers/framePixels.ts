// M2.1a -- the only browser I/O of the text engine: read the pixels around each detected box from the frame the text was read from, so appearance.ts can
// estimate its colour. Read-only (it loads an image the app already serves), injectable (tests pass a fake sampler), and failure-tolerant: a frame that cannot
// be loaded or read (network, a cross-origin canvas that refuses pixel access) just means no estimate for that item -- the candidate falls back to a default.
import { estimateAppearance, type Appearance, type PixelImage, type PixelRect } from './appearance'
import type { Rect } from './contract'
import type { TextEvidence } from './evidence'

export interface FrameSample { image: PixelImage; inner: PixelRect }
/** Given a frame (by its stored path) and a normalised box on it, return the pixels around the box and where the box sits inside them. */
export type FrameSampler = (framePath: string, box: Rect) => Promise<FrameSample | null>

interface LoadedFrame { ctx: CanvasRenderingContext2D; width: number; height: number }

export function browserFrameSampler(previewUrl: (path: string) => string): FrameSampler {
  const frames = new Map<string, Promise<LoadedFrame | null>>()
  const load = (url: string) => new Promise<LoadedFrame | null>(resolve => {
    const img = new Image()
    img.crossOrigin = 'anonymous'                                                   // required to read pixels back from an image served by the API origin
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth; canvas.height = img.naturalHeight
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (!ctx || !canvas.width || !canvas.height) return resolve(null)
        ctx.drawImage(img, 0, 0)
        resolve({ ctx, width: canvas.width, height: canvas.height })
      } catch { resolve(null) }
    }
    img.onerror = () => resolve(null)
    img.src = url
  })
  return async (framePath, box) => {
    const url = previewUrl(framePath)
    if (!url) return null
    if (!frames.has(url)) frames.set(url, load(url))
    const frame = await frames.get(url)!
    if (!frame) return null
    const bx = box.x * frame.width, by = box.y * frame.height, bw = box.w * frame.width, bh = box.h * frame.height
    const m = Math.max(6, Math.round(0.6 * bh))                                    // a ring of surrounding picture to compare the text against
    const cx = Math.max(0, Math.floor(bx - m)), cy = Math.max(0, Math.floor(by - m))
    const cw = Math.min(frame.width, Math.ceil(bx + bw + m)) - cx, ch = Math.min(frame.height, Math.ceil(by + bh + m)) - cy
    if (cw <= 0 || ch <= 0) return null
    try {
      const d = frame.ctx.getImageData(cx, cy, cw, ch)
      return { image: { width: d.width, height: d.height, data: d.data }, inner: { x: bx - cx, y: by - cy, w: bw, h: bh } }
    } catch { return null }                                                         // tainted canvas: pixel access refused
  }
}

/** Estimate every group's text colour from its own source frame. Groups whose frame cannot be read are simply absent from the result. */
export async function readAppearances(evidence: TextEvidence, sample: FrameSampler, isCancelled: () => boolean = () => false): Promise<Map<number, Appearance>> {
  const out = new Map<number, Appearance>()
  for (const g of evidence.groups) {
    if (isCancelled()) break
    if (!g.frame.path) continue
    try {
      const s = await sample(g.frame.path, g.box)
      if (s) out.set(g.id, estimateAppearance(s.image, s.inner))
    } catch { /* one unreadable frame never stops the others */ }
  }
  return out
}
