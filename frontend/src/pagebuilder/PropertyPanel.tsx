import { usePageBuilder } from './PageBuilderContext'
import { ANIMATION_PRESET_LIBRARY } from './AnimationPresets'
import type { AnimationTrigger } from './types'

/** The minimum property panel (Section 27) — common X/Y/W/H/Lock/Visibility/Layer-order for every
 * element, plus a small type-specific block for image/text, plus the animation picker (Section
 * 34's success criterion: pick a preset + trigger + duration + delay, switch to View Mode, see
 * it play). Deliberately not a full design-tool inspector. */
export function PropertyPanel() {
  const {
    selectedId, findElement, updateElement, resizeElement, moveElement, setLocked, setVisible,
    reorderLayer, updateAnimation, duplicateElement, deleteElement, select,
  } = usePageBuilder()
  const element = findElement(selectedId)

  if (!element) {
    return (
      <div className="pb-panel">
        <div className="pb-panel-empty">Select an element on the page to edit it.</div>
      </div>
    )
  }

  const w = typeof element.width === 'number' ? element.width : 0
  const h = typeof element.height === 'number' ? element.height : 0

  return (
    <div className="pb-panel">
      <div className="pb-panel-header">
        <span>{element.name}</span>
        <button className="pb-icon-btn" onClick={() => select(null)}>✕</button>
      </div>
      <div className="pb-panel-sub">{element.type}{element.positionOverridden || element.sizeOverridden ? ' · edited' : ' · default layout'}</div>

      <div className="pb-field-row">
        <label>X<input type="number" value={Math.round(element.x)} onChange={e => moveElement(element.id, Number(e.target.value) - element.x, 0)} /></label>
        <label>Y<input type="number" value={Math.round(element.y)} onChange={e => moveElement(element.id, 0, Number(e.target.value) - element.y)} /></label>
      </div>
      <div className="pb-field-row">
        <label>W<input type="number" value={w} onChange={e => resizeElement(element.id, { width: Number(e.target.value) })} /></label>
        <label>H<input type="number" value={h} onChange={e => resizeElement(element.id, { height: Number(e.target.value) })} /></label>
      </div>

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
