// Carousel Creator - background music for animated exports. One track per carousel, taken from the user's media library (MP3, WAV, M4A or AAC). The server mixes it into the MP4 with the
// existing FFmpeg; a GIF is always silent. These pure helpers describe WHICH part of the music is heard WHEN, so the preview (which plays the file in the browser) and the export agree.
import type { AudioTrack } from '../postDocument'

export const AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', 'aac'] as const
export const AUDIO_ACCEPT = '.mp3,.wav,.m4a,.aac,audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/aac,audio/x-m4a'
export const MAX_AUDIO_BYTES = 100 * 1024 * 1024

export function validateAudioFile(f: { name: string; size: number }): string | null {
  const ext = f.name.includes('.') ? f.name.split('.').pop()!.toLowerCase() : ''
  if (!(AUDIO_EXTENSIONS as readonly string[]).includes(ext)) return `"${f.name}" is not an MP3, WAV, M4A or AAC audio file.`
  if (f.size === 0) return `"${f.name}" is empty.`
  if (f.size > MAX_AUDIO_BYTES) return `"${f.name}" is larger than ${MAX_AUDIO_BYTES / 1024 / 1024} MB. Use a shorter or compressed file.`
  return null
}

export function newTrack(asset: { assetId: number; url: string; name: string }, sourceMs: number): AudioTrack {
  return { assetId: asset.assetId, url: asset.url, name: asset.name, sourceMs: Math.max(0, Math.round(sourceMs)), trimStartMs: 0, trimEndMs: 0, offsetMs: 0, volume: 1, fadeInMs: 0, fadeOutMs: 0, muted: false }
}

/** Replaces the file but keeps the person's levels and fades (the trim is reset: it belonged to the old file). */
export function replaceTrackFile(old: AudioTrack, asset: { assetId: number; url: string; name: string }, sourceMs: number): AudioTrack {
  return { ...newTrack(asset, sourceMs), volume: old.volume, fadeInMs: old.fadeInMs, fadeOutMs: old.fadeOutMs, offsetMs: old.offsetMs, muted: old.muted }
}

export interface AudibleWindow {
  /** Timeline times the music is heard between. */
  startMs: number
  endMs: number
  /** Where in the file it starts playing. */
  sourceStartMs: number
}

/** The part of the timeline (0..totalMs) where the music is heard, or null if none. */
export function audibleWindow(t: AudioTrack, totalMs: number): AudibleWindow | null {
  const end = t.trimEndMs > 0 ? t.trimEndMs : t.sourceMs
  const length = Math.max(0, end - t.trimStartMs)
  const startMs = t.offsetMs
  const endMs = Math.min(totalMs, startMs + length)
  return endMs > startMs && !t.muted ? { startMs, endMs, sourceStartMs: t.trimStartMs } : null
}

/** The volume (0..2) at timeline time `tMs`, including the fade-in and fade-out measured on the part that is actually heard. 0 outside the window. */
export function volumeAt(t: AudioTrack, tMs: number, totalMs: number): number {
  const w = audibleWindow(t, totalMs)
  if (!w || tMs < w.startMs || tMs > w.endMs) return 0
  const heard = w.endMs - w.startMs
  const fi = Math.min(t.fadeInMs, heard), fo = Math.min(t.fadeOutMs, heard)
  let g = 1
  if (fi > 0 && tMs - w.startMs < fi) g = Math.min(g, (tMs - w.startMs) / fi)
  if (fo > 0 && w.endMs - tMs < fo) g = Math.min(g, (w.endMs - tMs) / fo)
  return t.volume * Math.max(0, Math.min(1, g))
}

/** Where in the file to be at timeline time `tMs`. */
export const sourceTimeAt = (t: AudioTrack, tMs: number): number => (t.trimStartMs + (tMs - t.offsetMs)) / 1000

/** The settings the server needs (snake_case, milliseconds). Null for a muted or absent track, so nothing is sent. */
export function trackToSpec(t: AudioTrack | undefined): { asset_id: number; trim_start_ms: number; trim_end_ms: number; offset_ms: number; volume: number; fade_in_ms: number; fade_out_ms: number } | null {
  if (!t || t.muted) return null
  return { asset_id: t.assetId, trim_start_ms: Math.round(t.trimStartMs), trim_end_ms: Math.round(t.trimEndMs), offset_ms: Math.round(t.offsetMs), volume: t.volume, fade_in_ms: Math.round(t.fadeInMs), fade_out_ms: Math.round(t.fadeOutMs) }
}

/** Keeps edited values consistent: the trim stays inside the file and in order, and fades never exceed what is heard. */
export function normalizeTrack(t: AudioTrack): AudioTrack {
  const src = t.sourceMs
  const trimStart = Math.max(0, Math.min(t.trimStartMs, Math.max(0, src - 100)))
  let trimEnd = t.trimEndMs <= 0 ? 0 : Math.min(src, Math.max(t.trimEndMs, trimStart + 100))
  if (trimEnd >= src) trimEnd = 0
  return { ...t, trimStartMs: Math.round(trimStart), trimEndMs: Math.round(trimEnd), offsetMs: Math.max(0, Math.round(t.offsetMs)), volume: Math.max(0, Math.min(2, t.volume)), fadeInMs: Math.max(0, Math.round(t.fadeInMs)), fadeOutMs: Math.max(0, Math.round(t.fadeOutMs)) }
}

/** Reads a file's length by letting the browser load its metadata. Resolves 0 if it cannot be read. */
export function probeAudioDuration(url: string, make: () => { src: string; preload: string; duration: number; addEventListener: (e: string, f: () => void) => void; load: () => void } = () => new Audio() as never): Promise<number> {
  return new Promise(resolve => {
    try {
      const a = make()
      const done = (ms: number) => resolve(Number.isFinite(ms) ? Math.round(ms) : 0)
      a.preload = 'metadata'
      a.addEventListener('loadedmetadata', () => done(a.duration * 1000))
      a.addEventListener('error', () => done(0))
      a.src = url
      a.load()
      setTimeout(() => done(0), 15000)
    } catch { resolve(0) }
  })
}
