import { useRef } from 'react'
import { usePageBuilder } from './PageBuilderContext'
import { ANIMATION_PRESET_LIBRARY } from './AnimationPresets'
import { DEFAULT_IMAGE_PROPS } from './types'
import type { AnimationTrigger, SectionBackgroundType } from './types'

/** Section-level "Background" editor (the new editable-background-layer architecture) — shown
 * instead of the element panel when a SECTION is selected (via the 🎨 button on each section in
 * Edit Mode) rather than a child element. Type none/color/gradient/image/video, each with its own
 * minimal controls; image reuses the identical fit/focal/zoom/opacity/replace pattern the element
 * image panel already uses, so the two stay consistent. */
function SectionBackgroundPanel({ sectionId }: { sectionId: string }) {
  const { page, selectSection, updateSectionBackground, breakpoint } = usePageBuilder()
  const section = page.sections.find(s => s.id === sectionId)
  const fileInputRef = useRef<HTMLInputElement>(null)
  if (!section) return null

  const bg = section.backgroundLayer ?? { type: 'none' as SectionBackgroundType, opacity: 1 }

  const handleReplace = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const url = URL.createObjectURL(file)
    updateSectionBackground(sectionId, { image: { ...(bg.image ?? DEFAULT_IMAGE_PROPS), src: url } })
  }

  return (
    <div className="pb-panel">
      <div className="pb-panel-header">
        <span>{section.name} — Background</span>
        <button className="pb-icon-btn" onClick={() => selectSection(null)}>✕</button>
      </div>
      <div className="pb-panel-sub">section · {bg.type === 'none' ? 'no background layer (section CSS unchanged)' : `${bg.type} layer active`}</div>

      <div className="pb-field-row">
        <label>Type
          <select value={bg.type} onChange={e => updateSectionBackground(sectionId, { type: e.target.value as SectionBackgroundType })}>
            <option value="none">None (use existing design)</option>
            <option value="color">Solid colour</option>
            <option value="gradient">Gradient</option>
            <option value="image">Image</option>
            <option value="video">Video</option>
          </select>
        </label>
      </div>

      {bg.type === 'color' && (
        <div className="pb-field-row">
          <label>Colour<input type="color" value={bg.color ?? '#1E3D2A'} onChange={e => updateSectionBackground(sectionId, { color: e.target.value })} /></label>
        </div>
      )}

      {bg.type === 'gradient' && (
        <div className="pb-field-row">
          <label>CSS gradient<input value={bg.gradient ?? ''} placeholder="linear-gradient(135deg, #1E3D2A, #C89A2E)" onChange={e => updateSectionBackground(sectionId, { gradient: e.target.value })} /></label>
        </div>
      )}

      {bg.type === 'video' && (
        <div className="pb-field-row">
          <label>Video URL<input value={bg.videoSrc ?? ''} placeholder="https://…mp4" onChange={e => updateSectionBackground(sectionId, { videoSrc: e.target.value })} /></label>
        </div>
      )}

      {bg.type === 'image' && (
        <>
          <div className="pb-field-row">
            <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleReplace} />
            <button className="pb-toggle" onClick={() => fileInputRef.current?.click()}>{bg.image?.src ? 'Replace image' : 'Add image'}</button>
          </div>
          <div className="pb-field-row">
            <label>Fit
              <select value={bg.image?.fit ?? 'cover'} onChange={e => updateSectionBackground(sectionId, { image: { ...(bg.image ?? DEFAULT_IMAGE_PROPS), fit: e.target.value as any } })}>
                <option value="cover">Fill (cover)</option>
                <option value="contain">Contain</option>
                <option value="fill">Stretch</option>
              </select>
            </label>
          </div>
          <div className="pb-field-row">
            <label>Focal X<input type="range" min={0} max={100} value={bg.image?.focalX ?? 50} onChange={e => updateSectionBackground(sectionId, { image: { ...(bg.image ?? DEFAULT_IMAGE_PROPS), focalX: Number(e.target.value) } })} /></label>
            <label>Focal Y<input type="range" min={0} max={100} value={bg.image?.focalY ?? 50} onChange={e => updateSectionBackground(sectionId, { image: { ...(bg.image ?? DEFAULT_IMAGE_PROPS), focalY: Number(e.target.value) } })} /></label>
          </div>
          <div className="pb-field-row">
            <label>Zoom<input type="range" min={1} max={2} step={0.05} value={bg.image?.zoom ?? 1} onChange={e => updateSectionBackground(sectionId, { image: { ...(bg.image ?? DEFAULT_IMAGE_PROPS), zoom: Number(e.target.value) } })} /></label>
          </div>
        </>
      )}

      {bg.type !== 'none' && (
        <div className="pb-field-row">
          <label>Opacity ({breakpoint})<input type="range" min={0} max={1} step={0.05}
            value={breakpoint === 'desktop' ? bg.opacity : (bg.responsive?.[breakpoint]?.opacity ?? bg.opacity)}
            onChange={e => {
              const v = Number(e.target.value)
              if (breakpoint === 'desktop') updateSectionBackground(sectionId, { opacity: v })
              else updateSectionBackground(sectionId, { responsive: { ...bg.responsive, [breakpoint]: { ...bg.responsive?.[breakpoint], opacity: v } } })
            }} />
          </label>
        </div>
      )}
      {bg.type !== 'none' && breakpoint !== 'desktop' && (
        <p className="pb-form-note" style={{ margin: '4px 0 0' }}>Opacity here applies only at {breakpoint} — colour/gradient/image/fit are shared across breakpoints.</p>
      )}
    </div>
  )
}

