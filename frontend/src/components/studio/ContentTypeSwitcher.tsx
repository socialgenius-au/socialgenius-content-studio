import { type CSSProperties } from 'react'
import { useStudio } from '../../contexts/StudioContext'
import type { ContentType } from '../../types'

const CONTENT_TYPES: { key: ContentType; label: string; icon: string }[] = [
  { key: 'video',      label: 'Video',      icon: '🎬' },
  { key: 'image',      label: 'Image',      icon: '🖼️' },
  { key: 'carousel',   label: 'Carousel',   icon: '🎠' },
  { key: 'audio',      label: 'Audio',      icon: '🎙️' },
  { key: 'blog',       label: 'Blog',       icon: '📝' },
  { key: 'newsletter', label: 'Newsletter', icon: '📧' },
]

export default function ContentTypeSwitcher() {
  const { contentType, setContentType } = useStudio()

  return (
    <div style={s.root}>
      {CONTENT_TYPES.map(t => (
        <button
          key={t.key}
          style={{ ...s.btn, ...(contentType === t.key ? s.btnActive : {}) }}
          onClick={() => setContentType(t.key)}
        >
          <span style={s.icon}>{t.icon}</span>
          <span style={s.label}>{t.label}</span>
        </button>
      ))}
    </div>
  )
}

const s: Record<string, CSSProperties> = {
  root: {
    display: 'flex', alignItems: 'center', gap: 2,
    background: '#1a1a1a', padding: '4px 12px',
    borderBottom: '1px solid #2a2a2a', flexShrink: 0,
  },
  btn: {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '5px 12px', border: 'none', background: 'transparent',
    borderRadius: 6, cursor: 'pointer', color: '#888', fontSize: 13,
    transition: 'all 0.15s',
  },
  btnActive: { background: '#1E3D2A', color: '#F5F0E8' },
  icon: { fontSize: 14 },
  label: { fontWeight: 600 },
}
