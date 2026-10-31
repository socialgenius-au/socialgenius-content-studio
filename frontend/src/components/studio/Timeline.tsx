import { useRef, useCallback, useState, type CSSProperties, type DragEvent, type MouseEvent, type ReactNode } from 'react'
import {
  SkipBack, Play, Pause, SkipForward, ChevronsRight, Maximize, ZoomIn, ZoomOut,
  Scissors, Copy, Trash2, Undo2, Redo2, LogIn, LogOut, Eye, EyeOff, Lock, Unlock,
  Type as TypeIcon, Image as ImageIcon, type LucideIcon,
} from 'lucide-react'
import { useStudio } from '../../contexts/StudioContext'
import { formatTime } from '../../utils/platforms'
import { assetsApi } from '../../api/client'
import type { VideoClip } from '../../types'
import { MEDIA_ASSET_DRAG_TYPE, type MediaAssetDragPayload } from './dragTypes'
import { probeVideoDuration } from './videoPreviewUtils'

interface Props {
  videoRef: React.RefObject<HTMLVideoElement | null>
}

const MIN_DUR = 0.2

type TrackKey = 'video' | 'additional' | 'audio' | 'text' | 'overlay'

// Deterministic placeholder waveform bars (no real audio-analysis pipeline exists yet) —
// computed once at module load, not per-render, so it doesn't jitter on every playhead tick.
const WAVEFORM_BARS = Array.from({ length: 40 }).map((_, i) => (
  20 + Math.abs(Math.sin(i * 0.9)) * 60 * Math.abs(Math.sin(i * 0.35 + 1))
))

// Subtle repeating texture standing in for real filmstrip/frame thumbnails on video clips.
const FILMSTRIP_PATTERN = 'repeating-linear-gradient(90deg, rgba(255,255,255,0.08) 0px, rgba(255,255,255,0.08) 1px, transparent 1px, transparent 14px)'


