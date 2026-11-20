// Carousel Creator — the editor's state machine. Pure (no React): the page wraps it in useReducer, tests call it directly.
//
// Every content change is an immutable operation from lib/carousel/ops, so undo/redo is just a stack of whole documents. A drag is many small position updates but ONE undo step
// (dragStart remembers the document before the drag; dragEnd commits it as a single history entry).
//
// SELECTION: `selectedIds` is the set of selected top-level elements on the open slide (in the order they were picked); `selectedElementId` is the primary one (the last picked), which the
// inspector edits. Operations on several elements (align, distribute, group, nudge, delete, drag) apply to the whole set.
import type { Background, ElementAnimation, PostDocument, PostElement, SlideTransition } from '../../lib/postDocument'
import {
  CarouselError, addElement, addImages, alignElements, deleteElement, deleteElements, deleteSlide, distributeElements, duplicateElement, duplicateSlide, groupElements, insertSlide, makeImage, makeShape,
  makeText, moveElementLayer, moveElementTo, moveSlide, newSlide, nudgeElements, animateAllEntrances, clearSlideAnimations, setElementAnimation, setSlideMotion, setTransitionForAll, renameSlide, setLockedMany, setSlideBackground, setSlideElements, slideIndex, ungroupElement, updateElement,
  type ElementPatch, type ImageItem, type LayerMove, type OpContext, type SlideMotionPatch,
} from '../../lib/carousel/ops'
import type { AlignMode, AlignTo } from '../../lib/carousel/geometry'
import { buildLayout, themeById, type LayoutId } from '../../lib/carousel/layouts'

export const HISTORY_LIMIT = 60

export interface EditorState {
  doc: PostDocument
  themeId: string
  activeSlideId: string
  /** The primary selected element (the last one picked), or null. */
  selectedElementId: string | null
  /** Every selected top-level element on the open slide. */
  selectedIds: string[]
  past: PostDocument[]
  future: PostDocument[]
  /** Set while a drag is in progress: the document as it was when the drag began. */
  dragBase: PostDocument | null
  /** The latest refused action, in plain words (e.g. "A carousel needs at least one slide"). Cleared by the next successful action. */
  notice: string | null
  /** True when the document has changes that have not been saved. */
  dirty: boolean
}

export type EditorAction =
  | { type: 'load'; doc: PostDocument; themeId: string; activeSlideId?: string }
  | { type: 'selectSlide'; id: string }
  | { type: 'selectElement'; id: string | null; mode?: 'replace' | 'toggle' }
  | { type: 'selectAll' }
  | { type: 'addSlide'; layout: LayoutId }
  | { type: 'deleteSlide'; id: string }
  | { type: 'duplicateSlide'; id: string }
  | { type: 'moveSlide'; id: string; to: number }
  | { type: 'renameSlide'; id: string; name: string }
  | { type: 'applyLayout'; layout: LayoutId }
  | { type: 'setBackground'; background: Background }
  | { type: 'setTitle'; title: string }
  | { type: 'setTheme'; themeId: string }
  | { type: 'addElement'; kind: 'text' | 'shape' | 'image' }
  | { type: 'addImages'; items: ImageItem[] }
  /** Replaces the document with a prepared one (applying a Brand Kit or a template) as ONE undo step; optionally opens a slide and selects elements. */
  | { type: 'commitDoc'; doc: PostDocument; activeSlideId?: string; selectIds?: string[] }
  | { type: 'addPrepared'; element: PostElement }
  | { type: 'addPreparedMany'; elements: PostElement[] }
  | { type: 'slideMotion'; id: string; patch: SlideMotionPatch }
  | { type: 'transitionForAll'; transition: SlideTransition | null }
  | { type: 'elementAnimation'; id: string; phase: ElementAnimation['phase']; anim: ElementAnimation | null }
  | { type: 'animateAll'; kind: string; staggerMs?: number; direction?: ElementAnimation['direction'] }
  | { type: 'clearAnimations' }
  | { type: 'updateElement'; id: string; patch: ElementPatch }
  | { type: 'deleteElement'; id: string }
  | { type: 'deleteSelected' }
  | { type: 'duplicateElement'; id: string }
  | { type: 'layer'; id: string; move: LayerMove }
  | { type: 'reorderElement'; id: string; to: number }
  | { type: 'align'; mode: AlignMode; to: AlignTo }
  | { type: 'distribute'; axis: 'horizontal' | 'vertical' }
  | { type: 'nudge'; dx: number; dy: number }
  | { type: 'group' }
  | { type: 'ungroup'; id?: string }
  | { type: 'lockSelected'; locked: boolean }
  | { type: 'dragStart' }
  /** Resizing / rotating one element during a drag (preview; one undo step at dragEnd). */
  | { type: 'dragMove'; id: string; x?: number; y?: number; width?: number; height?: number; rotation?: number }
  /** Moving every selected element by (dx, dy) from where they were when the drag began. */
  | { type: 'dragDelta'; dx: number; dy: number }
  | { type: 'dragEnd' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'saved' }
  | { type: 'clearNotice' }