/** The minimum property panel (Section 27) — common X/Y/W/H/Lock/Visibility/Layer-order for every
 * element, plus a small type-specific block for image/text, plus the animation picker (Section
 * 34's success criterion: pick a preset + trigger + duration + delay, switch to View Mode, see
 * it play). Deliberately not a full design-tool inspector. */
export function PropertyPanel() {
  const {
    selectedId, selectedSectionId, findElement, updateElement, resizeElement, moveElement, setLocked, setVisible,
    reorderLayer, updateAnimation, duplicateElement, deleteElement, select, breakpoint,
  } = usePageBuilder()
  const element = findElement(selectedId)

  if (selectedSectionId && !element) {
    return <SectionBackgroundPanel sectionId={selectedSectionId} />
  }

  if (!element) {
    return (
      <div className="pb-panel">
        <div className="pb-panel-empty">Select an element, or a section's 🎨 button, to edit it.</div>
      </div>
    )
  }

  // Breakpoint-aware X/Y/W/H (bug fix — this panel previously always showed/edited the DESKTOP
  // base fields no matter which breakpoint tab was active in the toolbar, so there was no way to
  // even see, let alone author, a genuine tablet/mobile-only override). At desktop these are the
  // base fields; at tablet/mobile they show that breakpoint's OWN override when one exists, or the
  // desktop value as a preview of what it currently INHERITS (editing it creates a real override
  // for this breakpoint only — see moveElement/resizeElement in PageBuilderContext.tsx).
  const isDesktop = breakpoint === 'desktop'
  const activeOverride = isDesktop ? undefined : element.responsive[breakpoint]
  const hasOwnOverride = !isDesktop && (activeOverride?.x !== undefined || activeOverride?.y !== undefined || activeOverride?.width !== undefined || activeOverride?.height !== undefined)
  const displayX = isDesktop ? element.x : (activeOverride?.x ?? element.x)
  const displayY = isDesktop ? element.y : (activeOverride?.y ?? element.y)
  const displayW = isDesktop ? element.width : (activeOverride?.width ?? element.width)
  const displayH = isDesktop ? element.height : (activeOverride?.height ?? element.height)
  const w = typeof displayW === 'number' ? displayW : 0
  const h = typeof displayH === 'number' ? displayH : 0

  const clearBreakpointOverride = () => {
    if (isDesktop) return
    const { x: _x, y: _y, width: _w, height: _h, ...rest } = element.responsive[breakpoint] ?? {}
    updateElement(element.id, { responsive: { ...element.responsive, [breakpoint]: rest } })
  }

  return (
    <div className="pb-panel">
      <div className="pb-panel-header">
        <span>{element.name}</span>
        <button className="pb-icon-btn" onClick={() => select(null)}>✕</button>
      </div>
      <div className="pb-panel-sub">{element.type}{' · '}{isDesktop ? (element.positionOverridden || element.sizeOverridden ? 'edited (desktop)' : 'default layout') : `editing ${breakpoint}${hasOwnOverride ? ' (own override)' : ' — inherits desktop until you edit'}`}</div>

      <div className="pb-field-row">
        <label>X<input type="number" value={Math.round(displayX)} onChange={e => moveElement(element.id, Number(e.target.value) - displayX, 0)} /></label>
        <label>Y<input type="number" value={Math.round(displayY)} onChange={e => moveElement(element.id, 0, Number(e.target.value) - displayY)} /></label>
      </div>
      <div className="pb-field-row">
        <label>W<input type="number" value={w} onChange={e => resizeElement(element.id, { width: Number(e.target.value) })} /></label>
        <label>H<input type="number" value={h} onChange={e => resizeElement(element.id, { height: Number(e.target.value) })} /></label>
      </div>
      {!isDesktop && hasOwnOverride && (
        <div className="pb-field-row">
          <button className="pb-toggle" onClick={clearBreakpointOverride}>
            ↺ Remove {breakpoint} override (fall back to responsive layout)
          </button>
        </div>
      )}

      <div className="pb-field-row pb-toggle-row">
        <button className={`pb-toggle ${element.locked ? 'active' : ''}`} onClick={() => setLocked(element.id, !element.locked)}>
          {element.locked ? '🔒 Locked' : '🔓 Unlocked'}
        </button>
        <button className={`pb-toggle ${element.visible ? '' : 'active'}`} onClick={() => setVisible(element.id, !element.visible)}>
          {element.visible ? '👁 Visible' : '🚫 Hidden'}
        </button>
      </div>

      <div className="pb-field-row">
        <span className="pb-label-inline">Layer</span>
        <button className="pb-icon-btn" title="Send backward" onClick={() => reorderLayer(element.id, 'backward')}>◀</button>
        <button className="pb-icon-btn" title="Bring forward" onClick={() => reorderLayer(element.id, 'forward')}>▶</button>
        <button className="pb-icon-btn" title="Send to back" onClick={() => reorderLayer(element.id, 'back')}>⏮</button>
        <button className="pb-icon-btn" title="Bring to front" onClick={() => reorderLayer(element.id, 'front')}>⏭</button>
      </div>

      {element.type === 'image' && element.image && (
        <div className="pb-section">
          <div className="pb-section-title">Image</div>
          <div className="pb-field-row">
            <label>Fit
              <select value={element.image.fit} onChange={e => updateElement(element.id, { image: { ...element.image!, fit: e.target.value as any } })}>
                <option value="cover">Fill (cover)</option>
                <option value="contain">Contain</option>
                <option value="fill">Stretch</option>
              </select>
            </label>
          </div>
          <div className="pb-field-row">
            <label>Focal X<input type="range" min={0} max={100} value={element.image.focalX} onChange={e => updateElement(element.id, { image: { ...element.image!, focalX: Number(e.target.value) } })} /></label>
            <label>Focal Y<input type="range" min={0} max={100} value={element.image.focalY} onChange={e => updateElement(element.id, { image: { ...element.image!, focalY: Number(e.target.value) } })} /></label>
          </div>
          <div className="pb-field-row">
            <label>Opacity<input type="range" min={0} max={1} step={0.05} value={element.image.opacity} onChange={e => updateElement(element.id, { image: { ...element.image!, opacity: Number(e.target.value) } })} /></label>
            <label>Zoom<input type="range" min={1} max={2} step={0.05} value={element.image.zoom} onChange={e => updateElement(element.id, { image: { ...element.image!, zoom: Number(e.target.value) } })} /></label>
          </div>
          <div className="pb-field-row pb-toggle-row">
            <button className={`pb-toggle ${element.image.aspectRatioLocked ? 'active' : ''}`} onClick={() => updateElement(element.id, { image: { ...element.image!, aspectRatioLocked: !element.image!.aspectRatioLocked } })}>
              {element.image.aspectRatioLocked ? '🔗 Ratio locked' : '⛓️‍💥 Ratio free'}
            </button>
          </div>
        </div>
      )}

      {element.type === 'text' && element.text && (
        <div className="pb-section">
          <div className="pb-section-title">Text</div>
          <div className="pb-field-row">
            <label>Size<input type="number" value={element.text.fontSizePx} onChange={e => updateElement(element.id, { text: { ...element.text!, fontSizePx: Number(e.target.value) } })} /></label>
            <label>Weight
              <select value={element.text.fontWeight} onChange={e => updateElement(element.id, { text: { ...element.text!, fontWeight: Number(e.target.value) } })}>
                {[400, 500, 600, 700, 800].map(w => <option key={w} value={w}>{w}</option>)}
              </select>
            </label>
          </div>
          <div className="pb-field-row">
            <label>Align
              <select value={element.text.align ?? 'left'} onChange={e => updateElement(element.id, { text: { ...element.text!, align: e.target.value as any } })}>
                <option value="left">Left</option><option value="center">Center</option><option value="right">Right</option>
              </select>
            </label>
            <label>Colour<input type="color" value={element.text.color && /^#/.test(element.text.color) ? element.text.color : '#171912'} onChange={e => updateElement(element.id, { text: { ...element.text!, color: e.target.value } })} /></label>
          </div>
        </div>
      )}

      <div className="pb-section">
        <div className="pb-section-title">Animation</div>
        <div className="pb-field-row">
          <label>Preset
            <select value={element.animation.preset} onChange={e => updateAnimation(element.id, { preset: e.target.value as any })}>
              {ANIMATION_PRESET_LIBRARY.map(p => (
                <option key={p.id} value={p.id}>{p.label}{p.wired ? '' : ' (coming soon)'}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="pb-field-row">
          <label>Trigger
            <select value={element.animation.trigger} onChange={e => updateAnimation(element.id, { trigger: e.target.value as AnimationTrigger })}>
              <option value="page-load">Page load</option>
              <option value="viewport-enter">On viewport entry</option>
              <option value="hover">Hover</option>
              <option value="click">Click</option>
              <option value="scroll">Scroll (not yet wired)</option>
              <option value="focus">Focus (not yet wired)</option>
              <option value="time-delay">Time delay (not yet wired)</option>
              <option value="section-enter">Section enter (not yet wired)</option>
              <option value="section-exit">Section exit (not yet wired)</option>
            </select>
          </label>
        </div>
        <div className="pb-field-row">
          <label>Duration ms<input type="number" step={50} value={element.animation.durationMs} onChange={e => updateAnimation(element.id, { durationMs: Number(e.target.value) })} /></label>
          <label>Delay ms<input type="number" step={50} value={element.animation.delayMs} onChange={e => updateAnimation(element.id, { delayMs: Number(e.target.value) })} /></label>
        </div>
      </div>

      <div className="pb-field-row pb-panel-actions">
        <button className="pb-toggle" onClick={() => duplicateElement(element.id)}>Duplicate</button>
        <button className="pb-toggle pb-danger" onClick={() => { deleteElement(element.id); select(null) }}>Delete</button>
      </div>
    </div>
  )
}
