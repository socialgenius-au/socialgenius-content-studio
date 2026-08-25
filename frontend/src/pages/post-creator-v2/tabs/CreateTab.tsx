import { useState } from 'react'
import {
  Wand2, Sparkles, LayoutTemplate, Upload, Square, MousePointer2, Type, Image as ImageIcon,
  Shapes, Crop, Wand, Move, Layers, Film, Palette, Undo2, Redo2, ZoomIn,
} from 'lucide-react'
import { AI_TOOLS } from '../mockData'

const MODES = [
  { id: 'prompt', label: 'Prompt Generator', icon: Wand2 },
  { id: 'ai-create', label: 'AI Create', icon: Sparkles },
  { id: 'templates', label: 'Templates', icon: LayoutTemplate },
  { id: 'import', label: 'External Import', icon: Upload },
  { id: 'blank', label: 'Blank Canvas', icon: Square },
]

const LEFT_RAIL = [
  { id: 'ai-tools', label: 'AI Tools', icon: Sparkles },
  { id: 'layers', label: 'Layers', icon: Layers },
  { id: 'media', label: 'Media', icon: Film },
  { id: 'text', label: 'Text', icon: Type },
  { id: 'elements', label: 'Elements', icon: Shapes },
  { id: 'brand-kit', label: 'Brand Kit', icon: Palette },
]

const CANVAS_TOOLS = [
  { id: 'select', label: 'Select', icon: MousePointer2 },
  { id: 'text', label: 'Text', icon: Type },
  { id: 'image', label: 'Image', icon: ImageIcon },
  { id: 'shape', label: 'Shape', icon: Shapes },
  { id: 'crop', label: 'Crop', icon: Crop },
  { id: 'ai-edit', label: 'AI Edit', icon: Wand },
  { id: 'arrange', label: 'Arrange', icon: Move },
]

