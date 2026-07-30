import { useRef, useCallback, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import { useStudio } from '../../contexts/StudioContext'
import { formatTime } from '../../utils/platforms'
import { assetsApi } from '../../api/client'
import type { VideoClip } from '../../types'

interface Props {
  videoRef: React.RefObject<HTMLVideoElement | null>
}

const MIN_DUR = 0.2

export default function Timeline({ videoRef }: Props) {
  const {
    timeline, setTimeline,
    videoClips, updateVideoClip,
    additionalVideoClips, addAdditionalVideoClip, updateAdditionalVideoClip,
    textOverlays, updateTextOverlay,
    audioTracks, updateAudioTrack,
    selectedElement, setSelectedElement,
    uploadAsset, activeJob,
  } = useStudio()
  const trackRef = useRef<HTMLDivElement>(null)
  const addlFileRef = useRef<HTMLInputElement>(null)

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

  // The scrubber's real duration comes from the loaded primary video. Until one is loaded (or
  // for lanes that don't drive it, like audio-only content), clips still need something to drag
  // and trim against — so fall back to whatever the furthest clip/overlay/track reaches, or a
  // round minute if the timeline is completely empty.
  const authoredEnds = [
    ...videoClips.map(c => c.endTime),
    ...additionalVideoClips.map(c => c.endTime),
    ...textOverlays.map(o => o.endTime),
    ...audioTracks.map(t => t.endTime),
  ]
  const effectiveDuration = timeline.duration > 0
    ? timeline.duration
    : Math.max(60, ...authoredEnds, 0)

  const handleAddlUpload = async (file: File) => {
    try {
      const asset = await uploadAsset(file, activeJob?.id)
      const url = assetsApi.previewUrl(asset.file_path)
      const start = additionalVideoClips.reduce((a, c) => Math.max(a, c.endTime), 0)
      const clip: VideoClip = {
        id: crypto.randomUUID(),
        assetId: asset.id,
        url,
        name: file.name,
        duration: 0,
        startTime: start,
        endTime: start + 10,
        trimIn: 0, trimOut: 0,
        colorGrade: 'none', speed: 1,
        brightness: 0, contrast: 0, saturation: 0,
        transition: 'cut', transitionDuration: 0.5,
      }
      addAdditionalVideoClip(clip)
    } catch {
      // uploadAsset already surfaces a chat error message on failure
    }
  }

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

      {/* Video lane */}
      <Lane label="Video" name="video">
        {videoClips.map((clip, i) => (
          <ClipBlock
            key={clip.id}
            startTime={clip.startTime}
            endTime={clip.endTime}
            effectiveDuration={effectiveDuration}
            color={CLIP_COLORS[i % CLIP_COLORS.length]}
            label={clip.name || `Clip ${i + 1}`}
            selected={selectedElement?.type === 'clip' && selectedElement.lane === 'video' && selectedElement.id === clip.id}
            onSelect={() => setSelectedElement({ type: 'clip', lane: 'video', id: clip.id })}
            onBodyMove={(ns, ne) => updateVideoClip(clip.id, { startTime: ns, endTime: ne })}
            onEdgeLeft={(ns) => {
              const shrink = ns - clip.startTime
              updateVideoClip(clip.id, { startTime: ns, trimIn: Math.max(0, clip.trimIn + shrink) })
            }}
            onEdgeRight={(ne) => {
              const shrink = clip.endTime - ne
              updateVideoClip(clip.id, { endTime: ne, trimOut: Math.max(0, clip.trimOut + shrink) })
            }}
          />
        ))}
      </Lane>

      {/* Additional video lane — 2nd video track for intro/outro/transition inserts.
          No dedicated ToolPanel tool drives this one, so it gets its own inline upload control. */}
      <Lane
        label="Additional video"
        name="additional"
        action={(
          <>
            <input
              ref={addlFileRef}
              type="file"
              accept="video/*"
              style={{ display: 'none' }}
              onChange={e => {
                const f = e.target.files?.[0]
                if (f) handleAddlUpload(f)
                e.target.value = ''
              }}
            />
            <button style={s.laneAddBtn} onClick={() => addlFileRef.current?.click()} title="Add an intro/outro/transition clip">
              +
            </button>
          </>
        )}
      >
        {additionalVideoClips.map((clip, i) => (
          <ClipBlock
            key={clip.id}
            startTime={clip.startTime}
            endTime={clip.endTime}
            effectiveDuration={effectiveDuration}
            color={ADDL_CLIP_COLORS[i % ADDL_CLIP_COLORS.length]}
            label={clip.name || `Insert ${i + 1}`}
            selected={selectedElement?.type === 'clip' && selectedElement.lane === 'additional' && selectedElement.id === clip.id}
            onSelect={() => setSelectedElement({ type: 'clip', lane: 'additional', id: clip.id })}
            onBodyMove={(ns, ne) => updateAdditionalVideoClip(clip.id, { startTime: ns, endTime: ne })}
            onEdgeLeft={(ns) => {
              const shrink = ns - clip.startTime
              updateAdditionalVideoClip(clip.id, { startTime: ns, trimIn: Math.max(0, clip.trimIn + shrink) })
            }}
            onEdgeRight={(ne) => {
              const shrink = clip.endTime - ne
              updateAdditionalVideoClip(clip.id, { endTime: ne, trimOut: Math.max(0, clip.trimOut + shrink) })
            }}
          />
        ))}
      </Lane>

      {/* Text overlay lane */}
      {textOverlays.length > 0 && (
        <Lane label="Text" name="text">
          {textOverlays.map(o => (
            <ClipBlock
              key={o.id}
              small
              startTime={o.startTime}
              endTime={o.endTime}
              effectiveDuration={effectiveDuration}
              color="#C89A2E88"
              label={o.text.slice(0, 20)}
              selected={selectedElement?.type === 'text' && selectedElement.id === o.id}
              onSelect={() => setSelectedElement({ type: 'text', id: o.id })}
              onBodyMove={(ns, ne) => updateTextOverlay(o.id, { startTime: ns, endTime: ne })}
              onEdgeLeft={(ns) => updateTextOverlay(o.id, { startTime: ns })}
              onEdgeRight={(ne) => updateTextOverlay(o.id, { endTime: ne })}
            />
          ))}
        </Lane>
      )}

      {/* Audio lane */}
      {audioTracks.length > 0 && (
        <Lane label="Audio" name="audio">
          {audioTracks.map((t) => (
            <ClipBlock
              key={t.id}
              small
              startTime={t.startTime}
              endTime={t.endTime}
              effectiveDuration={effectiveDuration}
              color="#2ecc7188"
              label={t.name}
              selected={selectedElement?.type === 'audio' && selectedElement.id === t.id}
              onSelect={() => setSelectedElement({ type: 'audio', id: t.id })}
              onBodyMove={(ns, ne) => updateAudioTrack(t.id, { startTime: ns, endTime: ne })}
              onEdgeLeft={(ns) => {
                const shrink = ns - t.startTime
                updateAudioTrack(t.id, { startTime: ns, trimIn: Math.max(0, t.trimIn + shrink) })
              }}
              onEdgeRight={(ne) => {
                const shrink = t.endTime - ne
                updateAudioTrack(t.id, { endTime: ne, trimOut: Math.max(0, t.trimOut + shrink) })
              }}
            />
          ))}
        </Lane>
      )}
    </div>
  )
}

