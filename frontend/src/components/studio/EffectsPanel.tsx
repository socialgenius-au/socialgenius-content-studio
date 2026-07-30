import { type CSSProperties } from 'react'
import { useStudio } from '../../contexts/StudioContext'
import type { VideoClip } from '../../types'

const TRANSITIONS: { value: VideoClip['transition']; label: string }[] = [
  { value: 'cut', label: 'Cut' },
  { value: 'dissolve', label: 'Dissolve' },
  { value: 'whip_pan', label: 'Whip Pan' },
  { value: 'fade_black', label: 'Fade to Black' },
  { value: 'zoom_punch', label: 'Zoom Punch' },
]

export default function EffectsPanel() {
  const {
    videoClips, updateVideoClip,
    additionalVideoClips, updateAdditionalVideoClip,
  } = useStudio()

  const hasAny = videoClips.length > 0 || additionalVideoClips.length > 0

  if (!hasAny) {
    return (
      <div style={s.empty}>
        <p>No clips yet.</p>
        <p>Add a video clip (Video tool) or an insert (Additional video lane on the timeline) to set its transition.</p>
      </div>
    )
  }

  return (
    <div style={s.root}>
      {videoClips.length > 0 && (
        <Section title="Video">
          {videoClips.map((clip, i) => (
            <ClipTransition
              key={clip.id}
              clip={clip}
              label={clip.name || `Clip ${i + 1}`}
              onUpdate={upd => updateVideoClip(clip.id, upd)}
            />
          ))}
        </Section>
      )}

      {additionalVideoClips.length > 0 && (
        <Section title="Additional video">
          {additionalVideoClips.map((clip, i) => (
            <ClipTransition
              key={clip.id}
              clip={clip}
              label={clip.name || `Insert ${i + 1}`}
              onUpdate={upd => updateAdditionalVideoClip(clip.id, upd)}
            />
          ))}
        </Section>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={s.section}>
      <div style={s.sectionTitle}>{title}</div>
      {children}
    </div>
  )
}

function ClipTransition({ clip, label, onUpdate }: {
  clip: VideoClip
  label: string
  onUpdate: (upd: Partial<VideoClip>) => void
}) {
  return (
    <div style={s.card}>
      <span style={s.clipName}>{label}</span>
      <Row label="Transition">
        <select
          style={s.select}
          value={clip.transition}
          onChange={e => onUpdate({ transition: e.target.value as VideoClip['transition'] })}
        >
          {TRANSITIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </Row>
      <Row label="Duration (s)">
        <input
          style={s.numInput}
          type="number" min={0} max={5} step={0.1}
          disabled={clip.transition === 'cut'}
          value={clip.transitionDuration}
          onChange={e => onUpdate({ transitionDuration: parseFloat(e.target.value) || 0 })}
        />
      </Row>
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

const s: Record<string, CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' },
  empty: { color: 'var(--text-tertiary)', fontSize: 12, textAlign: 'center', padding: 'var(--space-6) var(--space-2)', lineHeight: 1.8 },

  section: { display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' },
  sectionTitle: { fontSize: 10, fontWeight: 800, color: 'var(--brand-accent)', textTransform: 'uppercase', letterSpacing: 0.8 },

  card: { border: '1px solid var(--border)', borderRadius: 8, background: 'var(--panel-surface)', padding: 'var(--space-3)' },
  clipName: { fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', display: 'block', marginBottom: 'var(--space-2)' },

  row: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-1)' },
  rowLabel: { fontSize: 11, color: 'var(--text-secondary)', width: 90, flexShrink: 0 },
  select: { flex: 1, padding: 'var(--space-1) var(--space-2)', border: '1px solid var(--border)', borderRadius: 5, fontSize: 12, background: 'var(--input-bg)', color: 'var(--text-primary)' },
  numInput: { width: 70, padding: '3px var(--space-2)', border: '1px solid var(--border)', borderRadius: 4, fontSize: 12, background: 'var(--input-bg)', color: 'var(--text-primary)' },
}
