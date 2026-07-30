import { useState, useRef, type CSSProperties } from 'react'
import { useStudio } from '../../contexts/StudioContext'
import type { AudioTrack } from '../../types'
import { uploadApi, assetsApi } from '../../api/client'

export default function AudioTrackControls() {
  const { audioTracks, addAudioTrack, updateAudioTrack, removeAudioTrack, uploadAsset, activeJob } = useStudio()
  const fileRef = useRef<HTMLInputElement>(null)

  const handleUpload = async (file: File) => {
    try {
      const asset = await uploadAsset(file, activeJob?.id)
      const url = assetsApi.downloadUrl(asset.id)
      const track: AudioTrack = {
        id: String(Date.now()),
        assetId: asset.id,
        url,
        name: file.name.replace(/\.[^.]+$/, ''),
        volume: 1,
        startAt: 0,
        fadeIn: 0,
        fadeOut: 0,
        duck: false,
      }
      addAudioTrack(track)
    } catch (err) {
      alert('Audio upload failed')
    }
  }

  return (
    <div style={s.root}>
      {/* Upload button */}
      <input
        ref={fileRef}
        type="file"
        accept="audio/*"
        style={{ display: 'none' }}
        onChange={e => {
          const f = e.target.files?.[0]
          if (f) handleUpload(f)
          e.target.value = ''
        }}
      />
      <button style={s.uploadBtn} onClick={() => fileRef.current?.click()}>
        + Upload Audio Track
      </button>

      {audioTracks.length === 0 ? (
        <p style={s.empty}>No audio tracks. Upload a music or voice file.</p>
      ) : (
        <div style={s.list}>
          {audioTracks.map(t => (
            <TrackEditor
              key={t.id}
              track={t}
              onUpdate={upd => updateAudioTrack(t.id, upd)}
              onRemove={() => removeAudioTrack(t.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function TrackEditor({ track, onUpdate, onRemove }: {
  track: AudioTrack
  onUpdate: (upd: Partial<AudioTrack>) => void
  onRemove: () => void
}) {
  const [open, setOpen] = useState(true)

  return (
    <div style={s.card}>
      <div style={s.cardHeader} onClick={() => setOpen(v => !v)}>
        <span style={s.trackIcon}>🎵</span>
        <span style={s.trackName}>{track.name}</span>
        <button style={s.removeBtn} onClick={e => { e.stopPropagation(); onRemove() }}>×</button>
        <span style={{ color: 'var(--text-tertiary)', fontSize: 10 }}>{open ? '▲' : '▼'}</span>
      </div>

      {open && (
        <div style={s.cardBody}>
          {/* Volume */}
          <Row label="Volume">
            <input
              type="range" min={0} max={2} step={0.05}
              value={track.volume}
              style={s.slider}
              onChange={e => onUpdate({ volume: parseFloat(e.target.value) })}
            />
            <span style={s.val}>{Math.round(track.volume * 100)}%</span>
          </Row>

          {/* Start at */}
          <Row label="Start at (s)">
            <input
              style={s.numInput} type="number" min={0} step={0.1}
              value={track.startAt}
              onChange={e => onUpdate({ startAt: parseFloat(e.target.value) || 0 })}
            />
          </Row>

          {/* Pause at */}
          <Row label="Pause at (s)">
            <input
              style={s.numInput} type="number" min={0} step={0.1}
              value={track.pauseAt ?? ''}
              placeholder="—"
              onChange={e => onUpdate({ pauseAt: parseFloat(e.target.value) || undefined })}
            />
          </Row>

          {/* Resume at */}
          <Row label="Resume at (s)">
            <input
              style={s.numInput} type="number" min={0} step={0.1}
              value={track.resumeAt ?? ''}
              placeholder="—"
              onChange={e => onUpdate({ resumeAt: parseFloat(e.target.value) || undefined })}
            />
          </Row>

          {/* Fade in / out */}
          <Row label="Fade In (s)">
            <input
              style={s.numInput} type="number" min={0} max={10} step={0.1}
              value={track.fadeIn}
              onChange={e => onUpdate({ fadeIn: parseFloat(e.target.value) || 0 })}
            />
          </Row>
          <Row label="Fade Out (s)">
            <input
              style={s.numInput} type="number" min={0} max={10} step={0.1}
              value={track.fadeOut}
              onChange={e => onUpdate({ fadeOut: parseFloat(e.target.value) || 0 })}
            />
          </Row>

          {/* Duck */}
          <Row label="Auto-duck">
            <label style={s.toggle}>
              <input
                type="checkbox"
                checked={track.duck}
                onChange={e => onUpdate({ duck: e.target.checked })}
              />
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                {track.duck ? 'On — music ducks under voice' : 'Off'}
              </span>
            </label>
          </Row>
        </div>
      )}
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={s.row}>
      <span style={s.rowLabel}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{children}</div>
    </div>
  )
}

const s: Record<string, CSSProperties> = {
  root: {},
  uploadBtn: {
    width: '100%', padding: 'var(--space-2)', background: 'var(--brand-header)', color: 'var(--brand-header-text)',
    border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 700, cursor: 'pointer',
    marginBottom: 'var(--space-3)',
  },
  empty: { color: 'var(--text-tertiary)', fontSize: 12, textAlign: 'center', padding: 'var(--space-3) 0' },
  list: { display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' },

  card: { border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', background: 'var(--panel-surface)' },
  cardHeader: {
    display: 'flex', alignItems: 'center', padding: 'var(--space-2) var(--space-3)',
    cursor: 'pointer', background: 'var(--panel-bg)', borderBottom: '1px solid var(--border)', gap: 'var(--space-2)',
  },
  trackIcon: { fontSize: 14 },
  trackName: { flex: 1, fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  removeBtn: { background: 'none', border: 'none', color: 'var(--danger)', fontSize: 16, cursor: 'pointer' },
  cardBody: { padding: 'var(--space-3) var(--space-3)' },

  row: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' },
  rowLabel: { fontSize: 11, color: 'var(--text-secondary)', width: 80, flexShrink: 0 },
  slider: { flex: 1, accentColor: 'var(--brand-header)' },
  val: { fontSize: 11, color: 'var(--text-primary)', width: 36, textAlign: 'right' },
  numInput: { width: 70, padding: '3px var(--space-2)', border: '1px solid var(--border)', borderRadius: 4, fontSize: 12, background: 'var(--input-bg)', color: 'var(--text-primary)' },
  toggle: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', cursor: 'pointer' },
}
