// Carousel Creator — pure, immutable operations on a multi-page PostDocument.
//
// A carousel IS a PostDocument whose `pages` are the slides (array order = swipe order). Nothing here touches React, the DOM or storage; every function returns a NEW
// document (the input is never mutated), bumps `revision` and `updatedAt`, and keeps the document valid (unique ids across the whole document, geometry in range).
import type {
  Background, DocumentFormat, ImageElement, PostDocument, PostElement, PostPage, ShapeElement, TextElement,
} from '../postDocument'

export const MIN_SLIDES = 1

export class CarouselError extends Error {
  constructor(message: string, readonly code: 'last_slide' | 'not_found' | 'bad_order' | 'locked') {
    super(message)
    this.name = 'CarouselError'
  }
}

export interface OpContext {
  now?: () => Date
  newId?: (prefix: string) => string
}

let counter = 0
/** Collision-resistant id; `crypto.randomUUID` where available, otherwise time + counter + random. */
export function defaultId(prefix: string): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  const rand = c?.randomUUID ? c.randomUUID().replace(/-/g, '').slice(0, 12) : `${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 8)}`
  return `${prefix}_${rand}`
}

const idOf = (ctx: OpContext | undefined, prefix: string) => (ctx?.newId ?? defaultId)(prefix)
const nowIso = (ctx: OpContext | undefined) => (ctx?.now ?? (() => new Date()))().toISOString()

/** A content edit: revision + 1 and a new updatedAt. */
export function touch(doc: PostDocument, ctx?: OpContext): PostDocument {
  return { ...doc, revision: doc.revision + 1, updatedAt: nowIso(ctx) }
}

// ── lookups ──────────────────────────────────────────────────────────────────────────────────

export const slideIndex = (doc: PostDocument, pageId: string): number => doc.pages.findIndex(p => p.id === pageId)

export function getSlide(doc: PostDocument, pageId: string): PostPage {
  const p = doc.pages.find(x => x.id === pageId)
  if (!p) throw new CarouselError(`Slide "${pageId}" does not exist`, 'not_found')
  return p
}

function replacePage(doc: PostDocument, pageId: string, fn: (p: PostPage) => PostPage, ctx?: OpContext): PostDocument {
  getSlide(doc, pageId)
  return touch({ ...doc, pages: doc.pages.map(p => (p.id === pageId ? fn(p) : p)) }, ctx)
}

// ── cloning (fresh ids so a copy can never collide with its original) ────────────────────────

export function cloneElement(el: PostElement, ctx?: OpContext): PostElement {
  const copy = structuredCloneSafe(el)
  const reid = (e: PostElement): PostElement => {
    const next = { ...e, id: idOf(ctx, e.type === 'group' ? 'grp' : 'el') } as PostElement
    if (next.type === 'group') next.children = next.children.map(reid)
    return next
  }
  return reid(copy)
}

function structuredCloneSafe<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T       // documents are plain JSON by contract (see serialize.ts)
}

// ── slide operations ─────────────────────────────────────────────────────────────────────────

export function newSlide(background: Background, elements: PostElement[], name: string | undefined, ctx?: OpContext): PostPage {
  return { id: idOf(ctx, 'slide'), name, background, elements }
}

/** Inserts a prepared slide at `index` (default: the end). */
export function insertSlide(doc: PostDocument, page: PostPage, index: number | undefined, ctx?: OpContext): PostDocument {
  const at = index === undefined ? doc.pages.length : Math.max(0, Math.min(index, doc.pages.length))
  return touch({ ...doc, pages: [...doc.pages.slice(0, at), page, ...doc.pages.slice(at)] }, ctx)
}

export function deleteSlide(doc: PostDocument, pageId: string, ctx?: OpContext): PostDocument {
  getSlide(doc, pageId)
  if (doc.pages.length <= MIN_SLIDES) throw new CarouselError('A carousel needs at least one slide', 'last_slide')
  return touch({ ...doc, pages: doc.pages.filter(p => p.id !== pageId) }, ctx)
}

