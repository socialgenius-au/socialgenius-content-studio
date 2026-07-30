import { useState, type CSSProperties } from 'react'
import { useStudio } from '../../contexts/StudioContext'
import type { TextOverlay } from '../../types'

const FONTS = ['Inter', 'Georgia', 'Arial', 'Bebas Neue', 'Playfair Display', 'Montserrat', 'Roboto']
const ANIMATIONS: TextOverlay['animation'][] = ['none', 'fade_in', 'slide_left', 'slide_right', 'slide_top', 'slide_bottom', 'typewriter', 'pop']
const ANIM_LABELS: Record<TextOverlay['animation'], string> = {
  none: 'None', fade_in: 'Fade', slide_left: '← Slide', slide_right: '→ Slide',
  slide_top: '↓ Drop', slide_bottom: '↑ Rise', typewriter: 'Type', pop: 'Pop',
}

export default function TextOverlayEditor() {
  const { textOverlays, addTextOverlay, updateTextOverlay, removeTextOverlay, timeline } = useStudio()
  const [newText, setNewText] = useState('')

  const handleAdd = () => {
    if (!newText.trim()) return
    const overlay: TextOverlay = {
      id: String(Date.now()),
      text: newText.trim(),
      x: 5, y: 80,
      width: 90,
      startTime: timeline.currentTime,
      endTime: Math.min(timeline.currentTime + 5, timeline.duration || timeline.currentTime + 5),
      fontFamily: 'Inter',
      fontSize: 48,
      bold: true, italic: false,
      color: '#FFFFFF',
      bgColor: 'transparent',
      bgOpacity: 0.7,
      animation: 'fade_in',
    }
    addTextOverlay(overlay)
    setNewText('')
  }

  return (
    <div style={s.root}>
      {/* Add new overlay */}
      <div style={s.addRow}>
        <input
          style={s.textInput}
          placeholder="Type overlay text…"
          value={newText}
          onChange={e => setNewText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
        />
        <button style={s.addBtn} onClick={handleAdd}>+ Add</button>
      </div>

      {textOverlays.length === 0 ? (
        <p style={s.empty}>No text overlays. Add one above to position it on the canvas.</p>
      ) : (
        <div style={s.list}>
          {textOverlays.map(o => (
            <OverlayEditor
              key={o.id}
              overlay={o}
              onUpdate={upd => updateTextOverlay(o.id, upd)}
              onRemove={() => removeTextOverlay(o.id)}
              maxTime={timeline.duration}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function OverlayEditor({ overlay, onUpdate, onRemove, maxTime }: {
  overlay: TextOverlay
  onUpdate: (upd: Partial<TextOverlay>) => void
  onRemove: () => void
  maxTime: number
}) {
  const [open, setOpen] = useState(true)

  return (
    <div style={s.card}>
      <div style={s.cardHeader} onClick={() => setOpen(v => !v)}>
        <span style={s.previewText}>{overlay.text.slice(0, 30)}</span>
        <button style={s.removeBtn} onClick={e => { e.stopPropagation(); onRemove() }}>×</button>
        <span style={{ color: 'var(--text-tertiary)', fontSize: 10 }}>{open ? '▲' : '▼'}</span>
      </div>

      {open && (
        <div style={s.cardBody}>
          {/* Text content */}
          <textarea
            style={s.textarea}
            value={overlay.text}
            onChange={e => onUpdate({ text: e.target.value })}
            rows={2}
          />

          {/* Font family */}
          <Row label="Font">
            <select
              style={s.select}
              value={overlay.fontFamily}
              onChange={e => onUpdate({ fontFamily: e.target.value })}
            >
              {FONTS.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </Row>

          {/* Font size */}
          <Row label="Size">
            <input
              style={s.numInput} type="number" min={8} max={200}
              value={overlay.fontSize}
              onChange={e => onUpdate({ fontSize: parseInt(e.target.value) || 48 })}
            />
            <div style={s.toggleRow}>
              <button
                style={{ ...s.fmtBtn, ...(overlay.bold ? s.fmtBtnActive : {}) }}
                onClick={() => onUpdate({ bold: !overlay.bold })}
              >B</button>
              <button
                style={{ ...s.fmtBtn, fontStyle: 'italic', ...(overlay.italic ? s.fmtBtnActive : {}) }}
                onClick={() => onUpdate({ italic: !overlay.italic })}
              >I</button>
            </div>
          </Row>

          {/* Colours */}
          <Row label="Text colour">
            <input
              type="color" value={overlay.color}
              style={s.colorPicker}
              onChange={e => onUpdate({ color: e.target.value })}
            />
            <span style={s.colorHex}>{overlay.color}</span>
          </Row>
          <Row label="Background">
            <input
              type="color" value={overlay.bgColor === 'transparent' ? '#000000' : overlay.bgColor}
              style={s.colorPicker}
              onChange={e => onUpdate({ bgColor: e.target.value })}
            />
            <input
              type="range" min={0} max={1} step={0.05}
              value={overlay.bgOpacity}
              style={s.slider}
              onChange={e => onUpdate({ bgOpacity: parseFloat(e.target.value) })}
            />
          </Row>

          {/* Position */}
          <Row label="X (%)">
            <input
              style={s.numInput} type="number" min={0} max={100}
              value={Math.round(overlay.x)}
              onChange={e => onUpdate({ x: parseFloat(e.target.value) || 0 })}
            />
          </Row>
          <Row label="Y (%)">
            <input
              style={s.numInput} type="number" min={0} max={100}
              value={Math.round(overlay.y)}
              onChange={e => onUpdate({ y: parseFloat(e.target.value) || 0 })}
            />
          </Row>

          {/* Timing */}
          <Row label="Start (s)">
            <input
              style={s.numInput} type="number" min={0} max={maxTime} step={0.1}
              value={overlay.startTime}
              onChange={e => onUpdate({ startTime: parseFloat(e.target.value) || 0 })}
            />
          </Row>
          <Row label="End (s)">
            <input
              style={s.numInput} type="number" min={0} max={maxTime} step={0.1}
              value={overlay.endTime}
              onChange={e => onUpdate({ endTime: parseFloat(e.target.value) || 5 })}
            />
          </Row>

          {/* Animation */}
          <div style={s.sectionTitle}>Animation</div>
          <div style={s.chipRow}>
            {ANIMATIONS.map(a => (
              <button
                key={a}
                style={{ ...s.chip, ...(overlay.animation === a ? s.chipActive : {}) }}
                onClick={() => onUpdate({ animation: a })}
              >
                {ANIM_LABELS[a]}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={s.row}>
      <span style={s.rowLabel}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>{children}</div>
    </div>
  )
}

const s: Record<string, CSSProperties> = {
  root: {},
  addRow: { display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' },
  textInput: {
    flex: 1, padding: 'var(--space-2) var(--space-3)', border: '1px solid var(--border)', borderRadius: 6,
    fontSize: 13, outline: 'none', background: 'var(--input-bg)', color: 'var(--text-primary)',
  },
  addBtn: {
    background: 'var(--brand-header)', color: 'var(--brand-header-text)', border: 'none',
    borderRadius: 6, padding: 'var(--space-2) var(--space-3)', fontSize: 12, fontWeight: 700, cursor: 'pointer',
  },
  empty: { color: 'var(--text-tertiary)', fontSize: 12, textAlign: 'center', padding: 'var(--space-3) 0' },
  list: { display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' },

  card: { border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', background: 'var(--panel-surface)' },
  cardHeader: {
    display: 'flex', alignItems: 'center', padding: 'var(--space-2) var(--space-3)',
    cursor: 'pointer', background: 'var(--panel-bg)', borderBottom: '1px solid var(--border)', gap: 'var(--space-2)',
  },
  previewText: { flex: 1, fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  removeBtn: { background: 'none', border: 'none', color: 'var(--danger)', fontSize: 16, cursor: 'pointer' },
  cardBody: { padding: 'var(--space-3) var(--space-3)' },
  textarea: {
    width: '100%', padding: 'var(--space-2) var(--space-2)', border: '1px solid var(--border)', borderRadius: 5,
    fontSize: 12, resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box',
    marginBottom: 'var(--space-2)', background: 'var(--input-bg)', color: 'var(--text-primary)',
  },

  sectionTitle: { fontSize: 10, fontWeight: 800, color: 'var(--brand-accent)', textTransform: 'uppercase', letterSpacing: 0.8, margin: 'var(--space-2) 0 var(--space-1)' },
  row: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' },
  rowLabel: { fontSize: 11, color: 'var(--text-secondary)', width: 70, flexShrink: 0 },
  select: { flex: 1, padding: 'var(--space-1) var(--space-2)', border: '1px solid var(--border)', borderRadius: 4, fontSize: 12, background: 'var(--input-bg)', color: 'var(--text-primary)' },
  numInput: { width: 60, padding: '3px var(--space-2)', border: '1px solid var(--border)', borderRadius: 4, fontSize: 12, background: 'var(--input-bg)', color: 'var(--text-primary)' },
  toggleRow: { display: 'flex', gap: 3 },
  fmtBtn: {
    width: 26, height: 26, border: '1px solid var(--border)', borderRadius: 4,
    background: 'var(--input-bg)', color: 'var(--text-primary)', cursor: 'pointer', fontSize: 12, fontWeight: 700,
  },
  fmtBtnActive: { background: 'var(--brand-header)', color: 'var(--brand-header-text)', borderColor: 'var(--brand-header)' },
  colorPicker: { width: 30, height: 24, border: '1px solid var(--border)', borderRadius: 3, padding: 1, cursor: 'pointer' },
  colorHex: { fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'monospace' },
  slider: { flex: 1, accentColor: 'var(--brand-header)' },

  chipRow: { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)', marginBottom: 'var(--space-1)' },
  chip: { padding: '3px var(--space-2)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 10, cursor: 'pointer', background: 'var(--input-bg)', color: 'var(--text-secondary)' },
  chipActive: { background: 'var(--brand-header)', color: 'var(--brand-header-text)', borderColor: 'var(--brand-header)' },
}
