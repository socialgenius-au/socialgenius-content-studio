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
        <span style={{ color: '#aaa', fontSize: 10 }}>{open ? '▲' : '▼'}</span>
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
  root: { display: 'flex', flexDirection: 'column', gap: 8 },
  empty: { color: '#aaa', fontSize: 12, textAlign: 'center', padding: '24px 0' },
  card: { border: '1px solid #e8e3d8', borderRadius: 8, overflow: 'hidden', background: '#fafaf8' },
  cardHeader: {
    display: 'flex', alignItems: 'center', padding: '8px 10px',
    cursor: 'pointer', background: '#fff', borderBottom: '1px solid #e8e3d8', gap: 6,
  },
  num: {
    width: 20, height: 20, borderRadius: '50%', background: '#C89A2E',
    color: '#1E3D2A', fontSize: 10, fontWeight: 800, display: 'flex',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  name: { flex: 1, fontSize: 12, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  removeBtn: { background: 'none', border: 'none', color: '#e74c3c', fontSize: 16, cursor: 'pointer' },
  cardBody: { padding: '10px 12px' },
  sectionTitle: { fontSize: 10, fontWeight: 800, color: '#C89A2E', textTransform: 'uppercase', letterSpacing: 0.8, margin: '8px 0 5px' },
  chipRow: { display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 },
  chip: { padding: '3px 7px', border: '1px solid #ddd', borderRadius: 10, fontSize: 10, cursor: 'pointer', background: '#fff', color: '#555' },
  chipActive: { background: '#1E3D2A', color: '#F5F0E8', borderColor: '#1E3D2A' },
  row: { display: 'flex', alignItems: 'center', gap: 8 },
  rowLabel: { fontSize: 11, color: '#666', flex: 1 },
  numInput: { width: 60, padding: '3px 6px', border: '1px solid #ddd', borderRadius: 4, fontSize: 12 },
}
