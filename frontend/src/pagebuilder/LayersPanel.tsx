import { usePageBuilder } from './PageBuilderContext'
import type { ElementConfig } from './types'

/** Minimal layer list (Section 19) — click to select, inline lock/visibility toggles. Nested
 * children render indented under their parent container so containment stays legible without a
 * full drag-to-reorder tree (out of scope for the first checkpoint). */
function LayerRow({ element, depth }: { element: ElementConfig; depth: number }) {
  const { selectedId, select, setLocked, setVisible } = usePageBuilder()
  return (
    <>
      <div
        className={`pb-layer-row ${selectedId === element.id ? 'active' : ''}`}
        style={{ paddingLeft: 10 + depth * 14 }}
        onClick={() => select(element.id)}
      >
        <span className="pb-layer-name">{element.name}</span>
        <span className="pb-layer-actions">
          <button onClick={(e) => { e.stopPropagation(); setVisible(element.id, !element.visible) }} title="Toggle visible">
            {element.visible ? '👁' : '🚫'}
          </button>
          <button onClick={(e) => { e.stopPropagation(); setLocked(element.id, !element.locked) }} title="Toggle lock">
            {element.locked ? '🔒' : '🔓'}
          </button>
        </span>
      </div>
      {element.children?.map(child => <LayerRow key={child.id} element={child} depth={depth + 1} />)}
    </>
  )
}

/** A section's Background as its own selectable Layers row (Section 8 of the Visual Editor brief
 * — background must be a first-class object in Layers, not reachable only via the canvas's
 * floating 🎨 button). Selecting it opens the exact same SectionBackgroundPanel the canvas button
 * already opens — same `selectSection` action, same underlying `backgroundLayer` data. */
function BackgroundRow({ sectionId, sectionName }: { sectionId: string; sectionName: string }) {
  const { selectedSectionId, selectSection } = usePageBuilder()
  return (
    <div
      className={`pb-layer-row ${selectedSectionId === sectionId ? 'active' : ''}`}
      style={{ paddingLeft: 10 }}
      onClick={() => selectSection(sectionId)}
    >
      <span className="pb-layer-name">🎨 Background</span>
    </div>
  )
}

export function LayersPanel() {
  const { page } = usePageBuilder()
  return (
    <div className="pb-layers">
      <div className="pb-panel-header"><span>Layers</span></div>
      {page.sections.map(section => (
        <div key={section.id} className="pb-layer-section">
          <div className="pb-layer-section-name">{section.name}</div>
          <BackgroundRow sectionId={section.id} sectionName={section.name} />
          {section.elements.map(el => <LayerRow key={el.id} element={el} depth={0} />)}
        </div>
      ))}
    </div>
  )
}
