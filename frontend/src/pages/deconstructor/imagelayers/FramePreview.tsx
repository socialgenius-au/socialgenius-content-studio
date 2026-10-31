// M2.2a -- a reference still with rectangles drawn over it, and (optionally) a way to drag out a new region. Presentational: it reports a normalised rectangle and
// changes nothing itself. The still is shown as served; nothing is drawn INTO its pixels.
import { useRef, useState } from 'react'
import { MIN_REGION, type Rect } from './contract'
import { rectFromPoints } from './geometry'

export interface PreviewRect { rect: Rect; kind: 'selected' | 'detected' | 'drawn' }

const STYLE: Record<PreviewRect['kind'], string> = {
  selected: 'border-2 border-emerald-500 bg-emerald-500/15',
  detected: 'border border-dashed border-amber-500 bg-amber-500/10',
  drawn: 'border border-sky-500 bg-sky-500/10',
}

export interface FramePreviewProps {
  src: string
  rects: readonly PreviewRect[]
  maxWidth?: number
  alt: string
  testId?: string
  /** When given, dragging on the still reports a new region. */
  onDraw?: (rect: Rect) => void
}

export function FramePreview({ src, rects, maxWidth = 200, alt, testId, onDraw }: FramePreviewProps) {
  const box = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<{ a: { x: number; y: number }; b: { x: number; y: number } } | null>(null)
  const point = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect()
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }
  }
  const live = drag ? rectFromPoints(drag.a, drag.b) : null
  return (
    <div
      ref={box} data-testid={testId} style={{ maxWidth, touchAction: onDraw ? 'none' : undefined }}
      className={`relative w-full select-none overflow-hidden rounded-md border bg-muted ${onDraw ? 'cursor-crosshair' : ''}`}
      onPointerDown={onDraw ? e => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); const p = point(e); setDrag({ a: p, b: p }) } : undefined}
      onPointerMove={onDraw ? e => { if (drag) setDrag({ a: drag.a, b: point(e) }) } : undefined}
      onPointerUp={onDraw ? e => {
        if (!drag) return
        const r = rectFromPoints(drag.a, point(e)); setDrag(null)
        if (r.w >= MIN_REGION && r.h >= MIN_REGION) onDraw(r)
      } : undefined}
      onPointerCancel={onDraw ? () => setDrag(null) : undefined}
    >
      {src
        ? <img src={src} alt={alt} draggable={false} className="block w-full" />
        : <div className="flex aspect-[9/16] items-center justify-center p-2 text-center text-[10px] text-muted-foreground">Frame not available</div>}
      {rects.map((r, i) => (
        <div key={i} data-kind={r.kind} className={`pointer-events-none absolute ${STYLE[r.kind]}`}
          style={{ left: `${r.rect.x * 100}%`, top: `${r.rect.y * 100}%`, width: `${r.rect.w * 100}%`, height: `${r.rect.h * 100}%` }} />
      ))}
      {live && <div data-testid="frame-drag" className={`pointer-events-none absolute ${STYLE.drawn}`} style={{ left: `${live.x * 100}%`, top: `${live.y * 100}%`, width: `${live.w * 100}%`, height: `${live.h * 100}%` }} />}
    </div>
  )
}
