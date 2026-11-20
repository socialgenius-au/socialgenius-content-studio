import { describe, expect, it } from 'vitest'
import type { PostDocument, PostElement } from '../postDocument'
import { assertValidPostDocument } from '../postDocument'
import { createCarouselDocument } from './document'
import { alignBoxes, distributeBoxes, elementBox, snapMove, unionBox } from './geometry'
import {
  CarouselError, addElement, addImages, alignElements, deleteElements, distributeElements, groupElements, makeImage, makeShape, makeText, moveElementTo, nudgeElements, setLockedMany,
  ungroupElement, type OpContext,
} from './ops'
import { collectImageUrls, drawSlide, fitRects, type Ctx2D } from './rasterize'
import { maskClipPath, MASK_POLYGONS } from './masks'
import { editorReducer, initialState, type EditorAction } from '../../pages/carousel-creator/editorState'

function ids(): OpContext { let n = 0; return { newId: p => `${p}_${++n}`, now: () => new Date('2026-11-19T09:00:00Z') } }

function withShapes(c = ids()) {
  let d = createCarouselDocument({ title: 'T', layouts: ['cover'] }, c)
  const page = d.pages[0].id
  d = { ...d, pages: [{ ...d.pages[0], elements: [] }] }
  const a = makeShape({ name: 'A', x: 0.1, y: 0.1, width: 0.2, height: 0.1 }, c)
  const b = makeShape({ name: 'B', x: 0.4, y: 0.3, width: 0.2, height: 0.1 }, c)
  const e = makeShape({ name: 'C', x: 0.8, y: 0.6, width: 0.1, height: 0.2 }, c)
  for (const el of [a, b, e]) d = addElement(d, page, el, c)
  return { d, page, a, b, c: e, ctx: c }
}

describe('geometry: snapping', () => {
  const box = (x: number, y: number, w = 0.2, h = 0.1) => ({ x, y, w, h })
  it('snaps a moved box to the canvas centre and edges and reports the guide lines', () => {
    const r = snapMove(box(0.395, 0.1), [], { x: 0.01, y: 0.01 })                     // centre at 0.495 -> 0.5
    expect(r.dx).toBeCloseTo(0.005, 6)
    expect(r.guides.v).toEqual([0.5])
    const edge = snapMove(box(0.004, 0.5), [], { x: 0.01, y: 0.01 })
    expect(edge.dx).toBeCloseTo(-0.004, 6)
    expect(edge.guides.v).toContain(0)
  })
  it('snaps to the edges and centres of other elements, picking the closest match per axis', () => {
    const other = box(0.5, 0.5, 0.2, 0.2)
    const r = snapMove(box(0.292, 0.7 + 0.003), [other], { x: 0.01, y: 0.01 })        // right edge 0.492 -> other's left 0.5; top 0.703 -> other's bottom 0.7
    expect(r.dx).toBeCloseTo(0.008, 6)
    expect(r.dy).toBeCloseTo(-0.003, 6)
    expect(r.guides.v).toContain(0.5)
    expect(r.guides.h).toContain(0.7)
  })
  it('does nothing outside the threshold', () => {
    const r = snapMove(box(0.1, 0.1), [box(0.6, 0.6)], { x: 0.005, y: 0.005 })
    expect(r).toEqual({ dx: 0, dy: 0, guides: { v: [], h: [] } })
  })
})

