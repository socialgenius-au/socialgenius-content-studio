// Carousel Creator - reusable templates and branded layouts.
//
// A template is just a saved PostDocument (see backend/app/routers/carousel_templates.py). USING one always makes a COPY with brand-new ids, so the template itself is never changed and
// two carousels made from the same template can never share an element id. Because geometry is canvas-relative, a template also works on a carousel with a different format.
import type { PostDocument, PostPage } from '../postDocument'
import { cloneElement, defaultId, touch, type OpContext } from './ops'

export interface TemplateSummary { id: number; name: string; description: string; kind: 'carousel' | 'layout'; slideCount: number; platformKey: string; formatKey: string; brandKitId: number | null; updatedAt: string }
export interface Template extends TemplateSummary { document: PostDocument }

const idOf = (ctx: OpContext | undefined, prefix: string) => (ctx?.newId ?? defaultId)(prefix)
const stamp = (ctx: OpContext | undefined) => (ctx?.now ?? (() => new Date()))().toISOString()

/** A copy of a slide with a new slide id and new ids on every element and group child. */
function freshSlide(p: PostPage, ctx?: OpContext): PostPage {
  return { ...JSON.parse(JSON.stringify(p)) as PostPage, id: idOf(ctx, 'slide'), elements: p.elements.map(e => cloneElement(e, ctx)) }
}

/** The slides of `doc` (all of them, or the given ones, in document order) as a template document. */
export function templateDocumentFrom(doc: PostDocument, pageIds?: string[], ctx?: OpContext): PostDocument {
  const keep = pageIds ? doc.pages.filter(p => pageIds.includes(p.id)) : doc.pages
  if (keep.length === 0) throw new Error('Choose at least one slide to save as a template')
  const now = stamp(ctx)
  return { ...JSON.parse(JSON.stringify(doc)) as PostDocument, id: idOf(ctx, 'tpl'), revision: 0, pages: keep.map(p => freshSlide(p, ctx)), createdAt: now, updatedAt: now, provenance: { origin: 'template' } }
}

/** A brand-new carousel made from a template: new document id, new slide and element ids, the template recorded as its origin. */
export function carouselFromTemplate(t: Template, title?: string, ctx?: OpContext): PostDocument {
  const src = t.document
  const now = stamp(ctx)
  return {
    ...JSON.parse(JSON.stringify(src)) as PostDocument, id: idOf(ctx, 'car'), title: (title ?? src.title).trim() || t.name, revision: 0, pages: src.pages.map(p => freshSlide(p, ctx)),
    createdAt: now, updatedAt: now, variants: undefined, provenance: { origin: 'template', templateId: String(t.id) },
  }
}

export type InsertMode = 'after' | 'end' | 'replace'

/**
 * Adds a template's slides to an existing carousel: after the open slide, at the end, or in place of the open slide. Every inserted slide and element gets a new id. The carousel's own
 * format, title and Brand Kit are kept. Returns the new document and the ids of the inserted slides (so the editor can open the first one).
 */
export function applyTemplateSlides(doc: PostDocument, t: Template, mode: InsertMode, activePageId: string, ctx?: OpContext): { doc: PostDocument; slideIds: string[]; formatDiffers: boolean } {
  const slides = t.document.pages.map(p => freshSlide(p, ctx))
  const at = Math.max(0, doc.pages.findIndex(p => p.id === activePageId))
  let pages: PostPage[]
  if (mode === 'end') pages = [...doc.pages, ...slides]
  else if (mode === 'replace') pages = [...doc.pages.slice(0, at), ...slides, ...doc.pages.slice(at + 1)]
  else pages = [...doc.pages.slice(0, at + 1), ...slides, ...doc.pages.slice(at + 1)]
  const ratioDiffers = t.document.format.ratio !== doc.format.ratio
  return { doc: touch({ ...doc, pages }, ctx), slideIds: slides.map(s => s.id), formatDiffers: ratioDiffers }
}
