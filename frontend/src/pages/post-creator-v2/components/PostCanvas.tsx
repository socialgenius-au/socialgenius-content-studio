import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { fitCanvasBox } from '../../../lib/platformFormats'
import { usePostFormat } from '../format/PostFormatContext'

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
 * The central Post Creator canvas. Its box is the selected format's exact aspect ratio, letterbox-fitted into the available stage —
 * never stretched. The mock creative inside is sized in container-relative units (cqmin) so it scales with the canvas instead of
 * keeping screen-pixel sizes; it is a placeholder until the real Post Document exists.
 */
export default function PostCanvas() {
  const { canvas } = usePostFormat()
  const [stageRef, stage] = useElementSize<HTMLDivElement>()
  const box = fitCanvasBox(canvas.width, canvas.height, Math.max(stage.w - CANVAS_MARGIN * 2, 80), Math.max(stage.h - CANVAS_MARGIN * 2, 80))

  return (
    <div className="pcv2-canvas-stage" ref={stageRef} data-testid="pcv2-canvas-stage">
      <div
        className="pcv2-mock-post"
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
        <span className="pcv2-mock-post-logo">
          <Sparkles size="1.25em" /> ABC TILES
        </span>
        <div className="pcv2-mock-post-content">
          <div className="pcv2-mock-post-headline">
            LARGE FORMAT.
            <br />
            PREMIUM FINISH.
          </div>
          <div className="pcv2-mock-post-sub">BUILT FOR QUALITY. MADE FOR BUILDERS.</div>
          <span className="pcv2-mock-post-cta">SEND YOUR TILE SCHEDULE →</span>
        </div>
      </div>
    </div>
  )
}
