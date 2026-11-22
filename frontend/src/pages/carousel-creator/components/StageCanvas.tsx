import { useEffect, useLayoutEffect, useRef, useState, type Dispatch, type KeyboardEvent, type PointerEvent } from 'react'
import type { PostDocument } from '../../../lib/postDocument'
import { fitCanvasBox } from '../../../lib/platformFormats'
import { elementBox, snapMove, unionBox, type Box, type SnapGuides } from '../../../lib/carousel/geometry'
import { STACKED_QUERY, useMatchMedia } from '../useMatchMedia'
import type { EditorAction } from '../editorState'
import SlideView from './SlideView'

const MARGIN = 12
/** How close (in screen pixels) an edge must come to a guide before it snaps. */
const SNAP_PX = 6

/** The id of the top-level element under `target` (a group's children select their group), or null when the click was on the bare slide. */
export function topLevelElementId(target: HTMLElement | null, root: HTMLElement): string | null {
  let node: HTMLElement | null = target
  let found: string | null = null
  while (node && node !== root) {
    const id = node.getAttribute('data-element-id')
    if (id && node.parentElement && node.parentElement.getAttribute('data-testid') === 'pcv2-post-page') found = id
    node = node.parentElement
  }
  return found
}

type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se'

type Drag =
  | { mode: 'move'; ids: string[]; startX: number; startY: number; base: Box; others: Box[] }
  | { mode: 'resize'; id: string; corner: ResizeCorner; startX: number; startY: number; x: number; y: number; w: number; h: number | 'auto' }
  | { mode: 'rotate'; id: string; cx: number; cy: number; startAngle: number; startRotation: number }

interface Outline { id: string; x: number; y: number; w: number; h: number }

export interface StageCanvasProps {
  doc: PostDocument
  pageId: string
  /** The primary selected element. */
  selectedId: string | null
  /** Every selected element (the primary is the last). Defaults to just the primary. */
  selectedIds?: string[]
  /** Snap to the canvas and to other elements while moving (hold Alt to bypass). Default on. */
  snap?: boolean
  zoomFactor?: number
  fitHeight?: boolean
  cornerHandles?: boolean
  dispatch: Dispatch<EditorAction>
}

