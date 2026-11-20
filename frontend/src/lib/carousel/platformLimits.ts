// Carousel Creator - what each platform limits, as ADVICE. These are limits as generally published; platforms change them, so every message tells the person to confirm with the platform
// before publishing. Nothing here blocks an export: the design and its exports are never restricted by a platform's rules, only warned about.
import type { PostDocument } from '../postDocument'

export interface PlatformLimits {
  /** Most slides / images / pages in one post. */
  maxSlides?: number
  /** Longest video, seconds. */
  maxVideoSeconds?: number
  /** Largest PDF / document, megabytes. */
  maxPdfMB?: number
  maxPdfPages?: number
  /** Largest video file, megabytes. */
  maxVideoMB?: number
  /** Largest single image, megabytes. */
  maxImageMB?: number
  /** Free text shown with the limits. */
  notes: string[]
}

const CHECK = 'Platform limits change, so confirm them with the platform before you publish.'

/** Limits by platform key and (optionally) placement key. */
export function limitsFor(platformKey: string, formatKey: string): PlatformLimits {
  switch (platformKey) {
    case 'instagram':
      if (formatKey === 'carousel') return { maxSlides: 20, notes: ['An Instagram carousel can hold up to 20 slides.'] }
      if (formatKey === 'reel_story') return { maxVideoSeconds: 180, notes: ['Instagram Reels can be up to 3 minutes; Stories play in 60-second segments.'] }
      return { notes: [] }
    case 'tiktok': return { maxSlides: 35, maxVideoSeconds: 600, notes: ['TikTok photo posts can hold up to 35 images; uploaded videos can be up to 10 minutes.'] }
    case 'pinterest':
      if (formatKey === 'video_pin') return { maxVideoSeconds: 900, maxVideoMB: 2048, notes: ['Pinterest video pins run from 4 seconds to 15 minutes and up to 2 GB.'] }
      return { maxSlides: 5, maxImageMB: 20, notes: ['A Pinterest carousel pin can hold up to 5 images, each up to 20 MB.'] }
    case 'linkedin':
      return { maxSlides: 300, maxPdfPages: 300, maxPdfMB: 100, maxVideoSeconds: 600, notes: ['LinkedIn document (PDF) posts can have up to 300 pages and 100 MB; videos up to 10 minutes; a multi-image post up to 20 images.'] }
    case 'youtube':
      if (formatKey === 'shorts') return { maxVideoSeconds: 180, notes: ['YouTube Shorts can be up to 3 minutes and must be vertical or square.'] }
      return { notes: [] }
    case 'facebook': return { notes: ['Facebook accepts long videos, but Reels and carousel ads have their own shorter limits.'] }
    case 'x': return { maxVideoSeconds: 140, maxVideoMB: 512, notes: ['X videos are limited to about 2 minutes 20 seconds and 512 MB on standard accounts.'] }
    default: return { notes: [] }
  }
}

export interface ExportContext {
  /** What is being exported. */
  kind: 'image' | 'pdf' | 'video' | 'gif'
  /** Slides included in this export. */
  slideCount: number
  /** Length of the animated export, seconds. */
  videoSeconds?: number
  /** Estimated file size, megabytes. */
  estimatedMB?: number
}

/** Plain-language warnings for the document's chosen platform. Empty when nothing is a concern. */
export function checkLimits(doc: PostDocument, ctx: ExportContext): string[] {
  const l = limitsFor(doc.format.platformKey, doc.format.formatKey)
  const out: string[] = []
  const name = `${doc.format.platformKey.charAt(0).toUpperCase()}${doc.format.platformKey.slice(1)}`
  if (l.maxSlides !== undefined && ctx.slideCount > l.maxSlides && ctx.kind !== 'video' && ctx.kind !== 'gif') out.push(`${ctx.slideCount} slides is more than ${name} allows in one post (${l.maxSlides}). Split it into several posts, or export a slide range.`)
  if (ctx.kind === 'pdf' && l.maxPdfPages !== undefined && ctx.slideCount > l.maxPdfPages) out.push(`A PDF of ${ctx.slideCount} pages is over ${name}'s ${l.maxPdfPages}-page limit.`)
  if (ctx.kind === 'pdf' && l.maxPdfMB !== undefined && ctx.estimatedMB !== undefined && ctx.estimatedMB > l.maxPdfMB) out.push(`This PDF is estimated at about ${Math.round(ctx.estimatedMB)} MB, over ${name}'s ${l.maxPdfMB} MB limit. Use 1x size or JPEG quality, or fewer slides.`)
  if ((ctx.kind === 'video' || ctx.kind === 'gif') && l.maxVideoSeconds !== undefined && ctx.videoSeconds !== undefined && ctx.videoSeconds > l.maxVideoSeconds) out.push(`This video is ${Math.round(ctx.videoSeconds)} seconds long; ${name} allows up to ${l.maxVideoSeconds} seconds for this format. Shorten the slides or split it.`)
  if (ctx.kind === 'video' && l.maxVideoMB !== undefined && ctx.estimatedMB !== undefined && ctx.estimatedMB > l.maxVideoMB) out.push(`The video may be larger than ${name}'s ${l.maxVideoMB} MB limit.`)
  if (ctx.kind === 'image' && l.maxImageMB !== undefined && ctx.estimatedMB !== undefined && ctx.estimatedMB > l.maxImageMB) out.push(`Each image may be larger than ${name}'s ${l.maxImageMB} MB limit. Use JPEG or 1x size.`)
  if (ctx.kind === 'gif') out.push('GIFs are silent and limited to 256 colours; most platforms play them as short loops only.')
  if (out.length > 0) out.push(CHECK)
  return out
}

/** The limits and notes for the document's format, for display. */
export const describeLimits = (doc: PostDocument): string[] => { const l = limitsFor(doc.format.platformKey, doc.format.formatKey); return l.notes.length ? [...l.notes, CHECK] : [] }
