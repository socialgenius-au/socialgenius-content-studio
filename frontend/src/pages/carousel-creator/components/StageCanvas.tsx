import { useEffect, useLayoutEffect, useRef, useState, type Dispatch, type KeyboardEvent, type PointerEvent } from 'react'
import type { PostDocument } from '../../../lib/postDocument'
import { fitCanvasBox } from '../../../lib/platformFormats'
import { STACKED_QUERY, useMatchMedia } from '../useMatchMedia'
import type { EditorAction } from '../editorState'
import SlideView from './SlideView'

const MARGIN = 12

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

type Drag = { mode: 'move' | 'resize'; id: string; startX: number; startY: number; x: number; y: number; w: number; h: number | 'auto' }

export default function StageCanvas({ doc, pageId, selectedId, dispatch }: { doc: PostDocument; pageId: string; selectedId: string | null; dispatch: Dispatch<EditorAction> }) {
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  const [stage, setStage] = useState({ w: 520, h: 640 })
  const [overlay, setOverlay] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const page = doc.pages.find(p => p.id === pageId)!
  // When the editor is stacked (phones and tablets) the page scrolls, so the canvas is sized by the available WIDTH (the stage grows to fit it); on larger screens it is fitted inside the stage's fixed height.
  const narrow = useMatchMedia(STACKED_QUERY)
  const availW = Math.max(stage.w - MARGIN * 2, 80)
  const availH = narrow ? Math.max(availW * (doc.format.height / doc.format.width), 80) : Math.max(stage.h - MARGIN * 2, 80)
  const box = fitCanvasBox(doc.format.width, doc.format.height, availW, availH)
  const selected = selectedId ? page.elements.find(e => e.id === selectedId) : undefined

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

  // The selection outline follows the element's REAL painted box (so auto-height text is outlined exactly).
  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !selectedId) { setOverlay(null); return }
    const node = canvas.querySelector<HTMLElement>(`[data-element-id="${CSS.escape(selectedId)}"]`)
    if (!node) { setOverlay(null); return }
    const c = canvas.getBoundingClientRect()
    const r = node.getBoundingClientRect()
    setOverlay({ x: r.left - c.left, y: r.top - c.top, w: r.width, h: r.height })
  }, [selectedId, doc, box.w, box.h, pageId])

  useEffect(() => { drag.current = null }, [pageId])

  /** Keep receiving the drag outside the canvas. Some synthetic or already-ended pointers cannot be captured; dragging still works without it. */
  const capture = (pointerId: number) => { try { canvasRef.current?.setPointerCapture(pointerId) } catch { /* not capturable */ } }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !canvasRef.current) return
    const id = topLevelElementId(e.target as HTMLElement, canvasRef.current)
    dispatch({ type: 'selectElement', id })
    stageRef.current?.focus({ preventScroll: true })
    if (!id) return
    const el = page.elements.find(x => x.id === id)
    if (!el || el.locked) return
    drag.current = { mode: 'move', id, startX: e.clientX, startY: e.clientY, x: el.x, y: el.y, w: el.width, h: el.height }
    capture(e.pointerId)
    dispatch({ type: 'dragStart' })
  }

  const onHandleDown = (e: PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    if (!selected || selected.locked || !canvasRef.current) return
    drag.current = { mode: 'resize', id: selected.id, startX: e.clientX, startY: e.clientY, x: selected.x, y: selected.y, w: selected.width, h: selected.height }
    capture(e.pointerId)
    dispatch({ type: 'dragStart' })
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    const dx = (e.clientX - d.startX) / box.w
    const dy = (e.clientY - d.startY) / box.h
    if (d.mode === 'move') dispatch({ type: 'dragMove', id: d.id, x: d.x + dx, y: d.y + dy })
    else dispatch({ type: 'dragMove', id: d.id, width: Math.max(0.04, d.w + dx), ...(d.h === 'auto' ? {} : { height: Math.max(0.02, d.h + dy) }) })
  }

  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    drag.current = null
    try { canvasRef.current?.releasePointerCapture(e.pointerId) } catch { /* already released */ }
    dispatch({ type: 'dragEnd' })
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const mod = e.ctrlKey || e.metaKey
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); dispatch({ type: e.shiftKey ? 'redo' : 'undo' }); return }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); dispatch({ type: 'redo' }); return }
    if (e.key === 'Escape') { dispatch({ type: 'selectElement', id: null }); return }
    if (!selected) return
    if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); dispatch({ type: 'duplicateElement', id: selected.id }); return }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); dispatch({ type: 'deleteElement', id: selected.id }); return }
    const step = e.shiftKey ? 0.02 : 0.005
    const move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]
    if (move) { e.preventDefault(); dispatch({ type: 'updateElement', id: selected.id, patch: { x: selected.x + move[0], y: selected.y + move[1] } }) }
  }

  return (
    <div
      ref={stageRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      aria-label="Slide canvas. Click an element to select it, drag to move, arrow keys to nudge, Delete to remove."
      data-testid="stage"
      className="flex min-h-[320px] flex-1 items-center justify-center rounded-lg bg-muted/60 p-3 outline-none focus-visible:ring-2 focus-visible:ring-primary xl:min-h-0"
    >
      <div
        ref={canvasRef}
        data-testid="stage-canvas"
        data-slide-id={pageId}
        data-box-width={box.w}
        data-box-height={box.h}
        className="relative touch-none select-none shadow-lg"
        style={{ width: box.w, height: box.h }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <SlideView doc={doc} pageId={pageId} style={{ width: '100%', height: '100%', aspectRatio: 'auto' }} />
        {overlay && selected && (
          <div data-testid="selection" className="pointer-events-none absolute border-2 border-sky-500" style={{ left: overlay.x, top: overlay.y, width: overlay.w, height: overlay.h }}>
            {!selected.locked && (
              <button type="button" aria-label="Resize element" data-testid="resize-handle" onPointerDown={onHandleDown} className="pointer-events-auto absolute -bottom-2 -right-2 h-4 w-4 cursor-nwse-resize rounded-full border-2 border-sky-500 bg-white" />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
