import { useEffect, useState } from 'react'
import { usePageBuilder } from './PageBuilderContext'
import { PageContent } from './PageCanvas'
import { LayersPanel } from './LayersPanel'
import { PropertyPanel } from './PropertyPanel'
import type { Breakpoint } from './types'
import './pagebuilder.css'

/**
 * Visual Web Editor V1 — the new PRIMARY hands-on design environment (distinct from the retained
 * Page Builder in PageCanvas.tsx, per the "one engine, three views" architecture: Page Builder |
 * Visual Editor | Preview all read/write the SAME `usePageBuilder()` state and the SAME
 * `PageContent` render path — this file owns none of its own page data, only a different shell
 * around the existing engine, exactly per Section 2/3 of the Visual Editor brief).
 *
 * Entered via `?studio=1` on `/positioning` (see PositioningLandingPage.tsx). All selection/drag/
 * resize/property/persistence logic is deferred to PageBuilderContext + LayersPanel +
 * PropertyPanel, which the retained Page Builder also uses unmodified — this file is chrome only.
 */
export function VisualEditorShell() {
  const { mode, setMode, breakpoint, setBreakpoint, page } = usePageBuilder()
  const [saved, setSaved] = useState(true)

  // Every page mutation already persists synchronously via PageBuilderContext's own localStorage
  // effect (Section 17: reuse existing persistence, don't build a second state model just for a
  // save indicator). This only gives Ayub a visible confirmation that the save happened.
  useEffect(() => {
    setSaved(false)
    const t = setTimeout(() => setSaved(true), 400)
    return () => clearTimeout(t)
  }, [page])

  if (mode === 'view') {
    // PREVIEW (Section 18): the exact same clean render a real visitor gets — no Layers, no
    // Properties, no selection chrome — plus one floating affordance to return to the editor.
    // `mode` is the SAME context state the retained Page Builder's own "Exit Edit Mode" button
    // uses, so this is not a second, parallel preview implementation.
    return (
      <div className="pb-preview-wrap">
        <button className="pb-preview-exit" onClick={() => setMode('edit')}>← Back to Visual Editor</button>
        <PageContent />
      </div>
    )
  }

  return (
    <div className="pb-shell pb-visual-editor">
      <div className="pb-toolbar">
        <div className="pb-toolbar-left">
          <strong>Visual Editor</strong>
          <span className="pb-toolbar-page-name">{page.name}</span>
          <span className={`pb-save-indicator ${saved ? 'saved' : ''}`}>{saved ? '✓ Saved' : 'Saving…'}</span>
        </div>
        <div className="pb-toolbar-center">
          {(['desktop', 'tablet', 'mobile'] as Breakpoint[]).map(bp => (
            <button key={bp} className={`pb-toggle ${breakpoint === bp ? 'active' : ''}`} onClick={() => setBreakpoint(bp)}>
              {bp === 'desktop' ? '🖥' : bp === 'tablet' ? '📱' : '📲'} {bp}
            </button>
          ))}
        </div>
        <div className="pb-toolbar-right">
          <button className="pb-toggle active" onClick={() => setMode('view')}>Preview →</button>
        </div>
      </div>
      <div className="pb-body">
        <LayersPanel />
        <div className={`pb-canvas-wrap pb-bp-${breakpoint}`}><PageContent /></div>
        <PropertyPanel />
      </div>
    </div>
  )
}