const sel = (ids: string[]) => ({ selectedIds: ids, selectedElementId: ids.length ? ids[ids.length - 1] : null })

export function initialState(doc: PostDocument, themeId: string, activeSlideId?: string): EditorState {
  return { doc, themeId, activeSlideId: activeSlideId && doc.pages.some(p => p.id === activeSlideId) ? activeSlideId : doc.pages[0].id, ...sel([]), past: [], future: [], dragBase: null, notice: null, dirty: false }
}

/** Records `next` as a new document, with the old one on the undo stack. */
function commit(s: EditorState, next: PostDocument, patch: Partial<EditorState> = {}): EditorState {
  if (next === s.doc) return { ...s, ...patch }
  return { ...s, ...patch, doc: next, past: [...s.past, s.doc].slice(-HISTORY_LIMIT), future: [], notice: null, dirty: true }
}

const topIds = (doc: PostDocument, pageId: string) => new Set((doc.pages.find(p => p.id === pageId)?.elements ?? []).map(e => e.id))
/** Keeps only the selected ids that still exist at the top level of `pageId` in `doc`. */
const cleanIds = (doc: PostDocument, pageId: string, ids: string[]): string[] => { const t = topIds(doc, pageId); return ids.filter(i => t.has(i)) }

export function editorReducer(s: EditorState, a: EditorAction, ctx?: OpContext): EditorState {
  try {
    return reduce(s, a, ctx)
  } catch (e) {
    if (e instanceof CarouselError) return { ...s, notice: e.message }
    throw e
  }
}

