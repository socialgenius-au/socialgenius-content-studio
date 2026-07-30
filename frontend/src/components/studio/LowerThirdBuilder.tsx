import { useState, type CSSProperties } from 'react'
import { useStudio } from '../../contexts/StudioContext'
import type { LowerThird } from '../../types'

const ANIMATIONS: LowerThird['animation'][] = ['slide_left', 'fade_in', 'pop_up']
const ANIM_LABELS: Record<LowerThird['animation'], string> = {
  slide_left: '← Slide In',
  fade_in: 'Fade In',
  pop_up: '↑ Pop Up',
}

export default function LowerThirdBuilder() {
  const { lowerThirds, addLowerThird, updateLowerThird, removeLowerThird, timeline, activeBrand } = useStudio()
  const [form, setForm] = useState({
    name: '', title: '', animation: 'slide_left' as LowerThird['animation'],
    duration: 5, positionY: 85, showLogo: true,
  })

  const handleAdd = () => {
    if (!form.name.trim()) return
    const lt: LowerThird = {
      id: String(Date.now()),
      name: form.name.trim(),
      title: form.title.trim(),
      animation: form.animation,
      duration: form.duration,
      positionY: form.positionY,
      showLogo: form.showLogo,
      startTime: timeline.currentTime,
    }
    addLowerThird(lt)
    setForm(p => ({ ...p, name: '', title: '' }))
  }

  const brandColor = (activeBrand?.colors as Record<string, string> | undefined)?.primary ?? '#1E3D2A'

  return (
    <div style={s.root}>
      {/* Builder form */}
      <div style={s.form}>
        <div style={s.sectionTitle}>New Lower Third</div>

        <div style={s.field}>
          <label style={s.label}>Name / Speaker</label>
          <input
            style={s.input}
            placeholder="e.g. John Smith"
            value={form.name}
            onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
          />
        </div>

        <div style={s.field}>
          <label style={s.label}>Title / Role</label>
          <input
            style={s.input}
            placeholder="e.g. CEO, SocialGenius"
            value={form.title}
            onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
          />
        </div>

        <div style={s.field}>
          <label style={s.label}>Animation</label>
          <div style={s.chipRow}>
            {ANIMATIONS.map(a => (
              <button
                key={a}
                style={{ ...s.chip, ...(form.animation === a ? s.chipActive : {}) }}
                onClick={() => setForm(p => ({ ...p, animation: a }))}
              >
                {ANIM_LABELS[a]}
              </button>
            ))}
          </div>
        </div>

        <div style={s.row}>
          <div style={{ flex: 1 }}>
            <label style={s.label}>Duration (s)</label>
            <input
              style={s.numInput} type="number" min={1} max={30}
              value={form.duration}
              onChange={e => setForm(p => ({ ...p, duration: parseInt(e.target.value) || 5 }))}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={s.label}>Vertical (% from top)</label>
            <input
              style={s.numInput} type="number" min={0} max={100}
              value={form.positionY}
              onChange={e => setForm(p => ({ ...p, positionY: parseInt(e.target.value) || 85 }))}
            />
          </div>
        </div>

        <label style={s.checkRow}>
          <input
            type="checkbox"
            checked={form.showLogo}
            onChange={e => setForm(p => ({ ...p, showLogo: e.target.checked }))}
          />
          <span style={s.checkLabel}>Show brand logo</span>
        </label>

        {/* Preview */}
        <div style={s.preview}>
          <div style={{ ...s.previewBar, background: brandColor }} />
          <div style={s.previewText}>
            <span style={s.previewName}>{form.name || 'Name'}</span>
            <span style={s.previewTitle}>{form.title || 'Title / Role'}</span>
          </div>
        </div>

        <button style={s.addBtn} onClick={handleAdd}>
          + Add to Timeline at {Math.round(timeline.currentTime)}s
        </button>
      </div>

      {/* Existing lower thirds */}
      {lowerThirds.length > 0 && (
        <div style={s.existingSection}>
          <div style={s.sectionTitle}>On Timeline</div>
          {lowerThirds.map(lt => (
            <div key={lt.id} style={s.ltCard}>
              <div style={s.ltCardBody}>
                <span style={s.ltName}>{lt.name}</span>
                {lt.title && <span style={s.ltTitle}>{lt.title}</span>}
                <span style={s.ltMeta}>at {lt.startTime.toFixed(1)}s · {lt.duration}s</span>
              </div>
              <button style={s.removeBtn} onClick={() => removeLowerThird(lt.id)}>×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const s: Record<string, CSSProperties> = {
  root: {},
  form: { background: 'var(--panel-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 'var(--space-3)', marginBottom: 'var(--space-3)' },
  sectionTitle: {
    fontSize: 10, fontWeight: 800, color: 'var(--brand-accent)',
    textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 'var(--space-3)',
  },
  field: { marginBottom: 'var(--space-2)' },
  label: { display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 3 },
  input: {
    width: '100%', padding: 'var(--space-2) var(--space-2)', border: '1px solid var(--border)', borderRadius: 5,
    fontSize: 12, boxSizing: 'border-box', background: 'var(--input-bg)', color: 'var(--text-primary)',
  },
  row: { display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' },
  numInput: { width: '100%', padding: 'var(--space-2) var(--space-2)', border: '1px solid var(--border)', borderRadius: 5, fontSize: 12, background: 'var(--input-bg)', color: 'var(--text-primary)' },
  chipRow: { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)' },
  chip: { padding: '3px var(--space-2)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 11, cursor: 'pointer', background: 'var(--input-bg)', color: 'var(--text-secondary)' },
  chipActive: { background: 'var(--brand-header)', color: 'var(--brand-header-text)', borderColor: 'var(--brand-header)' },
  checkRow: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', cursor: 'pointer', marginBottom: 'var(--space-3)' },
  checkLabel: { fontSize: 12, color: 'var(--text-secondary)' },

  preview: {
    display: 'flex', alignItems: 'stretch', marginBottom: 'var(--space-3)',
    background: 'var(--canvas-bg)', borderRadius: 6, overflow: 'hidden',
  },
  previewBar: { width: 4, flexShrink: 0 },
  previewText: { padding: 'var(--space-2) var(--space-3)', display: 'flex', flexDirection: 'column', gap: 1 },
  previewName: { color: 'var(--text-primary)', fontSize: 13, fontWeight: 800 },
  previewTitle: { color: 'var(--text-tertiary)', fontSize: 11 },

  addBtn: {
    width: '100%', padding: 'var(--space-2)', background: 'var(--brand-header)', color: 'var(--brand-header-text)',
    border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer',
  },

  existingSection: {},
  ltCard: {
    display: 'flex', alignItems: 'center', background: 'var(--panel-surface)',
    border: '1px solid var(--border)', borderRadius: 6, padding: 'var(--space-2) var(--space-3)',
    marginBottom: 'var(--space-1)', gap: 'var(--space-2)',
  },
  ltCardBody: { flex: 1, display: 'flex', flexDirection: 'column', gap: 1 },
  ltName: { fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' },
  ltTitle: { fontSize: 11, color: 'var(--text-secondary)' },
  ltMeta: { fontSize: 10, color: 'var(--text-tertiary)' },
  removeBtn: { background: 'none', border: 'none', color: 'var(--danger)', fontSize: 16, cursor: 'pointer', padding: '0 var(--space-1)' },
}
