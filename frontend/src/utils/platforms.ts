import type { Platform, PlatformSpec } from '../types'

export const PLATFORMS: Record<Platform, PlatformSpec> = {
  instagram_post:    { label: 'Instagram Post',    width: 1080, height: 1080, aspectRatio: '1/1',     safeZoneTop: 0,   safeZoneBottom: 0   },
  instagram_reel:   { label: 'Instagram Reel',    width: 1080, height: 1920, aspectRatio: '9/16',    safeZoneTop: 0.1, safeZoneBottom: 0.2  },
  instagram_story:  { label: 'Instagram Story',   width: 1080, height: 1920, aspectRatio: '9/16',    safeZoneTop: 0.1, safeZoneBottom: 0.15 },
  tiktok:           { label: 'TikTok',             width: 1080, height: 1920, aspectRatio: '9/16',    safeZoneTop: 0.1, safeZoneBottom: 0.25 },
  youtube_short:    { label: 'YouTube Short',      width: 1080, height: 1920, aspectRatio: '9/16',    safeZoneTop: 0.05, safeZoneBottom: 0.15 },
  youtube_16_9:     { label: 'YouTube 16:9',       width: 1920, height: 1080, aspectRatio: '16/9',    safeZoneTop: 0,   safeZoneBottom: 0.05 },
  facebook_post:    { label: 'Facebook Post',      width: 1200, height: 630,  aspectRatio: '1.91/1',  safeZoneTop: 0,   safeZoneBottom: 0   },
  facebook_reel:    { label: 'Facebook Reel',      width: 1080, height: 1920, aspectRatio: '9/16',    safeZoneTop: 0.1, safeZoneBottom: 0.2  },
  linkedin_post:    { label: 'LinkedIn Post',      width: 1200, height: 627,  aspectRatio: '1.91/1',  safeZoneTop: 0,   safeZoneBottom: 0   },
  pinterest:        { label: 'Pinterest',          width: 1000, height: 1500, aspectRatio: '2/3',     safeZoneTop: 0,   safeZoneBottom: 0.1  },
  twitter_x:        { label: 'Twitter / X',        width: 1200, height: 675,  aspectRatio: '16/9',    safeZoneTop: 0,   safeZoneBottom: 0   },
}

export function getCanvasSize(platform: Platform, maxWidth: number, maxHeight: number) {
  const spec = PLATFORMS[platform]
  const ratio = spec.width / spec.height

  let w = maxWidth
  let h = w / ratio

  if (h > maxHeight) {
    h = maxHeight
    w = h * ratio
  }

  return { w: Math.floor(w), h: Math.floor(h) }
}

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  const cs = Math.floor((seconds % 1) * 100)
  return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}

export function parseTime(str: string): number {
  const parts = str.split(':')
  if (parts.length === 2) {
    const [m, s] = parts
    return parseInt(m) * 60 + parseFloat(s)
  }
  return parseFloat(str)
}
