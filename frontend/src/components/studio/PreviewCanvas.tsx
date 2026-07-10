import {
  useRef, useEffect, useState, useCallback,
  type CSSProperties, type DragEvent,
} from 'react'
import { useStudio } from '../../contexts/StudioContext'
import { getCanvasSize, PLATFORMS } from '../../utils/platforms'
import Timeline from './Timeline'
import { uploadApi, assetsApi } from '../../api/client'
import type { Asset, VideoClip, ImageSlide } from '../../types'

export default function PreviewCanvas() {
  const {
    platform, contentType, previewUrl, previewHtml, previewText,
    videoClips, imageSlides, textOverlays,
    timeline, setTimeline,
    addVideoClip, addImageSlide,
    uploadAsset, activeJob,
    activeBrand,
  } = useStudio()

  const containerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [canvasSize, setCanvasSize] = useState({ w: 360, h: 640 })
  const [draggingOver, setDraggingOver] = useState(false)
  const [activeSlide, setActiveSlide] = useState(0)
  const [safeZone, setSafeZone] = useState(false)

  // Calculate canvas size from container
  useEffect(() => {
    const update = () => {
      if (!containerRef.current) return
      const { width, height } = containerRef.current.getBoundingClientRect()
      const size = getCanvasSize(platform, width - 32, height - 100)
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
        const url = assetsApi.downloadUrl(asset.id)
        if (file.type.startsWith('video/')) {
          const clip: VideoClip = {
            id: String(Date.now()),
            assetId: asset.id,
            url,
            name: file.name,
            duration: 0,
            startTime: videoClips.reduce((a, c) => Math.max(a, c.endTime), 0),
            endTime: videoClips.reduce((a, c) => Math.max(a, c.endTime), 0) + 30,
            trimIn: 0, trimOut: 0,
            colorGrade: 'none', speed: 1,
            brightness: 0, contrast: 0, saturation: 0,
            transition: 'cut',
          }
          addVideoClip(clip)
        } else if (file.type.startsWith('image/')) {
          const slide: ImageSlide = {
            id: String(Date.now()),
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
    <div ref={containerRef} style={s.root}>
      {/* Platform label */}
      <div style={s.platformLabel}>{spec.label} · {spec.width}×{spec.height}</div>

      {/* Canvas area */}
      <div
        style={{
          ...s.canvasWrap,
          width: canvasSize.w,
          height: canvasSize.h,
          outline: draggingOver ? '3px dashed #C89A2E' : '2px solid #333',
        }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Safe zone overlay */}
        {safeZone && (
          <>
            <div style={{
              ...s.safeZone, top: 0, height: `${spec.safeZoneTop * 100}%`,
              background: 'rgba(255,0,0,0.1)', borderBottom: '1px dashed rgba(255,0,0,0.5)',
            }} />
            <div style={{
              ...s.safeZone, bottom: 0, height: `${spec.safeZoneBottom * 100}%`,
              background: 'rgba(255,0,0,0.1)', borderTop: '1px dashed rgba(255,0,0,0.5)',
            }} />
          </>
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

        {/* Empty video state */}
        {contentType === 'video' && !currentVideoUrl && (
          <div style={s.dropZone}>
            <span style={s.dropIcon}>🎬</span>
            <p style={s.dropText}>Drop a video file here or use the chat below</p>
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
        {textOverlays.map(o => (
          <div
            key={o.id}
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
            }}
          >
            {o.text}
          </div>
        ))}

        {/* Play button overlay for video */}
        {contentType === 'video' && currentVideoUrl && (
          <button
            style={{
              ...s.playBtn,
              opacity: timeline.playing ? 0 : 0.85,
            }}
            onClick={togglePlay}
          >
            {timeline.playing ? '⏸' : '▶'}
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

      {/* Safe zone toggle */}
      <div style={s.canvasToolbar}>
        <button
          style={{ ...s.toolbarBtn, ...(safeZone ? s.toolbarBtnActive : {}) }}
          onClick={() => setSafeZone(v => !v)}
        >
          Safe Zones
        </button>
      </div>

      {/* Timeline */}
      {(contentType === 'video' || contentType === 'audio') && (
        <Timeline videoRef={videoRef} />
      )}
    </div>
  )
}

const s: Record<string, CSSProperties> = {
  root: {
    width: '60vw', display: 'flex', flexDirection: 'column', alignItems: 'center',
    background: '#111', overflow: 'hidden', position: 'relative', minWidth: 0,
  },
  platformLabel: {
    color: '#888', fontSize: 11, fontWeight: 600, padding: '6px 0 4px',
    letterSpacing: 0.5, textTransform: 'uppercase',
  },
  canvasWrap: {
    position: 'relative', background: '#000', overflow: 'hidden',
    borderRadius: 4, flexShrink: 0, cursor: 'crosshair',
  },
  media: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  dropZone: {
    width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', gap: 12,
  },
  dropIcon: { fontSize: 40, lineHeight: 1 },
  dropText: { color: '#666', fontSize: 13, textAlign: 'center', maxWidth: 200, margin: 0 },

  safeZone: { position: 'absolute', left: 0, right: 0, zIndex: 10, pointerEvents: 'none' },

  playBtn: {
    position: 'absolute', top: '50%', left: '50%',
    transform: 'translate(-50%, -50%)',
    background: 'rgba(0,0,0,0.55)', border: 'none', borderRadius: '50%',
    width: 56, height: 56, fontSize: 22, color: '#fff', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    transition: 'opacity 0.2s',
    zIndex: 20,
  },

  slideNav: { display: 'flex', gap: 6, padding: '6px 0' },
  slideDot: { width: 8, height: 8, borderRadius: '50%', border: 'none', cursor: 'pointer' },

  canvasToolbar: { display: 'flex', gap: 8, padding: '6px 0' },
  toolbarBtn: {
    background: '#333', border: '1px solid #555', color: '#ccc',
    padding: '3px 10px', borderRadius: 4, fontSize: 11, cursor: 'pointer',
  },
  toolbarBtnActive: { background: '#1E3D2A', color: '#C89A2E', borderColor: '#C89A2E' },

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