// Playback bar (spec section 10, reference-locked) — Previous / Play / Next / End, time
// readout, Fit dropdown, Fullscreen. Mark In/Out moved to the timeline toolbar below — the
// locked reference's transport row doesn't have room for them, and a professional NLE toolbar
// is a standard, equally-discoverable home for mark in/out.
export function TimelineTransport({ videoRef }: Props) {
  const { timeline, setTimeline } = useStudio()

  const togglePlay = () => setTimeline({ playing: !timeline.playing })

  const requestFullscreen = () => {
    const vid = videoRef.current
    if (vid?.requestFullscreen) vid.requestFullscreen().catch(() => {})
  }

  return (
    <div style={s.transportRoot}>
      <button className="sgv-btn sgv-btn--icon" disabled title="Previous clip — coming soon" aria-label="Previous clip">
        <SkipBack size={16} />
      </button>
      <button className="sgv-btn sgv-btn--icon" onClick={togglePlay} title={timeline.playing ? 'Pause' : 'Play'} aria-label={timeline.playing ? 'Pause' : 'Play'} style={s.playBtn}>
        {timeline.playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
      </button>
      <button className="sgv-btn sgv-btn--icon" disabled title="Next clip — coming soon" aria-label="Next clip">
        <SkipForward size={16} />
      </button>
      <button className="sgv-btn sgv-btn--icon" disabled title="Skip to end — coming soon" aria-label="Skip to end">
        <ChevronsRight size={16} />
      </button>

      <span style={s.timeDisplay}>
        <span style={s.timeCurrent}>{formatTime(timeline.currentTime)}</span>
        <span style={s.timeSep}> / </span>
        <span style={s.timeTotal}>{formatTime(timeline.duration)}</span>
      </span>

      <div style={{ flex: 1 }} />

      <select className="sgv-select" style={s.fitSelect} defaultValue="fit" title="Fit">
        <option value="fit">Fit</option>
        <option value="100">100%</option>
        <option value="50">50%</option>
      </select>
      <button className="sgv-btn sgv-btn--icon" onClick={requestFullscreen} title="Fullscreen" aria-label="Fullscreen">
        <Maximize size={16} />
      </button>
    </div>
  )
}

// Timeline toolbar (spec section 13, reference-locked) — Split/Duplicate/Delete/Undo/Redo stay
// disabled placeholders (no engine support yet). Mark In/Out are real (moved here from the
// playback bar, see above). Zoom is a real but purely visual scale on the ruler and tracks
// below — it never touches clip/timeline data, only how wide it's drawn.
export function TimelineToolbar({ zoom, onZoomChange }: { zoom: number; onZoomChange: (z: number) => void }) {
  const { timeline, setTimeline } = useStudio()
  const setMarkIn = () => setTimeline({ markIn: timeline.currentTime })
  const setMarkOut = () => setTimeline({ markOut: timeline.currentTime })

  return (
    <div style={s.toolbarRoot}>
      <button className="sgv-btn sgv-btn--toolbar" disabled title="Split — coming soon"><Scissors size={13} /> Split</button>
      <button className="sgv-btn sgv-btn--toolbar" disabled title="Duplicate — coming soon"><Copy size={13} /> Duplicate</button>
      <button className="sgv-btn sgv-btn--toolbar" disabled title="Delete — coming soon"><Trash2 size={13} /> Delete</button>
      <div style={s.toolbarDivider} />
      <button className="sgv-btn sgv-btn--toolbar" disabled title="Undo — coming soon"><Undo2 size={13} /> Undo</button>
      <button className="sgv-btn sgv-btn--toolbar" disabled title="Redo — coming soon"><Redo2 size={13} /> Redo</button>
      <div style={s.toolbarDivider} />
      <button className="sgv-btn sgv-btn--toolbar" onClick={setMarkIn} title="Mark In (set clip start)"><LogIn size={13} /> In</button>
      {timeline.markIn != null && <span style={s.markTime}>{formatTime(timeline.markIn)}</span>}
      <button className="sgv-btn sgv-btn--toolbar" onClick={setMarkOut} title="Mark Out (set clip end)"><LogOut size={13} /> Out</button>
      {timeline.markOut != null && <span style={s.markTime}>{formatTime(timeline.markOut)}</span>}
      {(timeline.markIn != null || timeline.markOut != null) && (
        <button className="sgv-btn sgv-btn--toolbar" onClick={() => setTimeline({ markIn: null, markOut: null })}>Clear</button>
      )}

      <div style={{ flex: 1 }} />

      <button className="sgv-btn sgv-btn--icon" onClick={() => onZoomChange(Math.max(0.5, zoom - 0.25))} title="Zoom out" aria-label="Zoom out">
        <ZoomOut size={16} />
      </button>
      <input
        type="range" min={0.5} max={3} step={0.25} value={zoom} className="sgv-range" style={s.zoomSlider}
        onChange={e => onZoomChange(Number(e.target.value))}
        aria-label="Timeline zoom"
      />
      <button className="sgv-btn sgv-btn--icon" onClick={() => onZoomChange(Math.min(3, zoom + 0.25))} title="Zoom in" aria-label="Zoom in">
        <ZoomIn size={16} />
      </button>
    </div>
  )
}

// Track lanes: V1 main video, V2 inserts, A1 audio, T1 text, O1 overlay. The ruler + all lanes
// share one horizontally-scrollable, zoomable content strip so the playhead lines up across
// every row. O1 stays display-only for this pass — real drag/trim interaction is left for a
// follow-up functionality pass (see the file-level note further down).
export function TimelineTracks({ videoRef, zoom }: Props & { zoom: number }) {
  const {
    timeline, setTimeline,
    videoClips, addVideoClip, updateVideoClip,
    additionalVideoClips, addAdditionalVideoClip, updateAdditionalVideoClip,
    textOverlays, updateTextOverlay,
    audioTracks, updateAudioTrack,
    mediaOverlays,
    selectedElement, setSelectedElement,
    uploadAsset, activeJob,
  } = useStudio()
  const addlFileRef = useRef<HTMLInputElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)

  // Per-track visibility/lock — real, but purely local UI state (not persisted, not part of
  // StudioContext): hidden dims that row's clips, locked disables dragging on it.
  const [hidden, setHidden] = useState<Record<TrackKey, boolean>>({ video: false, additional: false, audio: false, text: false, overlay: false })
  const [locked, setLocked] = useState<Record<TrackKey, boolean>>({ video: false, additional: false, audio: false, text: false, overlay: false })
  const toggleHidden = (k: TrackKey) => setHidden(p => ({ ...p, [k]: !p[k] }))
  const toggleLocked = (k: TrackKey) => setLocked(p => ({ ...p, [k]: !p[k] }))

  // Media Library → V1 drag-and-drop: highlight the lane while a compatible drag is over it,
  // and turn a drop into a real clip built from the dragged asset.
  const [videoDropActive, setVideoDropActive] = useState(false)

  const handleVideoDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes(MEDIA_ASSET_DRAG_TYPE) || locked.video) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setVideoDropActive(true)
  }

  const handleVideoDragLeave = () => setVideoDropActive(false)

  const handleVideoDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setVideoDropActive(false)
    if (locked.video) return
    const raw = e.dataTransfer.getData(MEDIA_ASSET_DRAG_TYPE)
    if (!raw) return

    let payload: MediaAssetDragPayload
    try {
      payload = JSON.parse(raw)
    } catch {
      return
    }

    const duration = await probeVideoDuration(payload.url)
    const start = videoClips.reduce((a, c) => Math.max(a, c.endTime), 0)
    const clip: VideoClip = {
      id: crypto.randomUUID(),
      assetId: payload.assetId,
      url: payload.url,
      name: payload.name,
      duration,
      startTime: start,
      endTime: start + duration,
      trimIn: 0, trimOut: 0,
      colorGrade: 'none', speed: 1,
      brightness: 0, contrast: 0, saturation: 0,
      transition: 'cut', transitionDuration: 0.5,
    }
    addVideoClip(clip)
  }

  const authoredEnds = [
    ...videoClips.map(c => c.endTime),
    ...additionalVideoClips.map(c => c.endTime),
    ...textOverlays.map(o => o.endTime),
    ...audioTracks.map(t => t.endTime),
    ...mediaOverlays.map(o => o.endTime),
  ]
  // A known timeline.duration (e.g. the demo seed's fixed 18s) still wins as the baseline, but
  // must not clip off real clips authored past it — e.g. a video dropped onto V1 after the
  // existing content, which previously landed beyond the ruler's scale and was unreachable by
  // scrubbing/clicking. Only when nothing is authored yet does the 60s fallback apply.
  const effectiveDuration = timeline.duration > 0
    ? Math.max(timeline.duration, ...authoredEnds, 0)
    : Math.max(60, ...authoredEnds, 0)

  const seek = useCallback((e: MouseEvent<HTMLDivElement>) => {
    if (!trackRef.current || effectiveDuration === 0) return
    const rect = trackRef.current.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const time = ratio * effectiveDuration
    setTimeline({ currentTime: time })
    if (videoRef.current) videoRef.current.currentTime = time
  }, [effectiveDuration, setTimeline, videoRef])

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

  const progress = effectiveDuration > 0 ? timeline.currentTime / effectiveDuration : 0
  const tickCount = 10
  const contentWidthPct = zoom * 100

  return (
    <div style={s.root}>
      {/* Fixed 188px track-header column */}
      <div style={s.headerCol}>
        <div style={s.rulerHeaderSpacer} />
        <TrackBadge trackKey="video" code="V1" label="Main Video" color="var(--sg-video-fill)" border="var(--sg-video-border)" height={64}
          hidden={hidden.video} locked={locked.video} onToggleHidden={toggleHidden} onToggleLocked={toggleLocked} />
        <TrackBadge trackKey="additional" code="V2" label="Inserts" color="var(--sg-video-fill)" border="var(--sg-video-border)" height={54}
          hidden={hidden.additional} locked={locked.additional} onToggleHidden={toggleHidden} onToggleLocked={toggleLocked}
          action={(
            <>
              <input
                ref={addlFileRef} type="file" accept="video/*" style={{ display: 'none' }}
                onChange={e => { const f = e.target.files?.[0]; if (f) handleAddlUpload(f); e.target.value = '' }}
              />
              <button style={s.laneAddBtn} onClick={() => addlFileRef.current?.click()} title="Add an intro/outro/transition clip">+</button>
            </>
          )}
        />
        <TrackBadge trackKey="audio" code="A1" label="Audio" color="var(--sg-audio-fill)" border="var(--sg-audio-border)" height={54}
          hidden={hidden.audio} locked={locked.audio} onToggleHidden={toggleHidden} onToggleLocked={toggleLocked} />
        <TrackBadge trackKey="text" code="T1" label="Text" color="var(--sg-text-fill)" border="var(--sg-text-border)" height={54}
          hidden={hidden.text} locked={locked.text} onToggleHidden={toggleHidden} onToggleLocked={toggleLocked} />
        <TrackBadge trackKey="overlay" code="O1" label="Overlay" color="var(--sg-overlay-fill)" border="var(--sg-overlay-border)" height={54}
          hidden={hidden.overlay} locked={locked.overlay} onToggleHidden={toggleHidden} onToggleLocked={toggleLocked} />
      </div>

      {/* Scrollable, zoomable ruler + track content */}
      <div style={s.scrollArea}>
        <div style={{ ...s.zoomContent, width: `${contentWidthPct}%`, minWidth: '100%' }}>
          {/* Time ruler */}
          <div style={s.ruler} ref={trackRef} onClick={seek}>
            {Array.from({ length: tickCount + 1 }).map((_, i) => (
              <span key={i} style={{ ...s.rulerTick, left: `${(i / tickCount) * 100}%` }}>
                {formatTime((i / tickCount) * effectiveDuration).slice(0, -3)}
              </span>
            ))}
          </div>

          {/* V1 */}
          <TrackRow
            height={64} onClick={seek} dimmed={hidden.video}
            onDragOver={handleVideoDragOver} onDragLeave={handleVideoDragLeave} onDrop={handleVideoDrop}
            dropActive={videoDropActive}
          >
            {videoClips.map((clip, i) => (
              <ClipBlock
                key={clip.id}
                startTime={clip.startTime} endTime={clip.endTime} effectiveDuration={effectiveDuration}
                fill="var(--sg-video-fill)" border="var(--sg-video-border)" selectedBorder="var(--sg-video-border-selected)"
                label={clip.name || `Clip ${i + 1}`}
                selected={selectedElement?.type === 'clip' && selectedElement.lane === 'video' && selectedElement.id === clip.id}
                locked={locked.video}
                pattern="filmstrip"
                onSelect={() => setSelectedElement({ type: 'clip', lane: 'video', id: clip.id })}
                onBodyMove={(ns, ne) => updateVideoClip(clip.id, { startTime: ns, endTime: ne })}
                onEdgeLeft={(ns) => { const shrink = ns - clip.startTime; updateVideoClip(clip.id, { startTime: ns, trimIn: Math.max(0, clip.trimIn + shrink) }) }}
                onEdgeRight={(ne) => { const shrink = clip.endTime - ne; updateVideoClip(clip.id, { endTime: ne, trimOut: Math.max(0, clip.trimOut + shrink) }) }}
              />
            ))}
          </TrackRow>

          {/* V2 */}
          <TrackRow height={54} onClick={seek} dimmed={hidden.additional}>
            {additionalVideoClips.map((clip, i) => (
              <ClipBlock
                key={clip.id}
                startTime={clip.startTime} endTime={clip.endTime} effectiveDuration={effectiveDuration}
                fill="var(--sg-video-fill)" border="var(--sg-video-border)" selectedBorder="var(--sg-video-border-selected)"
                label={clip.name || `Insert ${i + 1}`}
                selected={selectedElement?.type === 'clip' && selectedElement.lane === 'additional' && selectedElement.id === clip.id}
                locked={locked.additional}
                pattern="filmstrip"
                onSelect={() => setSelectedElement({ type: 'clip', lane: 'additional', id: clip.id })}
                onBodyMove={(ns, ne) => updateAdditionalVideoClip(clip.id, { startTime: ns, endTime: ne })}
                onEdgeLeft={(ns) => { const shrink = ns - clip.startTime; updateAdditionalVideoClip(clip.id, { startTime: ns, trimIn: Math.max(0, clip.trimIn + shrink) }) }}
                onEdgeRight={(ne) => { const shrink = clip.endTime - ne; updateAdditionalVideoClip(clip.id, { endTime: ne, trimOut: Math.max(0, clip.trimOut + shrink) }) }}
              />
            ))}
          </TrackRow>

          {/* A1 */}
          <TrackRow height={54} onClick={seek} dimmed={hidden.audio}>
            {audioTracks.map(t => (
              <ClipBlock
                key={t.id}
                startTime={t.startTime} endTime={t.endTime} effectiveDuration={effectiveDuration}
                fill="var(--sg-audio-fill)" border="var(--sg-audio-border)" selectedBorder="var(--sg-audio-wave)"
                label={t.name}
                selected={selectedElement?.type === 'audio' && selectedElement.id === t.id}
                locked={locked.audio}
                onSelect={() => setSelectedElement({ type: 'audio', id: t.id })}
                onBodyMove={(ns, ne) => updateAudioTrack(t.id, { startTime: ns, endTime: ne })}
                onEdgeLeft={(ns) => { const shrink = ns - t.startTime; updateAudioTrack(t.id, { startTime: ns, trimIn: Math.max(0, t.trimIn + shrink) }) }}
                onEdgeRight={(ne) => { const shrink = t.endTime - ne; updateAudioTrack(t.id, { endTime: ne, trimOut: Math.max(0, t.trimOut + shrink) }) }}
                waveform
              />
            ))}
          </TrackRow>

          {/* T1 */}
          <TrackRow height={54} onClick={seek} dimmed={hidden.text}>
            {textOverlays.map(o => (
              <ClipBlock
                key={o.id}
                startTime={o.startTime} endTime={o.endTime} effectiveDuration={effectiveDuration}
                fill="var(--sg-text-fill)" border="var(--sg-text-border)" selectedBorder="var(--sg-text-text)"
                label={o.text.slice(0, 24)}
                selected={selectedElement?.type === 'text' && selectedElement.id === o.id}
                locked={locked.text}
                icon={TypeIcon}
                onSelect={() => setSelectedElement({ type: 'text', id: o.id })}
                onBodyMove={(ns, ne) => updateTextOverlay(o.id, { startTime: ns, endTime: ne })}
                onEdgeLeft={(ns) => updateTextOverlay(o.id, { startTime: ns })}
                onEdgeRight={(ne) => updateTextOverlay(o.id, { endTime: ne })}
              />
            ))}
          </TrackRow>

          {/* O1 — display-only this pass */}
          <TrackRow height={54} onClick={seek} dimmed={hidden.overlay}>
            {mediaOverlays.map((o, i) => {
              const leftPct = effectiveDuration > 0 ? (o.startTime / effectiveDuration) * 100 : 0
              const widthPct = effectiveDuration > 0 ? Math.max(((o.endTime - o.startTime) / effectiveDuration) * 100, 0.6) : 10
              return (
                <div
                  key={o.id}
                  title={`Overlay ${i + 1} — timeline editing coming soon`}
                  style={{
                    position: 'absolute', left: `${leftPct}%`, width: `${widthPct}%`, top: 4, bottom: 4,
                    borderRadius: 5, background: 'var(--sg-overlay-fill)', border: '1px solid var(--sg-overlay-border)',
                    backgroundImage: FILMSTRIP_PATTERN, backgroundBlendMode: 'overlay',
                    display: 'flex', alignItems: 'center', minWidth: 8, overflow: 'hidden', userSelect: 'none', gap: 5,
                  }}
                >
                  <ImageIcon size={11} color="var(--sg-overlay-text)" style={{ flexShrink: 0, marginLeft: 8 }} />
                  <span style={{ fontSize: 11, color: 'var(--sg-overlay-text)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    Overlay.png
                  </span>
                </div>
              )
            })}
          </TrackRow>

          {/* Playhead — spans ruler + every track row */}
          <div style={{ ...s.playhead, left: `${progress * 100}%` }}>
            <div style={s.playheadTriangle} />
          </div>
        </div>
      </div>
    </div>
  )
}

function TrackBadge({ code, label, color, border, height, action, hidden, locked, trackKey, onToggleHidden, onToggleLocked }: {
  code: string; label: string; color: string; border: string; height: number; action?: ReactNode
  hidden: boolean; locked: boolean; trackKey: TrackKey
  onToggleHidden: (k: TrackKey) => void; onToggleLocked: (k: TrackKey) => void
}) {
  return (
    <div style={{ ...s.headerRow, height }}>
      <span style={{ ...s.trackBadge, background: color, border: `1px solid ${border}` }}>{code}</span>
      <span style={s.trackLabel}>{label}</span>
      {action}
      <button style={s.trackIconBtn} onClick={() => onToggleHidden(trackKey)} title={hidden ? 'Show track' : 'Hide track'} aria-label={hidden ? 'Show track' : 'Hide track'}>
        {hidden ? <EyeOff size={13} /> : <Eye size={13} />}
      </button>
      <button style={s.trackIconBtn} onClick={() => onToggleLocked(trackKey)} title={locked ? 'Unlock track' : 'Lock track'} aria-label={locked ? 'Unlock track' : 'Lock track'}>
        {locked ? <Lock size={13} color="var(--sg-gold)" /> : <Unlock size={13} />}
      </button>
    </div>
  )
}

function TrackRow({ height, children, onClick, dimmed, onDragOver, onDragLeave, onDrop, dropActive }: {
  height: number; children: ReactNode; onClick: (e: MouseEvent<HTMLDivElement>) => void; dimmed?: boolean
  // Optional — only the V1 lane currently accepts drops from the Media Library.
  onDragOver?: (e: DragEvent<HTMLDivElement>) => void
  onDragLeave?: (e: DragEvent<HTMLDivElement>) => void
  onDrop?: (e: DragEvent<HTMLDivElement>) => void
  dropActive?: boolean
}) {
  return (
    <div
      style={{ ...s.trackRow, height, opacity: dimmed ? 0.35 : 1, ...(dropActive ? s.trackRowDropActive : null) }}
      onClick={onClick}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      data-lane="true"
    >
      {children}
    </div>
  )
}

// A single clip/overlay/track block: click to select, drag the body to reposition, drag either
// edge to trim. A "drag" only counts once the pointer has moved a few px — anything under that
// is treated as a plain click so selecting still works.
function ClipBlock({
  startTime, endTime, effectiveDuration, fill, border, selectedBorder, label, selected, waveform,
  locked, pattern, icon: Icon,
  onSelect, onBodyMove, onEdgeLeft, onEdgeRight,
}: {
  startTime: number
  endTime: number
  effectiveDuration: number
  fill: string
  border: string
  selectedBorder: string
  label: string
  selected: boolean
  waveform?: boolean
  locked?: boolean
  pattern?: 'filmstrip'
  icon?: LucideIcon
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
    if (locked) { onSelect(); return }
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

  return (
    <div
      onMouseDown={beginDrag('move')}
      title={locked ? `${label} — track is locked` : `${label} — drag to move, drag either edge to trim`}
      style={{
        position: 'absolute', left: `${leftPct}%`, width: `${widthPct}%`, top: 4, bottom: 4,
        borderRadius: 5, background: fill, border: `1px solid ${selected ? selectedBorder : border}`,
        backgroundImage: pattern === 'filmstrip' ? FILMSTRIP_PATTERN : undefined,
        boxShadow: selected ? `0 0 0 1px ${selectedBorder}` : 'none',
        display: 'flex', alignItems: 'center', minWidth: 8, gap: 5,
        cursor: locked ? 'not-allowed' : 'grab', userSelect: 'none', overflow: 'hidden',
      }}
    >
      {waveform && (
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.65 }}>
          {WAVEFORM_BARS.map((h, i) => {
            const x = (i / WAVEFORM_BARS.length) * 100
            const w = (1 / WAVEFORM_BARS.length) * 100 * 0.6
            return (
              <rect
                key={i} x={`${x}%`} y={`${50 - h / 2}%`} width={`${w}%`} height={`${h}%`}
                fill="var(--sg-audio-wave)" rx={1}
              />
            )
          })}
        </svg>
      )}
      {!locked && (
        <div
          onMouseDown={beginDrag('left')}
          style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 6, cursor: 'ew-resize', background: 'rgba(255,255,255,0.15)' }}
        />
      )}
      {Icon && <Icon size={12} color="var(--sg-text-primary)" style={{ flexShrink: 0, marginLeft: 8, position: 'relative' }} />}
      <span style={{
        fontSize: 12, color: 'var(--sg-text-primary)', fontWeight: 600, paddingLeft: Icon ? 0 : 8,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', pointerEvents: 'none', position: 'relative',
      }}>
        {label}
      </span>
      {locked && <Lock size={11} color="var(--sg-text-primary)" style={{ marginLeft: 'auto', marginRight: 8, flexShrink: 0, position: 'relative', opacity: 0.7 }} />}
      {!locked && (
        <div
          onMouseDown={beginDrag('right')}
          style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 6, cursor: 'ew-resize', background: 'rgba(255,255,255,0.15)' }}
        />
      )}
    </div>
  )
}