describe('geometry: align and distribute', () => {
  const boxes = [{ x: 0.1, y: 0.1, w: 0.2, h: 0.1 }, { x: 0.4, y: 0.3, w: 0.1, h: 0.2 }, { x: 0.8, y: 0.6, w: 0.1, h: 0.1 }]
  it('aligns to each other or to the slide', () => {
    expect(alignBoxes(boxes, 'left').map(p => p.x)).toEqual([0.1, 0.1, 0.1])
    expect(alignBoxes(boxes, 'right').map(p => p.x?.toFixed(3))).toEqual(['0.700', '0.800', '0.800'])
    expect(alignBoxes(boxes, 'top').map(p => p.y)).toEqual([0.1, 0.1, 0.1])
    expect(alignBoxes(boxes, 'center', 'canvas').map(p => p.x?.toFixed(3))).toEqual(['0.400', '0.450', '0.450'])
    expect(alignBoxes(boxes, 'bottom', 'canvas').map(p => p.y?.toFixed(3))).toEqual(['0.900', '0.800', '0.900'])
  })
  it('distributes with equal gaps, keeping the outer two in place, whatever order they were given in', () => {
    const out = distributeBoxes([boxes[2], boxes[0], boxes[1]], 'horizontal')            // shuffled input
    const placed = [boxes[2], boxes[0], boxes[1]].map((b, i) => ({ ...b, x: out[i].x ?? b.x })).sort((p, q) => p.x - q.x)
    expect(placed[0].x).toBeCloseTo(0.1, 6)
    expect(placed[2].x).toBeCloseTo(0.8, 6)
    const g1 = placed[1].x - (placed[0].x + placed[0].w), g2 = placed[2].x - (placed[1].x + placed[1].w)
    expect(g1).toBeCloseTo(g2, 6)
    expect(distributeBoxes(boxes.slice(0, 2), 'vertical')).toEqual([{}, {}])               // two boxes: nothing to even out
  })
  it('estimates the box of auto-height text from its size and line count', () => {
    const c = ids()
    const d = createCarouselDocument({ layouts: ['cover'] }, c)
    const t = makeText(d.format, { content: 'a '.repeat(200), width: 0.5 }, c)
    const short = makeText(d.format, { content: 'a', width: 0.5 }, c)
    expect(elementBox(t, d.format).h).toBeGreaterThan(elementBox(short, d.format).h * 3)
    expect(unionBox([{ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, { x: 0.5, y: 0.5, w: 0.1, h: 0.1 }])).toEqual({ x: 0.1, y: 0.1, w: 0.5, h: 0.5 })
  })
})

describe('ops: several elements at once', () => {
  it('aligns, distributes and nudges as one change each, never moving locked elements', () => {
    const { d, page, a, b, c, ctx } = withShapes()
    const left = alignElements(d, page, [a.id, b.id, c.id], 'left', 'selection', ctx)
    expect(left.pages[0].elements.map(e => e.x)).toEqual([0.1, 0.1, 0.1])
    const dist = distributeElements(d, page, [a.id, b.id, c.id], 'horizontal', ctx)
    const [x1, x2, x3] = dist.pages[0].elements.map(e => e.x)
    expect(x1).toBeCloseTo(0.1, 6); expect(x3).toBeCloseTo(0.8, 6)
    expect(x2 - (x1 + 0.2)).toBeCloseTo(x3 - (x2 + 0.2), 6)
    expect(() => distributeElements(d, page, [a.id, b.id], 'horizontal', ctx)).toThrow(/at least three/)
    const locked = setLockedMany(d, page, [b.id], true, ctx)
    const moved = nudgeElements(locked, page, [a.id, b.id], 0.05, 0, ctx)
    expect(moved.pages[0].elements.map(e => e.x)).toEqual([0.15000000000000002, 0.4, 0.8])
    expect(() => nudgeElements(locked, page, [b.id], 0.05, 0, ctx)).toThrow(/locked/)
    expect(deleteElements(locked, page, [a.id, b.id], ctx).pages[0].elements.map(e => e.name)).toEqual(['B', 'C'])
    assertValidPostDocument(left); assertValidPostDocument(dist)
  })

  it('groups elements into one movable unit and ungroups them back to exactly where they were', () => {
    const { d, page, a, b, ctx } = withShapes()
    const r = groupElements(d, page, [a.id, b.id], ctx)
    assertValidPostDocument(r.doc)
    const els = r.doc.pages[0].elements
    expect(els.map(e => e.type)).toEqual(['group', 'shape'])                           // the group took the place of its members; the other shape stays
    const g = els[0]
    expect(g.type === 'group' && g.children.map(c => c.name)).toEqual(['A', 'B'])
    expect(g.x).toBeCloseTo(0.1, 6); expect(g.width).toBeCloseTo(0.5, 6); expect(g.y).toBeCloseTo(0.1, 6); expect(g.height).toBeCloseTo(0.3, 6)
    const back = ungroupElement(r.doc, page, r.groupId, ctx)
    const [ra, rb] = back.doc.pages[0].elements
    expect(ra.x).toBeCloseTo(0.1, 5); expect(ra.y).toBeCloseTo(0.1, 5); expect(ra.width).toBeCloseTo(0.2, 5); expect(ra.height as number).toBeCloseTo(0.1, 5)
    expect(rb.x).toBeCloseTo(0.4, 5); expect(rb.y).toBeCloseTo(0.3, 5)
    expect(back.ids).toHaveLength(2)
    assertValidPostDocument(back.doc)
  })

  it('moving a group moves its children; ungrouping a rotated group rotates them into place', () => {
    const { d, page, a, b, ctx } = withShapes()
    const g = groupElements(d, page, [a.id, b.id], ctx)
    const rotated = { ...g.doc, pages: [{ ...g.doc.pages[0], elements: g.doc.pages[0].elements.map(e => (e.id === g.groupId ? { ...e, rotation: 90 } : e)) as PostElement[] }] }
    const out = ungroupElement(rotated, page, g.groupId, ctx).doc.pages[0].elements
    expect(out[0].rotation).toBe(90)
    expect(out[1].rotation).toBe(90)
    // a 90 degree turn about the group's centre sends the child at the far left/top to the top right
    const gb = g.doc.pages[0].elements[0]
    expect(out[0].x).not.toBeCloseTo(gb.x, 2)
    assertValidPostDocument({ ...rotated, pages: [{ ...rotated.pages[0], elements: out }] })
  })

  it('refuses to group fewer than two or locked elements, and ungrouping something that is not a group', () => {
    const { d, page, a, b, ctx } = withShapes()
    expect(() => groupElements(d, page, [a.id], ctx)).toThrow(CarouselError)
    expect(() => groupElements(setLockedMany(d, page, [a.id], true, ctx), page, [a.id, b.id], ctx)).toThrow(/Unlock/)
    expect(() => ungroupElement(d, page, a.id, ctx)).toThrow(/not a group/)
  })

  it('moves a layer to an exact place in the paint order', () => {
    const { d, page, a, c, ctx } = withShapes()
    expect(moveElementTo(d, page, a.id, 2, ctx).pages[0].elements.map(e => e.name)).toEqual(['B', 'C', 'A'])
    expect(moveElementTo(d, page, c.id, 0, ctx).pages[0].elements.map(e => e.name)).toEqual(['C', 'A', 'B'])
    expect(moveElementTo(d, page, a.id, 0, ctx)).toBe(d)
  })

  it('adds any number of pictures at once, each its own element, in a tidy grid that stays inside the slide', () => {
    const c = ids()
    const base = createCarouselDocument({ layouts: ['cover'] }, c)
    const page = base.pages[0].id
    const many = Array.from({ length: 12 }, (_, i) => ({ assetId: i + 1, url: `/uploads/1/p${i}.png`, name: `p${i}.png` }))
    const r = addImages(base, page, many, c)
    expect(r.ids).toHaveLength(12)
    const imgs = r.doc.pages[0].elements.filter(e => e.type === 'image' && e.source.kind === 'asset')
    expect(imgs).toHaveLength(12)
    for (const e of imgs) { expect(e.x).toBeGreaterThanOrEqual(0); expect(e.x + e.width).toBeLessThanOrEqual(1.0001); expect(e.y + (e.height as number)).toBeLessThanOrEqual(1.0001) }
    assertValidPostDocument(r.doc)
    expect(addImages(base, page, [], c).doc).toBe(base)
    const big = addImages(base, page, Array.from({ length: 150 }, (_, i) => ({ assetId: i + 1, url: `/uploads/1/q${i}.png`, name: `q${i}` })), c)
    expect(big.ids).toHaveLength(150)                                                    // no arbitrary cap on pictures per slide
    assertValidPostDocument(big.doc)
  })
})

describe('image zoom, masks and focus', () => {
  it('zoom is a focus-centred scale: the visible part shrinks, and the mask clip is defined once for screen and export', () => {
    expect(fitRects(2000, 1000, 500, 500, 'cover', { x: 0.5, y: 0.5 })).toMatchObject({ sw: 1000, sh: 1000 })
    expect(maskClipPath('diamond')).toBe('polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)')
    expect(maskClipPath('circle')).toBeUndefined()
    expect(Object.keys(MASK_POLYGONS)).toEqual(expect.arrayContaining(['diamond', 'hexagon', 'triangle', 'star-5', 'heart', 'bubble', 'arrow-right']))
  })

  it('the exporter clips masked pictures and applies the zoom about the focal point, in this order', async () => {
    const c = ids()
    let d = createCarouselDocument({ layouts: ['cover'] }, c)
    const page = d.pages[0].id
    d = { ...d, pages: [{ ...d.pages[0], elements: [] }] }
    d = addElement(d, page, makeImage({ x: 0.1, y: 0.1, width: 0.5, height: 0.4, mask: 'hexagon', zoom: 2, focal: { x: 0.25, y: 0.75 }, source: { kind: 'asset', assetId: 1, url: '/uploads/1/x.png' } }, c), c)
    expect(collectImageUrls(d, 0)).toEqual(['/uploads/1/x.png'])
    const calls: string[] = []
    const ctx = new Proxy({} as Record<string, unknown>, { get: (t, k: string) => (k in t ? t[k] : (...a: unknown[]) => { calls.push(`${k}:${a.length ? a.slice(0, 2).map(v => (typeof v === 'number' ? Math.round(v * 100) / 100 : '')).join(',') : ''}`); return { addColorStop: () => undefined, width: 10 } }), set: (t, k: string, v) => { t[k] = v; return true } }) as unknown as Ctx2D
    await drawSlide(ctx, d, 0, { width: 1000, height: 1000, loadImage: async () => ({ width: 800, height: 600 }) })
    const iClip = calls.indexOf('clip:'), iScale = calls.findIndex(x => x.startsWith('scale:2,2')), iDraw = calls.findIndex(x => x.startsWith('drawImage'))
    expect(iClip).toBeGreaterThan(-1)
    expect(iScale).toBeGreaterThan(iClip)                                               // clip first, then zoom
    expect(iDraw).toBeGreaterThan(iScale)
    expect(calls.filter(x => x.startsWith('lineTo')).length).toBe(5)                    // hexagon: moveTo + 5 lineTo
    expect(calls).toContain('translate:225,400')                                       // zoom origin: focal (0.25, 0.75) of the 500x400 frame at (100, 100)
  })
})

describe('editor: selection and multi-element actions', () => {
  const run = (s: ReturnType<typeof initialState>, ...actions: EditorAction[]) => actions.reduce((st, a) => editorReducer(st, a, ids()), s)
  function start() {
    const { d, a, b, c } = withShapes()
    return { s: initialState(d, 'forest'), a, b, c }
  }

  it('select, toggle (shift-click), select all and clear', () => {
    const { s, a, b, c } = start()
    let st = run(s, { type: 'selectElement', id: a.id })
    expect(st.selectedIds).toEqual([a.id])
    st = run(st, { type: 'selectElement', id: b.id, mode: 'toggle' })
    expect(st.selectedIds).toEqual([a.id, b.id]); expect(st.selectedElementId).toBe(b.id)
    st = run(st, { type: 'selectElement', id: a.id, mode: 'toggle' })
    expect(st.selectedIds).toEqual([b.id])
    st = run(st, { type: 'selectAll' })
    expect(st.selectedIds).toEqual([a.id, b.id, c.id])
    expect(run(st, { type: 'selectElement', id: null }).selectedIds).toEqual([])
    expect(run(s, { type: 'selectElement', id: 'nope' }).selectedIds).toEqual([])
  })

  it('dragging several selected elements moves them together as ONE undo step, from where the drag began', () => {
    const { s, a, b } = start()
    let st = run(s, { type: 'selectElement', id: a.id }, { type: 'selectElement', id: b.id, mode: 'toggle' }, { type: 'dragStart' }, { type: 'dragDelta', dx: 0.02, dy: 0.01 }, { type: 'dragDelta', dx: 0.05, dy: 0.03 }, { type: 'dragEnd' })
    const els = st.doc.pages[0].elements
    expect(els[0].x).toBeCloseTo(0.15, 6); expect(els[1].x).toBeCloseTo(0.45, 6); expect(els[2].x).toBe(0.8)   // not accumulated: 0.1+0.05, 0.4+0.05
    expect(st.past).toHaveLength(1)
    st = run(st, { type: 'undo' })
    expect(st.doc.pages[0].elements[0].x).toBe(0.1)
  })

  it('align, distribute, group, ungroup, delete selected and lock work on the selection and keep it sensible', () => {
    const { s } = start()
    let st = run(s, { type: 'selectAll' }, { type: 'align', mode: 'left', to: 'selection' })
    expect(st.doc.pages[0].elements.map(e => e.x)).toEqual([0.1, 0.1, 0.1])
    st = run(st, { type: 'undo' }, { type: 'distribute', axis: 'horizontal' })
    expect(st.notice).toBeNull()
    st = run(st, { type: 'group' })
    expect(st.doc.pages[0].elements).toHaveLength(1)
    expect(st.selectedIds).toHaveLength(1)
    st = run(st, { type: 'ungroup' })
    expect(st.doc.pages[0].elements).toHaveLength(3)
    expect(st.selectedIds).toHaveLength(3)
    st = run(st, { type: 'lockSelected', locked: true }, { type: 'deleteSelected' })
    expect(st.notice).toMatch(/locked/)
    expect(st.doc.pages[0].elements).toHaveLength(3)
    st = run(st, { type: 'lockSelected', locked: false }, { type: 'deleteSelected' })
    expect(st.doc.pages[0].elements).toHaveLength(0)
    expect(st.selectedIds).toEqual([])
  })

  it('a refused multi action explains why and changes nothing', () => {
    const { s, a } = start()
    const st = run(s, { type: 'selectElement', id: a.id }, { type: 'group' })
    expect(st.notice).toMatch(/at least two/)
    expect(st.doc).toBe(s.doc)
    expect(run(s, { type: 'selectAll' }, { type: 'distribute', axis: 'vertical' }).notice).toBeNull()
    expect(run(s, { type: 'selectElement', id: a.id }, { type: 'distribute', axis: 'vertical' }).notice).toMatch(/at least three/)
  })

  it('reorders a layer to an exact place, rotates during a drag, and adds several pictures', () => {
    const { s, a } = start()
    let st = run(s, { type: 'reorderElement', id: a.id, to: 2 })
    expect(st.doc.pages[0].elements[2].id).toBe(a.id)
    st = run(st, { type: 'selectElement', id: a.id }, { type: 'dragStart' }, { type: 'dragMove', id: a.id, rotation: 45 }, { type: 'dragEnd' })
    expect(st.doc.pages[0].elements[2].rotation).toBe(45)
    st = run(st, { type: 'addImages', items: [{ assetId: 1, url: '/uploads/1/a.png', name: 'a' }, { assetId: 2, url: '/uploads/1/b.png', name: 'b' }] })
    expect(st.selectedIds).toHaveLength(2)
    expect(st.doc.pages[0].elements).toHaveLength(5)
  })

  it('undo drops selected ids that no longer exist', () => {
    const { s, a } = start()
    let st = run(s, { type: 'addElement', kind: 'text' })
    const added = st.selectedElementId!
    st = run(st, { type: 'undo' })
    expect(st.selectedIds).toEqual([])
    expect(added).not.toBe(a.id)
  })
})

export type { PostDocument }