function Lane({ label, name, action, children }: { label: string; name: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div style={s.laneRow}>
      <span style={s.laneLabel}>{label}</span>
      {action}
      <div style={s.lane} data-lane={name}>
        {children}
      </div>
    </div>
  )
}

// A single clip/overlay/track block: click to select, drag the body to reposition, drag either
// edge to trim. A "drag" only counts once the pointer has moved a few px — anything under that
// is treated as a plain click so selecting still works.
function ClipBlock({
  startTime, endTime, effectiveDuration, color, label, small, selected,
  onSelect, onBodyMove, onEdgeLeft, onEdgeRight,
}: {
  startTime: number
  endTime: number
  effectiveDuration: number
  color: string
  label: string
  small?: boolean
  selected: boolean
  onSelect: () => void
  onBodyMove: (startTime: number, endTime: number) => void
  onEdgeLeft: (startTime: number) => void
  onEdgeRight: (endTime: number) => void
}) {
  const drag = useRef<{
    mode: 'move' | 'left' | 'right'
    startX: number
    origStart: number
    origEnd: number
    laneWidth: number
    moved: boolean
  } | null>(null)

  const beginDrag = (mode: 'move' | 'left' | 'right') => (e: MouseEvent<HTMLDivElement>) => {
    e.stopPropagation()
    e.preventDefault()
    const lane = (e.currentTarget as HTMLElement).closest('[data-lane]') as HTMLElement | null
    const rect = lane?.getBoundingClientRect()
    if (!rect || rect.width === 0) return

    drag.current = {
      mode, startX: e.clientX, origStart: startTime, origEnd: endTime,
      laneWidth: rect.width, moved: false,
    }

    const onMove = (ev: globalThis.MouseEvent) => {
      const d = drag.current
      if (!d) return
      const deltaPx = ev.clientX - d.startX
      if (Math.abs(deltaPx) > 3) d.moved = true
      const deltaTime = effectiveDuration > 0 ? (deltaPx / d.laneWidth) * effectiveDuration : 0

      if (d.mode === 'move') {
        const dur = d.origEnd - d.origStart
        const maxStart = Math.max(0, effectiveDuration - dur)
        const ns = Math.min(Math.max(0, d.origStart + deltaTime), maxStart)
        onBodyMove(ns, ns + dur)
      } else if (d.mode === 'left') {
        const ns = Math.min(Math.max(0, d.origStart + deltaTime), d.origEnd - MIN_DUR)
        onEdgeLeft(ns)
      } else {
        const ne = Math.max(Math.min(effectiveDuration, d.origEnd + deltaTime), d.origStart + MIN_DUR)
        onEdgeRight(ne)
      }
    }

    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      if (!drag.current?.moved) onSelect()
      drag.current = null
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const leftPct = effectiveDuration > 0 ? (startTime / effectiveDuration) * 100 : 0
  const widthPct = effectiveDuration > 0
    ? Math.max(((endTime - startTime) / effectiveDuration) * 100, 0.6)
    : 10
  const h = small ? 12 : 16

  return (
    <div
      onMouseDown={beginDrag('move')}
      title={`${label} — drag to move, drag either edge to trim`}
      style={{
        position: 'absolute', left: `${leftPct}%`, width: `${widthPct}%`, top: 1, height: h,
        borderRadius: 3, background: color, display: 'flex', alignItems: 'center', minWidth: 8,
        cursor: 'grab', userSelect: 'none', overflow: 'hidden',
        outline: selected ? '2px solid var(--brand-accent)' : 'none', outlineOffset: -2,
      }}
    >
      <div
        onMouseDown={beginDrag('left')}
        style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 6, cursor: 'ew-resize', background: 'rgba(255,255,255,0.28)' }}
      />
      <span style={{
        fontSize: small ? 8 : 9, color: '#fff', fontWeight: 600, paddingLeft: 6,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', pointerEvents: 'none',
      }}>
        {label}
      </span>
      <div
        onMouseDown={beginDrag('right')}
        style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 6, cursor: 'ew-resize', background: 'rgba(255,255,255,0.28)' }}
      />
    </div>
  )
}