/** Duplicates a slide right after the original. Every element (and group child) gets a new id; the copy is independent. */
export function duplicateSlide(doc: PostDocument, pageId: string, ctx?: OpContext): { doc: PostDocument; slideId: string } {
  const src = getSlide(doc, pageId)
  const copy: PostPage = { ...structuredCloneSafe(src), id: idOf(ctx, 'slide'), name: src.name ? `${src.name} (copy)` : undefined, elements: src.elements.map(e => cloneElement(e, ctx)) }
  const at = slideIndex(doc, pageId) + 1
  return { doc: touch({ ...doc, pages: [...doc.pages.slice(0, at), copy, ...doc.pages.slice(at)] }, ctx), slideId: copy.id }
}

/** Moves a slide to `toIndex` (0-based, clamped). Moving to the same place returns the document unchanged (no revision bump). */
export function moveSlide(doc: PostDocument, pageId: string, toIndex: number, ctx?: OpContext): PostDocument {
  const from = slideIndex(doc, pageId)
  if (from < 0) throw new CarouselError(`Slide "${pageId}" does not exist`, 'not_found')
  const to = Math.max(0, Math.min(toIndex, doc.pages.length - 1))
  if (to === from) return doc
  const pages = doc.pages.slice()
  const [p] = pages.splice(from, 1)
  pages.splice(to, 0, p)
  return touch({ ...doc, pages }, ctx)
}

/** Sets the whole slide order; `orderedIds` must be a permutation of the current slide ids. */
export function reorderSlides(doc: PostDocument, orderedIds: string[], ctx?: OpContext): PostDocument {
  const current = doc.pages.map(p => p.id)
  if (orderedIds.length !== current.length || new Set(orderedIds).size !== orderedIds.length || !orderedIds.every(id => current.includes(id))) {
    throw new CarouselError('The new order must list every slide exactly once', 'bad_order')
  }
  if (orderedIds.every((id, i) => id === current[i])) return doc
  const byId = new Map(doc.pages.map(p => [p.id, p]))
  return touch({ ...doc, pages: orderedIds.map(id => byId.get(id)!) }, ctx)
}

export const renameSlide = (doc: PostDocument, pageId: string, name: string, ctx?: OpContext): PostDocument => replacePage(doc, pageId, p => ({ ...p, name: name.trim() || undefined }), ctx)
export const setSlideBackground = (doc: PostDocument, pageId: string, background: Background, ctx?: OpContext): PostDocument => replacePage(doc, pageId, p => ({ ...p, background }), ctx)
/** Replaces every element on a slide (used when applying a layout). */
export const setSlideElements = (doc: PostDocument, pageId: string, elements: PostElement[], ctx?: OpContext): PostDocument => replacePage(doc, pageId, p => ({ ...p, elements }), ctx)

// ── element operations (top-level elements of a slide; groups are kept intact) ──────────────

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/** Keeps geometry valid for the validator (x,y in 0..1; width/height in (0,1]; opacity 0..1) and inside the canvas where it can be. */
export function normalizeGeometry<T extends PostElement>(el: T): T {
  const width = clamp(el.width, 0.01, 1)
  const height = el.height === 'auto' ? 'auto' : clamp(el.height, 0.01, 1)
  return { ...el, width, height, x: clamp(el.x, 0, 1 - Math.min(width, 1)), y: clamp(el.y, 0, height === 'auto' ? 1 : 1 - height), opacity: clamp(el.opacity, 0, 1) }
}

export type ElementPatch = Partial<Omit<PostElement, 'id' | 'type'>> & { style?: Partial<TextElement['style']> }

function findTop(page: PostPage, elementId: string): number {
  const i = page.elements.findIndex(e => e.id === elementId)
  if (i < 0) throw new CarouselError(`Element "${elementId}" is not on this slide`, 'not_found')
  return i
}

export function addElement(doc: PostDocument, pageId: string, el: PostElement, ctx?: OpContext): PostDocument {
  return replacePage(doc, pageId, p => ({ ...p, elements: [...p.elements, normalizeGeometry(el)] }), ctx)
}

