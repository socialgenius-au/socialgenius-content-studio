// Carousel Creator — creating a carousel document from the shared Platform & Format Registry.
import { findPlacement } from '../platformFormats'
import {
  POST_DOCUMENT_SCHEMA_VERSION, type DocumentFormat, type PostDocument, type Provenance,
} from '../postDocument'
import { buildLayout, DEFAULT_THEME_ID, themeById, type LayoutContent, type LayoutId } from './layouts'
import { defaultId, newSlide, type OpContext } from './ops'

/** The first supported output: Instagram carousel, 4:5 (1080 x 1350). Other registry placements work through the same functions. */
export const INSTAGRAM_CAROUSEL = { platformKey: 'instagram', formatKey: 'carousel' } as const

/** A DocumentFormat snapshot from the registry (stored in the document so a reopened carousel never shifts if the registry changes). */
export function formatFromRegistry(platformKey: string, formatKey: string): DocumentFormat {
  const p = findPlacement(platformKey, formatKey)
  if (!p) throw new Error(`Unknown format ${platformKey}/${formatKey}`)
  return { platformKey, formatKey, width: p.width, height: p.height, ratio: p.ratio }
}

export interface NewCarouselOptions {
  title?: string
  platformKey?: string
  formatKey?: string
  themeId?: string
  /** Layout of each starting slide. Default: cover, title+text, call to action. */
  layouts?: LayoutId[]
  /** Per-slide content for the starting slides (same order as `layouts`). */
  content?: LayoutContent[]
  provenance?: Provenance
  names?: (string | undefined)[]
}

export function createCarouselDocument(opts: NewCarouselOptions = {}, ctx?: OpContext): PostDocument {
  const format = formatFromRegistry(opts.platformKey ?? INSTAGRAM_CAROUSEL.platformKey, opts.formatKey ?? INSTAGRAM_CAROUSEL.formatKey)
  const theme = themeById(opts.themeId ?? DEFAULT_THEME_ID)
  const layouts = opts.layouts ?? ['cover', 'title_body', 'cta']
  const stamp = (ctx?.now ?? (() => new Date()))().toISOString()
  const pages = layouts.map((layout, i) => {
    const built = buildLayout(layout, format, theme, opts.content?.[i], ctx)
    return newSlide(built.background, built.elements, opts.names?.[i] ?? defaultSlideName(layout, i), ctx)
  })
  return {
    kind: 'post', schemaVersion: POST_DOCUMENT_SCHEMA_VERSION, id: (ctx?.newId ?? defaultId)('car'), title: opts.title?.trim() || 'Untitled carousel', revision: 0,
    format, pages, context: {}, provenance: opts.provenance ?? { origin: 'manual' }, createdAt: stamp, updatedAt: stamp,
  }
}

const LAYOUT_NAMES: Record<LayoutId, string> = { cover: 'Cover', title_body: 'Explain', statement: 'Statement', list: 'List', image_caption: 'Image', quote: 'Quote', cta: 'Call to action' }
export const defaultSlideName = (layout: LayoutId, index: number): string => `${index + 1}. ${LAYOUT_NAMES[layout]}`
