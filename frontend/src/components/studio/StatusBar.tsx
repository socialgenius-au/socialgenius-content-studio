import { type CSSProperties } from 'react'
import { useStudio } from '../../contexts/StudioContext'
import { PLATFORMS, formatTime } from '../../utils/platforms'

// Status bar (spec section 16). Auto-save status and frame rate are display-only labels —
// there's no real autosave pipeline or frame-rate tracking in StudioContext to read from yet,
// so they're honest static text rather than fabricated live state. Preview Quality is a local,
// non-wired selector (view-only, like the timeline zoom), consistent with "no new editing
// functionality" for this pass.
export default function StatusBar() {
  const { platform, timeline } = useStudio()
  const spec = PLATFORMS[platform]

  return (
    <div className="sgv-status-bar" style={s.bar}>
      <span style={s.item}>All changes saved</span>

      <div style={s.center}>
        <span style={s.item}>Duration: {formatTime(timeline.duration)}</span>
        <span style={s.dot} />
        <span style={s.item}>{spec.width}×{spec.height}</span>
        <span style={s.dot} />
        <span style={s.item}>30 fps</span>
      </div>

      <select className="sgv-select" style={s.qualitySelect} defaultValue="auto" title="Preview quality">
        <option value="auto">Preview: Auto</option>
        <option value="1080p">Preview: 1080p</option>
        <option value="720p">Preview: 720p</option>
        <option value="480p">Preview: 480p</option>
      </select>
    </div>
  )
}

const s: Record<string, CSSProperties> = {
  bar: {
    background: 'var(--sg-bg-1)', borderTop: '1px solid var(--sg-border)',
    padding: '0 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    flexShrink: 0,
  },
  item: { fontSize: 11, color: 'var(--sg-text-secondary)' },
  center: { display: 'flex', alignItems: 'center', gap: 10 },
  dot: { width: 3, height: 3, borderRadius: '50%', background: 'var(--sg-text-muted)' },
  qualitySelect: { height: 28, fontSize: 11, padding: '0 8px' },
}