function reduce(s: EditorState, a: EditorAction, ctx?: OpContext): EditorState {
  const active = s.activeSlideId
  switch (a.type) {
    case 'load': return initialState(a.doc, a.themeId, a.activeSlideId)
    case 'selectSlide': return s.doc.pages.some(p => p.id === a.id) ? { ...s, activeSlideId: a.id, ...sel([]) } : s
    case 'selectElement': {
      if (a.id === null) return { ...s, ...sel([]) }
      if (!topIds(s.doc, active).has(a.id)) return s
      if (a.mode === 'toggle') return { ...s, ...sel(s.selectedIds.includes(a.id) ? s.selectedIds.filter(i => i !== a.id) : [...s.selectedIds, a.id]) }
      return { ...s, ...sel([a.id]) }
    }
    case 'selectAll': return { ...s, ...sel(s.doc.pages.find(p => p.id === active)?.elements.map(e => e.id) ?? []) }
    case 'addSlide': {
      const built = buildLayout(a.layout, s.doc.format, themeById(s.themeId), {}, ctx)
      const page = newSlide(built.background, built.elements, `${s.doc.pages.length + 1}. ${a.layout === 'cta' ? 'Call to action' : a.layout.replace('_', ' ').replace(/^./, c => c.toUpperCase())}`, ctx)
      const next = insertSlide(s.doc, page, slideIndex(s.doc, active) + 1, ctx)
      return commit(s, next, { activeSlideId: page.id, ...sel([]) })
    }
    case 'deleteSlide': {
      const i = slideIndex(s.doc, a.id)
      const next = deleteSlide(s.doc, a.id, ctx)
      const nextActive = a.id === active ? next.pages[Math.min(i, next.pages.length - 1)].id : active
      return commit(s, next, { activeSlideId: nextActive, ...sel([]) })
    }
    case 'duplicateSlide': {
      const r = duplicateSlide(s.doc, a.id, ctx)
      return commit(s, r.doc, { activeSlideId: r.slideId, ...sel([]) })
    }
    case 'moveSlide': return commit(s, moveSlide(s.doc, a.id, a.to, ctx))
    case 'renameSlide': return commit(s, renameSlide(s.doc, a.id, a.name, ctx))
    case 'applyLayout': {
      const built = buildLayout(a.layout, s.doc.format, themeById(s.themeId), {}, ctx)
      return commit(s, setSlideElements(setSlideBackground(s.doc, active, built.background, ctx), active, built.elements, ctx), { ...sel([]) })
    }
    case 'setBackground': return commit(s, setSlideBackground(s.doc, active, a.background, ctx))
    case 'setTitle': return commit(s, { ...s.doc, title: a.title })
    case 'setTheme': return { ...s, themeId: a.themeId, dirty: true }
    case 'addElement': {
      const el = a.kind === 'text' ? makeText(s.doc.format, {}, ctx) : a.kind === 'shape' ? makeShape({}, ctx) : makeImage({}, ctx)
      return commit(s, addElement(s.doc, active, el, ctx), { ...sel([el.id]) })
    }
    case 'addImages': {
      const r = addImages(s.doc, active, a.items, ctx)
      return commit(s, r.doc, { ...sel(r.ids) })
    }
    case 'commitDoc': {
      const open = a.activeSlideId && a.doc.pages.some(p => p.id === a.activeSlideId) ? a.activeSlideId : (a.doc.pages.some(p => p.id === active) ? active : a.doc.pages[0].id)
      return commit(s, a.doc, { activeSlideId: open, ...sel(cleanIds(a.doc, open, a.selectIds ?? [])) })
    }
    case 'slideMotion': return commit(s, setSlideMotion(s.doc, a.id, a.patch, ctx))
    case 'transitionForAll': return commit(s, setTransitionForAll(s.doc, a.transition, ctx))
    case 'elementAnimation': return commit(s, setElementAnimation(s.doc, active, a.id, a.phase, a.anim, ctx))
    case 'animateAll': return commit(s, animateAllEntrances(s.doc, active, a.kind, { staggerMs: a.staggerMs, direction: a.direction }, ctx))
    case 'clearAnimations': return commit(s, clearSlideAnimations(s.doc, active, ctx))
    case 'addPreparedMany': {
      let next = s.doc
      for (const e of a.elements) next = addElement(next, active, e, ctx)
      return commit(s, next, { ...sel(a.elements.map(e => e.id)) })
    }
    case 'addPrepared': return commit(s, addElement(s.doc, active, a.element, ctx), { ...sel([a.element.id]) })
    case 'updateElement': return commit(s, updateElement(s.doc, active, a.id, a.patch, ctx))
    case 'deleteElement': return commit(s, deleteElement(s.doc, active, a.id, ctx), { ...sel(s.selectedIds.filter(i => i !== a.id)) })
    case 'deleteSelected': {
      const next = deleteElements(s.doc, active, s.selectedIds, ctx)
      return commit(s, next, { ...sel(cleanIds(next, active, s.selectedIds)) })
    }
    case 'duplicateElement': {
      const r = duplicateElement(s.doc, active, a.id, ctx)
      return commit(s, r.doc, { ...sel([r.elementId]) })
    }
    case 'layer': return commit(s, moveElementLayer(s.doc, active, a.id, a.move, ctx))
    case 'reorderElement': return commit(s, moveElementTo(s.doc, active, a.id, a.to, ctx))
    case 'align': return commit(s, alignElements(s.doc, active, s.selectedIds, a.mode, a.to, ctx))
    case 'distribute': return commit(s, distributeElements(s.doc, active, s.selectedIds, a.axis, ctx))
    case 'nudge': return commit(s, nudgeElements(s.doc, active, s.selectedIds, a.dx, a.dy, ctx))
    case 'group': {
      const r = groupElements(s.doc, active, s.selectedIds, ctx)
      return commit(s, r.doc, { ...sel([r.groupId]) })
    }
    case 'ungroup': {
      const r = ungroupElement(s.doc, active, a.id ?? s.selectedElementId ?? '', ctx)
      return commit(s, r.doc, { ...sel(r.ids) })
    }
    case 'lockSelected': return commit(s, setLockedMany(s.doc, active, s.selectedIds, a.locked, ctx))
    case 'dragStart': return s.dragBase ? s : { ...s, dragBase: s.doc }
    case 'dragMove': {
      if (!s.dragBase) return s
      // preview only: replace the document without touching history
      const patch: ElementPatch = {}
      if (a.x !== undefined) patch.x = a.x
      if (a.y !== undefined) patch.y = a.y
      if (a.width !== undefined) patch.width = a.width
      if (a.height !== undefined) patch.height = a.height
      if (a.rotation !== undefined) patch.rotation = a.rotation
      return { ...s, doc: updateElement(s.dragBase, active, a.id, patch, ctx), dirty: true }
    }
    case 'dragDelta': {
      if (!s.dragBase) return s
      return { ...s, doc: nudgeElements(s.dragBase, active, s.selectedIds, a.dx, a.dy, ctx), dirty: true }
    }
    case 'dragEnd': {
      if (!s.dragBase) return s
      const base = s.dragBase
      if (base === s.doc) return { ...s, dragBase: null }
      return { ...s, dragBase: null, past: [...s.past, base].slice(-HISTORY_LIMIT), future: [], notice: null }
    }
    case 'undo': {
      if (s.past.length === 0) return s
      const prev = s.past[s.past.length - 1]
      const activeSlideId = prev.pages.some(p => p.id === active) ? active : prev.pages[0].id
      return { ...s, doc: prev, past: s.past.slice(0, -1), future: [s.doc, ...s.future].slice(0, HISTORY_LIMIT), activeSlideId, ...sel(cleanIds(prev, activeSlideId, s.selectedIds)), dirty: true, notice: null, dragBase: null }
    }
    case 'redo': {
      if (s.future.length === 0) return s
      const nextDoc = s.future[0]
      const activeSlideId = nextDoc.pages.some(p => p.id === active) ? active : nextDoc.pages[0].id
      return { ...s, doc: nextDoc, future: s.future.slice(1), past: [...s.past, s.doc].slice(-HISTORY_LIMIT), activeSlideId, ...sel(cleanIds(nextDoc, activeSlideId, s.selectedIds)), dirty: true, notice: null }
    }
    case 'saved': return { ...s, dirty: false }
    case 'clearNotice': return { ...s, notice: null }
  }
}
