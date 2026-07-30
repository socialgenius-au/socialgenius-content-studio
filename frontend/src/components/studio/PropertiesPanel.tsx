import type { CSSProperties } from 'react'
import { useStudio } from '../../contexts/StudioContext'

export default function PropertiesPanel() {
  const {
    selectedElement, setSelectedElement,
    textOverlays, updateTextOverlay, removeTextOverlay,
    videoClips, updateVideoClip, removeVideoClip,
    additionalVideoClips, updateAdditionalVideoClip, removeAdditionalVideoClip,
    audioTracks, updateAudioTrack, removeAudioTrack,
  } = useStudio()

  if (!selectedElement) return null

  const close = () => setSelectedElement(null)

  const overlay = selectedElement.type === 'text'
    ? textOverlays.find(o => o.id === selectedElement.id)
    : undefined
  const clipList = selectedElement.type === 'clip' && selectedElement.lane === 'additional' ? additionalVideoClips : videoClips
  const clip = selectedElement.type === 'clip'
    ? clipList.find(c => c.id === selectedElement.id)
    : undefined
  const updateClip = selectedElement.type === 'clip' && selectedElement.lane === 'additional' ? updateAdditionalVideoClip : updateVideoClip
  const removeClip = selectedElement.type === 'clip' && selectedElement.lane === 'additional' ? removeAdditionalVideoClip : removeVideoClip
  const audio = selectedElement.type === 'audio'
    ? audioTracks.find(t => t.id === selectedElement.id)
    : undefined

  if (!overlay && !clip && !audio) return null

  return (
    <aside style={s.panel}>
      <div style={s.header}>
        <span style={s.title}>{overlay ? 'Text properties' : audio ? 'Audio properties' : 'Clip properties'}</span>
        <button style={s.closeBtn} onClick={close} title="Deselect" aria-label="Deselect">✕</button>
      </div>

      <div style={s.content}>
        {overlay && (
          <>
            <Field label="Text">
              <textarea
                style={s.textarea}
                rows={2}
                value={overlay.text}
                onChange={e => updateTextOverlay(overlay.id, { text: e.target.value })}
              />
            </Field>
            <Row>
              <Field label="Font size">
                <input
                  style={s.numInput} type="number" min={8} max={200}
                  value={overlay.fontSize}
                  onChange={e => updateTextOverlay(overlay.id, { fontSize: parseInt(e.target.value) || 48 })}
                />
              </Field>
              <Field label="Colour">
                <input
                  type="color" style={s.colorPicker}
                  value={overlay.color}
                  onChange={e => updateTextOverlay(overlay.id, { color: e.target.value })}
                />
              </Field>
            </Row>
            <Row>
              <Field label="X (%)">
                <input
                  style={s.numInput} type="number" min={0} max={100}
                  value={Math.round(overlay.x)}
                  onChange={e => updateTextOverlay(overlay.id, { x: parseFloat(e.target.value) || 0 })}
                />
              </Field>
              <Field label="Y (%)">
                <input
                  style={s.numInput} type="number" min={0} max={100}
                  value={Math.round(overlay.y)}
                  onChange={e => updateTextOverlay(overlay.id, { y: parseFloat(e.target.value) || 0 })}
                />
              </Field>
            </Row>
            <button style={s.removeBtn} onClick={() => { removeTextOverlay(overlay.id); close() }}>
              Remove overlay
            </button>
          </>
        )}

        {clip && (
          <>
            <Field label="Name">
              <span style={s.staticVal}>{clip.name || 'Untitled clip'}</span>
            </Field>
            <Row>
              <Field label="Trim in (s)">
                <input
                  style={s.numInput} type="number" min={0} step={0.01}
                  value={clip.trimIn}
                  onChange={e => updateClip(clip.id, { trimIn: parseFloat(e.target.value) || 0 })}
                />
              </Field>
              <Field label="Trim out (s)">
                <input
                  style={s.numInput} type="number" min={0} step={0.01}
                  value={clip.trimOut}
                  onChange={e => updateClip(clip.id, { trimOut: parseFloat(e.target.value) || 0 })}
                />
              </Field>
            </Row>
            <Field label="Speed">
              <div style={s.chipRow}>
                {([0.25, 0.5, 1, 2] as const).map(sp => (
                  <button
                    key={sp}
                    style={{ ...s.chip, ...(clip.speed === sp ? s.chipActive : {}) }}
                    onClick={() => updateClip(clip.id, { speed: sp })}
                  >
                    {sp}x
                  </button>
                ))}
              </div>
            </Field>
            <button style={s.removeBtn} onClick={() => { removeClip(clip.id); close() }}>
              Remove clip
            </button>
          </>
        )}

        {audio && (
          <>
            <Field label="Name">
              <span style={s.staticVal}>{audio.name || 'Untitled track'}</span>
            </Field>
            <Field label="Volume">
              <div style={s.sliderRow}>
                <input
                  type="range" min={0} max={2} step={0.05} style={s.slider}
                  value={audio.volume}
                  onChange={e => updateAudioTrack(audio.id, { volume: parseFloat(e.target.value) })}
                />
                <span style={s.sliderVal}>{Math.round(audio.volume * 100)}%</span>
              </div>
            </Field>
            <Row>
              <Field label="Trim in (s)">
                <input
                  style={s.numInput} type="number" min={0} step={0.01}
                  value={audio.trimIn}
                  onChange={e => updateAudioTrack(audio.id, { trimIn: parseFloat(e.target.value) || 0 })}
                />
              </Field>
              <Field label="Trim out (s)">
                <input
                  style={s.numInput} type="number" min={0} step={0.01}
                  value={audio.trimOut}
                  onChange={e => updateAudioTrack(audio.id, { trimOut: parseFloat(e.target.value) || 0 })}
                />
              </Field>
            </Row>
            <Row>
              <Field label="Fade in (s)">
                <input
                  style={s.numInput} type="number" min={0} max={10} step={0.1}
                  value={audio.fadeIn}
                  onChange={e => updateAudioTrack(audio.id, { fadeIn: parseFloat(e.target.value) || 0 })}
                />
              </Field>
              <Field label="Fade out (s)">
                <input
                  style={s.numInput} type="number" min={0} max={10} step={0.1}
                  value={audio.fadeOut}
                  onChange={e => updateAudioTrack(audio.id, { fadeOut: parseFloat(e.target.value) || 0 })}
                />
              </Field>
            </Row>
            <Field label="Auto-duck">
              <label style={s.toggle}>
                <input
                  type="checkbox"
                  checked={audio.duck}
                  onChange={e => updateAudioTrack(audio.id, { duck: e.target.checked })}
                />
                <span style={s.staticVal}>{audio.duck ? 'On — ducks under voice' : 'Off'}</span>
              </label>
            </Field>
            <button style={s.removeBtn} onClick={() => { removeAudioTrack(audio.id); close() }}>
              Remove track
            </button>
          </>
        )}
      </div>
    </aside>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={s.field}>
      <span style={s.fieldLabel}>{label}</span>
      {children}
    </div>
  )
}

