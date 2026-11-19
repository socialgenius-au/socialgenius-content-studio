import { describe, expect, it } from 'vitest'
import { validatePostDocument } from '../../lib/postDocument'
import { createCarouselDocument } from '../../lib/carousel/document'
import { HISTORY_LIMIT, editorReducer, initialState, type EditorAction, type EditorState } from './editorState'
import type { OpContext } from '../../lib/carousel/ops'

function ctx(): OpContext { let n = 0; let t = Date.UTC(2026, 10, 19); return { newId: p => `${p}_${++n}`, now: () => new Date((t += 1000)) } }
const start = (c = ctx()) => initialState(createCarouselDocument({ title: 'T', layouts: ['cover', 'title_body', 'cta'] }, c), 'forest')
const run = (s: EditorState, c: OpContext, ...actions: EditorAction[]) => actions.reduce((st, a) => editorReducer(st, a, c), s)
const names = (s: EditorState) => s.doc.pages.map(p => p.name)

describe('editor state: slides', () => {
  it('starts on the first slide, clean, with nothing selected', () => {
    const s = start()
    expect(s.activeSlideId).toBe(s.doc.pages[0].id)
    expect(s).toMatchObject({ selectedElementId: null, dirty: false, past: [], future: [], notice: null })
  })

  it('adds a slide after the active one, selects it and marks the carousel as changed', () => {
    const c = ctx()
    const s = run(start(c), c, { type: 'selectSlide', id: start(c).doc.pages[0].id })
    const s0 = start(c)
    const s1 = run(s0, c, { type: 'addSlide', layout: 'quote' })
    expect(s1.doc.pages).toHaveLength(4)
    expect(s1.doc.pages[1].id).toBe(s1.activeSlideId)
    expect(s1.doc.pages[1].elements.map(e => e.name)).toEqual(['Quote mark', 'Quote', 'Attribution'])
    expect(s1.dirty).toBe(true)
    expect(s1.past).toHaveLength(1)
    expect(s.dirty).toBe(false)
    expect(validatePostDocument(s1.doc).ok).toBe(true)
  })

  it('deleting the active slide moves to the neighbour; deleting the last remaining slide is refused with a notice', () => {
    const c = ctx()
    let s = run(start(c), c, { type: 'selectSlide', id: start(c).doc.pages[1].id })
    s = initialState(start(c).doc, 'forest')
    s = run(s, c, { type: 'selectSlide', id: s.doc.pages[1].id }, { type: 'deleteSlide', id: s.doc.pages[1].id })
    expect(s.doc.pages).toHaveLength(2)
    expect(s.activeSlideId).toBe(s.doc.pages[1].id)                       // the slide that took its place
    s = run(s, c, { type: 'deleteSlide', id: s.doc.pages[0].id })
    expect(s.doc.pages).toHaveLength(1)
    const before = s
    s = run(s, c, { type: 'deleteSlide', id: s.doc.pages[0].id })
    expect(s.doc).toBe(before.doc)
    expect(s.notice).toMatch(/at least one slide/)
    expect(run(s, c, { type: 'addSlide', layout: 'cover' }).notice).toBeNull()      // a successful action clears the notice
  })

  it('duplicates, moves and renames slides', () => {
    const c = ctx()
    let s = start(c)
    const [a, b, d] = s.doc.pages.map(p => p.id)
    s = run(s, c, { type: 'duplicateSlide', id: a })
    expect(s.doc.pages).toHaveLength(4)
    expect(s.activeSlideId).toBe(s.doc.pages[1].id)
    s = run(s, c, { type: 'moveSlide', id: d, to: 0 }, { type: 'renameSlide', id: b, name: 'Why tiles' })
    expect(s.doc.pages[0].id).toBe(d)
    expect(names(s)).toContain('Why tiles')
  })
})

describe('editor state: elements', () => {
  it('adds, edits, layers, duplicates and deletes elements on the active slide, tracking the selection', () => {
    const c = ctx()
    let s = start(c)
    const count = s.doc.pages[0].elements.length
    s = run(s, c, { type: 'addElement', kind: 'text' })
    expect(s.doc.pages[0].elements).toHaveLength(count + 1)
    const id = s.selectedElementId!
    expect(s.doc.pages[0].elements[count].id).toBe(id)
    s = run(s, c, { type: 'updateElement', id, patch: { content: 'Edited', style: { fontSize: 0.09 } } as never })
    const el = s.doc.pages[0].elements.find(e => e.id === id)!
    expect(el.type === 'text' && el.content).toBe('Edited')
    s = run(s, c, { type: 'layer', id, move: 'back' })
    expect(s.doc.pages[0].elements[0].id).toBe(id)
    s = run(s, c, { type: 'duplicateElement', id })
    expect(s.selectedElementId).not.toBe(id)
    expect(s.doc.pages[0].elements).toHaveLength(count + 2)
    s = run(s, c, { type: 'deleteElement', id: s.selectedElementId! })
    expect(s.selectedElementId).toBeNull()
    expect(validatePostDocument(s.doc).ok).toBe(true)
  })

  it('selecting an element that is not on the document clears the selection', () => {
    const c = ctx()
    const s = run(start(c), c, { type: 'selectElement', id: 'nope' })
    expect(s.selectedElementId).toBeNull()
  })

  it('switching slides clears the element selection; applying a layout replaces the slide content', () => {
    const c = ctx()
    let s = start(c)
    s = run(s, c, { type: 'selectElement', id: s.doc.pages[0].elements[0].id })
    expect(s.selectedElementId).not.toBeNull()
    s = run(s, c, { type: 'selectSlide', id: s.doc.pages[1].id })
    expect(s.selectedElementId).toBeNull()
    s = run(s, c, { type: 'applyLayout', layout: 'statement' })
    expect(s.doc.pages[1].elements.map(e => e.name)).toEqual(['Accent bar', 'Statement'])
    expect(s.doc.pages[1].id).toBe(s.activeSlideId)
  })

  it('a locked element cannot be edited and the reason is shown', () => {
    const c = ctx()
    let s = start(c)
    const id = s.doc.pages[0].elements[0].id
    s = run(s, c, { type: 'updateElement', id, patch: { locked: true } })
    s = run(s, c, { type: 'updateElement', id, patch: { x: 0.5 } })
    expect(s.notice).toMatch(/locked/)
  })
})

