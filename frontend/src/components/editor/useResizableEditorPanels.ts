import { useCallback, useEffect, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'

type Side = 'left' | 'right'
type Widths = { left: number; right: number }
const defaults: Widths = { left: 300, right: 320 }
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))

/** Shared panel sizing for Post and Carousel. Pointer capture keeps dragging smooth. */
export function useResizableEditorPanels(storageKey: string) {
  const [widths, setWidths] = useState<Widths>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) || 'null') as Widths | null
      if (stored && Number.isFinite(stored.left) && Number.isFinite(stored.right))
        return { left: clamp(stored.left, 0, 520), right: clamp(stored.right, 0, 520) }
    } catch { /* unavailable storage */ }
    return defaults
  })
  useEffect(() => { try { localStorage.setItem(storageKey, JSON.stringify(widths)) } catch { /* private browsing */ } }, [storageKey, widths])
  const resize = useCallback((side: Side, delta: number) => setWidths(prev => ({
    ...prev, [side]: clamp(prev[side] + (side === 'left' ? delta : -delta), 0, 520),
  })), [])
  const separator = (side: Side) => ({
    role: 'separator' as const,
    tabIndex: 0,
    'aria-orientation': 'vertical' as const,
    'aria-label': `Resize ${side} editor panel`,
    className: 'sg-editor-resize-handle',
    onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId)
      event.currentTarget.dataset.lastX = String(event.clientX)
      event.preventDefault()
    },
    onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
      const last = Number(event.currentTarget.dataset.lastX || event.clientX)
      resize(side, event.clientX - last)
      event.currentTarget.dataset.lastX = String(event.clientX)
    },
    onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault()
        resize(side, event.key === 'ArrowRight' ? 24 : -24)
      }
      if (event.key === 'Home') { event.preventDefault(); setWidths(prev => ({ ...prev, [side]: 0 })) }
    },
  })
  const style: CSSProperties = { '--sg-editor-left': `${widths.left}px`, '--sg-editor-right': `${widths.right}px` } as CSSProperties
  return { widths, style, separator, toggle: (side: Side) => setWidths(prev => ({ ...prev, [side]: prev[side] === 0 ? defaults[side] : 0 })), reset: () => setWidths(defaults) }
}
