import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { StudioProvider, useStudio } from '../../contexts/StudioContext'
import './video-editor-theme.css'
import TopBar from './TopBar'
import IconRail from './IconRail'
import ToolPanel from './ToolPanel'
import PreviewCanvas from './PreviewCanvas'
import PropertiesPanel from './PropertiesPanel'
import PropertiesRail, { type RightRailTab } from './PropertiesRail'
import { TimelineTransport, TimelineToolbar, TimelineTracks } from './Timeline'
import StatusBar from './StatusBar'
import ChatBar from './ChatBar'
import ContentTypeSwitcher from './ContentTypeSwitcher'
import type { VideoClip, TextOverlay, AudioTrack, MediaOverlay } from '../../types'

// Dev-only demo state (spec section 17) — seeds the timeline once, only in development builds,
// and only if nothing real has been loaded yet, purely so the rebuilt shell has something to
// show for visual approval. Uses only StudioContext's already-existing add*/setTimeline setters;
// nothing about the context itself changes.
function useDemoSeed() {
  const {
    videoClips, addVideoClip, addTextOverlay, addAudioTrack, addMediaOverlay, setTimeline,
  } = useStudio()
  // A ref (not the videoClips.length check alone) guards against StrictMode's dev-only
  // double-invocation of effects — two back-to-back invocations both see the same stale
  // "empty" closure before the first one's state update has re-rendered, so the length check
  // alone would silently seed everything twice, stacked exactly on top of itself.
  const seededRef = useRef(false)

  useEffect(() => {
    if (!import.meta.env.DEV) return
    if (seededRef.current || videoClips.length > 0) return
    seededRef.current = true

    const clip = (name: string, startTime: number, endTime: number): VideoClip => ({
      id: crypto.randomUUID(), url: '', name, duration: endTime - startTime,
      startTime, endTime, trimIn: 0, trimOut: 0, colorGrade: 'none', speed: 1,
      brightness: 0, contrast: 0, saturation: 0, transition: 'cut', transitionDuration: 0.5,
    })
    addVideoClip(clip('Beach Drone.mp4', 0, 6))
    addVideoClip(clip('Surfing.mp4', 6, 12))
    addVideoClip(clip('Palm Trees.mp4', 12, 18))

    const audio: AudioTrack = {
      id: crypto.randomUUID(), url: '', name: 'Summer Vibes.mp3', volume: 0.8,
      startTime: 0, endTime: 18, trimIn: 0, trimOut: 0, fadeIn: 1, fadeOut: 1, duck: true,
    }
    addAudioTrack(audio)

    const textBase = {
      width: 60, fontFamily: 'Inter', bold: true, italic: false,
      color: '#F4F7F5', bgColor: 'transparent', bgOpacity: 0, animation: 'fade_in' as const,
    }
    const text1: TextOverlay = { id: crypto.randomUUID(), text: 'ENJOY THE MOMENT', x: 20, y: 15, startTime: 0, endTime: 4, fontSize: 56, ...textBase }
    const text2: TextOverlay = { id: crypto.randomUUID(), text: 'Live Your Life', x: 20, y: 80, startTime: 10, endTime: 14, fontSize: 40, ...textBase }
    addTextOverlay(text1)
    addTextOverlay(text2)

    const overlay: MediaOverlay = {
      id: crypto.randomUUID(), url: '', assetId: 0, x: 65, y: 8, width: 28, height: 18,
      opacity: 0.9, startTime: 2, endTime: 8,
    }
    addMediaOverlay(overlay)

    setTimeline({ duration: 18, currentTime: 4.25 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}

function StudioLayout() {
  const { contentType } = useStudio()
  // Shared with PreviewCanvas (which owns the <video> element) so the docked
  // Timeline below can seek/read it despite no longer being nested inside it.
  const videoRef = useRef<HTMLVideoElement>(null)

  const [rightPanelOpen, setRightPanelOpen] = useState(true)
  const [rightRailTab, setRightRailTab] = useState<RightRailTab>('properties')
  const [zoom, setZoom] = useState(1)

  useDemoSeed()

  // Below the "one side panel may default collapse" breakpoint (spec section 19), start with
  // the right panel closed so the timeline/preview keep usable room. Left panel is left as-is
  // since it's already closed by default (activeRailTool starts on 'video', which the user can
  // toggle) — this only sets an initial default, it never fights a later manual toggle.
  useEffect(() => {
    if (window.innerWidth <= 1366) setRightPanelOpen(false)
  }, [])

  // Inject typing animation CSS
  useEffect(() => {
    const id = 'studio-anim'
    if (document.getElementById(id)) return
    const style = document.createElement('style')
    style.id = id
    style.textContent = `
      @keyframes bounce {
        0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
        40% { transform: translateY(-6px); opacity: 1; }
      }
      .studio-typing-dot { animation: bounce 1.2s infinite; }
      .studio-typing-dot:nth-child(2) { animation-delay: 0.2s; }
      .studio-typing-dot:nth-child(3) { animation-delay: 0.4s; }
    `
    document.head.appendChild(style)
    return () => { document.getElementById(id)?.remove() }
  }, [])

  const showTimeline = contentType === 'video' || contentType === 'audio'

  return (
    <div className="sg-video-editor" style={s.root}>
      <TopBar />

      {/* Content type switcher — kept from the existing app (switches the whole Studio between
          video/image/carousel/audio/blog/newsletter editing modes); restyled to sit quietly
          under the new dark header rather than removed, since it's existing working capability
          outside the pixel spec's scope. */}
      <ContentTypeSwitcher />

      {/* Left tool rail | left media panel | large preview + playback bar | right properties panel | right tool rail */}
      <div style={s.workspace}>
        <IconRail />
        <ToolPanel />
        <div style={s.centerColumn}>
          <PreviewCanvas videoRef={videoRef} />
          {showTimeline && <TimelineTransport videoRef={videoRef} />}
        </div>
        {rightRailTab === 'properties' ? (
          <PropertiesPanel collapsed={!rightPanelOpen} />
        ) : (
          <PlaceholderRightPanel collapsed={!rightPanelOpen} tab={rightRailTab} />
        )}
        <PropertiesRail
          active={rightRailTab}
          onChange={tab => {
            if (tab === rightRailTab) { setRightPanelOpen(v => !v); return }
            setRightRailTab(tab)
            setRightPanelOpen(true)
          }}
        />
      </div>

      {/* Timeline (toolbar + full-width time ruler + V1/V2/A1/T1/O1 tracks) docked beside the
          permanent AI Assistant panel (spec section 8) — both share the same row height. */}
      <div style={s.bottomRow}>
        {showTimeline && (
          <div className="sgv-timeline-area" style={s.timelineArea}>
            <TimelineToolbar zoom={zoom} onZoomChange={setZoom} />
            <TimelineTracks videoRef={videoRef} zoom={zoom} />
          </div>
        )}
        <ChatBar />
      </div>

      <StatusBar />
    </div>
  )
}

function PlaceholderRightPanel({ collapsed, tab }: {
  collapsed: boolean; tab: RightRailTab
}) {
  const LABELS: Record<RightRailTab, string> = {
    properties: 'Properties', audio: 'Audio', speed: 'Speed', transitions: 'Transitions',
    filters: 'Filters', adjust: 'Adjust', ai: 'AI Tools',
  }
  return (
    <aside className="sgv-right-panel sgv-collapsible" data-collapsed={collapsed} style={s.placeholderPanel}>
      <div style={s.placeholderHeader}>
        <span style={s.placeholderTitle}>{LABELS[tab]}</span>
      </div>
      <div style={s.placeholderBody}>
        <p style={s.placeholderText}>This panel is coming in a future pass.</p>
      </div>
    </aside>
  )
}

export default function StudioPage() {
  return (
    <StudioProvider>
      <StudioLayout />
    </StudioProvider>
  )
}

const s: Record<string, CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
  },
  workspace: {
    flex: 1,
    display: 'flex',
    overflow: 'hidden',
    minHeight: 0,
  },
  centerColumn: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    minWidth: 520,
    minHeight: 0,
  },
  bottomRow: {
    display: 'flex',
    flexDirection: 'row',
    flexShrink: 0,
  },
  timelineArea: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--sg-bg-2)',
  },
  placeholderPanel: {
    background: 'var(--panel-bg)', borderLeft: '1px solid var(--border)',
    display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0,
  },
  placeholderHeader: { height: 44, display: 'flex', alignItems: 'center', padding: '0 18px', borderBottom: '1px solid var(--border)' },
  placeholderTitle: { fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' },
  placeholderBody: { flex: 1, padding: 18 },
  placeholderText: { fontSize: 13, color: 'var(--text-tertiary)', lineHeight: 1.6 },
}
