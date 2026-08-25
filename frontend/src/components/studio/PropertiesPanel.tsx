import { useState, type CSSProperties, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { useStudio } from '../../contexts/StudioContext'
import type { VideoClip } from '../../types'

const GRADE_LABELS: Record<string, string> = {
  none: 'None', warm: 'Warm', cool: 'Cool', cinematic: 'Cine',
  bw: 'B&W', high_contrast: 'Hi-Con', desaturated: 'Desat',
}

const SPEED_OPTIONS = [0.25, 0.5, 1, 2] as const

type PanelTab = 'properties' | 'effects'

interface Props {
  collapsed: boolean
}

// Collapse is triggered from the right icon rail (re-clicking the active "Properties" item),
// matching the locked reference — this panel just reflects that state, it doesn't own a
// collapse button of its own.
export default function PropertiesPanel({ collapsed }: Props) {
  const {
    selectedElement, setSelectedElement,
    textOverlays, updateTextOverlay, removeTextOverlay,
    videoClips, updateVideoClip, removeVideoClip,
    additionalVideoClips, updateAdditionalVideoClip, removeAdditionalVideoClip,
    audioTracks, updateAudioTrack, removeAudioTrack,
  } = useStudio()
  const [tab, setTab] = useState<PanelTab>('properties')

  const close = () => setSelectedElement(null)

  const overlay = selectedElement?.type === 'text'
    ? textOverlays.find(o => o.id === selectedElement.id)
    : undefined
  const clipList = selectedElement?.type === 'clip' && selectedElement.lane === 'additional' ? additionalVideoClips : videoClips
  const clip = selectedElement?.type === 'clip'
    ? clipList.find(c => c.id === selectedElement.id)
    : undefined
  const updateClip = selectedElement?.type === 'clip' && selectedElement.lane === 'additional' ? updateAdditionalVideoClip : updateVideoClip
  const removeClip = selectedElement?.type === 'clip' && selectedElement.lane === 'additional' ? removeAdditionalVideoClip : removeVideoClip
  const audio = selectedElement?.type === 'audio'
    ? audioTracks.find(t => t.id === selectedElement.id)
    : undefined

  const hasSelection = !!(overlay || clip || audio)
  const label = overlay ? overlay.text.slice(0, 28) || 'Text' : clip ? (clip.name || 'Clip') : audio ? (audio.name || 'Audio') : null

  return (
    <aside className="sgv-right-panel sgv-collapsible" data-collapsed={collapsed} style={s.panel}>
      <div style={s.tabs}>
        <button className="sgv-tab sgv-tab--panel" data-active={tab === 'properties'} onClick={() => setTab('properties')}>
          Properties
        </button>
        <button className="sgv-tab sgv-tab--panel" data-active={tab === 'effects'} onClick={() => setTab('effects')}>
          Effects
        </button>
        {hasSelection && (
          <button style={s.deselectBtn} onClick={close} title="Deselect" aria-label="Deselect">✕</button>
        )}
      </div>

      <div style={s.content}>
        {!hasSelection && (
          <p style={s.empty}>Select a clip, text, or audio element on the timeline to edit its properties.</p>
        )}

        {hasSelection && label && <div style={s.selectionLabel}>{label}</div>}

        {tab === 'properties' && (
          <>
            {overlay && (
              <>
                <Section title="Content">
                  <Field label="Text">
                    <textarea
                      className="sgv-input" style={s.textarea} rows={2}
                      value={overlay.text}
                      onChange={e => updateTextOverlay(overlay.id, { text: e.target.value })}
                    />
                  </Field>
                </Section>
                <Section title="Transform">
                  <Row>
                    <Field label="X (%)">
                      <input
                        className="sgv-input" style={s.numInput} type="number" min={0} max={100}
                        value={Math.round(overlay.x)}
                        onChange={e => updateTextOverlay(overlay.id, { x: parseFloat(e.target.value) || 0 })}
                      />
                    </Field>
                    <Field label="Y (%)">
                      <input
                        className="sgv-input" style={s.numInput} type="number" min={0} max={100}
                        value={Math.round(overlay.y)}
                        onChange={e => updateTextOverlay(overlay.id, { y: parseFloat(e.target.value) || 0 })}
                      />
                    </Field>
                  </Row>
                  <Field label="Font size">
                    <input
                      className="sgv-input" style={s.numInput} type="number" min={8} max={200}
                      value={overlay.fontSize}
                      onChange={e => updateTextOverlay(overlay.id, { fontSize: parseInt(e.target.value) || 48 })}
                    />
                  </Field>
                </Section>
                <Section title="Colour">
                  <Field label="Text colour">
                    <input
                      type="color" style={s.colorPicker}
                      value={overlay.color}
                      onChange={e => updateTextOverlay(overlay.id, { color: e.target.value })}
                    />
                  </Field>
                </Section>
                <button style={s.removeBtn} onClick={() => { removeTextOverlay(overlay.id); close() }}>
                  Remove overlay
                </button>
              </>
            )}

            {clip && (
              <>
                {/* Scale/Position/Rotate/Opacity aren't backed by any real state yet (VideoClip
                    has no such fields) — shown disabled with "Coming next" rather than as fake
                    interactive controls, so this never implies functionality that doesn't exist. */}
                <Section title="Transform" badge="Coming next">
                  <Row>
                    <Field label="Scale (%)">
                      <input className="sgv-input" style={s.numInput} type="number" value={100} disabled />
                    </Field>
                    <Field label="Rotate (°)">
                      <input className="sgv-input" style={s.numInput} type="number" value={0} disabled />
                    </Field>
                  </Row>
                  <Row>
                    <Field label="Position X">
                      <input className="sgv-input" style={s.numInput} type="number" value={0} disabled />
                    </Field>
                    <Field label="Position Y">
                      <input className="sgv-input" style={s.numInput} type="number" value={0} disabled />
                    </Field>
                  </Row>
                  <Field label="Opacity (%)">
                    <input className="sgv-input" style={s.numInput} type="number" value={100} disabled />
                  </Field>
                </Section>

                <Section title="Speed">
                  <Field label="Playback Speed">
                    <select
                      className="sgv-select" style={s.select}
                      value={clip.speed}
                      onChange={e => updateClip(clip.id, { speed: Number(e.target.value) as VideoClip['speed'] })}
                    >
                      {SPEED_OPTIONS.map(sp => <option key={sp} value={sp}>{sp.toFixed(2)}x</option>)}
                    </select>
                  </Field>
                </Section>

                <Section title="Transition to Next">
                  <Row>
                    <Field label="Transition">
                      <select
                        className="sgv-select" style={s.select}
                        value={clip.transition}
                        onChange={e => updateClip(clip.id, { transition: e.target.value as VideoClip['transition'] })}
                      >
                        <option value="cut">Cut</option>
                        <option value="dissolve">Dissolve</option>
                        <option value="whip_pan">Whip Pan</option>
                        <option value="fade_black">Fade to Black</option>
                        <option value="zoom_punch">Zoom Punch</option>
                      </select>
                    </Field>
                    <Field label="Duration (s)">
                      <input
                        className="sgv-input" style={s.numInput} type="number" min={0} max={5} step={0.1}
                        disabled={clip.transition === 'cut'}
                        value={clip.transitionDuration}
                        onChange={e => updateClip(clip.id, { transitionDuration: parseFloat(e.target.value) || 0 })}
                      />
                    </Field>
                  </Row>
                </Section>

                <button style={s.removeBtn} onClick={() => { removeClip(clip.id); close() }}>
                  Remove clip
                </button>
              </>
            )}

            {audio && (
              <>
                <Section title="Transform">
                  <Row>
                    <Field label="Trim in (s)">
                      <input
                        className="sgv-input" style={s.numInput} type="number" min={0} step={0.01}
                        value={audio.trimIn}
                        onChange={e => updateAudioTrack(audio.id, { trimIn: parseFloat(e.target.value) || 0 })}
                      />
                    </Field>
                    <Field label="Trim out (s)">
                      <input
                        className="sgv-input" style={s.numInput} type="number" min={0} step={0.01}
                        value={audio.trimOut}
                        onChange={e => updateAudioTrack(audio.id, { trimOut: parseFloat(e.target.value) || 0 })}
                      />
                    </Field>
                  </Row>
                  <Row>
                    <Field label="Fade in (s)">
                      <input
                        className="sgv-input" style={s.numInput} type="number" min={0} max={10} step={0.1}
                        value={audio.fadeIn}
                        onChange={e => updateAudioTrack(audio.id, { fadeIn: parseFloat(e.target.value) || 0 })}
                      />
                    </Field>
                    <Field label="Fade out (s)">
                      <input
                        className="sgv-input" style={s.numInput} type="number" min={0} max={10} step={0.1}
                        value={audio.fadeOut}
                        onChange={e => updateAudioTrack(audio.id, { fadeOut: parseFloat(e.target.value) || 0 })}
                      />
                    </Field>
                  </Row>
                </Section>

                <Section title="Speed">
                  <Field label="Volume">
                    <div style={s.sliderRow}>
                      <input
                        type="range" min={0} max={2} step={0.05} className="sgv-range"
                        value={audio.volume}
                        onChange={e => updateAudioTrack(audio.id, { volume: parseFloat(e.target.value) })}
                      />
                      <span style={s.sliderVal}>{Math.round(audio.volume * 100)}%</span>
                    </div>
                  </Field>
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
                </Section>

                <button style={s.removeBtn} onClick={() => { removeAudioTrack(audio.id); close() }}>
                  Remove track
                </button>
              </>
            )}
          </>
        )}

        {tab === 'effects' && (
          <>
            {clip && (
              <>
                <Section title="Colour">
                  <div style={s.chipRow}>
                    {(['none', 'warm', 'cool', 'cinematic', 'bw', 'high_contrast', 'desaturated'] as VideoClip['colorGrade'][]).map(g => (
                      <button
                        key={g}
                        className="sgv-btn sgv-btn--ghost-sm"
                        data-active={clip.colorGrade === g}
                        onClick={() => updateClip(clip.id, { colorGrade: g })}
                      >
                        {GRADE_LABELS[g]}
                      </button>
                    ))}
                  </div>
                  <Slider label="Brightness" value={clip.brightness} min={-100} max={100}
                    onChange={v => updateClip(clip.id, { brightness: v })} />
                  <Slider label="Contrast" value={clip.contrast} min={-100} max={100}
                    onChange={v => updateClip(clip.id, { contrast: v })} />
                  <Slider label="Saturation" value={clip.saturation} min={-100} max={100}
                    onChange={v => updateClip(clip.id, { saturation: v })} />
                </Section>
              </>
            )}
            {!clip && (
              <p style={s.empty}>
                {hasSelection ? 'Effects aren’t available for this element type yet.' : 'Select a clip to edit colour effects.'}
              </p>
            )}
          </>
        )}
      </div>
    </aside>
  )
}

function Section({ title, children, badge }: { title: string; children: ReactNode; badge?: string }) {
  const [open, setOpen] = useState(true)
  return (
    <div style={s.section}>
      <button style={s.sectionHeader} onClick={() => setOpen(v => !v)} aria-expanded={open}>
        <span style={s.sectionTitle}>{title}</span>
        {badge && <span style={s.sectionBadge}>{badge}</span>}
        <ChevronDown size={14} color="var(--sg-text-muted)" style={{ ...s.sectionChevron, transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }} />
      </button>
      {open && <div style={s.sectionBody}>{children}</div>}
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={s.field}>
      <span style={s.fieldLabel}>{label}</span>
      {children}
    </div>
  )
}

function Row({ children }: { children: ReactNode }) {
  return <div style={s.row}>{children}</div>
}

function Slider({ label, value, min, max, onChange }: {
  label: string; value: number; min: number; max: number
  onChange: (v: number) => void
}) {
  return (
    <div style={s.sliderFieldRow}>
      <span style={s.sliderLabel}>{label}</span>
      <input
        type="range" min={min} max={max} value={value}
        className="sgv-range" style={{ flex: 1 }}
        onChange={e => onChange(Number(e.target.value))}
      />
      <span style={s.sliderVal}>{value > 0 ? '+' : ''}{value}</span>
    </div>
  )
}

const s: Record<string, CSSProperties> = {
  panel: {
    background: 'var(--panel-bg)', borderLeft: '1px solid var(--border)',
    display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0,
  },
  tabs: {
    display: 'flex', alignItems: 'center', gap: 20,
    padding: '0 18px', borderBottom: '1px solid var(--border)', flexShrink: 0, height: 44,
  },
  deselectBtn: {
    marginLeft: 'auto', background: 'none', border: 'none', fontSize: 13, cursor: 'pointer',
    color: 'var(--text-tertiary)', padding: '4px 6px', borderRadius: 4,
  },
  content: { flex: 1, overflowY: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 14 },
  empty: { color: 'var(--text-tertiary)', fontSize: 13, lineHeight: 1.6 },
  selectionLabel: {
    fontSize: 12, fontWeight: 700, color: 'var(--sg-green)', overflow: 'hidden',
    textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: -6,
  },

  section: { display: 'flex', flexDirection: 'column' },
  sectionHeader: {
    display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none',
    cursor: 'pointer', padding: '4px 0', width: '100%', textAlign: 'left',
  },
  sectionTitle: { fontSize: 12, fontWeight: 700, color: 'var(--sg-text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 },
  sectionBadge: {
    fontSize: 9, fontWeight: 700, color: 'var(--sg-gold)', background: 'var(--sg-gold-soft)',
    padding: '2px 6px', borderRadius: 8, textTransform: 'uppercase', letterSpacing: 0.3,
  },
  sectionChevron: { marginLeft: 'auto', transition: 'transform 120ms ease' },
  sectionBody: { display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 },

  row: { display: 'flex', gap: 12 },
  field: { flex: 1, display: 'flex', flexDirection: 'column', gap: 6 },
  fieldLabel: { fontSize: 12, color: 'var(--text-secondary)' },
  staticVal: { fontSize: 13, color: 'var(--text-primary)', fontWeight: 600 },

  textarea: { width: '100%', resize: 'vertical', boxSizing: 'border-box', height: 'auto', minHeight: 60 },
  numInput: { width: '100%', boxSizing: 'border-box' },
  colorPicker: { width: '100%', height: 34, border: '1px solid var(--border)', borderRadius: 6, padding: 1, cursor: 'pointer', background: 'var(--input-bg)' },
  select: { width: '100%' },

  chipRow: { display: 'flex', flexWrap: 'wrap', gap: 6 },

  sliderRow: { display: 'flex', alignItems: 'center', gap: 10 },
  sliderFieldRow: { display: 'flex', alignItems: 'center', gap: 10 },
  sliderLabel: { fontSize: 12, color: 'var(--text-secondary)', width: 74, flexShrink: 0 },
  sliderVal: { fontSize: 12, color: 'var(--text-primary)', width: 36, textAlign: 'right', fontWeight: 600, flexShrink: 0 },
  toggle: { display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' },

  removeBtn: {
    padding: '8px 12px', background: 'transparent', border: '1px solid var(--danger)',
    color: 'var(--danger)', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
  },
}
