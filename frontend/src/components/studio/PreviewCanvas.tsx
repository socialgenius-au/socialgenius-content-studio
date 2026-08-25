import {
  useRef, useEffect, useState, useCallback,
  type CSSProperties, type DragEvent,
} from 'react'
import { Square, RectangleVertical, RectangleHorizontal, Film, Play, Pause } from 'lucide-react'
import { useStudio } from '../../contexts/StudioContext'
import { getCanvasSize, PLATFORMS } from '../../utils/platforms'
import { uploadApi, assetsApi } from '../../api/client'
import type { Asset, VideoClip, ImageSlide, Platform } from '../../types'

interface Props {
  videoRef: React.RefObject<HTMLVideoElement>
}

// Aspect-ratio quick-select (spec section 10). Maps onto the closest existing platform preset
// rather than inventing new ones — 4:5 has no exact match in utils/platforms.ts so it stays
// disabled rather than silently picking a wrong ratio.
const RATIO_PRESETS: { key: string; label: string; icon: typeof Square; platform: Platform | null }[] = [
  { key: '9:16', label: '9:16', icon: RectangleVertical, platform: 'instagram_reel' },
  { key: '16:9', label: '16:9', icon: RectangleHorizontal, platform: 'youtube_16_9' },
  { key: '1:1', label: '1:1', icon: Square, platform: 'instagram_post' },
  { key: '4:5', label: '4:5', icon: RectangleVertical, platform: null },
]

