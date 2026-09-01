import type { VideoClip } from '../../types'

// Which V1 clip (if any) covers a given playhead time. Clips aren't necessarily stored in
// chronological order (dragging a clip's body can move its startTime past another's), so this
// checks ranges rather than assuming array order — and freezes on the chronologically last
// clip once the playhead reaches/passes the end of everything, same as a single video would.
// Shared by the legacy /studio PreviewCanvas and the Video Studio V2 Create/Edit preview so
// both drive off the identical, already-verified logic rather than two drifting copies.
export function findActiveClip(clips: VideoClip[], time: number): VideoClip | null {
  const hit = clips.find(c => time >= c.startTime && time < c.endTime)
  if (hit) return hit
  if (clips.length === 0) return null
  const last = clips.reduce((a, c) => (c.endTime > a.endTime ? c : a))
  return time >= last.endTime ? last : null
}

// Reads real duration off an uploaded video file (no server-provided metadata exists yet) by
// loading it into an offscreen <video> and waiting for its metadata to become available. Falls
// back to a placeholder if the file can't be probed in time.
export function probeVideoDuration(url: string, fallbackSeconds = 10): Promise<number> {
  return new Promise(resolve => {
    const vid = document.createElement('video')
    let settled = false
    const finish = (d: number) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      vid.removeAttribute('src')
      resolve(d)
    }
    const timer = setTimeout(() => finish(fallbackSeconds), 4000)
    vid.preload = 'metadata'
    vid.onloadedmetadata = () => finish(Number.isFinite(vid.duration) && vid.duration > 0 ? vid.duration : fallbackSeconds)
    vid.onerror = () => finish(fallbackSeconds)
    vid.src = url
  })
}

// Instruction 12: does an uploaded video file carry an embedded audio stream? Same lightweight
// offscreen-<video> + 'loadedmetadata' pattern as probeVideoDuration above (a separate probe,
// not folded into it, so probeVideoDuration's existing callers/behaviour stay untouched) —
// HTMLMediaElement.captureStream() is a standard, already-available browser API (this project
// already uses it elsewhere for canvas recording); MediaStream.getAudioTracks() reports the
// real decoded tracks, so this reflects the source file's actual content, not a guess from its
// container/MIME type. (HTMLMediaElement.audioTracks — the other candidate API for this — is
// NOT implemented in this Chromium build, confirmed by direct test, hence captureStream here
// instead.) If it can't be determined in time, resolves false — a video is never assumed to
// have audio it wasn't confirmed to have, so a silent video never gets a fabricated Audio clip.
export function probeHasAudioTrack(url: string): Promise<boolean> {
  return new Promise(resolve => {
    const vid = document.createElement('video')
    let settled = false
    const finish = (has: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      vid.removeAttribute('src')
      resolve(has)
    }
    const timer = setTimeout(() => finish(false), 4000)
    vid.preload = 'metadata'
    vid.muted = true
    vid.onloadedmetadata = () => {
      try {
        // captureStream() isn't in the standard DOM typings this project's tsconfig uses,
        // though it's a real, already-supported method (this project already relies on the
        // same API on <canvas> elsewhere, for recording) — cast narrowly just for this call.
        const captureStream = (vid as unknown as { captureStream: () => MediaStream }).captureStream
        const stream = captureStream.call(vid)
        finish(stream.getAudioTracks().length > 0)
      } catch {
        finish(false)
      }
    }
    vid.onerror = () => finish(false)
    vid.src = url
  })
}