export default function CreateTab({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const [mode, setMode] = useState('prompt')
  const [railTab, setRailTab] = useState('ai-tools')
  const [canvasTool, setCanvasTool] = useState('select')
  const [rightTab, setRightTab] = useState<'properties' | 'ai-select'>('ai-select')
  const [selectedTool, setSelectedTool] = useState('ai-select')

  return (
    <div>
      <div className="pcv2-stage-head">
        <span className="pcv2-stage-num">4</span>
        <span className="pcv2-stage-title">Create</span>
      </div>
      <p className="pcv2-stage-sub">Generate your post</p>

      <div className="pcv2-mode-row" style={{ marginTop: 20 }}>
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            className={`pcv2-mode-btn ${mode === m.id ? 'is-active' : ''}`}
            onClick={() => setMode(m.id)}
          >
            <m.icon size={14} /> {m.label}
          </button>
        ))}
      </div>

      <div className="pcv2-editor">
        {/* LEFT — AI Tools / Layers / Media / Text / Elements / Brand Kit */}
        <div className="pcv2-editor-col">
          <div className="pcv2-rail-tabs">
            {LEFT_RAIL.map((r) => (
              <button
                key={r.id}
                type="button"
                className={`pcv2-rail-tab ${railTab === r.id ? 'is-active' : ''}`}
                onClick={() => setRailTab(r.id)}
              >
                <r.icon size={15} /> {r.label}
              </button>
            ))}
          </div>

          {railTab === 'ai-tools' && (
            <div style={{ overflowY: 'auto' }}>
              {AI_TOOLS.map((tool) => (
                <div
                  key={tool.id}
                  className={`pcv2-ai-tool ${selectedTool === tool.id ? 'is-selected' : ''}`}
                  onClick={() => setSelectedTool(tool.id)}
                >
                  <span className="pcv2-ai-tool-icon">
                    <Wand2 size={14} />
                  </span>
                  <div>
                    <div className="pcv2-ai-tool-title">{tool.title}</div>
                    <div className="pcv2-ai-tool-sub">{tool.sub}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {railTab !== 'ai-tools' && (
            <p className="pcv2-card-sub">
              {LEFT_RAIL.find((r) => r.id === railTab)?.label} panel — populated once this workspace is wired to
              the editor.
            </p>
          )}
        </div>

        {/* CENTRE — Post Editor canvas */}
        <div className="pcv2-editor-col">
          <div className="pcv2-canvas-toolbar" style={{ justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', gap: 2 }}>
              {CANVAS_TOOLS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`pcv2-canvas-tool ${canvasTool === t.id ? 'is-active' : ''}`}
                  onClick={() => setCanvasTool(t.id)}
                >
                  <t.icon size={16} /> {t.label}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 2, color: 'var(--pcv2-text-muted)' }}>
              <button type="button" className="pcv2-canvas-tool">
                <Undo2 size={16} />
              </button>
              <button type="button" className="pcv2-canvas-tool">
                <Redo2 size={16} />
              </button>
              <button type="button" className="pcv2-canvas-tool">
                <ZoomIn size={16} /> 100%
              </button>
            </div>
          </div>

          <div className="pcv2-canvas-stage">
            <div className="pcv2-mock-post">
              <span className="pcv2-mock-post-logo">
                <Sparkles size={14} /> ABC TILES
              </span>
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

        {/* RIGHT — Properties + AI Select */}
        <div className="pcv2-editor-col">
          <div className="pcv2-right-tabs">
            <button
              type="button"
              className={`pcv2-right-tab ${rightTab === 'properties' ? 'is-active' : ''}`}
              onClick={() => setRightTab('properties')}
            >
              Properties
            </button>
            <button
              type="button"
              className={`pcv2-right-tab ${rightTab === 'ai-select' ? 'is-active' : ''}`}
              onClick={() => setRightTab('ai-select')}
            >
              AI Select
            </button>
          </div>

          {rightTab === 'properties' ? (
            <div>
              <div className="pcv2-field">
                <label className="pcv2-label">Font</label>
                <select className="pcv2-select" defaultValue="Montserrat">
                  <option>Montserrat</option>
                  <option>Inter</option>
                  <option>Poppins</option>
                </select>
              </div>
              <div className="pcv2-pill-row">
                <select className="pcv2-select" defaultValue="Bold">
                  <option>Bold</option>
                  <option>Regular</option>
                </select>
                <select className="pcv2-select" defaultValue="64">
                  <option>64</option>
                  <option>48</option>
                  <option>32</option>
                </select>
              </div>
              <div className="pcv2-field">
                <label className="pcv2-label">Colour</label>
                <input className="pcv2-input" defaultValue="#1E4D2B" />
              </div>
              <div className="pcv2-field">
                <label className="pcv2-label">Spacing / Line Height</label>
                <div className="pcv2-pill-row">
                  <input className="pcv2-input" defaultValue="1.1" />
                  <input className="pcv2-input" defaultValue="1.2" />
                </div>
              </div>
            </div>
          ) : (
            <div>
              <p className="pcv2-card-sub" style={{ marginBottom: 12 }}>Edit any part of the design</p>
              <p className="pcv2-label" style={{ marginBottom: 8 }}>What would you like to do?</p>
              <div className="pcv2-pill-row" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
                {['Delete', 'Replace', 'Regenerate', 'Similar', 'Use Asset', 'Recreate Text'].map((a) => (
                  <button key={a} type="button" className="pcv2-pill-btn">
                    {a}
                  </button>
                ))}
              </div>
              <p className="pcv2-label" style={{ marginTop: 14, marginBottom: 6 }}>Replace with</p>
              <div className="pcv2-subtabs" style={{ width: '100%' }}>
                <button type="button" className="pcv2-subtab is-active" style={{ flex: 1 }}>
                  AI Generate
                </button>
                <button type="button" className="pcv2-subtab" style={{ flex: 1 }}>
                  Client Assets
                </button>
              </div>
              <div className="pcv2-field">
                <label className="pcv2-label">Describe what you want</label>
                <textarea className="pcv2-textarea" defaultValue="Modern bathroom with grey tiles and black tapware" />
              </div>
              <div className="pcv2-field">
                <label className="pcv2-label">Style</label>
                <select className="pcv2-select" defaultValue="Modern Premium">
                  <option>Modern Premium</option>
                  <option>Minimal</option>
                  <option>Bold &amp; Editorial</option>
                </select>
              </div>
              <button type="button" className="pcv2-btn pcv2-btn-primary pcv2-btn-block">
                Generate (3 Variations)
              </button>
            </div>
          )}
        </div>
      </div>

      <div>
        <p className="pcv2-label" style={{ marginTop: 20, marginBottom: 4 }}>AI Generated Variations</p>
        <div className="pcv2-variations-strip">
          {[1, 2, 3].map((n) => (
            <div key={n} className={`pcv2-variation ${n === 2 ? 'is-selected' : ''}`}>
              <div className="pcv2-variation-thumb" />
              <div className="pcv2-variation-label">Variation {n}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="pcv2-footer-nav">
        <button type="button" className="pcv2-btn pcv2-btn-secondary" onClick={onBack}>
          ← References
        </button>
        <button type="button" className="pcv2-btn pcv2-btn-primary" onClick={onNext}>
          Next: Review →
        </button>
      </div>
    </div>
  )
}
