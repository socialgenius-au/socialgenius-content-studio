import { useCallback, useEffect, useRef, useState } from 'react'
import { usePageBuilder } from './PageBuilderContext'
import { PageContent } from './PageCanvas'
import { VisualEditorLeftPanel } from './VisualEditorLeftPanel'
import { VisualEditorPropertyPanel } from './VisualEditorPropertyPanel'
import { ZoomProvider } from './ZoomContext'
import type { Breakpoint } from './types'
import './pagebuilder.css'

/**
 * Visual Web Editor V1 — the new PRIMARY hands-on design environment, built to the EXACT desktop
 * layout specified in the UX-correction brief: a fixed 56-64px toolbar, then three permanent
 * columns (~260px Elements/Layers | flexible neutral workspace with a bounded artboard | ~300px
 * Properties). This replaces the previous checkpoint's shell, which reused the retained Page
 * Builder's own edge-to-edge layout and read as "the Page Builder with extra sidebars" rather than
 * a distinct design-tool workspace — that was the exact, named defect this file corrects.
 *
 * Still "one engine, three views" (Page Builder | Visual Editor | Preview all read/write the SAME
 * `usePageBuilder()` state and the SAME `PageContent` render path) — this file owns no page data
 * of its own, only a different shell + a local, page-data-free zoom value around the existing
 * engine (Section 5: "Zoom changes visual canvas scale only. It must NOT alter... saved page
 * properties" — `zoom` below is plain component state, never written into `page`).
 *
 * Entered via `?studio=1` on `/positioning` (see PositioningLandingPage.tsx).
 */
const ARTBOARD_WIDTH: Record<Breakpoint, number> = { desktop: 1280, tablet: 768, mobile: 375 }
const ZOOM_MIN = 10
const ZOOM_MAX = 200
const ZOOM_STEP = 10

export function VisualEditorShell() {
  const { mode, setMode, breakpoint, setBreakpoint } = usePageBuilder()
  const workspaceRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(100)
  const [zoomMode, setZoomMode] = useState<'fit' | 'manual'>('fit')

  const computeFit = useCallback(() => {
    const workspaceWidth = workspaceRef.current?.clientWidth ?? 0
    if (!workspaceWidth) return
    const artboardWidth = ARTBOARD_WIDTH[breakpoint]
    const ratio = ((workspaceWidth - 64) / artboardWidth) * 100
    setZoom(Math.max(ZOOM_MIN, Math.min(100, Math.floor(ratio))))
  }, [breakpoint])

  // Re-fit whenever the artboard's own width changes (breakpoint switch) while in 'fit' mode —
  // switching Desktop (1280px) -> Mobile (375px) at a zoom level computed for 1280px would leave
  // the mobile artboard tiny and off-centre otherwise. Manual zoom (+/-/100%) opts out of this
  // until "Fit" is clicked again (Section 5 of the brief).
  useEffect(() => {
    if (zoomMode !== 'fit') return
    computeFit()
    window.addEventListener('resize', computeFit)
    return () => window.removeEventListener('resize', computeFit)
  }, [zoomMode, computeFit])

  if (mode === 'view') {
    // PREVIEW (Section 18 of the original brief, unchanged): the exact same clean render a real
    // visitor gets — no panels, no toolbar, no selection chrome — plus one floating affordance to
    // return to the editor. `mode` is the SAME context state the retained Page Builder's own "Exit
    // Edit Mode" button uses, so this is not a second, parallel preview implementation.
    return (
      <div className="pb-preview-wrap">
        <button className="pb-preview-exit" onClick={() => setMode('edit')}>← Back to Visual Editor</button>
        <PageContent />
      </div>
    )
  }

  const zoomFactor = zoom / 100
  const artboardWidth = ARTBOARD_WIDTH[breakpoint]

  return (
    <div className="pve-shell">
      <div className="pve-toolbar">
        <div className="pve-toolbar-left">
          <strong>VISUAL EDITOR</strong>
          <span className="pve-toolbar-page-name">Page: Positioning</span>
        </div>
        <div className="pve-toolbar-center">
          <div className="pve-bp-group">
            {(['desktop', 'tablet', 'mobile'] as Breakpoint[]).map(bp => (
              <button key={bp} className={`pve-bp-btn ${breakpoint === bp ? 'active' : ''}`} onClick={() => setBreakpoint(bp)}>
                {bp === 'desktop' ? 'Desktop' : bp === 'tablet' ? 'Tablet' : 'Mobile'}
              </button>
            ))}
          </div>
          <div className="pve-zoom-group">
            <button className="pve-zoom-btn" onClick={() => { setZoomMode('fit'); computeFit() }}>Fit</button>
            <button className="pve-zoom-btn" onClick={() => { setZoomMode('manual'); setZoom(z => Math.max(ZOOM_MIN, z - ZOOM_STEP)) }}>−</button>
            <span className="pve-zoom-pct">{zoom}%</span>
            <button className="pve-zoom-btn" onClick={() => { setZoomMode('manual'); setZoom(z => Math.min(ZOOM_MAX, z + ZOOM_STEP)) }}>+</button>
            <button className="pve-zoom-btn" onClick={() => { setZoomMode('manual'); setZoom(100) }}>100%</button>
          </div>
        </div>
        <div className="pve-toolbar-right">
          <button className="pve-preview-btn" onClick={() => setMode('view')}>Preview</button>
        </div>
      </div>

      <div className="pve-body">
        <VisualEditorLeftPanel />

        <div className="pve-workspace" ref={workspaceRef}>
          {/* Two-level frame: the OUTER box is sized to the artboard's actual VISUAL (post-scale)
             width so `margin: auto` centres it correctly at any zoom; the INNER box keeps its real
             CSS width and is shrunk purely via `transform: scale`, top-left origin, so its painted
             size exactly fills the outer frame (Section 5: zoom is visual-only, never a page-data
             change — nothing here writes to `page`). */}
          <div className="pve-artboard-frame" style={{ width: artboardWidth * zoomFactor }}>
            <div
              className={`pve-artboard pb-bp-${breakpoint}`}
              style={{ width: artboardWidth, transform: `scale(${zoomFactor})`, transformOrigin: 'top left' }}
            >
              <ZoomProvider value={zoomFactor}>
                <PageContent />
              </ZoomProvider>
            </div>
          </div>
        </div>

        <VisualEditorPropertyPanel />
      </div>
    </div>
  )
}
