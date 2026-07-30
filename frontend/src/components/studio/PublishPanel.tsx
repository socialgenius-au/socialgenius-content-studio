import { useState, type CSSProperties } from 'react'
import { useStudio } from '../../contexts/StudioContext'
import { publishApi, processApi } from '../../api/client'
import type { Platform } from '../../types'
import { PLATFORMS } from '../../utils/platforms'

interface PublishLog {
  id: string
  timestamp: string
  platform: string
  status: 'success' | 'error'
  message: string
}

// Frontend transition names don't all match the backend/ffmpeg vocabulary (e.g. fade_black vs fade_to_black).
const TRANSITION_MAP: Record<string, string> = {
  cut: 'cut',
  dissolve: 'dissolve',
  whip_pan: 'whip_pan',
  fade_black: 'fade_to_black',
  zoom_punch: 'zoom_punch',
}

export default function PublishPanel() {
  const { activeBrand, videoClips, imageSlides, textOverlays, audioTracks, seoPackage, activeJob } = useStudio()
  const [logs, setLogs] = useState<PublishLog[]>([])
  const [publishing, setPublishing] = useState<string | null>(null)

  const addLog = (platform: string, status: 'success' | 'error', message: string) => {
    setLogs(prev => [{
      id: crypto.randomUUID(),
      timestamp: new Date().toLocaleTimeString(),
      platform, status, message,
    }, ...prev].slice(0, 20))
  }

  const publishGMB = async () => {
    setPublishing('gmb')
    try {
      await publishApi.gmb({
        brand_id: activeBrand?.id,
        text: seoPackage?.gmbPost ?? 'New post from SocialGenius Content Studio',
        media_url: videoClips[0]?.url ?? imageSlides[0]?.url,
      })
      addLog('Google Business', 'success', 'Post published to GMB')
    } catch (err) {
      addLog('Google Business', 'error', err instanceof Error ? err.message : 'Failed')
    } finally {
      setPublishing(null)
    }
  }

  const publishBeehiiv = async () => {
    setPublishing('beehiiv')
    try {
      await publishApi.beehiiv({
        brand_id: activeBrand?.id,
        subject: 'Newsletter from ' + (activeBrand?.name ?? 'SocialGenius'),
        content: seoPackage?.gmbPost ?? 'Newsletter content',
      })
      addLog('Beehiiv', 'success', 'Draft sent to Beehiiv')
    } catch (err) {
      addLog('Beehiiv', 'error', err instanceof Error ? err.message : 'Failed')
    } finally {
      setPublishing(null)
    }
  }

  const download = (format: string) => {
    const url = videoClips[0]?.url ?? imageSlides[0]?.url
    if (!url) {
      alert('No content to download. Add a video or image first.')
      return
    }
    const a = document.createElement('a')
    a.href = url
    a.download = `export-${format}.mp4`
    a.click()
    addLog(format, 'success', `Downloaded as ${format}`)
  }

  const renderFinal = async () => {
    if (!activeJob) {
      alert('No active job. Start a job first.')
      return
    }
    const assetIds = videoClips.map(c => c.assetId).filter((id): id is number => id != null)
    if (assetIds.length < 2) {
      alert('Need at least 2 uploaded/processed clips to export.')
      return
    }
    const audioTrack = audioTracks.find(t => t.assetId != null)

    setPublishing('render')
    try {
      await processApi.export({
        job_id: activeJob.id,
        asset_ids: assetIds,
        transition: TRANSITION_MAP[videoClips[0].transition] ?? 'dissolve',
        transition_duration: 0.5,
        text_overlays: textOverlays.map(o => ({
          text: o.text,
          start: o.startTime,
          end: o.endTime,
          x: o.x,
          y: o.y,
          font_size: o.fontSize,
          font_color: o.color,
        })),
        audio_asset_id: audioTrack?.assetId,
        audio_mode: audioTrack?.duck ? 'mix' : 'replace',
        audio_original_volume: audioTrack?.duck ? 0.2 : 0,
        audio_volume: audioTrack?.volume ?? 1,
      })
      addLog('Render', 'success', 'Final export started — check job status')
    } catch (err) {
      addLog('Render', 'error', err instanceof Error ? err.message : 'Render failed')
    } finally {
      setPublishing(null)
    }
  }

  const FORMATS: { label: string; value: string; icon: string }[] = [
    { label: '9:16 (Reel/TikTok)', value: '9_16', icon: '📱' },
    { label: '1:1 (Post)', value: '1_1', icon: '📸' },
    { label: '16:9 (YouTube)', value: '16_9', icon: '📺' },
  ]

  return (
    <div style={s.root}>
      {/* Publish to platforms */}
      <div style={s.section}>
        <div style={s.sectionTitle}>Publish</div>
        <button
          style={{ ...s.publishBtn, ...s.gmbBtn, ...(publishing === 'gmb' ? s.disabled : {}) }}
          onClick={publishGMB}
          disabled={publishing !== null}
        >
          {publishing === 'gmb' ? '⏳ Publishing…' : '🏢 Publish to Google Business'}
        </button>
        <button
          style={{ ...s.publishBtn, ...s.beehiivBtn, ...(publishing === 'beehiiv' ? s.disabled : {}) }}
          onClick={publishBeehiiv}
          disabled={publishing !== null}
        >
          {publishing === 'beehiiv' ? '⏳ Sending…' : '📧 Send to Beehiiv'}
        </button>
      </div>

      {/* Render & Download */}
      <div style={s.section}>
        <div style={s.sectionTitle}>Export</div>
        <button
          style={{ ...s.renderBtn, ...(publishing === 'render' ? s.disabled : {}) }}
          onClick={renderFinal}
          disabled={publishing !== null}
        >
          {publishing === 'render' ? '⏳ Rendering…' : '🎬 Render Final (FFmpeg)'}
        </button>

        <div style={s.downloadRow}>
          {FORMATS.map(f => (
            <button
              key={f.value}
              style={s.downloadBtn}
              onClick={() => download(f.value)}
            >
              <span>{f.icon}</span>
              <span style={s.downloadLabel}>{f.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* History log */}
      {logs.length > 0 && (
        <div style={s.section}>
          <div style={s.sectionTitle}>History</div>
          <div style={s.logs}>
            {logs.map(log => (
              <div key={log.id} style={s.logRow}>
                <span style={{ ...s.logStatus, color: log.status === 'success' ? '#2ecc71' : '#e74c3c' }}>
                  {log.status === 'success' ? '✓' : '✕'}
                </span>
                <span style={s.logPlatform}>{log.platform}</span>
                <span style={s.logMsg}>{log.message}</span>
                <span style={s.logTime}>{log.timestamp}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

const s: Record<string, CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', gap: 16 },
  section: {},
  sectionTitle: {
    fontSize: 10, fontWeight: 800, color: '#C89A2E',
    textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8,
  },

  publishBtn: {
    width: '100%', padding: '10px 14px', border: 'none',
    borderRadius: 7, fontSize: 13, fontWeight: 700, cursor: 'pointer',
    marginBottom: 6, textAlign: 'left',
  },
  gmbBtn: { background: '#4285F4', color: '#fff' },
  beehiivBtn: { background: '#FF6B35', color: '#fff' },
  disabled: { opacity: 0.6, cursor: 'not-allowed' },

  renderBtn: {
    width: '100%', padding: '10px 14px', background: '#1E3D2A',
    color: '#C89A2E', border: 'none', borderRadius: 7, fontSize: 13,
    fontWeight: 700, cursor: 'pointer', marginBottom: 8, textAlign: 'left',
  },

  downloadRow: { display: 'flex', flexDirection: 'column', gap: 4 },
  downloadBtn: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
    background: '#fafaf8', border: '1px solid #e8e3d8', borderRadius: 6,
    cursor: 'pointer', fontSize: 12, textAlign: 'left',
  },
  downloadLabel: { flex: 1, color: '#333' },

  logs: { display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 180, overflowY: 'auto' },
  logRow: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, padding: '3px 0' },
  logStatus: { fontWeight: 800, width: 14, flexShrink: 0 },
  logPlatform: { fontWeight: 700, color: '#1E3D2A', flexShrink: 0 },
  logMsg: { flex: 1, color: '#555', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  logTime: { color: '#aaa', flexShrink: 0 },
}
