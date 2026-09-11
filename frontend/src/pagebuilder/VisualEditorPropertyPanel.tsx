import { usePageBuilder } from './PageBuilderContext'
import { MediaSelector } from './MediaSelector'
import { DEFAULT_IMAGE_PROPS } from './types'
import type { SectionBackgroundType } from './types'

/**
 * Visual Editor V1 — right-hand Properties panel, built to the EXACT section layout specified in
 * the UX-correction brief (Section 8/9: PROPERTIES / "Selected: [name]" / TRANSFORM / then a
 * type-specific CONTENT+TYPOGRAPHY or IMAGE or APPEARANCE block / BACKGROUND for a selected
 * section). This is a dedicated presentation for the new shell — the retained Page Builder keeps
 * its own existing `PropertyPanel.tsx` untouched, so this file changes ONLY what Ayub sees in the
 * new editor, never the old one. Every field here calls the SAME context actions the old panel
 * uses (`updateElement`, `moveElement`, `resizeElement`, `updateSectionBackground`, ...) — this is
 * a different VIEW over the identical shared page model, not a second one (Section 9: "Background
 * editing must operate on the existing background model already built. Do not rebuild it.").
 */
function BackgroundPanel({ sectionId }: { sectionId: string }) {
  const { page, selectSection, updateSectionBackground } = usePageBuilder()
  const section = page.sections.find(s => s.id === sectionId)
  if (!section) return null
  const bg = section.backgroundLayer ?? { type: 'none' as SectionBackgroundType, opacity: 1 }

  const handleReplace = (file: File) => {
    const url = URL.createObjectURL(file)
    updateSectionBackground(sectionId, { image: { ...(bg.image ?? DEFAULT_IMAGE_PROPS), src: url } })
  }

  return (
    <div className="pve-panel">
      <div className="pve-panel-title">PROPERTIES</div>
      <div className="pve-panel-selected">Selected: {section.name} — Background</div>
      <button className="pve-deselect" onClick={() => selectSection(null)}>✕ Deselect</button>

      <div className="pve-section">
        <div className="pve-section-title">BACKGROUND</div>
        <div className="pve-field-row">
          <label>Type
            <select value={bg.type} onChange={e => updateSectionBackground(sectionId, { type: e.target.value as SectionBackgroundType })}>
              <option value="none">None (existing design)</option>
              <option value="color">Colour</option>
              <option value="gradient">Gradient</option>
              <option value="image">Image</option>
            </select>
          </label>
        </div>

        {bg.type === 'color' && (
          <div className="pve-field-row">
            <label>Colour<input type="color" value={bg.color ?? '#1E3D2A'} onChange={e => updateSectionBackground(sectionId, { color: e.target.value })} /></label>
          </div>
        )}

        {bg.type === 'gradient' && (
          <div className="pve-field-row">
            <label>CSS gradient<input value={bg.gradient ?? ''} placeholder="linear-gradient(135deg, #1E3D2A, #C89A2E)" onChange={e => updateSectionBackground(sectionId, { gradient: e.target.value })} /></label>
          </div>
        )}

        {bg.type === 'image' && (
          <>
            <div className="pve-field-row">
              <MediaSelector label={bg.image?.src ? 'Replace' : 'Upload'} onUpload={handleReplace} />
            </div>
            <div className="pve-field-row">
              <label>Fit
                <select value={bg.image?.fit ?? 'cover'} onChange={e => updateSectionBackground(sectionId, { image: { ...(bg.image ?? DEFAULT_IMAGE_PROPS), fit: e.target.value as any } })}>
                  <option value="cover">Cover</option>
                  <option value="contain">Contain</option>
                  <option value="fill">Fill</option>
                </select>
              </label>
            </div>
            <div className="pve-field-row">
              <label>Zoom<input type="range" min={1} max={2} step={0.05} value={bg.image?.zoom ?? 1} onChange={e => updateSectionBackground(sectionId, { image: { ...(bg.image ?? DEFAULT_IMAGE_PROPS), zoom: Number(e.target.value) } })} /></label>
            </div>
            <div className="pve-field-row">
              <label>Focal X<input type="range" min={0} max={100} value={bg.image?.focalX ?? 50} onChange={e => updateSectionBackground(sectionId, { image: { ...(bg.image ?? DEFAULT_IMAGE_PROPS), focalX: Number(e.target.value) } })} /></label>
              <label>Focal Y<input type="range" min={0} max={100} value={bg.image?.focalY ?? 50} onChange={e => updateSectionBackground(sectionId, { image: { ...(bg.image ?? DEFAULT_IMAGE_PROPS), focalY: Number(e.target.value) } })} /></label>
            </div>
          </>
        )}

        {bg.type !== 'none' && (
          <div className="pve-field-row">
            <label>Opacity<input type="range" min={0} max={1} step={0.05} value={bg.opacity} onChange={e => updateSectionBackground(sectionId, { opacity: Number(e.target.value) })} /></label>
          </div>
        )}
      </div>
    </div>
  )
}

