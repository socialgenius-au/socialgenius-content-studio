// Carousel Creator — pure, immutable operations on a multi-page PostDocument.
//
// A carousel IS a PostDocument whose `pages` are the slides (array order = swipe order). Nothing here touches React, the DOM or storage; every function returns a NEW
// document (the input is never mutated), bumps `revision` and `updatedAt`, and keeps the document valid (unique ids across the whole document, geometry in range).
import type {
  Background, DocumentFormat, ElementAnimation, GroupElement, ImageElement, PostDocument, PostElement, PostPage, ShapeElement, SlideSequence, SlideTransition, TextElement,
} from '../postDocument'
import { alignBoxes, distributeBoxes, elementBox, unionBox, type AlignMode, type AlignTo } from './geometry'
import { defaultAnimation, withAnimation, DEFAULT_SEQUENCE } from './animation'

export const MIN_SLIDES = 1

export class CarouselError extends Error {
  constructor(message: string, readonly code: 'last_slide' | 'not_found' | 'bad_order' | 'locked' | 'bad_selection') {
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


// ── several elements at once: align, distribute, nudge, delete, group ────────────────────────
//
// Each of these is ONE document change (one undo step). Locked elements are never moved, deleted or grouped; when everything chosen is locked the operation says so instead of
// silently doing nothing.

const chosen = (page: PostPage, ids: string[]) => page.elements.filter(e => ids.includes(e.id))

function movable(page: PostPage, ids: string[]): PostElement[] {
  const all = chosen(page, ids)
  if (all.length === 0) throw new CarouselError('Nothing is selected on this slide', 'not_found')
  const free = all.filter(e => !e.locked)
  if (free.length === 0) throw new CarouselError('The selected elements are locked', 'locked')
  return free
}

/** Applies a position patch (x and/or y) to each element in `patches` (a map of id -> patch). */
function applyPositions(page: PostPage, patches: Map<string, { x?: number; y?: number }>): PostPage {
  return { ...page, elements: page.elements.map(e => { const pt = patches.get(e.id); return pt ? normalizeGeometry({ ...e, ...pt } as PostElement) : e }) }
}

export function alignElements(doc: PostDocument, pageId: string, ids: string[], mode: AlignMode, to: AlignTo, ctx?: OpContext): PostDocument {
  return replacePage(doc, pageId, p => {
    const els = movable(p, ids)
    const target = to === 'selection' && els.length < 2 ? 'canvas' : to          // a single element aligns to the canvas
    const out = alignBoxes(els.map(e => elementBox(e, doc.format)), mode, target)
    return applyPositions(p, new Map(els.map((e, i) => [e.id, out[i]])))
  }, ctx)
}

export function distributeElements(doc: PostDocument, pageId: string, ids: string[], axis: 'horizontal' | 'vertical', ctx?: OpContext): PostDocument {
  return replacePage(doc, pageId, p => {
    const els = movable(p, ids)
    if (els.length < 3) throw new CarouselError('Select at least three elements to distribute them evenly', 'bad_selection')
    const out = distributeBoxes(els.map(e => elementBox(e, doc.format)), axis)
    return applyPositions(p, new Map(els.map((e, i) => [e.id, out[i]])))
  }, ctx)
}

export function nudgeElements(doc: PostDocument, pageId: string, ids: string[], dx: number, dy: number, ctx?: OpContext): PostDocument {
  return replacePage(doc, pageId, p => {
    const els = movable(p, ids)
    return applyPositions(p, new Map(els.map(e => [e.id, { x: e.x + dx, y: e.y + dy }])))
  }, ctx)
}

export function deleteElements(doc: PostDocument, pageId: string, ids: string[], ctx?: OpContext): PostDocument {
  return replacePage(doc, pageId, p => {
    const gone = new Set(movable(p, ids).map(e => e.id))
    return { ...p, elements: p.elements.filter(e => !gone.has(e.id)) }
  }, ctx)
}

/** Locks or unlocks several elements at once. */
export function setLockedMany(doc: PostDocument, pageId: string, ids: string[], locked: boolean, ctx?: OpContext): PostDocument {
  return replacePage(doc, pageId, p => {
    if (chosen(p, ids).length === 0) throw new CarouselError('Nothing is selected on this slide', 'not_found')
    return { ...p, elements: p.elements.map(e => (ids.includes(e.id) ? { ...e, locked } : e)) }
  }, ctx)
}

/** Moves an element to an exact place in the paint order (0 = back). Used by drag-to-reorder in the Layers panel. */
export function moveElementTo(doc: PostDocument, pageId: string, elementId: string, toIndex: number, ctx?: OpContext): PostDocument {
  const page = getSlide(doc, pageId)
  const from = findTop(page, elementId)
  const to = clamp(Math.round(toIndex), 0, page.elements.length - 1)
  if (to === from) return doc
  return replacePage(doc, pageId, p => {
    const els = p.elements.slice()
    const [e] = els.splice(from, 1)
    els.splice(to, 0, e)
    return { ...p, elements: els }
  }, ctx)
}

/**
 * Groups two or more top-level elements. The group's box is the union of their boxes; each child keeps its place and size, now expressed relative to the group (the document
 * model's rule for groups). The group sits where its front-most member was. Text keeps its size (typography is relative to the canvas, not to the group).
 */
export function groupElements(doc: PostDocument, pageId: string, ids: string[], ctx?: OpContext): { doc: PostDocument; groupId: string } {
  let groupId = ''
  const next = replacePage(doc, pageId, p => {
    const members = chosen(p, ids)
    if (members.length < 2) throw new CarouselError('Select at least two elements to group them', 'bad_selection')
    if (members.some(m => m.locked)) throw new CarouselError('Unlock the selected elements before grouping them', 'locked')
    const g = unionBox(members.map(m => elementBox(m, doc.format)))
    const gw = Math.max(g.w, 0.01), gh = Math.max(g.h, 0.01)
    const rel = (v: number) => Math.round(v * 1e6) / 1e6
    const children = members.map(m => ({
      ...m, x: rel(clamp((m.x - g.x) / gw, 0, 1)), y: rel(clamp((m.y - g.y) / gh, 0, 1)), width: rel(clamp(m.width / gw, 0.001, 1)),
      height: m.height === 'auto' ? 'auto' as const : rel(clamp(m.height / gh, 0.001, 1)),
    })) as PostElement[]
    const group: GroupElement = {
      id: idOf(ctx, 'grp'), type: 'group', role: 'decorative', name: 'Group', x: g.x, y: g.y, width: gw, height: gh, rotation: 0, opacity: 1, visible: true, locked: false, children, origin: 'manual',
    }
    groupId = group.id
    const topIndex = Math.max(...members.map(m => p.elements.indexOf(m)))
    const before = p.elements.slice(0, topIndex + 1).filter(e => !members.includes(e))
    const after = p.elements.slice(topIndex + 1)
    return { ...p, elements: [...before, group, ...after] }
  }, ctx)
  return { doc: next, groupId }
}

/** Dissolves a group: its children become top-level elements again at the same place on the canvas (a rotated group rotates its children into place). */
export function ungroupElement(doc: PostDocument, pageId: string, groupId: string, ctx?: OpContext): { doc: PostDocument; ids: string[] } {
  let ids: string[] = []
  const next = replacePage(doc, pageId, p => {
    const i = findTop(p, groupId)
    const g = p.elements[i]
    if (g.type !== 'group') throw new CarouselError('That element is not a group', 'bad_selection')
    if (g.locked) throw new CarouselError('Unlock the group first', 'locked')
    const W = doc.format.width, H = doc.format.height
    const gh = g.height === 'auto' ? 0.1 : g.height
    const theta = (g.rotation * Math.PI) / 180
    const gcx = (g.x + g.width / 2) * W, gcy = (g.y + gh / 2) * H
    const out = g.children.map(c => {
      const absW = c.width * g.width
      const absX = g.x + c.x * g.width
      const absY = g.y + c.y * gh
      const abs = { ...c, x: absX, y: absY, width: absW, height: c.height === 'auto' ? 'auto' as const : c.height * gh } as PostElement
      const box = elementBox(abs, doc.format)
      let x = absX, y = absY, rotation = c.rotation
      if (g.rotation) {
        const dx = (box.x + box.w / 2) * W - gcx, dy = (box.y + box.h / 2) * H - gcy
        const rx = dx * Math.cos(theta) - dy * Math.sin(theta), ry = dx * Math.sin(theta) + dy * Math.cos(theta)
        x = (gcx + rx) / W - box.w / 2
        y = (gcy + ry) / H - box.h / 2
        rotation = c.rotation + g.rotation
      }
      return normalizeGeometry({ ...abs, x, y, rotation, opacity: c.opacity * g.opacity, visible: c.visible && g.visible, locked: false } as PostElement)
    })
    ids = out.map(e => e.id)
    return { ...p, elements: [...p.elements.slice(0, i), ...out, ...p.elements.slice(i + 1)] }
  }, ctx)
  return { doc: next, ids }
}

// ── motion settings (stored with the slide / element; static exports ignore them) ───────────

export interface SlideMotionPatch { transition?: SlideTransition | null; durationMs?: number | null; sequence?: SlideSequence | null }

/** Sets (or, with null, clears) a slide's transition, hold time and sequencing. Fields not mentioned are left alone. */
export function setSlideMotion(doc: PostDocument, pageId: string, patch: SlideMotionPatch, ctx?: OpContext): PostDocument {
  return replacePage(doc, pageId, p => {
    const next: PostPage = { ...p }
    for (const key of ['transition', 'durationMs', 'sequence'] as const) {
      if (!(key in patch)) continue
      const v = patch[key]
      if (v === null || v === undefined) delete next[key]
      else (next as unknown as Record<string, unknown>)[key] = v
    }
    return next
  }, ctx)
}

/** Gives every slide after the first the same transition (the first slide has nothing to arrive from). */
export function setTransitionForAll(doc: PostDocument, transition: SlideTransition | null, ctx?: OpContext): PostDocument {
  const pages = doc.pages.map((p, i) => {
    if (i === 0) return p
    const next: PostPage = { ...p }
    if (transition) next.transition = transition; else delete next.transition
    return next
  })
  return touch({ ...doc, pages }, ctx)
}

/** Sets (or, with null, removes) one phase (entrance / exit / emphasis) of an element's animation. Other phases are kept. */
export function setElementAnimation(doc: PostDocument, pageId: string, elementId: string, phase: ElementAnimation['phase'], anim: ElementAnimation | null, ctx?: OpContext): PostDocument {
  return replacePage(doc, pageId, p => {
    const i = findTop(p, elementId)
    const els = p.elements.slice()
    els[i] = withAnimation(els[i], phase, anim)
    return { ...p, elements: els }
  }, ctx)
}

/** Gives every visible, unlocked element on the slide the same entrance, played one after another (staggered) in layer order. Replaces any existing entrance; keeps exits and emphasis. */
export function animateAllEntrances(doc: PostDocument, pageId: string, kind: string, opts: { staggerMs?: number; direction?: ElementAnimation['direction'] } = {}, ctx?: OpContext): PostDocument {
  return replacePage(doc, pageId, p => ({
    ...p,
    sequence: { ...(p.sequence ?? DEFAULT_SEQUENCE), mode: 'stagger', staggerMs: opts.staggerMs ?? 150 },
    elements: p.elements.map(e => (e.visible && !e.locked ? withAnimation(e, 'entrance', { ...defaultAnimation('entrance', kind, idOf(ctx, 'anim')), ...(opts.direction ? { direction: opts.direction } : {}) }) : e)),
  }), ctx)
}

/** Removes every animation from every element on the slide. */
export function clearSlideAnimations(doc: PostDocument, pageId: string, ctx?: OpContext): PostDocument {
  return replacePage(doc, pageId, p => ({ ...p, elements: p.elements.map(e => (e.animations ? { ...e, animations: undefined } : e)) }), ctx)
}

export interface ImageItem { assetId: number; url: string; name: string }

/** Adds several pictures at once, laid out in a tidy grid (one picture: large and centred). Every picture is its own element, free to move, resize, overlap and reorder afterwards. */
export function addImages(doc: PostDocument, pageId: string, items: ImageItem[], ctx?: OpContext): { doc: PostDocument; ids: string[] } {
  if (items.length === 0) return { doc, ids: [] }
  const W = doc.format.width, H = doc.format.height
  const margin = 0.12, gap = 0.02
  const n = items.length
  const cols = n === 1 ? 1 : Math.ceil(Math.sqrt(n))
  const rows = Math.ceil(n / cols)
  const cellW = (1 - 2 * margin - gap * (cols - 1)) / cols
  const cellH = n === 1 ? 0.36 : Math.min((cellW * W) / H, (1 - 2 * margin - gap * (rows - 1)) / rows)
  const gridH = rows * cellH + (rows - 1) * gap
  const top = n === 1 ? 0.32 : Math.max(margin, (1 - gridH) / 2)
  const els = items.map((it, i) => makeImage({
    name: it.name.slice(0, 80) || 'Image', source: { kind: 'asset', assetId: it.assetId, url: it.url }, alt: it.name.slice(0, 120),
    x: margin + (i % cols) * (cellW + gap), y: top + Math.floor(i / cols) * (cellH + gap), width: cellW, height: cellH, fit: 'contain', lockAspect: true,
  }, ctx))
  let d = doc
  for (const e of els) d = addElement(d, pageId, e, ctx)
  return { doc: d, ids: els.map(e => e.id) }
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
