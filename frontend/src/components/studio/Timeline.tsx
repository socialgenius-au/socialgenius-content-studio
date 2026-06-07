import { useRef, useCallback, type CSSProperties, type MouseEvent } from 'react'
import { useStudio } from '../../contexts/StudioContext'
import { formatTime } from '../../utils/platforms'

interface Props {
  videoRef: React.RefObject<HTMLVideoElement | null>
}

export default function Timeline({ videoRef }: Props) {
  const { timeline, setTimeline, videoClips, textOverlays, audioTracks } = useStudio()
  const trackRef = useRef<HTMLDivElement>(null)

  const seek = useCallback((e: MouseEvent<HTMLDivElement>) => {
    if (!trackRef.current || timeline.duration === 0) return
    const rect = trackRef.current.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const time = ratio * timeline.duration
    setTimeline({ currentTime: time })
    if (videoRef.current) videoRef.current.currentTime = time
  }, [timeline.duration, setTimeline, videoRef])

  const setMarkIn = () => setTimeline({ markIn: timeline.currentTime })
  const setMarkOut = () => setTimeline({ markOut: timeline.currentTime })

  const clearMarks = () => setTimeline({ markIn: null, markOut: null })

  const progress = timeline.duration > 0 ? timeline.currentTime / timeline.duration : 0
  const markInPct = timeline.markIn != null && timeline.duration > 0
    ? (timeline.markIn / timeline.duration) * 100 : null
  const markOutPct = timeline.markOut != null && timeline.duration > 0
    ? (timeline.markOut / timeline.duration) * 100 : null

  return (
    <div style={s.root}>
      {/* Controls row */}
      <div style={s.controls}>
        <span style={s.timeDisplay}>{formatTime(timeline.currentTime)}</span>
        <div style={s.markButtons}>
          <button style={s.markBtn} onClick={setMarkIn} title="Mark In (set clip start)">
            ◁ Mark In
          </button>
          {timeline.markIn != null && (
            <span style={s.markTime}>In: {formatTime(timeline.markIn)}</span>
          )}
          <button style={s.markBtn} onClick={setMarkOut} title="Mark Out (set clip end)">
            Mark Out ▷
          </button>
          {timeline.markOut != null && (
            <span style={s.markTime}>Out: {formatTime(timeline.markOut)}</span>
          )}
          {(timeline.markIn != null || timeline.markOut != null) && (
            <button style={s.clearBtn} onClick={clearMarks}>Clear</button>
          )}
        </div>
        <span style={s.durationDisplay}>{formatTime(timeline.duration)}</span>
      </div>

      {/* Scrubber track */}
      <div style={s.trackWrap} ref={trackRef} onClick={seek}>
        {/* Background */}
        <div style={s.track}>
          {/* Played region */}
          <div style={{ ...s.played, width: `${progress * 100}%` }} />

          {/* Mark In/Out region */}
          {markInPct != null && markOutPct != null && (
            <div style={{
              ...s.markRegion,
              left: `${markInPct}%`,
              width: `${markOutPct - markInPct}%`,
            }} />
          )}

          {/* Mark In pin */}
          {markInPct != null && (
            <div style={{ ...s.markPin, ...s.markPinIn, left: `${markInPct}%` }}>
              <span style={s.markLabel}>In</span>
            </div>
          )}

          {/* Mark Out pin */}
          {markOutPct != null && (
            <div style={{ ...s.markPin, ...s.markPinOut, left: `${markOutPct}%` }}>
              <span style={s.markLabel}>Out</span>
            </div>
          )}

          {/* Playhead */}
          <div style={{ ...s.playhead, left: `${progress * 100}%` }} />
        </div>
      </div>

      {/* Clip lane */}
      <div style={s.laneRow}>
        <span style={s.laneLabel}>Video</span>
        <div style={s.lane}>
          {videoClips.map((clip, i) => {
            const startPct = timeline.duration > 0 ? (clip.startTime / timeline.duration) * 100 : 0
            const durPct = timeline.duration > 0 ? ((clip.endTime - clip.startTime) / timeline.duration) * 100 : (100 / Math.max(videoClips.length, 1))
            return (
              <div key={clip.id} style={{
                ...s.clipBlock,
                left: `${startPct}%`,
                width: `${durPct}%`,
                background: CLIP_COLORS[i % CLIP_COLORS.length],
              }}>
                <span style={s.clipLabel}>{clip.name || `Clip ${i + 1}`}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Text overlay lane */}
      {textOverlays.length > 0 && (
        <div style={s.laneRow}>
          <span style={s.laneLabel}>Text</span>
          <div style={s.lane}>
            {textOverlays.map((o, i) => {
              const startPct = timeline.duration > 0 ? (o.startTime / timeline.duration) * 100 : i * 15
              const durPct = timeline.duration > 0 ? ((o.endTime - o.startTime) / timeline.duration) * 100 : 10
              return (
                <div key={o.id} style={{
                  ...s.clipBlock,
                  left: `${startPct}%`,
                  width: `${durPct}%`,
                  background: '#C89A2E88',
                  height: 12,
                }}>
                  <span style={{ ...s.clipLabel, fontSize: 8 }}>{o.text.slice(0, 20)}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Audio lane */}
      {audioTracks.length > 0 && (
        <div style={s.laneRow}>
          <span style={s.laneLabel}>Audio</span>
          <div style={s.lane}>
            {audioTracks.map((t) => (
              <div key={t.id} style={{
                ...s.clipBlock,
                left: `${(t.startAt / Math.max(timeline.duration, 1)) * 100}%`,
                width: '40%',
                background: '#2ecc7188',
                height: 12,
              }}>
                <span style={{ ...s.clipLabel, fontSize: 8 }}>{t.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

const CLIP_COLORS = ['#1E3D2A88', '#2980b988', '#8e44ad88', '#e67e2288', '#16a08588']

const s: Record<string, CSSProperties> = {
  root: {
    background: '#1a1a1a', padding: '8px 12px',
    display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0,
  },
  controls: { display: 'flex', alignItems: 'center', gap: 10 },
  timeDisplay: { color: '#fff', fontFamily: 'monospace', fontSize: 12, minWidth: 70 },
  durationDisplay: { color: '#888', fontFamily: 'monospace', fontSize: 12, marginLeft: 'auto' },
  markButtons: { display: 'flex', alignItems: 'center', gap: 6, flex: 1 },
  markBtn: {
    background: '#333', border: '1px solid #555', color: '#ddd',
    padding: '3px 8px', borderRadius: 4, fontSize: 11, cursor: 'pointer',
  },
  markTime: { color: '#C89A2E', fontSize: 11, fontFamily: 'monospace' },
  clearBtn: {
    background: '#8B0000', border: 'none', color: '#fff',
    padding: '3px 8px', borderRadius: 4, fontSize: 11, cursor: 'pointer',
  },

  trackWrap: { cursor: 'crosshair', padding: '4px 0' },
  track: {
    position: 'relative', height: 24, background: '#333', borderRadius: 4,
    overflow: 'hidden',
  },
  played: {
    position: 'absolute', top: 0, left: 0, height: '100%',
    background: 'rgba(30,61,42,0.5)', pointerEvents: 'none',
  },
  markRegion: {
    position: 'absolute', top: 0, height: '100%',
    background: 'rgba(200,154,46,0.3)', pointerEvents: 'none',
  },
  markPin: {
    position: 'absolute', top: 0, height: '100%', width: 2,
    pointerEvents: 'none',
  },
  markPinIn: { background: '#2ecc71' },
  markPinOut: { background: '#e74c3c' },
  markLabel: {
    position: 'absolute', top: 2, left: 4, fontSize: 9, fontWeight: 700,
    color: '#fff', whiteSpace: 'nowrap',
  },
  playhead: {
    position: 'absolute', top: 0, height: '100%', width: 2,
    background: '#fff', transform: 'translateX(-1px)', pointerEvents: 'none',
  },

  laneRow: { display: 'flex', alignItems: 'center', gap: 6 },
  laneLabel: { color: '#888', fontSize: 10, width: 36, flexShrink: 0, textAlign: 'right' },
  lane: { position: 'relative', flex: 1, height: 18, background: '#2a2a2a', borderRadius: 3 },
  clipBlock: {
    position: 'absolute', top: 1, height: 16, borderRadius: 3,
    overflow: 'hidden', display: 'flex', alignItems: 'center', minWidth: 4,
  },
  clipLabel: {
    fontSize: 9, color: '#fff', fontWeight: 600, paddingLeft: 3,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
}
