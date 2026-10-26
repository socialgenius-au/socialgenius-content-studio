import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { fitCanvasBox } from '../../../lib/platformFormats'
import type { PostDocument } from '../../../lib/postDocument'
import { usePostFormat } from '../format/PostFormatContext'
import PostRenderer from '../canvas/PostRenderer'
import { createAbcTilesMockDocument } from '../mock/abcTilesDocument'

/** Space kept free around the canvas inside the stage (px). */
export const CANVAS_MARGIN = 14
/** Fallback stage size before the first measurement (and in non-DOM renders). */
const FALLBACK = { w: 520, h: 480 }

// useLayoutEffect measures before paint in the browser; on the server (tests) it would only warn, so fall back to useEffect there.
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

/** Live size of an element (ResizeObserver). Falls back to a fixed size until measured. */
function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [size, setSize] = useState(FALLBACK)
  useIsoLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => { if (el.clientWidth > 0 && el.clientHeight > 0) setSize({ w: el.clientWidth, h: el.clientHeight }) }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, size] as const
}

/**
 * The central Post Creator canvas: PostDocument -> PostRenderer. The box is the selected format's exact aspect ratio, letterbox-fitted into
 * the available stage (never stretched), and it is a size container so the document's shorter-side-relative type scales with it.
 *
 * P2: nothing edits the document, so unless one is passed in (tests), the ABC Tiles mock document is built for the selected format.
 */
export default function PostCanvas({ document: docOverride }: { document?: PostDocument }) {
  const { canvas } = usePostFormat()
  const [stageRef, stage] = useElementSize<HTMLDivElement>()
  const box = fitCanvasBox(canvas.width, canvas.height, Math.max(stage.w - CANVAS_MARGIN * 2, 80), Math.max(stage.h - CANVAS_MARGIN * 2, 80))

  const doc = useMemo(
    () => docOverride ?? createAbcTilesMockDocument({ platformKey: canvas.platformKey, formatKey: canvas.formatKey, width: canvas.width, height: canvas.height, ratio: canvas.ratioLabel }),
    [docOverride, canvas.platformKey, canvas.formatKey, canvas.width, canvas.height, canvas.ratioLabel],
  )

  return (
    <div className="pcv2-canvas-stage" ref={stageRef} data-testid="pcv2-canvas-stage">
      <div
        className="pcv2-post-canvas"
        data-testid="pcv2-canvas"
        data-platform={canvas.platformKey}
        data-format={canvas.formatKey}
        data-canvas-width={canvas.width}
        data-canvas-height={canvas.height}
        data-ratio={canvas.ratioLabel}
        data-box-width={box.w}
        data-box-height={box.h}
        style={{ width: box.w, height: box.h }}
      >
        <PostRenderer document={doc} />
      </div>
    </div>
  )
}
