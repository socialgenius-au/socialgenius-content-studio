// Carousel Creator - animated frames (shared by the motion preview and the animated video export).
//
// `drawFrame` paints ONE frame of the carousel's timeline: a slide on its own, or two slides composited while a transition runs, with every element's entrance / exit / emphasis applied.
// The preview calls it for the frame under the playhead; the export calls it for every frame, encodes each as a JPEG and hands it to a `VideoSink` (the server turns the frames into an
// MP4 or GIF with FFmpeg). Because both use this one function, what you preview is what is exported.
import type { BrandTokens, PostDocument } from '../postDocument'
import { buildTimeline, elementMotion, planFrame, sequenceOffsets, transitionLayers, type Timeline, type TransitionLayer } from './animation'
import { ExportCancelled, type RasterBackend, type RasterSurface } from './exporter'
import { drawSlide, type Ctx2D, type DrawableImage } from './rasterize'

export interface FrameContext {
  doc: PostDocument
  timeline: Timeline
  backend: RasterBackend
  width: number
  height: number
  tokens?: BrandTokens
  images: Map<string, DrawableImage | null>
  main: RasterSurface
  a: RasterSurface
  b: RasterSurface
}

/** Loads every picture the carousel uses, once. */
export async function prepareFrameContext(doc: PostDocument, backend: RasterBackend, opts: { scale?: number; /** exact frame size (overrides scale) */ size?: { width: number; height: number }; resolveUrl?: (u: string) => string; tokens?: BrandTokens }): Promise<FrameContext> {
  const scale = opts.scale ?? 1
  const width = opts.size?.width ?? Math.max(2, Math.round(doc.format.width * scale))
  const height = opts.size?.height ?? Math.max(2, Math.round(doc.format.height * scale))
  const urls = new Set<string>()
  const walk = (els: PostDocument['pages'][number]['elements']) => { for (const e of els) { if (e.type === 'image' && e.source.kind === 'asset' && e.source.url) urls.add(e.source.url); if (e.type === 'group') walk(e.children) } }
  for (const p of doc.pages) { if (p.background.kind === 'image' && p.background.source.kind === 'asset' && p.background.source.url) urls.add(p.background.source.url); walk(p.elements) }
  const images = new Map<string, DrawableImage | null>()
  await Promise.all([...urls].map(async u => { images.set(u, await backend.loadImage(opts.resolveUrl ? opts.resolveUrl(u) : u).catch(() => null)) }))
  return { doc, timeline: buildTimeline(doc), backend, width, height, tokens: opts.tokens, images, main: backend.createSurface(width, height), a: backend.createSurface(width, height), b: backend.createSurface(width, height) }
}

function composite(ctx: Ctx2D, image: unknown, l: TransitionLayer, W: number, H: number): void {
  if (l.opacity <= 0.0005 || Math.abs(l.scaleX) < 0.002 || Math.abs(l.scaleY) < 0.002) return
  ctx.save()
  ctx.globalAlpha = l.opacity
  if (l.clip) { ctx.beginPath(); ctx.rect(l.clip.x0 * W, l.clip.y0 * H, (l.clip.x1 - l.clip.x0) * W, (l.clip.y1 - l.clip.y0) * H); ctx.clip() }
  ctx.translate(W / 2 + l.dx * W, H / 2 + l.dy * H)
  ctx.scale(l.scaleX, l.scaleY)
  ctx.drawImage(image, 0, 0, W, H, -W / 2, -H / 2, W, H)
  ctx.restore()
}

/** Draws the frame at `tMs` into `fc.main`. */
export async function drawFrame(fc: FrameContext, tMs: number): Promise<void> {
  const { doc, width: W, height: H } = fc
  const plan = planFrame(fc.timeline, tMs)
  const offsetCache = new Map<number, Map<string, number>>()
  const slideOpts = (index: number, localMs: number) => {
    const page = doc.pages[index]
    let offsets = offsetCache.get(index)
    if (!offsets) { offsets = sequenceOffsets(page); offsetCache.set(index, offsets) }
    return { width: W, height: H, tokens: fc.tokens, images: fc.images, loadImage: fc.backend.loadImage, motion: (el: PostDocument['pages'][number]['elements'][number]) => elementMotion(page, el, localMs, offsets) }
  }
  const main = fc.main.ctx
  if (plan.solo) {
    await drawSlide(main, doc, plan.solo.index, slideOpts(plan.solo.index, plan.solo.localMs))
    return
  }
  const tr = plan.transition!
  await drawSlide(fc.a.ctx, doc, tr.out.index, slideOpts(tr.out.index, tr.out.localMs))
  await drawSlide(fc.b.ctx, doc, tr.in.index, slideOpts(tr.in.index, tr.in.localMs))
  main.save(); main.fillStyle = '#000000'; main.fillRect(0, 0, W, H); main.restore()
  const layers = transitionLayers(tr.kind, tr.p, tr.direction)
  composite(main, fc.a.image, layers.out, W, H)
  composite(main, fc.b.image, layers.in, W, H)
}