export default function StageCanvas({ doc, pageId, selectedId, selectedIds, snap = true, zoomFactor = 1, fitHeight = false, cornerHandles = false, dispatch }: StageCanvasProps) {
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  const [stage, setStage] = useState({ w: 520, h: 640 })
  const [outlines, setOutlines] = useState<Outline[]>([])
  const [guides, setGuides] = useState<SnapGuides>({ v: [], h: [] })
  const page = doc.pages.find(p => p.id === pageId)!
  const ids = selectedIds ?? (selectedId ? [selectedId] : [])
  // When the editor is stacked (phones and tablets) the page scrolls, so the canvas is sized by the available WIDTH (the stage grows to fit it); on larger screens it is fitted inside the stage's fixed height.
  const narrow = useMatchMedia(STACKED_QUERY)
  const coarse = useMatchMedia('(pointer: coarse)')
  const availW = Math.max(stage.w - MARGIN * 2, 80)
  const availH = narrow && !fitHeight ? Math.max(availW * (doc.format.height / doc.format.width), 80) : Math.max(stage.h - MARGIN * 2, 80)
  const fit = fitCanvasBox(doc.format.width, doc.format.height, availW, availH)
  const box = { w: Math.round(fit.w * zoomFactor), h: Math.round(fit.h * zoomFactor) }
  const selected = selectedId ? page.elements.find(e => e.id === selectedId) : undefined
  const handle = coarse ? 28 : 16

  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el) return
    const measure = () => { if (el.clientWidth > 0 && el.clientHeight > 0) setStage({ w: el.clientWidth, h: el.clientHeight }) }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // The selection outlines follow each element's REAL painted box (so auto-height text is outlined exactly).
  const idsKey = ids.join(',')
  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || ids.length === 0) { setOutlines([]); return }
    const c = canvas.getBoundingClientRect()
    const out: Outline[] = []
    for (const id of ids) {
      const node = canvas.querySelector<HTMLElement>(`[data-element-id="${CSS.escape(id)}"]`)
      if (!node) continue
      const r = node.getBoundingClientRect()
      out.push({ id, x: r.left - c.left, y: r.top - c.top, w: r.width, h: r.height })
    }
    setOutlines(out)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, doc, box.w, box.h, pageId])

  useEffect(() => { drag.current = null; setGuides({ v: [], h: [] }) }, [pageId])

  /** Keep receiving the drag outside the canvas. Some synthetic or already-ended pointers cannot be captured; dragging still works without it. */
  const capture = (pointerId: number) => { try { canvasRef.current?.setPointerCapture(pointerId) } catch { /* not capturable */ } }
  const othersExcept = (skip: string[]): Box[] => page.elements.filter(e => e.visible && !skip.includes(e.id)).map(e => elementBox(e, doc.format))

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !canvasRef.current) return
    const id = topLevelElementId(e.target as HTMLElement, canvasRef.current)
    stageRef.current?.focus({ preventScroll: true })
    if (id && (e.shiftKey || e.ctrlKey || e.metaKey)) { dispatch({ type: 'selectElement', id, mode: 'toggle' }); return }
    const keep = !!id && ids.includes(id) && ids.length > 1            // pressing on one of several selected elements drags them all
    if (!keep) dispatch({ type: 'selectElement', id })
    if (!id) return
    const moving = keep ? ids : [id]
    const els = page.elements.filter(x => moving.includes(x.id))
    if (els.length === 0 || els.every(x => x.locked)) return
    drag.current = { mode: 'move', ids: moving, startX: e.clientX, startY: e.clientY, base: unionBox(els.filter(x => !x.locked).map(x => elementBox(x, doc.format))), others: othersExcept(moving) }
    capture(e.pointerId)
    dispatch({ type: 'dragStart' })
  }

  const onHandleDown = (e: PointerEvent<HTMLButtonElement>, corner: ResizeCorner = 'se') => {
    e.stopPropagation()
    if (!selected || selected.locked || !canvasRef.current) return
    drag.current = { mode: 'resize', id: selected.id, corner, startX: e.clientX, startY: e.clientY, x: selected.x, y: selected.y, w: selected.width, h: selected.height }
    capture(e.pointerId)
    dispatch({ type: 'dragStart' })
  }

  const onRotateDown = (e: PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    const o = outlines.find(x => x.id === selected?.id)
    if (!selected || selected.locked || !canvasRef.current || !o) return
    const c = canvasRef.current.getBoundingClientRect()
    const cx = c.left + o.x + o.w / 2, cy = c.top + o.y + o.h / 2
    drag.current = { mode: 'rotate', id: selected.id, cx, cy, startAngle: Math.atan2(e.clientY - cy, e.clientX - cx), startRotation: selected.rotation }
    capture(e.pointerId)
    dispatch({ type: 'dragStart' })
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    if (d.mode === 'rotate') {
      let deg = d.startRotation + ((Math.atan2(e.clientY - d.cy, e.clientX - d.cx) - d.startAngle) * 180) / Math.PI
      deg = ((((deg + 180) % 360) + 360) % 360) - 180
      if (e.shiftKey) deg = Math.round(deg / 15) * 15
      dispatch({ type: 'dragMove', id: d.id, rotation: Math.round(deg * 10) / 10 })
      return
    }
    let dx = (e.clientX - d.startX) / box.w
    let dy = (e.clientY - d.startY) / box.h
    const thr = { x: SNAP_PX / box.w, y: SNAP_PX / box.h }
    if (d.mode === 'move') {
      if (snap && !e.altKey) {
        const r = snapMove({ ...d.base, x: d.base.x + dx, y: d.base.y + dy }, d.others, thr)
        dx += r.dx; dy += r.dy; setGuides(r.guides)
      } else setGuides({ v: [], h: [] })
      dispatch({ type: 'dragDelta', dx, dy })
    } else {
      const west = d.corner.endsWith('w')
      const north = d.corner.startsWith('n') && d.h !== 'auto'
      const horizontal = west ? -1 : 1
      const vertical = north ? -1 : 1
      if (snap && !e.altKey) {
        const r = snapMove({ x: d.x + (west ? 0 : d.w) + dx, y: d.y + (north || d.h === 'auto' ? 0 : d.h) + dy, w: 0, h: 0 }, othersExcept([d.id]), thr)
        dx += r.dx; dy += r.dy
        setGuides(r.guides)
      } else setGuides({ v: [], h: [] })
      const width = Math.max(0.04, d.w + dx * horizontal)
      const height = d.h === 'auto' ? undefined : Math.max(0.02, d.h + dy * vertical)
      dispatch({ type: 'dragMove', id: d.id, width, ...(west ? { x: d.x + d.w - width } : {}),
        ...(height === undefined || d.h === 'auto' ? {} : { height, ...(north ? { y: d.y + d.h - height } : {}) }) })
    }
  }

  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    drag.current = null
    setGuides({ v: [], h: [] })
    try { canvasRef.current?.releasePointerCapture(e.pointerId) } catch { /* already released */ }
    dispatch({ type: 'dragEnd' })
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const mod = e.ctrlKey || e.metaKey
    const k = e.key.toLowerCase()
    if (mod && k === 'z') { e.preventDefault(); dispatch({ type: e.shiftKey ? 'redo' : 'undo' }); return }
    if (mod && k === 'y') { e.preventDefault(); dispatch({ type: 'redo' }); return }
    if (mod && k === 'a') { e.preventDefault(); dispatch({ type: 'selectAll' }); return }
    if (e.key === 'Escape') { dispatch({ type: 'selectElement', id: null }); return }
    if (e.key === 'Tab' && ids.length > 0 && page.elements.length > 0) {            // Tab steps through the elements while something is selected; Escape first to leave the canvas
      e.preventDefault()
      const at = page.elements.findIndex(x => x.id === selectedId)
      const next = page.elements[(at + (e.shiftKey ? -1 : 1) + page.elements.length) % page.elements.length]
      dispatch({ type: 'selectElement', id: next.id })
      return
    }
    if (ids.length === 0 || !selected) return
    if (mod && k === 'g') { e.preventDefault(); dispatch(e.shiftKey ? { type: 'ungroup' } : { type: 'group' }); return }
    if (mod && k === 'd') { e.preventDefault(); dispatch({ type: 'duplicateElement', id: selected.id }); return }
    if (mod && (e.key === ']' || e.key === '[')) { e.preventDefault(); dispatch({ type: 'layer', id: selected.id, move: e.key === ']' ? 'front' : 'back' }); return }
    if (!mod && (e.key === ']' || e.key === '[')) { e.preventDefault(); dispatch({ type: 'layer', id: selected.id, move: e.key === ']' ? 'forward' : 'backward' }); return }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); dispatch(ids.length > 1 ? { type: 'deleteSelected' } : { type: 'deleteElement', id: selected.id }); return }
    const step = e.shiftKey ? 0.02 : 0.005
    const move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]
    if (move) { e.preventDefault(); dispatch({ type: 'nudge', dx: move[0], dy: move[1] }) }
  }

  const primary = outlines.find(o => o.id === selected?.id)
  const union = outlines.length > 1 ? { x: Math.min(...outlines.map(o => o.x)), y: Math.min(...outlines.map(o => o.y)), x2: Math.max(...outlines.map(o => o.x + o.w)), y2: Math.max(...outlines.map(o => o.y + o.h)) } : null

  return (
    <div
      ref={stageRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      aria-label="Slide canvas. Click an element to select it; Shift-click adds to the selection; drag to move; arrow keys nudge; Ctrl+G groups; [ and ] change layer order; Delete removes; Tab steps through elements; Escape clears."
      data-testid="stage"
      className="flex min-h-[320px] flex-1 rounded-lg bg-muted/60 p-3 outline-none focus-visible:ring-2 focus-visible:ring-primary xl:min-h-0 xl:overflow-auto"
    >
      <div
        ref={canvasRef}
        data-testid="stage-canvas"
        data-slide-id={pageId}
        data-box-width={box.w}
        data-box-height={box.h}
        className="relative m-auto shrink-0 touch-none select-none shadow-lg"
        style={{ width: box.w, height: box.h }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <SlideView doc={doc} pageId={pageId} style={{ width: '100%', height: '100%', aspectRatio: 'auto' }} />
        {outlines.map(o => (
          <div key={o.id} data-testid={o.id === selected?.id ? 'selection' : 'selection-other'} className={`pointer-events-none absolute border-2 ${o.id === selected?.id ? 'border-sky-500' : 'border-sky-400/70 border-dashed'}`} style={{ left: o.x, top: o.y, width: o.w, height: o.h }} />
        ))}
        {union && <div data-testid="selection-union" className="pointer-events-none absolute border border-sky-500/60" style={{ left: union.x - 3, top: union.y - 3, width: union.x2 - union.x + 6, height: union.y2 - union.y + 6 }} />}
        {primary && selected && !selected.locked && outlines.length === 1 && (
          <div className="pointer-events-none absolute" style={{ left: primary.x, top: primary.y, width: primary.w, height: primary.h }}>
            <button type="button" aria-label="Resize element" data-testid="resize-handle" onPointerDown={e => onHandleDown(e)} className="pointer-events-auto absolute cursor-nwse-resize rounded-full border-2 border-sky-500 bg-white" style={{ width: handle, height: handle, right: -handle / 2, bottom: -handle / 2 }} />
            {cornerHandles && selected.height !== 'auto' ? (['nw', 'ne', 'sw'] as const).map(corner =>
              <button type="button" key={corner} aria-label={`Resize from ${{ nw: 'top left', ne: 'top right', sw: 'bottom left' }[corner]}`}
                data-testid={`resize-handle-${corner}`} onPointerDown={e => onHandleDown(e, corner)}
                className="pointer-events-auto absolute rounded-full border-2 border-sky-500 bg-white"
                style={{ width: handle, height: handle, cursor: corner + '-resize', [corner.startsWith('n') ? 'top' : 'bottom']: -handle / 2, [corner.endsWith('w') ? 'left' : 'right']: -handle / 2 }}/>
            ) : <>
              <button type="button" aria-label="Rotate element" data-testid="rotate-handle" onPointerDown={onRotateDown} className="pointer-events-auto absolute cursor-grab rounded-full border-2 border-sky-500 bg-white" style={{ width: handle, height: handle, left: `calc(50% - ${handle / 2}px)`, top: -(handle + 14) }} />
              <span className="absolute left-1/2 w-px -translate-x-1/2 bg-sky-500" style={{ top: -14, height: 14 }} />
            </>}
          </div>
        )}
        {guides.v.map(x => <div key={`v${x}`} data-testid="guide-v" className="pointer-events-none absolute top-0 h-full w-px bg-fuchsia-500" style={{ left: x * box.w }} />)}
        {guides.h.map(y => <div key={`h${y}`} data-testid="guide-h" className="pointer-events-none absolute left-0 h-px w-full bg-fuchsia-500" style={{ top: y * box.h }} />)}
      </div>
    </div>
  )
}
