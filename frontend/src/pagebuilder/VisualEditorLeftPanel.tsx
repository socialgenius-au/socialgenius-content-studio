import { useState } from 'react'
import { usePageBuilder } from './PageBuilderContext'
import { LayersPanel } from './LayersPanel'
import type { ElementType } from './types'

type LeftTab = 'elements' | 'layers'

/** The five V1 add-able element types (Section 3/10 of the UX-correction brief) — clicking one
 * calls the SAME `addElement` action every other mutation in this engine uses, appending a real
 * element to the shared page model (never a decorative menu, never a separate canvas-object
 * model). Glyphs match the approved mockup exactly (T / image / container / shape / button). */
const ADDABLE: { type: ElementType; glyph: string; label: string }[] = [
  { type: 'text', glyph: 'T', label: 'Text' },
  { type: 'image', glyph: '▧', label: 'Image' },
  { type: 'container', glyph: '▣', label: 'Container' },
  { type: 'shape', glyph: '▢', label: 'Shape' },
  { type: 'button', glyph: '◉', label: 'Button' },
]

function ElementsTab() {
  const { addElement } = usePageBuilder()
  return (
    <div className="pve-elements-list">
      {ADDABLE.map(item => (
        <button key={item.type} className="pve-element-item" onClick={() => addElement(item.type)}>
          <span className="pve-element-glyph" aria-hidden="true">{item.glyph}</span>
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  )
}

/** Left panel — exactly two tabs (Section 3 of the UX-correction brief). The Layers tab reuses the
 * existing `LayersPanel` component unmodified (same selection/visibility/lock logic the retained
 * Page Builder already uses) rather than duplicating it — this file only adds the tab chrome and
 * the new Elements tab around it. */
export function VisualEditorLeftPanel() {
  const [tab, setTab] = useState<LeftTab>('elements')
  return (
    <div className="pve-left">
      <div className="pve-left-tabs">
        <button className={`pve-left-tab ${tab === 'elements' ? 'active' : ''}`} onClick={() => setTab('elements')}>Elements</button>
        <button className={`pve-left-tab ${tab === 'layers' ? 'active' : ''}`} onClick={() => setTab('layers')}>Layers</button>
      </div>
      <div className="pve-left-body">
        {tab === 'elements' ? <ElementsTab /> : <LayersPanel />}
      </div>
    </div>
  )
}
