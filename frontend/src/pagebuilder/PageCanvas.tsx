import { usePageBuilder } from './PageBuilderContext'
import { RenderElement } from './ElementRenderer'
import { PropertyPanel } from './PropertyPanel'
import { LayersPanel } from './LayersPanel'
import type { Breakpoint } from './types'
import './pagebuilder.css'

/**
 * Top-level page renderer. VIEW MODE renders sections/elements with zero extra chrome — this is
 * what a public visitor gets, byte-for-byte the same DOM shape the original hard-coded
 * PositioningLandingPage produced. EDIT MODE adds a toolbar + layers panel + property panel
 * around the exact same rendered content (Section 2: the two modes share one render path, edit
 * chrome is additive, never a fork that could drift out of sync with what visitors see).
 *
 * Edit Mode is entered via `?edit=1` on the URL (see PositioningLandingPage.tsx) — deliberately
 * not a public button, since this is an internal/admin capability, not a visitor-facing feature.
 */
export function PageCanvas() {
  const { mode, setMode, page, select, breakpoint, setBreakpoint, resetDraft } = usePageBuilder()

  const content = (
    <div className={`pl-page pb-page pb-bp-${breakpoint}`} onClick={() => mode === 'edit' && select(null)}>
      {page.sections.map(section => {
        const Tag = section.role === 'top-nav' ? 'nav' : section.role === 'footer' ? 'footer' : section.role === 'content' && section.id === 'hero' ? 'header' : 'section'
        return (
          <Tag
            key={section.id}
            className={`pb-role-${section.role} ${section.className ?? ''}`}
            style={{
              background: section.background,
              position: section.sticky && section.sticky !== 'normal' ? (section.sticky === 'fixed' ? 'fixed' : 'sticky') : undefined,
              top: section.sticky && section.sticky !== 'normal' ? 0 : undefined,
            }}
            id={section.id === 'why-positioning' || section.id === 'positioning-audit' ? section.id : undefined}
          >
            {section.elements.map(el => <RenderElement key={el.id} element={el} />)}
          </Tag>
        )
      })}
    </div>
  )

  if (mode === 'view') return content

  return (
    <div className="pb-shell">
      <div className="pb-toolbar">
        <div className="pb-toolbar-left">
          <strong>Page Builder</strong>
          <span className="pb-toolbar-page-name">{page.name}</span>
        </div>
        <div className="pb-toolbar-center">
          {(['desktop', 'tablet', 'mobile'] as Breakpoint[]).map(bp => (
            <button key={bp} className={`pb-toggle ${breakpoint === bp ? 'active' : ''}`} onClick={() => setBreakpoint(bp)}>
              {bp === 'desktop' ? '🖥' : bp === 'tablet' ? '📱' : '📲'} {bp}
            </button>
          ))}
        </div>
        <div className="pb-toolbar-right">
          <button className="pb-toggle" onClick={() => { if (confirm('Reset all edits back to the shipped design?')) resetDraft() }}>Reset draft</button>
          <button className="pb-toggle active" onClick={() => setMode('view')}>Exit Edit Mode → View</button>
        </div>
      </div>
      <div className="pb-body">
        <LayersPanel />
        <div className={`pb-canvas-wrap pb-bp-${breakpoint}`}>{content}</div>
        <PropertyPanel />
      </div>
    </div>
  )
}
