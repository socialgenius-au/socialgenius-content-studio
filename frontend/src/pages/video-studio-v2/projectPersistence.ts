// The editor's browser-local working copy of the open project (VideoStudioV2.tsx writes it on every change and restores it once on mount, so a refresh does not lose work).
// Pure, so every shape of stored data -- including copies written by older versions -- can be tested without a browser.
//
// The first version kept clips, text, pictures, audio, assets, canvas format, timeline and item positions. It did NOT keep shapes, lower thirds, subtitles, B-roll inserts or the
// subtitle style, so a refresh dropped them from the working project. Those five are stored too now; each is OPTIONAL, so a copy written before this change restores exactly as it did.
// This never touches a saved draft or which draft is open: it is only the local working copy.
import type { Asset, AudioTrack, LowerThird, MediaOverlay, Shape, SubtitleSegment, SubtitleStyle, TextOverlay, VideoClip } from '../../types'
import type { CanvasFormatState, CanvasItemPosition } from '../../contexts/StudioContext'

export const PROJECT_STORAGE_KEY = 'sg-video-studio-v2-project'

export interface PersistedProject {
  videoClips: VideoClip[]
  textOverlays: TextOverlay[]
  mediaOverlays: MediaOverlay[]
  audioTracks: AudioTrack[]
  mediaAssets: Asset[]
  canvasFormat: CanvasFormatState
  timeline: unknown
  canvasItemPositions: Record<string, CanvasItemPosition>
  // added later: absent in older copies
  shapes?: Shape[]
  lowerThirds?: LowerThird[]
  subtitles?: SubtitleSegment[]
  additionalVideoClips?: VideoClip[]
  subtitleStyle?: SubtitleStyle
}

const LIST_KEYS = ['videoClips', 'textOverlays', 'mediaOverlays', 'audioTracks', 'mediaAssets', 'shapes', 'lowerThirds', 'subtitles', 'additionalVideoClips'] as const

/** Parse a stored copy. Anything unusable (not JSON, not an object) is "no copy". A list field that is not an array is dropped, so one bad field never blocks the rest. */
export function parsePersistedProject(raw: string | null): Partial<PersistedProject> | null {
  if (!raw) return null
  let value: unknown
  try { value = JSON.parse(raw) } catch { return null }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const saved = { ...(value as Record<string, unknown>) }
  for (const k of LIST_KEYS) if (k in saved && !Array.isArray(saved[k])) delete saved[k]
  if ('subtitleStyle' in saved && (!saved.subtitleStyle || typeof saved.subtitleStyle !== 'object' || Array.isArray(saved.subtitleStyle))) delete saved.subtitleStyle
  if ('canvasItemPositions' in saved && (!saved.canvasItemPositions || typeof saved.canvasItemPositions !== 'object' || Array.isArray(saved.canvasItemPositions))) delete saved.canvasItemPositions
  return saved as Partial<PersistedProject>
}