export default function PreviewCanvas({ videoRef }: Props) {
  const {
    platform, setPlatform, contentType, previewUrl, previewHtml, previewText,
    videoClips, imageSlides, textOverlays, mediaOverlays,
    timeline, setTimeline,
    addVideoClip, addImageSlide,
    uploadAsset, activeJob,
    activeBrand,
    selectedElement, setSelectedElement,
  } = useStudio()

  const containerRef = useRef<HTMLDivElement>(null)
  const [canvasSize, setCanvasSize] = useState({ w: 360, h: 640 })
  const [draggingOver, setDraggingOver] = useState(false)
  const [activeSlide, setActiveSlide] = useState(0)
  const [safeZone, setSafeZone] = useState(false)

  // Calculate canvas size from container
  useEffect(() => {
    const update = () => {
      if (!containerRef.current) return
      const { width, height } = containerRef.current.getBoundingClientRect()
      // Timeline now docks outside this component (see StudioPage.tsx), so the only
      // vertical space to reserve here is the platform label + safe-zone toolbar rows.
      const size = getCanvasSize(platform, width - 32, height - 60)
      setCanvasSize(size)
    }
    update()
    const ro = new ResizeObserver(update)
    if (containerRef.current) ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [platform])

  // Sync video time to timeline
  useEffect(() => {
    const vid = videoRef.current
    if (!vid) return
    const onTime = () => setTimeline({ currentTime: vid.currentTime })
    const onDuration = () => setTimeline({ duration: vid.duration || 0 })
    const onEnded = () => setTimeline({ playing: false })
    vid.addEventListener('timeupdate', onTime)
    vid.addEventListener('loadedmetadata', onDuration)
    vid.addEventListener('ended', onEnded)
    return () => {
      vid.removeEventListener('timeupdate', onTime)
      vid.removeEventListener('loadedmetadata', onDuration)
      vid.removeEventListener('ended', onEnded)
    }
  }, [setTimeline])

  // Play/pause
  useEffect(() => {
    const vid = videoRef.current
    if (!vid) return
    if (timeline.playing) vid.play().catch(() => {})
    else vid.pause()
  }, [timeline.playing])

  const togglePlay = () => setTimeline({ playing: !timeline.playing })

  // Drag & drop upload
  const handleDragOver = (e: DragEvent) => { e.preventDefault(); setDraggingOver(true) }
  const handleDragLeave = () => setDraggingOver(false)
  const handleDrop = useCallback(async (e: DragEvent) => {
    e.preventDefault()
    setDraggingOver(false)
    const files = Array.from(e.dataTransfer.files)
    for (const file of files) {
      try {
        const asset = await uploadAsset(file, activeJob?.id)
        const url = assetsApi.previewUrl(asset.file_path)
        if (file.type.startsWith('video/')) {
          const clip: VideoClip = {
            id: crypto.randomUUID(),
            assetId: asset.id,
            url,
            name: file.name,
            duration: 0,
            startTime: videoClips.reduce((a, c) => Math.max(a, c.endTime), 0),
            endTime: videoClips.reduce((a, c) => Math.max(a, c.endTime), 0) + 30,
            trimIn: 0, trimOut: 0,
            colorGrade: 'none', speed: 1,
            brightness: 0, contrast: 0, saturation: 0,
            transition: 'cut', transitionDuration: 0.5,
          }
          addVideoClip(clip)
        } else if (file.type.startsWith('image/')) {
          const slide: ImageSlide = {
            id: crypto.randomUUID(),
            assetId: asset.id,
            url,
            name: file.name,
            filter: 'none', animation: 'none', duration: 5, transition: 'dissolve',
          }
          addImageSlide(slide)
        }
      } catch (err) {
        console.error('Upload failed', err)
      }
    }
  }, [uploadAsset, activeJob, videoClips, addVideoClip, addImageSlide])

  const spec = PLATFORMS[platform]
  const currentVideoUrl = previewUrl ?? (videoClips[0]?.url ?? null)
  const currentImageUrl = imageSlides[activeSlide]?.url ?? null

  // Apply CSS filter for colour grade
  const getVideoFilter = () => {
    const clip = videoClips[0]
    if (!clip) return ''
    const filters: string[] = []
    if (clip.brightness) filters.push(`brightness(${1 + clip.brightness / 100})`)
    if (clip.contrast) filters.push(`contrast(${1 + clip.contrast / 100})`)
    if (clip.saturation !== 0) filters.push(`saturate(${1 + clip.saturation / 100})`)
    switch (clip.colorGrade) {
      case 'bw': filters.push('grayscale(1)'); break
      case 'warm': filters.push('sepia(0.3) saturate(1.2)'); break
      case 'cool': filters.push('hue-rotate(20deg) saturate(0.9)'); break
      case 'cinematic': filters.push('contrast(1.1) saturate(0.85) brightness(0.95)'); break
      case 'high_contrast': filters.push('contrast(1.4)'); break
      case 'desaturated': filters.push('saturate(0.3)'); break
    }
    return filters.join(' ')
  }

  const getImageFilter = (slide?: ImageSlide) => {
    if (!slide) return ''
    switch (slide.filter) {
      case 'bw': return 'grayscale(1)'
      case 'warm': return 'sepia(0.4) saturate(1.3)'
      case 'cool': return 'hue-rotate(20deg) saturate(0.8)'
      case 'vintage': return 'sepia(0.5) contrast(0.9) brightness(0.95)'
      case 'high_contrast': return 'contrast(1.4)'
      case 'vivid': return 'saturate(1.5) contrast(1.1)'
      case 'cinematic': return 'contrast(1.1) saturate(0.85) sepia(0.1)'
      default: return ''
    }
  }

  return (
    <div style={s.outer}>
      {/* Aspect toolbar (spec section 10) */}
      <div style={s.aspectToolbar}>
        <span style={s.aspectSectionLabel}>Ratio</span>
        {RATIO_PRESETS.map(r => {
          const Icon = r.icon
          const active = r.platform === platform
          return (
            <button
              key={r.key}
              style={{ ...s.aspectBtn, ...(active ? s.aspectBtnActive : {}) }}
              disabled={!r.platform}
              onClick={() => r.platform && setPlatform(r.platform)}
              title={r.platform ? r.label : `${r.label} — no matching preset yet`}
            >
              <Icon size={16} />
              <span style={s.aspectBtnLabel}>{r.label}</span>
            </button>
          )
        })}
        <div style={s.aspectDivider} />
        <span style={s.aspectSectionLabel}>Safe Zones</span>
        <button
          role="switch"
          aria-checked={safeZone}
          style={{ ...s.safeToggle, ...(safeZone ? s.safeToggleActive : {}) }}
          onClick={() => setSafeZone(v => !v)}
          title="Toggle safe zones"
        >
          <span style={{ ...s.safeToggleKnob, ...(safeZone ? s.safeToggleKnobActive : {}) }} />
        </button>
      </div>

      <div ref={containerRef} style={s.root}>
        {/* Platform label */}
        <div style={s.platformLabel}>{spec.label} · {spec.width}×{spec.height}</div>

        {/* Canvas area */}
        <div
          style={{
            ...s.canvasWrap,
            width: canvasSize.w,
            height: canvasSize.h,
            outline: draggingOver ? '3px dashed var(--sg-green)' : '1px solid var(--sg-preview-border)',
          }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => setSelectedElement(null)}
      >
        {/* Safe zone overlay — a dashed inset guide box between the top/bottom safe margins */}
        {safeZone && (
          <div style={{
            position: 'absolute', left: 0, right: 0, zIndex: 10, pointerEvents: 'none',
            top: `${spec.safeZoneTop * 100}%`, bottom: `${spec.safeZoneBottom * 100}%`,
            border: '1px dashed rgba(255,255,255,0.35)',
          }} />
        )}

        {/* VIDEO */}
        {contentType === 'video' && currentVideoUrl && (
          <video
            ref={videoRef}
            src={currentVideoUrl}
            style={{ ...s.media, filter: getVideoFilter() }}
            onClick={togglePlay}
            playsInline
          />
        )}

        {/* Empty video state — a loaded demo clip with no playable source yet shows its
            name; a truly empty timeline shows the drop prompt. */}
        {contentType === 'video' && !currentVideoUrl && (
          <div style={s.dropZone}>
            <Film size={40} color="var(--sg-text-muted)" />
            {videoClips.length > 0 ? (
              <p style={s.dropText}>{videoClips[0].name || 'Clip'}</p>
            ) : (
              <p style={s.dropText}>Drop a video file to start editing</p>
            )}
          </div>
        )}

        {/* IMAGE / CAROUSEL */}
        {(contentType === 'image' || contentType === 'carousel') && imageSlides.length > 0 && (
          <img
            src={imageSlides[activeSlide]?.url}
            alt=""
            style={{ ...s.media, filter: getImageFilter(imageSlides[activeSlide]) }}
          />
        )}

        {(contentType === 'image' || contentType === 'carousel') && imageSlides.length === 0 && (
          <div style={s.dropZone}>
            <span style={s.dropIcon}>🖼️</span>
            <p style={s.dropText}>Drop images here to start your carousel</p>
          </div>
        )}

        {/* BLOG preview */}
        {contentType === 'blog' && (
          <div style={s.blogPreview}>
            {previewText ? (
              <div style={s.blogText}>{previewText}</div>
            ) : (
              <div style={s.dropZone}>
                <span style={s.dropIcon}>📝</span>
                <p style={s.dropText}>Type in the chat below to generate blog content</p>
              </div>
            )}
          </div>
        )}

        {/* NEWSLETTER preview */}
        {contentType === 'newsletter' && (
          <div style={s.newsletterPreview}>
            {previewHtml ? (
              <iframe
                srcDoc={previewHtml}
                style={{ width: '100%', height: '100%', border: 'none' }}
                title="Newsletter preview"
                sandbox="allow-same-origin"
              />
            ) : (
              <div style={s.dropZone}>
                <span style={s.dropIcon}>📧</span>
                <p style={s.dropText}>Newsletter sections will appear here as Claude writes them</p>
              </div>
            )}
          </div>
        )}

        {/* AUDIO preview */}
        {contentType === 'audio' && (
          <div style={s.audioPreview}>
            <span style={s.dropIcon}>🎙️</span>
            <p style={s.dropText}>Audio waveform renders below when file is uploaded</p>
          </div>
        )}

        {/* Text overlays */}
        {textOverlays.map(o => {
          const isSelected = selectedElement?.type === 'text' && selectedElement.id === o.id
          return (
            <div
              key={o.id}
              onClick={e => { e.stopPropagation(); setSelectedElement({ type: 'text', id: o.id }) }}
              style={{
                position: 'absolute',
                left: `${o.x}%`, top: `${o.y}%`,
                width: `${o.width}%`,
                fontFamily: o.fontFamily,
                fontSize: o.fontSize * (canvasSize.w / 1080),
                fontWeight: o.bold ? 700 : 400,
                fontStyle: o.italic ? 'italic' : 'normal',
                color: o.color,
                background: o.bgColor !== 'transparent'
                  ? `${o.bgColor}${Math.round(o.bgOpacity * 255).toString(16).padStart(2, '0')}`
                  : 'transparent',
                padding: '2px 6px',
                borderRadius: 3,
                cursor: 'move',
                userSelect: 'none',
                pointerEvents: 'all',
                outline: isSelected ? '2px solid var(--brand-accent)' : 'none',
                outlineOffset: 2,
              }}
            >
              {o.text}
            </div>
          )
        })}

        {/* Media overlays (uploaded image/video layered on top of the base content) */}
        {mediaOverlays.map(o => {
          const isVideo = /\.(mp4|webm|mov)$/i.test(o.url)
          const style: CSSProperties = {
            position: 'absolute',
            left: `${o.x}%`, top: `${o.y}%`,
            width: `${o.width}%`, height: `${o.height}%`,
            opacity: o.opacity,
            objectFit: 'cover',
            pointerEvents: 'none',
          }
          return isVideo ? (
            <video key={o.id} src={o.url} style={style} autoPlay loop muted playsInline />
          ) : (
            <img key={o.id} src={o.url} alt="" style={style} />
          )
        })}

        {/* Play button overlay for video */}
        {contentType === 'video' && currentVideoUrl && (
          <button
            style={{
              ...s.playBtn,
              opacity: timeline.playing ? 0 : 0.85,
            }}
            onClick={togglePlay}
          >
            {timeline.playing ? <Pause size={22} fill="#fff" /> : <Play size={22} fill="#fff" />}
          </button>
        )}
      </div>

      {/* Carousel navigation */}
      {(contentType === 'carousel') && imageSlides.length > 1 && (
        <div style={s.slideNav}>
          {imageSlides.map((_, i) => (
            <button
              key={i}
              style={{ ...s.slideDot, background: i === activeSlide ? '#C89A2E' : '#555' }}
              onClick={() => setActiveSlide(i)}
            />
          ))}
        </div>
      )}

      </div>
    </div>
  )
}

const s: Record<string, CSSProperties> = {
  outer: {
    flex: 1, display: 'flex', flexDirection: 'row', minWidth: 0, minHeight: 0,
    background: 'var(--sg-canvas-surround)', padding: '16px 24px 12px',
  },
  aspectToolbar: {
    width: 64, flexShrink: 0, display: 'flex', flexDirection: 'column',
    alignItems: 'center', paddingTop: 4,
  },
  aspectSectionLabel: {
    fontSize: 10, fontWeight: 600, color: 'var(--sg-text-muted)', textTransform: 'uppercase',
    letterSpacing: 0.4, marginBottom: 8,
  },
  aspectBtn: {
    width: 48, height: 42, marginBottom: 8, borderRadius: 7, border: '1px solid transparent',
    background: 'transparent', color: 'var(--sg-text-secondary)', cursor: 'pointer',
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
  },
  aspectBtnLabel: { fontSize: 9, fontWeight: 600 },
  aspectBtnActive: { background: 'var(--sg-green-soft)', border: '1px solid #247A46', color: 'var(--sg-green)' },
  aspectDivider: { width: 28, height: 1, background: 'var(--sg-border)', margin: '4px 0 12px' },

  safeToggle: {
    width: 36, height: 20, borderRadius: 10, border: '1px solid var(--sg-border-strong)',
    background: 'var(--sg-bg-3)', cursor: 'pointer', position: 'relative', padding: 0,
    transition: 'background 120ms ease, border-color 120ms ease',
  },
  safeToggleActive: { background: 'var(--sg-green)', border: '1px solid var(--sg-green)' },
  safeToggleKnob: {
    position: 'absolute', top: 2, left: 2, width: 14, height: 14, borderRadius: '50%',
    background: '#fff', transition: 'transform 120ms ease',
  },
  safeToggleKnobActive: { transform: 'translateX(16px)' },

  root: {
    flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden', position: 'relative', minWidth: 0, minHeight: 0,
  },
  platformLabel: {
    color: 'var(--text-secondary)', fontSize: 11, fontWeight: 600, padding: 'var(--space-2) 0 var(--space-1)',
    letterSpacing: 0.5, textTransform: 'uppercase',
  },
  canvasWrap: {
    position: 'relative', background: '#000', overflow: 'hidden',
    borderRadius: 6, flexShrink: 0, cursor: 'crosshair',
    boxShadow: '0 8px 28px rgba(0,0,0,0.28)',
  },
  media: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  dropZone: {
    width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', gap: 12,
  },
  dropIcon: { fontSize: 40, lineHeight: 1 },
  dropText: { color: 'var(--text-secondary)', fontSize: 13, textAlign: 'center', maxWidth: 200, margin: 0 },

  playBtn: {
    position: 'absolute', top: '50%', left: '50%',
    transform: 'translate(-50%, -50%)',
    background: 'rgba(0,0,0,0.55)', border: 'none', borderRadius: '50%',
    width: 56, height: 56, fontSize: 22, color: '#fff', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    transition: 'opacity 0.2s',
    zIndex: 20,
  },

  slideNav: { display: 'flex', gap: 'var(--space-2)', padding: 'var(--space-2) 0' },
  slideDot: { width: 8, height: 8, borderRadius: '50%', border: 'none', cursor: 'pointer' },

  blogPreview: {
    width: '100%', height: '100%', overflowY: 'auto',
    background: '#fff', padding: 16,
  },
  blogText: { fontFamily: 'Georgia, serif', fontSize: 14, lineHeight: 1.8, color: '#222', whiteSpace: 'pre-wrap' },

  newsletterPreview: { width: '100%', height: '100%', background: '#fff' },

  audioPreview: {
    width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', gap: 12,
  },
}
