import { useState, type CSSProperties } from 'react'
import { useStudio } from '../../contexts/StudioContext'
import type { ImageSlide } from '../../types'

const FILTERS: ImageSlide['filter'][] = ['none', 'bw', 'warm', 'cool', 'vintage', 'high_contrast', 'vivid', 'cinematic']
const FILTER_LABELS: Record<ImageSlide['filter'], string> = {
  none: 'None', bw: 'B&W', warm: 'Warm', cool: 'Cool',
  vintage: 'Vintage', high_contrast: 'Hi-Con', vivid: 'Vivid', cinematic: 'Cine',
}

const ANIMATIONS: ImageSlide['animation'][] = ['none', 'ken_burns_in', 'ken_burns_out', 'pan_left', 'pan_right', 'float', 'pulse']
const ANIM_LABELS: Record<ImageSlide['animation'], string> = {
  none: 'None', ken_burns_in: 'Ken Burns ↗', ken_burns_out: 'Ken Burns ↙',
  pan_left: '← Pan', pan_right: '→ Pan', float: 'Float', pulse: 'Pulse',
}

const TRANSITIONS: ImageSlide['transition'][] = ['dissolve', 'wipe', 'fade', 'zoom_punch']
const TRANS_LABELS: Record<ImageSlide['transition'], string> = {
  dissolve: 'Dissolve', wipe: 'Wipe', fade: 'Fade', zoom_punch: 'Zoom Punch',
}

export default function ImageControls() {
  const { imageSlides, addImageSlide, updateImageSlide, removeImageSlide } = useStudio()

  if (imageSlides.length === 0) {
    return (
      <p style={s.empty}>
        No images yet. Drop image files onto the preview canvas to start your carousel.
      </p>
    )
  }

  return (
    <div style={s.root}>
      {imageSlides.map((slide, idx) => (
        <SlideEditor
          key={slide.id}
          slide={slide}
          idx={idx}
          onUpdate={upd => updateImageSlide(slide.id, upd)}
          onRemove={() => removeImageSlide(slide.id)}
        />
      ))}
    </div>
  )
}

function SlideEditor({ slide, idx, onUpdate, onRemove }: {
  slide: ImageSlide; idx: number
  onUpdate: (upd: Partial<ImageSlide>) => void
  onRemove: () => void
}) {
  const [open, setOpen] = useState(true)

  return (
    <div style={s.card}>
      <div style={s.cardHeader} onClick={() => setOpen(v => !v)}>
        <span style={s.num}>{idx + 1}</span>
        <span style={s.name}>{slide.name || `Slide ${idx + 1}`}</span>
        <button style={s.removeBtn} onClick={e => { e.stopPropagation(); onRemove() }}>×</button>
        <span style={{ color: 'var(--text-tertiary)', fontSize: 10 }}>{open ? '▲' : '▼'}</span>
      </div>

      {open && (
        <div style={s.cardBody}>
          {/* Filter */}
          <SectionTitle>Filter</SectionTitle>
          <div style={s.chipRow}>
            {FILTERS.map(f => (
              <button
                key={f}
                style={{ ...s.chip, ...(slide.filter === f ? s.chipActive : {}) }}
                onClick={() => onUpdate({ filter: f })}
              >
                {FILTER_LABELS[f]}
              </button>
            ))}
          </div>

          {/* Animation */}
          <SectionTitle>Animation</SectionTitle>
          <div style={s.chipRow}>
            {ANIMATIONS.map(a => (
              <button
                key={a}
                style={{ ...s.chip, ...(slide.animation === a ? s.chipActive : {}) }}
                onClick={() => onUpdate({ animation: a })}
              >
                {ANIM_LABELS[a]}
              </button>
            ))}
          </div>

          {/* Transition */}
          <SectionTitle>Transition</SectionTitle>
          <div style={s.chipRow}>
            {TRANSITIONS.map(t => (
              <button
                key={t}
                style={{ ...s.chip, ...(slide.transition === t ? s.chipActive : {}) }}
                onClick={() => onUpdate({ transition: t })}
              >
                {TRANS_LABELS[t]}
              </button>
            ))}
          </div>

          {/* Duration */}
          <div style={s.row}>
            <span style={s.rowLabel}>Duration (s)</span>
            <input
              style={s.numInput} type="number" min={1} max={30}
              value={slide.duration}
              onChange={e => onUpdate({ duration: parseFloat(e.target.value) || 5 })}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div style={s.sectionTitle}>{children}</div>
}

const s: Record<string, CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' },
  empty: { color: 'var(--text-tertiary)', fontSize: 12, textAlign: 'center', padding: 'var(--space-6) 0' },
  card: { border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', background: 'var(--panel-surface)' },
  cardHeader: {
    display: 'flex', alignItems: 'center', padding: 'var(--space-2) var(--space-3)',
    cursor: 'pointer', background: 'var(--panel-bg)', borderBottom: '1px solid var(--border)', gap: 'var(--space-2)',
  },
  num: {
    width: 20, height: 20, borderRadius: '50%', background: 'var(--brand-accent)',
    color: 'var(--brand-accent-text)', fontSize: 10, fontWeight: 800, display: 'flex',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  name: { flex: 1, fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  removeBtn: { background: 'none', border: 'none', color: 'var(--danger)', fontSize: 16, cursor: 'pointer' },
  cardBody: { padding: 'var(--space-3) var(--space-3)' },
  sectionTitle: { fontSize: 10, fontWeight: 800, color: 'var(--brand-accent)', textTransform: 'uppercase', letterSpacing: 0.8, margin: 'var(--space-2) 0 var(--space-1)' },
  chipRow: { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)', marginBottom: 'var(--space-2)' },
  chip: { padding: '3px var(--space-2)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 10, cursor: 'pointer', background: 'var(--input-bg)', color: 'var(--text-secondary)' },
  chipActive: { background: 'var(--brand-header)', color: 'var(--brand-header-text)', borderColor: 'var(--brand-header)' },
  row: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)' },
  rowLabel: { fontSize: 11, color: 'var(--text-secondary)', flex: 1 },
  numInput: { width: 60, padding: '3px var(--space-2)', border: '1px solid var(--border)', borderRadius: 4, fontSize: 12, background: 'var(--input-bg)', color: 'var(--text-primary)' },
}