export function updateElement(doc: PostDocument, pageId: string, elementId: string, patch: ElementPatch, ctx?: OpContext): PostDocument {
  return replacePage(doc, pageId, p => {
    const i = findTop(p, elementId)
    const cur = p.elements[i]
    if (cur.locked && !('locked' in patch)) throw new CarouselError('This element is locked', 'locked')
    const { style, ...rest } = patch
    let next = { ...cur, ...rest } as PostElement
    if (style && next.type === 'text') next = { ...next, style: { ...next.style, ...style } }
    const elements = p.elements.slice()
    elements[i] = normalizeGeometry(next)
    return { ...p, elements }
  }, ctx)
}

export function deleteElement(doc: PostDocument, pageId: string, elementId: string, ctx?: OpContext): PostDocument {
  return replacePage(doc, pageId, p => { findTop(p, elementId); return { ...p, elements: p.elements.filter(e => e.id !== elementId) } }, ctx)
}

/** Duplicates an element just above the original, nudged so the copy is visibly separate. */
export function duplicateElement(doc: PostDocument, pageId: string, elementId: string, ctx?: OpContext): { doc: PostDocument; elementId: string } {
  let newId = ''
  const next = replacePage(doc, pageId, p => {
    const i = findTop(p, elementId)
    const copy = normalizeGeometry({ ...cloneElement(p.elements[i], ctx), x: Math.min(p.elements[i].x + 0.03, 0.95), y: Math.min(p.elements[i].y + 0.02, 0.95), name: `${p.elements[i].name} (copy)`, locked: false } as PostElement)
    newId = copy.id
    return { ...p, elements: [...p.elements.slice(0, i + 1), copy, ...p.elements.slice(i + 1)] }
  }, ctx)
  return { doc: next, elementId: newId }
}

export type LayerMove = 'forward' | 'backward' | 'front' | 'back'

/** Paint order IS array order (index 0 = back), so layering is just moving within the array. */
export function moveElementLayer(doc: PostDocument, pageId: string, elementId: string, move: LayerMove, ctx?: OpContext): PostDocument {
  const page = getSlide(doc, pageId)
  const from = findTop(page, elementId)
  const last = page.elements.length - 1
  const to = move === 'front' ? last : move === 'back' ? 0 : move === 'forward' ? Math.min(from + 1, last) : Math.max(from - 1, 0)
  if (to === from) return doc
  return replacePage(doc, pageId, p => {
    const els = p.elements.slice()
    const [e] = els.splice(from, 1)
    els.splice(to, 0, e)
    return { ...p, elements: els }
  }, ctx)
}

// ── element factories (sensible defaults; all geometry canvas-relative) ──────────────────────

const WHITE = '#FFFFFF'

export function makeText(format: DocumentFormat, over: Partial<TextElement> = {}, ctx?: OpContext): TextElement {
  return {
    id: idOf(ctx, 'el'), type: 'text', role: 'body_text', name: 'Text', x: 0.08, y: 0.4, width: 0.84, height: 'auto', rotation: 0, opacity: 1, visible: true, locked: false,
    content: 'Your text', autoSize: 'auto-height',
    style: { fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif', fontSize: 0.05, fontWeight: 600, lineHeight: 1.2, align: 'left', color: '#111827' },
    origin: 'manual', ...over,
  } as TextElement
}

export function makeShape(over: Partial<ShapeElement> = {}, ctx?: OpContext): ShapeElement {
  return { id: idOf(ctx, 'el'), type: 'shape', role: 'decorative', name: 'Shape', shape: 'rect', x: 0.1, y: 0.1, width: 0.3, height: 0.2, rotation: 0, opacity: 1, visible: true, locked: false, fill: '#1E8A55', origin: 'manual', ...over }
}

export function makeImage(over: Partial<ImageElement> = {}, ctx?: OpContext): ImageElement {
  return {
    id: idOf(ctx, 'el'), type: 'image', role: 'hero_image', name: 'Image', source: { kind: 'placeholder', label: 'Add image', glyph: 'none' }, fit: 'cover', x: 0.08, y: 0.1, width: 0.84, height: 0.4,
    rotation: 0, opacity: 1, visible: true, locked: false, lockAspect: false, origin: 'manual', ...over,
  }
}

export const WHITE_RGB = WHITE