export function VisualEditorPropertyPanel() {
  const {
    selectedId, selectedSectionId, findElement, updateElement, resizeElement, moveElement,
    setLocked, breakpoint, select,
  } = usePageBuilder()
  const element = findElement(selectedId)

  if (selectedSectionId && !element) return <BackgroundPanel sectionId={selectedSectionId} />

  if (!element) {
    return (
      <div className="pve-panel">
        <div className="pve-panel-title">PROPERTIES</div>
        <div className="pve-panel-empty">Select an object on the canvas, or a layer, to edit it.</div>
      </div>
    )
  }

  const isDesktop = breakpoint === 'desktop'
  const activeOverride = isDesktop ? undefined : element.responsive[breakpoint]
  const displayX = isDesktop ? element.x : (activeOverride?.x ?? element.x)
  const displayY = isDesktop ? element.y : (activeOverride?.y ?? element.y)
  const displayW = isDesktop ? element.width : (activeOverride?.width ?? element.width)
  const displayH = isDesktop ? element.height : (activeOverride?.height ?? element.height)
  const w = typeof displayW === 'number' ? displayW : 0
  const h = typeof displayH === 'number' ? displayH : 0

  return (
    <div className="pve-panel">
      <div className="pve-panel-title">PROPERTIES</div>
      <div className="pve-panel-selected">Selected: {element.name}</div>
      <button className="pve-deselect" onClick={() => select(null)}>✕ Deselect</button>
      {!isDesktop && (
        <p className="pve-bp-note">Editing {breakpoint} — position/size changes here only affect {breakpoint}.</p>
      )}

      <div className="pve-section">
        <div className="pve-section-title">TRANSFORM</div>
        <div className="pve-field-row">
          <label>X<input type="number" value={Math.round(displayX)} onChange={e => moveElement(element.id, Number(e.target.value) - displayX, 0)} /></label>
          <label>Y<input type="number" value={Math.round(displayY)} onChange={e => moveElement(element.id, 0, Number(e.target.value) - displayY)} /></label>
        </div>
        <div className="pve-field-row">
          <label>W<input type="number" value={w} onChange={e => resizeElement(element.id, { width: Number(e.target.value) })} /></label>
          <label>H<input type="number" value={h} onChange={e => resizeElement(element.id, { height: Number(e.target.value) })} /></label>
        </div>
        <div className="pve-field-row">
          <button className={`pve-lock-btn ${element.locked ? 'active' : ''}`} onClick={() => setLocked(element.id, !element.locked)}>
            {element.locked ? '🔒 Locked' : '🔓 Lock'}
          </button>
        </div>
      </div>

      {element.type === 'text' && element.text && (
        <>
          <div className="pve-section">
            <div className="pve-section-title">CONTENT</div>
            <div className="pve-field-row">
              <textarea
                rows={element.text.content.length > 60 ? 4 : 2}
                value={element.text.content}
                onChange={e => updateElement(element.id, { text: { ...element.text!, content: e.target.value } })}
              />
            </div>
          </div>
          <div className="pve-section">
            <div className="pve-section-title">TYPOGRAPHY</div>
            <div className="pve-field-row">
              <label>Font Size<input type="number" value={element.text.fontSizePx ?? ''} placeholder="inherited" onChange={e => updateElement(element.id, { text: { ...element.text!, fontSizePx: Number(e.target.value) } })} /></label>
              <label>Weight
                <select value={element.text.fontWeight} onChange={e => updateElement(element.id, { text: { ...element.text!, fontWeight: Number(e.target.value) } })}>
                  {[400, 500, 600, 700, 800].map(fw => <option key={fw} value={fw}>{fw}</option>)}
                </select>
              </label>
            </div>
            <div className="pve-field-row">
              <label>Alignment
                <select value={element.text.align ?? 'left'} onChange={e => updateElement(element.id, { text: { ...element.text!, align: e.target.value as any } })}>
                  <option value="left">Left</option><option value="center">Center</option><option value="right">Right</option>
                </select>
              </label>
              <label>Colour<input type="color" value={element.text.color && /^#/.test(element.text.color) ? element.text.color : '#171912'} onChange={e => updateElement(element.id, { text: { ...element.text!, color: e.target.value } })} /></label>
            </div>
          </div>
        </>
      )}

      {element.type === 'image' && element.image && (
        <div className="pve-section">
          <div className="pve-section-title">IMAGE</div>
          <div className="pve-field-row">
            <MediaSelector
              label={element.image.src ? 'Replace' : 'Upload'}
              onUpload={(file) => updateElement(element.id, { image: { ...element.image!, src: URL.createObjectURL(file) } })}
            />
          </div>
          <div className="pve-field-row">
            <label>Fit
              <select value={element.image.fit} onChange={e => updateElement(element.id, { image: { ...element.image!, fit: e.target.value as any } })}>
                <option value="cover">Cover</option>
                <option value="contain">Contain</option>
                <option value="fill">Fill</option>
              </select>
            </label>
          </div>
          <div className="pve-field-row">
            <label>Zoom<input type="range" min={1} max={2} step={0.05} value={element.image.zoom} onChange={e => updateElement(element.id, { image: { ...element.image!, zoom: Number(e.target.value) } })} /></label>
            <label>Opacity<input type="range" min={0} max={1} step={0.05} value={element.image.opacity} onChange={e => updateElement(element.id, { image: { ...element.image!, opacity: Number(e.target.value) } })} /></label>
          </div>
          <div className="pve-field-row">
            <label>Focal X<input type="range" min={0} max={100} value={element.image.focalX} onChange={e => updateElement(element.id, { image: { ...element.image!, focalX: Number(e.target.value) } })} /></label>
            <label>Focal Y<input type="range" min={0} max={100} value={element.image.focalY} onChange={e => updateElement(element.id, { image: { ...element.image!, focalY: Number(e.target.value) } })} /></label>
          </div>
          <div className="pve-field-row">
            <button className={`pve-lock-btn ${element.image.aspectRatioLocked ? 'active' : ''}`} onClick={() => updateElement(element.id, { image: { ...element.image!, aspectRatioLocked: !element.image!.aspectRatioLocked } })}>
              {element.image.aspectRatioLocked ? '🔗 Aspect locked' : '⛓️‍💥 Aspect free'}
            </button>
          </div>
        </div>
      )}

      {(element.type === 'container' || element.type === 'card' || element.type === 'shape') && !element.custom && (
        <div className="pve-section">
          <div className="pve-section-title">APPEARANCE</div>
          <div className="pve-field-row">
            <label>Fill<input type="color" value={element.background && /^#/.test(element.background) ? element.background : '#ffffff'} onChange={e => updateElement(element.id, { background: e.target.value })} /></label>
            <label>Opacity<input type="range" min={0} max={1} step={0.05} value={element.opacity ?? 1} onChange={e => updateElement(element.id, { opacity: Number(e.target.value) })} /></label>
          </div>
          <div className="pve-field-row">
            <label>Border<input value={element.border ?? ''} placeholder="1px solid #17191233" onChange={e => updateElement(element.id, { border: e.target.value })} /></label>
            <label>Radius<input type="number" value={element.borderRadius ?? 0} onChange={e => updateElement(element.id, { borderRadius: Number(e.target.value) })} /></label>
          </div>
        </div>
      )}

      {element.type === 'button' && element.button && (
        <>
          <div className="pve-section">
            <div className="pve-section-title">CONTENT</div>
            <div className="pve-field-row">
              <label>Label<input value={element.button.label} onChange={e => updateElement(element.id, { button: { ...element.button!, label: e.target.value } })} /></label>
            </div>
          </div>
          <div className="pve-section">
            <div className="pve-section-title">TYPOGRAPHY</div>
            <div className="pve-field-row">
              <label>Text Colour<input type="color" value={element.button.color && /^#/.test(element.button.color) ? element.button.color : '#ffffff'} onChange={e => updateElement(element.id, { button: { ...element.button!, color: e.target.value } })} /></label>
            </div>
          </div>
          <div className="pve-section">
            <div className="pve-section-title">APPEARANCE</div>
            <div className="pve-field-row">
              <label>Background<input type="color" value={element.button.background && /^#/.test(element.button.background) ? element.button.background : '#1E3D2A'} onChange={e => updateElement(element.id, { button: { ...element.button!, background: e.target.value } })} /></label>
              <label>Radius<input type="number" value={element.button.borderRadius ?? 0} onChange={e => updateElement(element.id, { button: { ...element.button!, borderRadius: Number(e.target.value) } })} /></label>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