const CLIP_COLORS = ['#1E3D2A88', '#2980b988', '#8e44ad88', '#e67e2288', '#16a08588']
const ADDL_CLIP_COLORS = ['#8B451388', '#6B4E9688', '#B8642888']

const s: Record<string, CSSProperties> = {
  root: {
    background: 'var(--canvas-bg)', padding: 'var(--space-2) var(--space-3)',
    display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', flexShrink: 0,
  },
  controls: { display: 'flex', alignItems: 'center', gap: 'var(--space-3)' },
  timeDisplay: { color: 'var(--text-primary)', fontFamily: 'monospace', fontSize: 12, minWidth: 70 },
  durationDisplay: { color: 'var(--text-secondary)', fontFamily: 'monospace', fontSize: 12, marginLeft: 'auto' },
  markButtons: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flex: 1 },
  markBtn: {
    background: 'var(--canvas-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)',
    padding: '3px var(--space-2)', borderRadius: 4, fontSize: 11, cursor: 'pointer',
  },
  markTime: { color: 'var(--brand-accent)', fontSize: 11, fontFamily: 'monospace' },
  clearBtn: {
    background: 'var(--danger)', border: 'none', color: '#fff',
    padding: '3px var(--space-2)', borderRadius: 4, fontSize: 11, cursor: 'pointer',
  },

  trackWrap: { cursor: 'crosshair', padding: 'var(--space-1) 0' },
  track: {
    position: 'relative', height: 24, background: 'var(--canvas-surface)', borderRadius: 4,
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
  markPinIn: { background: 'var(--success)' },
  markPinOut: { background: 'var(--danger)' },
  markLabel: {
    position: 'absolute', top: 2, left: 4, fontSize: 9, fontWeight: 700,
    color: 'var(--text-primary)', whiteSpace: 'nowrap',
  },
  playhead: {
    position: 'absolute', top: 0, height: '100%', width: 2,
    background: 'var(--text-primary)', transform: 'translateX(-1px)', pointerEvents: 'none',
  },

  laneRow: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)' },
  laneLabel: {
    color: 'var(--text-secondary)', fontSize: 9.5, width: 74, flexShrink: 0, textAlign: 'right',
    lineHeight: 1.15,
  },
  laneAddBtn: {
    width: 14, height: 14, borderRadius: 3, border: '1px solid var(--border)', background: 'var(--canvas-surface)',
    color: 'var(--text-primary)', fontSize: 10, lineHeight: 1, cursor: 'pointer', flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
  },
  lane: { position: 'relative', flex: 1, height: 18, background: 'var(--canvas-surface)', borderRadius: 3 },
}
