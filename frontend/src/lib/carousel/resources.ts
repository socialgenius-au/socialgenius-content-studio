// Carousel Creator — honest resource advice for big exports.
//
// There is NO product limit on the number of slides. What exists are the real limits of the machine doing the work: a browser tab has a few GB at most, and a ZIP/PDF is assembled
// in memory. These estimates are deliberately rough (they are upper-ish bounds for typical artwork) and only ever produce advice, never a refusal.
import type { PostDocument } from '../postDocument'

export type ResourceLevel = 'ok' | 'notice' | 'heavy' | 'extreme'
export interface ResourceAdvice { level: ResourceLevel; messages: string[]; slides: number; perSlideBytes: number; totalBytes: number; peakBytes: number }

const MB = 1024 * 1024
/** Rough encoded bytes per pixel: PNG artwork vs JPEG at ~0.92 quality. */
const BYTES_PER_PX = { png: 1.0, jpeg: 0.35 } as const
/** Instagram's current per-post carousel limit. Advice only: the exports still contain every slide. */
export const INSTAGRAM_SLIDE_ADVISORY = 20

export function estimateImageExport(doc: PostDocument, kind: 'png' | 'jpeg' | 'pdf', scale: number, slides = doc.pages.length): { perSlideBytes: number; totalBytes: number; peakBytes: number } {
  const px = doc.format.width * scale * (doc.format.height * scale)
  const perSlideBytes = px * BYTES_PER_PX[kind === 'png' ? 'png' : 'jpeg']
  const totalBytes = perSlideBytes * slides
  // One canvas (4 bytes per pixel) while drawing, plus every encoded slide held for the ZIP/PDF, plus the assembled file (a second copy).
  const peakBytes = px * 4 + totalBytes * 2
  return { perSlideBytes, totalBytes, peakBytes }
}

export function exportAdvice(doc: PostDocument, kind: 'png' | 'jpeg' | 'pdf', scale: number, slides = doc.pages.length): ResourceAdvice {
  const e = estimateImageExport(doc, kind, scale, slides)
  const messages: string[] = []
  let level: ResourceLevel = 'ok'
  const raise = (l: ResourceLevel) => { const order: ResourceLevel[] = ['ok', 'notice', 'heavy', 'extreme']; if (order.indexOf(l) > order.indexOf(level)) level = l }
  const mb = (n: number) => `${Math.round(n / MB)} MB`

  if (doc.format.platformKey === 'instagram' && doc.pages.length > INSTAGRAM_SLIDE_ADVISORY) {
    raise('notice')
    messages.push(`This carousel has ${doc.pages.length} slides. Instagram currently accepts up to ${INSTAGRAM_SLIDE_ADVISORY} per post, so you may need to split it into several posts. Every slide is still exported.`)
  }
  if (e.peakBytes >= 1536 * MB) {
    raise('extreme')
    messages.push(`This export may need about ${mb(e.peakBytes)} of browser memory and the tab could run out. Export in batches using the slide range, or use 1x size or JPEG.`)
  } else if (e.peakBytes >= 400 * MB) {
    raise('heavy')
    messages.push(`This export may need about ${mb(e.peakBytes)} of browser memory and could be slow on a phone or older computer. Consider exporting a range of slides at a time.`)
  }
  if (slides >= 100 && level === 'ok') { raise('notice'); messages.push(`${slides} slides will take a while to render; progress is shown and you can cancel at any time.`) }
  return { level, messages, slides, ...e }
}

/** Animated video export is rendered on the server, so its limits are different: total duration and frame count. */
export const VIDEO_LONG_SECONDS = 180
export function videoAdvice(totalSeconds: number, width: number, height: number, fps: number): ResourceAdvice {
  const frames = Math.round(totalSeconds * fps)
  const messages: string[] = []
  let level: ResourceLevel = 'ok'
  if (totalSeconds > VIDEO_LONG_SECONDS * 3) { level = 'extreme'; messages.push(`A ${Math.round(totalSeconds / 60)}-minute video is very large to render (${frames.toLocaleString()} frames). Split it into several videos.`) }
  else if (totalSeconds > VIDEO_LONG_SECONDS) { level = 'heavy'; messages.push(`A ${Math.round(totalSeconds / 60)}-minute video will take several minutes to render on the server (${frames.toLocaleString()} frames).`) }
  if (width * height > 1920 * 1920) { if (level === 'ok') level = 'notice'; messages.push('Large frame sizes take longer and use more server memory.') }
  return { level, messages, slides: 0, perSlideBytes: 0, totalBytes: 0, peakBytes: 0 }
}
