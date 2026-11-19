// Carousel Creator — the editor's state machine. Pure (no React): the page wraps it in useReducer, tests call it directly.
//
// Every content change is an immutable operation from lib/carousel/ops, so undo/redo is just a stack of whole documents. A drag is many small position updates but ONE undo step
// (dragStart remembers the document before the drag; dragEnd commits it as a single history entry).
import type { Background, PostDocument } from '../../lib/postDocument'
import {
  CarouselError, addElement, deleteElement, deleteSlide, duplicateElement, duplicateSlide, insertSlide, makeImage, makeShape, makeText, moveElementLayer, moveSlide,
  newSlide, renameSlide, setSlideBackground, setSlideElements, slideIndex, updateElement, type ElementPatch, type LayerMove, type OpContext,
} from '../../lib/carousel/ops'
import { buildLayout, themeById, type LayoutId } from '../../lib/carousel/layouts'

export const HISTORY_LIMIT = 60

export interface EditorState {
  doc: PostDocument
  themeId: string
  activeSlideId: string
  selectedElementId: string | null
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
  | { type: 'selectElement'; id: string | null }
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
  | { type: 'updateElement'; id: string; patch: ElementPatch }
  | { type: 'deleteElement'; id: string }
  | { type: 'duplicateElement'; id: string }
  | { type: 'layer'; id: string; move: LayerMove }
  | { type: 'dragStart' }
  | { type: 'dragMove'; id: string; x?: number; y?: number; width?: number; height?: number }
  | { type: 'dragEnd' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'saved' }
  | { type: 'clearNotice' }

export function initialState(doc: PostDocument, themeId: string, activeSlideId?: string): EditorState {
  return { doc, themeId, activeSlideId: activeSlideId && doc.pages.some(p => p.id === activeSlideId) ? activeSlideId : doc.pages[0].id, selectedElementId: null, past: [], future: [], dragBase: null, notice: null, dirty: false }
}

/** Records `next` as a new document, with the old one on the undo stack. */
function commit(s: EditorState, next: PostDocument, patch: Partial<EditorState> = {}): EditorState {
  if (next === s.doc) return { ...s, ...patch }
  return { ...s, ...patch, doc: next, past: [...s.past, s.doc].slice(-HISTORY_LIMIT), future: [], notice: null, dirty: true }
}

const clean = (s: EditorState, id: string | null): string | null => (id && s.doc.pages.some(p => p.elements.some(e => e.id === id)) ? id : null)

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
    case 'selectSlide': return s.doc.pages.some(p => p.id === a.id) ? { ...s, activeSlideId: a.id, selectedElementId: null } : s
    case 'selectElement': return { ...s, selectedElementId: a.id === null ? null : clean(s, a.id) }
    case 'addSlide': {
      const built = buildLayout(a.layout, s.doc.format, themeById(s.themeId), {}, ctx)
      const page = newSlide(built.background, built.elements, `${s.doc.pages.length + 1}. ${a.layout === 'cta' ? 'Call to action' : a.layout.replace('_', ' ').replace(/^./, c => c.toUpperCase())}`, ctx)
      const next = insertSlide(s.doc, page, slideIndex(s.doc, active) + 1, ctx)
      return commit(s, next, { activeSlideId: page.id, selectedElementId: null })
    }
    case 'deleteSlide': {
      const i = slideIndex(s.doc, a.id)
      const next = deleteSlide(s.doc, a.id, ctx)
      const nextActive = a.id === active ? next.pages[Math.min(i, next.pages.length - 1)].id : active
      return commit(s, next, { activeSlideId: nextActive, selectedElementId: null })
    }
    case 'duplicateSlide': {
      const r = duplicateSlide(s.doc, a.id, ctx)
      return commit(s, r.doc, { activeSlideId: r.slideId, selectedElementId: null })
    }
    case 'moveSlide': return commit(s, moveSlide(s.doc, a.id, a.to, ctx))
    case 'renameSlide': return commit(s, renameSlide(s.doc, a.id, a.name, ctx))
    case 'applyLayout': {
      const built = buildLayout(a.layout, s.doc.format, themeById(s.themeId), {}, ctx)
      return commit(s, setSlideElements(setSlideBackground(s.doc, active, built.background, ctx), active, built.elements, ctx), { selectedElementId: null })
    }
    case 'setBackground': return commit(s, setSlideBackground(s.doc, active, a.background, ctx))
    case 'setTitle': return commit(s, { ...s.doc, title: a.title })
    case 'setTheme': return { ...s, themeId: a.themeId, dirty: true }
    case 'addElement': {
      const el = a.kind === 'text' ? makeText(s.doc.format, {}, ctx) : a.kind === 'shape' ? makeShape({}, ctx) : makeImage({}, ctx)
      return commit(s, addElement(s.doc, active, el, ctx), { selectedElementId: el.id })
    }
    case 'updateElement': return commit(s, updateElement(s.doc, active, a.id, a.patch, ctx))
    case 'deleteElement': return commit(s, deleteElement(s.doc, active, a.id, ctx), { selectedElementId: s.selectedElementId === a.id ? null : s.selectedElementId })
    case 'duplicateElement': {
      const r = duplicateElement(s.doc, active, a.id, ctx)
      return commit(s, r.doc, { selectedElementId: r.elementId })
    }
    case 'layer': return commit(s, moveElementLayer(s.doc, active, a.id, a.move, ctx))
    case 'dragStart': return s.dragBase ? s : { ...s, dragBase: s.doc }
    case 'dragMove': {
      if (!s.dragBase) return s
      // preview only: replace the document without touching history
      const patch: ElementPatch = {}
      if (a.x !== undefined) patch.x = a.x
      if (a.y !== undefined) patch.y = a.y
      if (a.width !== undefined) patch.width = a.width
      if (a.height !== undefined) patch.height = a.height
      return { ...s, doc: updateElement(s.doc, active, a.id, patch, ctx), dirty: true }
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
      return { ...s, doc: prev, past: s.past.slice(0, -1), future: [s.doc, ...s.future].slice(0, HISTORY_LIMIT), activeSlideId, selectedElementId: clean({ ...s, doc: prev }, s.selectedElementId), dirty: true, notice: null, dragBase: null }
    }
    case 'redo': {
      if (s.future.length === 0) return s
      const nextDoc = s.future[0]
      const activeSlideId = nextDoc.pages.some(p => p.id === active) ? active : nextDoc.pages[0].id
      return { ...s, doc: nextDoc, future: s.future.slice(1), past: [...s.past, s.doc].slice(-HISTORY_LIMIT), activeSlideId, selectedElementId: clean({ ...s, doc: nextDoc }, s.selectedElementId), dirty: true, notice: null }
    }
    case 'saved': return { ...s, dirty: false }
    case 'clearNotice': return { ...s, notice: null }
  }
}