function Row({ children }: { children: React.ReactNode }) {
  return <div style={s.row}>{children}</div>
}

const s: Record<string, CSSProperties> = {
  panel: {
    width: 280, minWidth: 280, background: 'var(--panel-bg)', borderLeft: '1px solid var(--border)',
    display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0,
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--border)', flexShrink: 0,
  },
  title: { fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' },
  closeBtn: {
    background: 'none', border: 'none', fontSize: 14, cursor: 'pointer',
    color: 'var(--text-tertiary)', padding: 'var(--space-1) var(--space-2)', borderRadius: 4,
  },
  content: { flex: 1, overflowY: 'auto', padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' },

  row: { display: 'flex', gap: 'var(--space-3)' },
  field: { flex: 1, display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' },
  fieldLabel: { fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' },
  staticVal: { fontSize: 12, color: 'var(--text-primary)', fontWeight: 600 },

  textarea: {
    width: '100%', padding: 'var(--space-2) var(--space-3)', border: '1px solid var(--border)',
    borderRadius: 6, fontSize: 12, resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box',
    background: 'var(--input-bg)', color: 'var(--text-primary)',
  },
  numInput: {
    width: '100%', padding: 'var(--space-1) var(--space-2)', border: '1px solid var(--border)',
    borderRadius: 5, fontSize: 12, background: 'var(--input-bg)', color: 'var(--text-primary)', boxSizing: 'border-box',
  },
  colorPicker: { width: '100%', height: 30, border: '1px solid var(--border)', borderRadius: 5, padding: 1, cursor: 'pointer' },

  chipRow: { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)' },
  chip: {
    padding: '3px var(--space-2)', border: '1px solid var(--border)', borderRadius: 10,
    fontSize: 11, cursor: 'pointer', background: 'var(--input-bg)', color: 'var(--text-secondary)',
  },
  chipActive: { background: 'var(--brand-header)', color: 'var(--brand-header-text)', borderColor: 'var(--brand-header)' },

  sliderRow: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)' },
  slider: { flex: 1, accentColor: 'var(--brand-header)' },
  sliderVal: { fontSize: 11, color: 'var(--text-primary)', width: 36, textAlign: 'right', fontWeight: 600 },
  toggle: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', cursor: 'pointer' },

  removeBtn: {
    padding: 'var(--space-2) var(--space-3)', background: 'transparent', border: '1px solid var(--danger)',
    color: 'var(--danger)', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', marginTop: 'var(--space-2)',
  },
}
