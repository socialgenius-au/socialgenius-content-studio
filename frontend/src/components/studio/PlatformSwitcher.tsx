import { type CSSProperties } from 'react'
import { useStudio } from '../../contexts/StudioContext'
import { PLATFORMS } from '../../utils/platforms'
import type { Platform } from '../../types'

const PLATFORM_ICONS: Record<Platform, string> = {
  instagram_post: '📸',
  instagram_reel: '🎬',
  instagram_story: '📱',
  tiktok: '🎵',
  youtube_short: '▶️',
  youtube_16_9: '📺',
  facebook_post: '👥',
  facebook_reel: '🎭',
  linkedin_post: '💼',
  pinterest: '📌',
  twitter_x: '🐦',
}

const PLATFORM_GROUPS: { label: string; platforms: Platform[] }[] = [
  { label: 'Instagram', platforms: ['instagram_post', 'instagram_reel', 'instagram_story'] },
  { label: 'Short Video', platforms: ['tiktok', 'youtube_short', 'facebook_reel'] },
  { label: 'YouTube', platforms: ['youtube_16_9'] },
  { label: 'Social', platforms: ['facebook_post', 'linkedin_post', 'twitter_x', 'pinterest'] },
]

export default function PlatformSwitcher() {
  const { platform, setPlatform } = useStudio()
  const spec = PLATFORMS[platform]

  return (
    <div style={s.root}>
      <div style={s.currentPlatform}>
        <span style={s.currentIcon}>{PLATFORM_ICONS[platform]}</span>
        <div style={s.currentInfo}>
          <span style={s.currentName}>{spec.label}</span>
          <span style={s.currentSize}>{spec.width}×{spec.height} · {spec.aspectRatio}</span>
        </div>
      </div>

      {PLATFORM_GROUPS.map(group => (
        <div key={group.label} style={s.group}>
          <div style={s.groupLabel}>{group.label}</div>
          <div style={s.groupPlatforms}>
            {group.platforms.map(p => {
              const s2 = PLATFORMS[p]
              const active = p === platform
              return (
                <button
                  key={p}
                  style={{ ...s.platformBtn, ...(active ? s.platformBtnActive : {}) }}
                  onClick={() => setPlatform(p)}
                  title={`${s2.label} (${s2.width}×${s2.height})`}
                >
                  <span style={s.platformIcon}>{PLATFORM_ICONS[p]}</span>
                  <span style={s.platformLabel}>{s2.label.replace(/^(Instagram|Facebook|YouTube) /, '')}</span>
                  <span style={s.platformSize}>{s2.aspectRatio}</span>
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

const s: Record<string, CSSProperties> = {
  root: {},
  currentPlatform: {
    display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0',
    borderBottom: '1px solid #e8e3d8', marginBottom: 10,
  },
  currentIcon: { fontSize: 24 },
  currentInfo: { display: 'flex', flexDirection: 'column', gap: 1 },
  currentName: { fontSize: 13, fontWeight: 700, color: '#1E3D2A' },
  currentSize: { fontSize: 11, color: '#888', fontFamily: 'monospace' },

  group: { marginBottom: 10 },
  groupLabel: { fontSize: 10, fontWeight: 800, color: '#C89A2E', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 5 },
  groupPlatforms: { display: 'flex', flexDirection: 'column', gap: 3 },
  platformBtn: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
    background: '#fafaf8', border: '1px solid #e8e3d8', borderRadius: 6,
    cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s',
  },
  platformBtnActive: { background: '#1E3D2A', borderColor: '#1E3D2A' },
  platformIcon: { fontSize: 14, width: 20, textAlign: 'center' },
  platformLabel: {
    flex: 1, fontSize: 12, fontWeight: 600,
    color: 'inherit',
  },
  platformSize: { fontSize: 10, color: '#aaa', fontFamily: 'monospace' },
}