const s: Record<string, CSSProperties> = {
  /* Playback bar */
  transportRoot: {
    height: 52, background: 'var(--sg-bg-2)', borderTop: '1px solid var(--sg-border)',
    padding: '0 16px', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
  },
  playBtn: {
    background: 'var(--sg-green)', color: 'var(--sg-bg-0)',
    width: 44, height: 44, borderRadius: '50%',
  },
  timeDisplay: { fontFamily: 'monospace', fontSize: 13, marginLeft: 8 },
  timeCurrent: { color: 'var(--sg-green)', fontWeight: 700 },
  timeSep: { color: 'var(--sg-text-muted)' },
  timeTotal: { color: 'var(--sg-text-secondary)' },
  markTime: { color: 'var(--sg-gold)', fontSize: 11, fontFamily: 'monospace' },
  fitSelect: { width: 72, height: 34, fontSize: 12, padding: '0 6px' },

  /* Toolbar */
  toolbarRoot: {
    height: 52, background: 'var(--sg-bg-1)', borderTop: '1px solid var(--sg-border)',
    borderBottom: '1px solid var(--sg-border)', padding: '0 16px',
    display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
  },
  toolbarDivider: { width: 1, height: 24, background: 'var(--sg-border)', margin: '0 4px' },
  zoomSlider: { width: 96 },

  /* Tracks */
  root: { display: 'flex', flex: 1, minHeight: 0, background: 'var(--sg-bg-2)' },
  headerCol: {
    width: 188, minWidth: 188, flexShrink: 0, background: 'var(--sg-bg-2)',
    borderRight: '1px solid var(--sg-border)', display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 34,
  },
  rulerHeaderSpacer: { display: 'none' },
  headerRow: { display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px' },
  trackBadge: {
    fontSize: 11, lineHeight: '16px', fontWeight: 700, color: '#fff',
    borderRadius: 4, padding: '2px 6px', flexShrink: 0,
  },
  trackLabel: { flex: 1, fontSize: 12, fontWeight: 600, color: 'var(--sg-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  laneAddBtn: {
    width: 18, height: 18, borderRadius: 4, border: '1px solid var(--sg-border)',
    background: 'var(--sg-bg-3)', color: 'var(--sg-text-primary)', fontSize: 12, lineHeight: 1, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, flexShrink: 0,
  },
  trackIconBtn: {
    width: 20, height: 20, borderRadius: 4, border: 'none', background: 'transparent',
    color: 'var(--sg-text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 0, flexShrink: 0,
  },

  scrollArea: { flex: 1, overflowX: 'auto', overflowY: 'hidden', minWidth: 0 },
  zoomContent: { position: 'relative', height: '100%', display: 'flex', flexDirection: 'column', gap: 6 },

  ruler: {
    position: 'relative', height: 34, background: 'var(--sg-bg-1)', flexShrink: 0, cursor: 'crosshair',
  },
  rulerTick: {
    position: 'absolute', top: 10, fontSize: 11, color: 'var(--sg-text-muted)', transform: 'translateX(-50%)',
    fontFamily: 'monospace',
  },

  trackRow: {
    position: 'relative', background: 'var(--sg-bg-3)', borderRadius: 4, cursor: 'crosshair', flexShrink: 0,
  },
  // Shown on V1 only, while a draggable media-library video is over it — a clear, valid-drop
  // affordance that doesn't touch any other track's styling.
  trackRowDropActive: {
    outline: '2px dashed var(--sg-green)', outlineOffset: -2, background: 'rgba(46, 204, 113, 0.12)',
  },

  playhead: {
    position: 'absolute', top: 0, bottom: 0, width: 2,
    background: 'var(--sg-playhead)', transform: 'translateX(-1px)', pointerEvents: 'none', zIndex: 5,
  },
  playheadTriangle: {
    position: 'absolute', top: 0, left: -5, width: 0, height: 0,
    borderLeft: '6px solid transparent', borderRight: '6px solid transparent',
    borderTop: '10px solid var(--sg-playhead)',
  },
}
