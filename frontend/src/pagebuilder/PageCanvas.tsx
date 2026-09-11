import type { CSSProperties } from 'react'
import { useRef } from 'react'
import { usePageBuilder } from './PageBuilderContext'
import { RenderElement } from './ElementRenderer'
import { PropertyPanel } from './PropertyPanel'
import { LayersPanel } from './LayersPanel'
import type { Breakpoint, SectionConfig } from './types'
import './pagebuilder.css'

/**
 * Renders one section's BACKGROUND LAYER (Section 9/"editable background architecture" of the
 * responsive-audit brief) — additive on top of the section's own existing `background` CSS value,
 * never replacing it. `type: 'none'` (every existing section's default) renders nothing at all, so
 * this changes zero pixels on any section until someone actually turns a background layer on.
 * Absolutely positioned, `inset: 0`, behind the section's real content (DOM order — see
 * SectionShell below for why no explicit z-index is needed for correct stacking).
 */
function SectionBackgroundLayer({ section, breakpoint }: { section: SectionConfig; breakpoint: Breakpoint }) {
  const bg = section.backgroundLayer
  if (!bg || bg.type === 'none') return null

  const bpOverride = breakpoint === 'desktop' ? undefined : bg.responsive?.[breakpoint]
  if (bpOverride?.visible === false) return null
  const opacity = bpOverride?.opacity ?? bg.opacity

  const layerStyle: CSSProperties = { position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', opacity }

  if (bg.type === 'color') {
    return <div className="pb-bg-layer" style={{ ...layerStyle, background: bg.color }} aria-hidden="true" />
  }
  if (bg.type === 'gradient') {
    return <div className="pb-bg-layer" style={{ ...layerStyle, background: bg.gradient }} aria-hidden="true" />
  }
  if (bg.type === 'video' && bg.videoSrc) {
    return (
      <div className="pb-bg-layer" style={layerStyle} aria-hidden="true">
        <video src={bg.videoSrc} autoPlay muted loop playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </div>
    )
  }
  if (bg.type === 'image' && bg.image) {
    const focalX = bpOverride?.focalX ?? bg.image.focalX
    const focalY = bpOverride?.focalY ?? bg.image.focalY
    return (
      <div className="pb-bg-layer" style={layerStyle} aria-hidden="true">
        {bg.image.src && (
          <img
            src={bg.image.src}
            alt=""
            style={{
              width: `${100 * bg.image.zoom}%`, height: `${100 * bg.image.zoom}%`,
              objectFit: bg.image.fit, objectPosition: `${focalX}% ${focalY}%`,
            }}
          />
        )}
      </div>
    )
  }
  return null
}

/** One section's chrome: the real semantic tag, its own existing className/background (untouched),
 * the new editable background layer, its content, and — Edit Mode only — a small affordance to
 * select the section itself for background editing (distinct from selecting a child element). */
function SectionShell({ section, breakpoint }: { section: SectionConfig; breakpoint: Breakpoint }) {
  const { mode, selectedSectionId, selectSection } = usePageBuilder()
  const Tag = (section.role === 'top-nav' ? 'nav' : section.role === 'footer' ? 'footer' : section.id === 'hero' ? 'header' : 'section') as
    'nav' | 'footer' | 'header' | 'section'
  const isSticky = section.sticky && section.sticky !== 'normal'
  const isSelected = mode === 'edit' && selectedSectionId === section.id

  return (
    <Tag
      className={`pb-role-${section.role} ${section.className ?? ''} ${isSelected ? 'pb-section-selected' : ''}`}
      style={{
        background: section.background,
        position: isSticky ? (section.sticky === 'fixed' ? 'fixed' : 'sticky') : 'relative',
        top: isSticky ? 0 : undefined,
      }}
      id={section.id === 'why-positioning' || section.id === 'positioning-audit' ? section.id : undefined}
    >
      <SectionBackgroundLayer section={section} breakpoint={breakpoint} />
      {mode === 'edit' && (
        <button
          className="pb-section-bg-btn"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); selectSection(section.id) }}
          title={`Edit ${section.name} background`}
        >
          🎨 {section.name}
        </button>
      )}
      {section.elements.map(el => <RenderElement key={el.id} element={el} />)}
    </Tag>
  )
}

/**
 * Top-level page renderer. VIEW MODE renders sections/elements with zero extra chrome — this is
 * what a public visitor gets, byte-for-byte the same DOM shape the original hard-coded
 * PositioningLandingPage produced (a `type: 'none'` background layer renders nothing, and the
 * section-select button only renders in Edit Mode). EDIT MODE adds a toolbar + layers panel +
 * property panel around the exact same rendered content (Section 2: the two modes share one
 * render path, edit chrome is additive, never a fork that could drift out of sync with what
 * visitors see).
 *
 * Edit Mode is entered via `?edit=1` on the URL (see PositioningLandingPage.tsx) — deliberately
 * not a public button, since this is an internal/admin capability, not a visitor-facing feature.
 */
export function PageCanvas() {
  const { mode, setMode, page, select, selectSection, breakpoint, setBreakpoint, resetDraft } = usePageBuilder()
  const canvasRef = useRef<HTMLDivElement>(null)

  const content = (
    <div
      ref={canvasRef}
      className={`pl-page pb-page pb-bp-${breakpoint}`}
      onClick={() => { if (mode === 'edit') { select(null); selectSection(null) } }}
    >
      {page.sections.map(section => <SectionShell key={section.id} section={section} breakpoint={breakpoint} />)}
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
