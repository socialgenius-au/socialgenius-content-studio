import { type CSSProperties } from 'react'
import { useStudio } from '../../contexts/StudioContext'
import type { VideoClip } from '../../types'

export default function VideoControls() {
  const { videoClips, updateVideoClip, removeVideoClip, timeline } = useStudio()

  if (videoClips.length === 0) {
    return (
      <div style={s.empty}>
        <p>No video clips yet.</p>
        <p>Drop a video file onto the preview canvas to start editing.</p>
      </div>
    )
  }

  return (
    <div style={s.root}>
      {videoClips.map((clip, idx) => (
        <ClipEditor
          key={clip.id}
          clip={clip}
          idx={idx}
          onUpdate={(upd) => updateVideoClip(clip.id, upd)}
          onRemove={() => removeVideoClip(clip.id)}
          duration={timeline.duration}
        />
      ))}
    </div>
  )
}

function ClipEditor({
  clip, idx, onUpdate, onRemove, duration,
}: {
  clip: VideoClip
  idx: number
  onUpdate: (upd: Partial<VideoClip>) => void
  onRemove: () => void
  duration: number
}) {
  const [open, setOpen] = useState(true)

  return (
    <div style={s.clipCard}>
      <div style={s.clipHeader} onClick={() => setOpen(v => !v)}>
        <span style={s.clipNum}>{idx + 1}</span>
        <span style={s.clipName}>{clip.name || `Clip ${idx + 1}`}</span>
        <button style={s.removeBtn} onClick={e => { e.stopPropagation(); onRemove() }}>×</button>
        <span style={s.chevron}>{open ? '▲' : '▼'}</span>
      </div>

      {open && (
        <div style={s.clipBody}>
          {/* Trim */}
          <Section title="Trim">
            <Row label="Trim In (s)">
              <input
                style={s.numInput}
                type="number" min={0} max={duration} step={0.01}
                value={clip.trimIn}
                onChange={e => onUpdate({ trimIn: parseFloat(e.target.value) || 0 })}
              />
            </Row>
            <Row label="Trim Out (s)">
              <input
                style={s.numInput}
                type="number" min={0} max={duration} step={0.01}
                value={clip.trimOut}
                onChange={e => onUpdate({ trimOut: parseFloat(e.target.value) || 0 })}
              />
            </Row>
          </Section>

          {/* Color grade */}
          <Section title="Colour Grade">
            <div style={s.chipRow}>
              {(['none', 'warm', 'cool', 'cinematic', 'bw', 'high_contrast', 'desaturated'] as VideoClip['colorGrade'][]).map(g => (
                <button
                  key={g}
                  style={{ ...s.chip, ...(clip.colorGrade === g ? s.chipActive : {}) }}
                  onClick={() => onUpdate({ colorGrade: g })}
                >
                  {GRADE_LABELS[g]}
                </button>
              ))}
            </div>
          </Section>

          {/* Adjustments */}
          <Section title="Adjustments">
            <Slider label="Brightness" value={clip.brightness} min={-100} max={100}
              onChange={v => onUpdate({ brightness: v })} />
            <Slider label="Contrast" value={clip.contrast} min={-100} max={100}
              onChange={v => onUpdate({ contrast: v })} />
            <Slider label="Saturation" value={clip.saturation} min={-100} max={100}
              onChange={v => onUpdate({ saturation: v })} />
          </Section>

          {/* Speed */}
          <Section title="Speed">
            <div style={s.chipRow}>
              {([0.25, 0.5, 1, 2] as VideoClip['speed'][]).map(sp => (
                <button
                  key={sp}
                  style={{ ...s.chip, ...(clip.speed === sp ? s.chipActive : {}) }}
                  onClick={() => onUpdate({ speed: sp })}
                >
                  {sp}x
                </button>
              ))}
            </div>
          </Section>

          {/* Transition */}
          <Section title="Transition to next">
            <select
              style={s.select}
              value={clip.transition}
              onChange={e => onUpdate({ transition: e.target.value as VideoClip['transition'] })}
            >
              <option value="cut">Cut</option>
              <option value="dissolve">Dissolve</option>
              <option value="whip_pan">Whip Pan</option>
              <option value="fade_black">Fade to Black</option>
              <option value="zoom_punch">Zoom Punch</option>
            </select>
          </Section>
        </div>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={s.sectionTitle}>{title}</div>
      {children}
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={s.row}>
      <span style={s.rowLabel}>{label}</span>
      {children}
    </div>
  )
}

function Slider({ label, value, min, max, onChange }: {
  label: string; value: number; min: number; max: number
  onChange: (v: number) => void
}) {
  return (
    <div style={s.sliderRow}>
      <span style={s.sliderLabel}>{label}</span>
      <input
        type="range" min={min} max={max} value={value}
        style={s.slider}
        onChange={e => onChange(Number(e.target.value))}
      />
      <span style={s.sliderVal}>{value > 0 ? '+' : ''}{value}</span>
    </div>
  )
}

import { useState } from 'react'

const GRADE_LABELS: Record<string, string> = {
  none: 'None', warm: 'Warm', cool: 'Cool', cinematic: 'Cine',
  bw: 'B&W', high_contrast: 'Hi-Con', desaturated: 'Desat',
}

const s: Record<string, CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' },
  empty: { color: 'var(--text-tertiary)', fontSize: 12, textAlign: 'center', padding: 'var(--space-6) var(--space-2)', lineHeight: 1.8 },

  clipCard: { border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', background: 'var(--panel-surface)' },
  clipHeader: {
    display: 'flex', alignItems: 'center', padding: 'var(--space-2) var(--space-3)', cursor: 'pointer',
    gap: 'var(--space-2)', background: 'var(--panel-bg)', borderBottom: '1px solid var(--border)',
  },
  clipNum: {
    width: 20, height: 20, borderRadius: '50%', background: 'var(--brand-header)',
    color: 'var(--brand-header-text)', fontSize: 10, fontWeight: 800, display: 'flex',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  clipName: { flex: 1, fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  removeBtn: { background: 'none', border: 'none', color: 'var(--danger)', fontSize: 16, cursor: 'pointer', padding: '0 var(--space-1)' },
  chevron: { color: 'var(--text-tertiary)', fontSize: 10 },

  clipBody: { padding: 'var(--space-3) var(--space-3)' },

  sectionTitle: { fontSize: 10, fontWeight: 800, color: 'var(--brand-accent)', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 'var(--space-2)' },
  row: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-1)' },
  rowLabel: { fontSize: 11, color: 'var(--text-secondary)', flex: 1 },
  numInput: { width: 70, padding: '3px var(--space-2)', border: '1px solid var(--border)', borderRadius: 4, fontSize: 12, background: 'var(--input-bg)', color: 'var(--text-primary)' },
  select: { width: '100%', padding: 'var(--space-1) var(--space-2)', border: '1px solid var(--border)', borderRadius: 5, fontSize: 12, background: 'var(--input-bg)', color: 'var(--text-primary)' },

  chipRow: { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)' },
  chip: {
    padding: '3px var(--space-2)', border: '1px solid var(--border)', borderRadius: 10,
    fontSize: 11, cursor: 'pointer', background: 'var(--input-bg)', color: 'var(--text-secondary)',
  },
  chipActive: { background: 'var(--brand-header)', color: 'var(--brand-header-text)', borderColor: 'var(--brand-header)' },

  sliderRow: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-1)' },
  sliderLabel: { fontSize: 11, color: 'var(--text-secondary)', width: 70 },
  slider: { flex: 1, accentColor: 'var(--brand-header)' },
  sliderVal: { fontSize: 11, color: 'var(--text-primary)', width: 32, textAlign: 'right' },
}