describe('editor state: undo and redo', () => {
  it('undoes and redoes whole steps, and a new edit after an undo discards the redo branch', () => {
    const c = ctx()
    let s = start(c)
    s = run(s, c, { type: 'addSlide', layout: 'quote' }, { type: 'addSlide', layout: 'list' })
    expect(s.doc.pages).toHaveLength(5)
    s = run(s, c, { type: 'undo' })
    expect(s.doc.pages).toHaveLength(4)
    expect(s.future).toHaveLength(1)
    s = run(s, c, { type: 'undo' }, { type: 'undo' })
    expect(s.doc.pages).toHaveLength(3)
    expect(run(s, c, { type: 'undo' })).toBe(s)                       // nothing more to undo
    s = run(s, c, { type: 'redo' })
    expect(s.doc.pages).toHaveLength(4)
    s = run(s, c, { type: 'addSlide', layout: 'statement' })
    expect(s.future).toHaveLength(0)
    expect(run(s, c, { type: 'redo' })).toBe(s)
  })

  it('keeps the open slide valid when undo removes it', () => {
    const c = ctx()
    let s = run(start(c), c, { type: 'addSlide', layout: 'quote' })
    const added = s.activeSlideId
    s = run(s, c, { type: 'undo' })
    expect(s.doc.pages.some(p => p.id === added)).toBe(false)
    expect(s.doc.pages.some(p => p.id === s.activeSlideId)).toBe(true)
  })

  it('limits the history so a long session cannot grow without bound', () => {
    const c = ctx()
    let s = start(c)
    const id = s.doc.pages[0].elements[1].id
    for (let i = 0; i < HISTORY_LIMIT + 25; i++) s = run(s, c, { type: 'updateElement', id, patch: { content: `v${i}` } as never })
    expect(s.past).toHaveLength(HISTORY_LIMIT)
  })
})

describe('editor state: dragging', () => {
  it('moves an element live and records the whole drag as ONE undo step', () => {
    const c = ctx()
    let s = start(c)
    const id = s.doc.pages[0].elements[1].id
    const x0 = s.doc.pages[0].elements[1].x
    s = run(s, c, { type: 'dragStart' })
    for (let i = 1; i <= 10; i++) s = run(s, c, { type: 'dragMove', id, x: x0 + i * 0.005, y: 0.3 })
    expect(s.past).toHaveLength(0)                                    // nothing recorded while dragging
    s = run(s, c, { type: 'dragEnd' })
    expect(s.past).toHaveLength(1)
    expect(s.doc.pages[0].elements[1].x).toBeCloseTo(x0 + 0.05, 5)
    s = run(s, c, { type: 'undo' })
    expect(s.doc.pages[0].elements[1].x).toBe(x0)
  })

  it('a click without movement adds no history; dragMove without dragStart is ignored', () => {
    const c = ctx()
    let s = start(c)
    const id = s.doc.pages[0].elements[1].id
    expect(run(s, c, { type: 'dragMove', id, x: 0.9, y: 0.9 })).toBe(s)
    s = run(s, c, { type: 'dragStart' }, { type: 'dragEnd' })
    expect(s.past).toHaveLength(0)
    expect(s.dragBase).toBeNull()
  })
})

describe('editor state: saving and loading', () => {
  it('tracks unsaved changes, and loading replaces everything', () => {
    const c = ctx()
    let s = run(start(c), c, { type: 'setTitle', title: 'New name' })
    expect(s.dirty).toBe(true)
    s = run(s, c, { type: 'saved' })
    expect(s.dirty).toBe(false)
    const other = createCarouselDocument({ title: 'Other', layouts: ['cover'] }, c)
    s = run(s, c, { type: 'load', doc: other, themeId: 'ink', activeSlideId: 'missing' })
    expect(s).toMatchObject({ themeId: 'ink', dirty: false, past: [], future: [] })
    expect(s.activeSlideId).toBe(other.pages[0].id)
  })

  it('changing the theme only affects slides added later', () => {
    const c = ctx()
    let s = run(start(c), c, { type: 'setTheme', themeId: 'ink' })
    const before = s.doc
    expect(s.doc.pages[0].background).toEqual(before.pages[0].background)
    s = run(s, c, { type: 'addSlide', layout: 'statement' })
    expect(s.doc.pages[1].background).toEqual({ kind: 'solid', color: '#111827' })
    expect(s.doc.pages[0].background).toEqual({ kind: 'solid', color: '#1E4D2B' })
  })
})
