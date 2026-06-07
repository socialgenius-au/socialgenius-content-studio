import { useState, useRef, type CSSProperties } from 'react'
import { useStudio } from '../../contexts/StudioContext'
import type { MediaOverlay } from '../../types'
import { assetsApi } from '../../api/client'

export default function MediaOverlayEditor() {
  const { uploadAsset, activeJob, timeline } = useStudio()
  const [overlays, setOverlays] = useState<MediaOverlay[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  const handleUpload = async (file: File) => {
    try {
      const asset = await uploadAsset(file, activeJob?.id)
      const url = assetsApi.downloadUrl(asset.id)
      const overlay: MediaOverlay = {
        id: String(Date.now()),
        url,
        x: 10,
        y: 10,
        width: 30,
        height: 30,
        opacity: 1,
        startTime: timeline.currentTime,
        endTime: Math.min(timeline.currentTime + 5, timeline.duration || timeline.currentTime + 5),
      }
      setOverlays(p => [...p, overlay])
    } catch {
      alert('Upload failed')
    }
  }

  const updateOverlay = (id: string, upd: Partial<MediaOverlay>) => {
    setOverlays(p => p.map(o => o.id === id ? { ...o, ...upd } : o))
  }

  const removeOverlay = (id: string) => {
    setOverlays(p => p.filter(o => o.id !== id))
  }

  return (
    <div style={s.root}>
      <input
        ref={fileRef}
        type="file"
        accept="video/*,image/*"
        style={{ display: 'none' }}
        onChange={e => {
          const f = e.target.files?.[0]
          if (f) handleUpload(f)
          e.target.value = ''
        }}
      />
      <button style={s.uploadBtn} onClick={() => fileRef.current?.click()}>
        + Upload Media Overlay
      </button>
      <p style={s.hint}>Upload a second video or image to overlay on your main content.</p>

      {overlays.length === 0 ? (
        <p style={s.empty}>No overlays yet.</p>
      ) : (
        <div style={s.list}>
          {overlays.map(o => (
            <OverlayCard key={o.id} overlay={o} onUpdate={upd => updateOverlay(o.id, upd)} onRemove={() => removeOverlay(o.id)} />
          ))}
        </div>
      )}
    </div>
  )
}

function OverlayCard({ overlay, onUpdate, onRemove }: {
  overlay: MediaOverlay
  onUpdate: (upd: Partial<MediaOverlay>) => void
  onRemove: () => void
}) {
  const [open, setOpen] = useState(true)
  const isVideo = overlay.url.match(/\.(mp4|webm|mov)/i)

  return (
    <div style={s.card}>
      <div style={s.cardHeader} onClick={() => setOpen(v => !v)}>
        <span style={s.icon}>{isVideo ? '🎬' : '🖼️'}</span>
        <span style={s.name}>{isVideo ? 'Video overlay' : 'Image overlay'}</span>
        <button style={s.removeBtn} onClick={e => { e.stopPropagation(); onRemove() }}>×</button>
        <span style={{ color: '#aaa', fontSize: 10 }}>{open ? '▲' : '▼'}</span>
      </div>

      {open && (
        <div style={s.cardBody}>
          {/* Preview thumbnail */}
          {!isVideo && (
            <img src={overlay.url} alt="" style={s.thumb} />
          )}

          <Row label="X (%)">
            <input style={s.num} type="number" min={0} max={100} value={Math.round(overlay.x)}
              onChange={e => onUpdate({ x: parseFloat(e.target.value) || 0 })} />
          </Row>
          <Row label="Y (%)">
            <input style={s.num} type="number" min={0} max={100} value={Math.round(overlay.y)}
              onChange={e => onUpdate({ y: parseFloat(e.target.value) || 0 })} />
          </Row>
          <Row label="Width (%)">
            <input style={s.num} type="number" min={5} max={100} value={Math.round(overlay.width)}
              onChange={e => onUpdate({ width: parseFloat(e.target.value) || 30 })} />
          </Row>
          <Row label="Height (%)">
            <input style={s.num} type="number" min={5} max={100} value={Math.round(overlay.height)}
              onChange={e => onUpdate({ height: parseFloat(e.target.value) || 30 })} />
          </Row>

          <div style={s.sliderRow}>
            <span style={s.sliderLabel}>Opacity</span>
            <input type="range" min={0} max={1} step={0.05} value={overlay.opacity} style={s.slider}
              onChange={e => onUpdate({ opacity: parseFloat(e.target.value) })} />
            <span style={s.sliderVal}>{Math.round(overlay.opacity * 100)}%</span>
          </div>

          <Row label="Start (s)">
            <input style={s.num} type="number" min={0} step={0.1} value={overlay.startTime}
              onChange={e => onUpdate({ startTime: parseFloat(e.target.value) || 0 })} />
          </Row>
          <Row label="End (s)">
            <input style={s.num} type="number" min={0} step={0.1} value={overlay.endTime}
              onChange={e => onUpdate({ endTime: parseFloat(e.target.value) || 5 })} />
          </Row>
        </div>
      )}
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
      <span style={{ fontSize: 11, color: '#666', width: 70, flexShrink: 0 }}>{label}</span>
      {children}
    </div>
  )
}

const s: Record<string, CSSProperties> = {
  root: {},
  uploadBtn: {
    width: '100%', padding: '8px', background: '#1E3D2A', color: '#F5F0E8',
    border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 700, cursor: 'pointer',
    marginBottom: 6,
  },
  hint: { fontSize: 11, color: '#888', marginBottom: 10, lineHeight: 1.5 },
  empty: { color: '#aaa', fontSize: 12, textAlign: 'center', padding: '12px 0' },
  list: { display: 'flex', flexDirection: 'column', gap: 8 },

  card: { border: '1px solid #e8e3d8', borderRadius: 8, overflow: 'hidden', background: '#fafaf8' },
  cardHeader: {
    display: 'flex', alignItems: 'center', padding: '8px 10px',
    cursor: 'pointer', background: '#fff', borderBottom: '1px solid #e8e3d8', gap: 6,
  },
  icon: { fontSize: 14 },
  name: { flex: 1, fontSize: 12, fontWeight: 700 },
  removeBtn: { background: 'none', border: 'none', color: '#e74c3c', fontSize: 16, cursor: 'pointer' },
  cardBody: { padding: '10px 12px' },
  thumb: { width: '100%', borderRadius: 4, marginBottom: 8, maxHeight: 80, objectFit: 'cover' },

  sliderRow: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 },
  sliderLabel: { fontSize: 11, color: '#666', width: 70 },
  slider: { flex: 1, accentColor: '#1E3D2A' },
  sliderVal: { fontSize: 11, color: '#333', width: 36, textAlign: 'right' },
  num: { width: 70, padding: '3px 6px', border: '1px solid #ddd', borderRadius: 4, fontSize: 12 },
}
