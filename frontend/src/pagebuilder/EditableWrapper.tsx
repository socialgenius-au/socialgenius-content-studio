import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { usePageBuilder } from './PageBuilderContext'
import type { ElementConfig } from './types'

type HandlePos = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
const HANDLES: HandlePos[] = ['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se']

/**
 * EDIT MODE chrome only — selection outline + 8 resize handles + whole-element drag. Renders
 * nothing extra in VIEW MODE (the brief's Section 2: the two modes must be genuinely separate,
 * never "edit chrome hidden by CSS but still in the DOM/bundle logic path" for a public visitor).
 *
 * Drag = move (Section 5): pointerdown anywhere on the element body (not a handle) tracks the
 * pointer and calls `moveElement` with the delta; committed continuously, not just on release, so
 * the element visibly follows the cursor.
 *
 * Resize handles (Section 5/6): edge handles (n/s/e/w) change one dimension only — this is what
 * makes a top-nav's "drag bottom edge = height" / left-nav's "drag right edge = width" / right-
 * nav's "drag left edge = width" behaviours fall out naturally, since those are just ordinary
 * edge-handle resizes on a container whose own role happens to be a nav. Corner handles change
 * both; for `image` elements with `aspectRatioLocked`, corner drags preserve the ratio.
 */
export function EditableWrapper({
  element, editMode, selected, children,
}: { element: ElementConfig; editMode: boolean; selected: boolean; children: ReactNode }) {
  const { select, moveElement, resizeElement, setLocked } = usePageBuilder()
  const ref = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)

  const startWidth = useRef(0)
  const startHeight = useRef(0)
  const aspectRatio = useRef(1)

  const onBodyPointerDown = useCallback((e: ReactPointerEvent) => {
    if (!editMode || element.locked) return
    e.stopPropagation()
    select(element.id)
    const startX = e.clientX
    const startY = e.clientY
    setDragging(true)
    ;(e.target as Element).setPointerCapture(e.pointerId)

    let lastX = startX
    let lastY = startY
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - lastX
      const dy = ev.clientY - lastY
      lastX = ev.clientX
      lastY = ev.clientY
      moveElement(element.id, dx, dy)
    }
    const onUp = () => {
      setDragging(false)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [editMode, element.id, element.locked, moveElement, select])

  const onHandlePointerDown = useCallback((pos: HandlePos) => (e: ReactPointerEvent) => {
    if (!editMode || element.locked) return
    e.stopPropagation()
    e.preventDefault()
    const rect = ref.current?.getBoundingClientRect()
    startWidth.current = rect?.width ?? 0
    startHeight.current = rect?.height ?? 0
    aspectRatio.current = startHeight.current > 0 ? startWidth.current / startHeight.current : 1
    const startX = e.clientX
    const startY = e.clientY
    const lockRatio = element.type === 'image' && element.image?.aspectRatioLocked

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY
      let w = startWidth.current
      let h = startHeight.current
      if (pos.includes('e')) w = startWidth.current + dx
      if (pos.includes('w')) w = startWidth.current - dx
      if (pos.includes('s')) h = startHeight.current + dy
      if (pos.includes('n')) h = startHeight.current - dy
      if (lockRatio && (pos === 'se' || pos === 'ne' || pos === 'sw' || pos === 'nw')) {
        h = w / aspectRatio.current
      }
      resizeElement(element.id, { width: w, height: h })
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [editMode, element.id, element.locked, element.type, element.image?.aspectRatioLocked, resizeElement])

  if (!editMode) {
    return <>{children}</>
  }

  return (
    <div
      ref={ref}
      className={[
        'pb-editable',
        selected ? 'pb-selected' : '',
        element.locked ? 'pb-locked' : '',
        dragging ? 'pb-dragging' : '',
      ].filter(Boolean).join(' ')}
      onPointerDown={onBodyPointerDown}
      onClick={(e) => { e.stopPropagation(); select(element.id) }}
      title={element.locked ? `${element.name} (locked)` : element.name}
    >
      {children}
      {selected && (
        <div className="pb-chrome" aria-hidden="true">
          <div className="pb-name-tag">{element.name}{element.locked ? ' 🔒' : ''}</div>
          {!element.locked && HANDLES.map(pos => (
            <div
              key={pos}
              className={`pb-handle pb-handle-${pos}`}
              onPointerDown={onHandlePointerDown(pos)}
            />
          ))}
          {element.locked && (
            <button
              className="pb-unlock-btn"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); setLocked(element.id, false) }}
            >
              Unlock
            </button>
          )}
        </div>
      )}
    </div>
  )
}