// ── export ───────────────────────────────────────────────────────────────────────────────────

export type VideoFormat = 'mp4' | 'gif'
export const VIDEO_FPS_CHOICES = [12, 15, 24, 30] as const

export interface VideoMeta { fps: number; width: number; height: number; frames: number; format: VideoFormat }
export interface VideoSink {
  start(meta: VideoMeta): Promise<string>
  /** Frames arrive in order, `startIndex` being the index of the first one in the batch. */
  sendFrames(jobId: string, startIndex: number, frames: Uint8Array[]): Promise<void>
  render(jobId: string): Promise<void>
  download(jobId: string): Promise<{ name: string; mime: string; bytes: Uint8Array }>
  discard(jobId: string): Promise<void>
}

export interface VideoExportOptions {
  fps: number
  scale: number
  format: VideoFormat
  quality?: number
  resolveUrl?: (u: string) => string
  tokens?: BrandTokens
  signal?: AbortSignal
  onProgress?: (stage: 'rendering' | 'encoding' | 'downloading', done: number, total: number) => void
  /** Frames are sent in batches of about this many bytes. */
  batchBytes?: number
}

export const frameCount = (tl: Timeline, fps: number) => Math.max(1, Math.round((tl.totalMs / 1000) * fps))
/** Frame dimensions must be even for H.264 (yuv420p). */
export const videoSize = (doc: PostDocument, scale: number) => ({ width: Math.max(2, Math.round((doc.format.width * scale) / 2) * 2), height: Math.max(2, Math.round((doc.format.height * scale) / 2) * 2) })

/**
 * Renders every frame of the timeline (one at a time), sends them to the sink in batches, asks it to encode, and returns the finished file. Cancelling stops before the next frame and
 * discards the server's partial job. Nothing is rendered twice and only one frame of pixels is ever held (plus the batch being sent).
 */
export async function exportAnimatedVideo(doc: PostDocument, backend: RasterBackend, sink: VideoSink, o: VideoExportOptions): Promise<{ name: string; mime: string; bytes: Uint8Array }> {
  const size = videoSize(doc, o.scale)
  const fc = await prepareFrameContext(doc, backend, { size, resolveUrl: o.resolveUrl, tokens: o.tokens })
  const total = frameCount(fc.timeline, o.fps)
  const jobId = await sink.start({ fps: o.fps, width: fc.width, height: fc.height, frames: total, format: o.format })
  const cancelled = () => { if (o.signal?.aborted) throw new ExportCancelled() }
  try {
    let batch: Uint8Array[] = []
    let batchStart = 0
    let batchSize = 0
    const flush = async () => { if (batch.length) { await sink.sendFrames(jobId, batchStart, batch); batchStart += batch.length; batch = []; batchSize = 0 } }
    for (let i = 0; i < total; i++) {
      cancelled()
      await new Promise<void>(r => setTimeout(r, 0))                        // let the page paint and handle clicks (including Cancel) between frames
      cancelled()
      await drawFrame(fc, (i * 1000) / o.fps)
      const jpeg = await fc.main.toBytes('image/jpeg', o.quality ?? 0.9)
      batch.push(jpeg); batchSize += jpeg.length
      if (batchSize >= (o.batchBytes ?? 6 * 1024 * 1024)) await flush()
      o.onProgress?.('rendering', i + 1, total)
    }
    await flush()
    cancelled()
    o.onProgress?.('encoding', 0, 1)
    await sink.render(jobId)
    cancelled()
    o.onProgress?.('downloading', 0, 1)
    const file = await sink.download(jobId)
    await sink.discard(jobId).catch(() => undefined)
    return file
  } catch (e) {
    await sink.discard(jobId).catch(() => undefined)
    throw e
  }
}
