import type { VideoClip } from '../../types'

// Step 7 defect fix (Video 1 base visual missing at a clip's exact boundary): a clip's own
// startTime/endTime are the accumulated result of pixel-based drag/trim/split math (see
// beginClipDrag and friends) — dragging a clip and letting it settle back near an edge does
// not reliably land on a perfectly clean value; it can end up a few femto/pico-seconds off
// zero (e.g. 1.4e-13 instead of 0). This function's own boundary check used to be a hard
// `time >= c.startTime`, so a playhead sitting at an exact, clean 0 (from pausing/seeking to
// the very start) would MISS a clip whose stored startTime is a hair above that — no clip
// matched, hasRealSrc fell back to false, and the mock placeholder rendered underneath the
// still-correctly-rendered small overlay (which has no dependency on activeVideoClip at all).
// Reproduced and confirmed exactly this way: paused at 0:00, Video 1 not visible, O1 overlay
// still showing correctly on top of the placeholder. CLIP_BOUNDARY_EPSILON (matching this
// codebase's own existing RIPPLE_EPSILON convention for the same class of float-drift problem)
// tolerates that drift on the START of a clip's range only — see the deliberate asymmetry
// below for why the END must stay a hard, un-widened bound.
const CLIP_BOUNDARY_EPSILON = 1e-6

// Which V1 clip (if any) covers a given playhead time. Clips aren't necessarily stored in
// chronological order (dragging a clip's body can move its startTime past another's), so this
// checks ranges rather than assuming array order — and freezes on the chronologically last
// clip once the playhead reaches/passes the end of everything, same as a single video would.
// Shared by the legacy /studio PreviewCanvas and the Video Studio V2 Create/Edit preview so
// both drive off the identical, already-verified logic rather than two drifting copies.
//
// Manual Test 7.2 fix (continuous Video 1 -> Video 2 handoff): the END of a clip's range
// deliberately does NOT get the same epsilon widening as the START. Two back-to-back clips
// (the overwhelmingly common case — clip2.startTime is literally set to clip1.endTime by
// handleDrop/split) share one exact boundary value. Widening BOTH edges — as an earlier
// version of this function did — makes that shared instant match TWO clips at once
// (clip1: time < clip1.endTime + EPSILON is still true; clip2: time >= clip2.startTime -
// EPSILON is also true), and .find() returns whichever clip sits first in the array — which,
// for two clips added in timeline order, is always clip1, the one that just ended. Reproduced
// directly: playing through a real two-clip timeline, timeline.currentTime correctly reaches
// the boundary and keeps advancing (so audio, which only follows currentTime, plays on
// uninterrupted), but activeVideoClip stayed clip1 — so the <video> element's src never
// repointed at clip2, exactly matching "audio continues, Video 2 visual never starts".
// Keeping the epsilon on the START only still fixes the original 0:00 defect (a clip whose
// stored startTime drifted a hair above a clean 0) without ever letting a clip's END outlive
// its own boundary into the next clip's territory.
export function findActiveClip(clips: VideoClip[], time: number): VideoClip | null {
  const hit = clips.find(c => time >= c.startTime - CLIP_BOUNDARY_EPSILON && time < c.endTime)
  if (hit) return hit
  if (clips.length === 0) return null
  const last = clips.reduce((a, c) => (c.endTime > a.endTime ? c : a))
  return time >= last.endTime - CLIP_BOUNDARY_EPSILON ? last : null
}

// Video Editor Playback Regression defect fix (found via Sameena's Stage-4 manual test): a
// clip's endTime/trimIn/trimOut together define its own already-trimmed, valid source range —
// changing `speed` alone (the only thing the Properties panel's Speed control used to write)
// leaves endTime fixed at whatever timeline duration was correct under the PREVIOUS speed, so
// the offset formula (trimIn + elapsed*speed, in CreateEditTab's own sync effect) ends up
// asking for source positions well past the footage this clip's own trim boundary said it
// should ever show — playing material the user had deliberately trimmed away. This computes the
// new endTime a speed change requires to keep exactly the same trimmed source range (never
// touched here) mapped onto a (shorter/longer) timeline span at the new speed — extracted as its
// own pure, exported function so this exact fix is independently unit-testable, not just
// exercised indirectly through the UI.
export function computeEndTimeForSpeed(clip: Pick<VideoClip, 'startTime' | 'duration' | 'trimIn' | 'trimOut'>, newSpeed: number): number {
  const sourceSpan = Math.max(0.01, clip.duration - clip.trimIn - clip.trimOut);
  return clip.startTime + sourceSpan / newSpeed;
}

// Phase 1 (V2 Inserts/B-roll): trim-left/trim-right clamp math for a V2 insert clip — identical
// rules to V1's own trimVideoLeft/trimVideoRight in CreateEditTab.tsx (can never reveal source
// material earlier/later than the file actually has via minStart/maxEnd; can never trim a clip
// down to less than minClipDuration), extracted here as pure, independently-testable functions
// — same "extract the fix so it's unit-testable, not just exercised through the UI" reasoning
// computeEndTimeForSpeed above already established — rather than duplicating this inline only
// inside the component closure.
export function computeInsertTrimLeft(
  clip: Pick<VideoClip, 'startTime' | 'endTime' | 'trimIn'>,
  proposedStart: number,
  minClipDuration: number
): { startTime: number; trimIn: number } {
  const minStart = Math.max(0, clip.startTime - clip.trimIn)
  const maxStart = clip.endTime - minClipDuration
  const finalStart = Math.min(maxStart, Math.max(minStart, proposedStart))
  return { startTime: finalStart, trimIn: clip.trimIn + (finalStart - clip.startTime) }
}

export function computeInsertTrimRight(
  clip: Pick<VideoClip, 'startTime' | 'endTime' | 'trimOut'>,
  proposedEnd: number,
  minClipDuration: number
): { endTime: number; trimOut: number } {
  const maxEnd = clip.endTime + clip.trimOut
  const minEnd = clip.startTime + minClipDuration
  const finalEnd = Math.max(minEnd, Math.min(maxEnd, proposedEnd))
  return { endTime: finalEnd, trimOut: clip.trimOut + (clip.endTime - finalEnd) }
}

// Phase 1: which of a V2 insert's own embedded-audio choices is safe to apply automatically
// on insertion, vs. requiring the user's explicit action. Pure decision extracted from
// insertAdditionalVideoClipAt so the "do NOT blindly mix unwanted audio" rule (the whole point
// of Requirement 9) is independently verifiable: a video with detected audio always starts
// 'muted' (never auto-created as an audible AudioTrack), and a silent video gets no B-roll
// audio state at all (undefined — nothing to choose).
export function defaultBrollAudioMode(hasEmbeddedAudio: boolean): 'muted' | undefined {
  return hasEmbeddedAudio ? 'muted' : undefined
}

// Composes a hex colour + a 0-1 opacity into one 8-digit hex-with-alpha CSS colour string —
// the one place this math lives, shared by every Video Studio V2 element that stores fill/
// background as a plain hex colour + a separate opacity field (TextOverlay's bgColor/bgOpacity,
// Phase 4's Shape.fillColor/opacity) rather than baking alpha into the colour itself.
export function composeHexAlpha(hexColor: string, opacity: number): string {
  const alphaHex = Math.round(Math.max(0, Math.min(1, opacity)) * 255).toString(16).padStart(2, '0')
  return `${hexColor}${alphaHex}`
}

// Phase 3 (Video Studio V2 — Advanced Text Properties): composes a TextOverlay's bgColor +
// bgOpacity into one CSS colour — independently verifiable that this matches, byte-for-byte,
// legacy /studio's own PreviewCanvas.tsx composition
// (`${bgColor}${Math.round(bgOpacity*255).toString(16).padStart(2,'0')}`), which is what makes a
// project's text background render identically in both editors. 'transparent' passes through
// unchanged — there is no alpha-suffixed form of the transparent keyword, and this is legacy
// /studio's own explicit "no background" sentinel value; composeHexAlpha itself has no opinion
// on that sentinel, so the check stays here rather than being pushed down into it.
export function composeTextBgColor(bgColor: string, bgOpacity: number): string {
  if (bgColor === 'transparent') return 'transparent'
  return composeHexAlpha(bgColor, bgOpacity)
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

export interface ParsedTranscriptSegment {
  start: number
  end: number
  text: string
}

// Phase 5 (Video Studio V2 — Subtitles / Transcript) — Requirement (PASTE TRANSCRIPT, Option A:
// "if timestamps are included, parse and create timed subtitle segments"). SRT is the one real,
// unambiguous timestamped-transcript format already in use in this codebase — Whisper's own
// segments_to_srt on the backend (backend/app/services/whisper_svc.py) produces exactly this —
// so pasting a transcript exported from this project, or any standard .srt file, parses into
// real timed segments rather than becoming one giant permanent text block. Deliberately does
// not guess at other ad-hoc timestamp notations (e.g. "[00:01]") — SRT is the one format there's
// a real, checkable spec for. Extracted as a pure function so the parsing itself — not just the
// UI that calls it — is independently testable.
export function parseSrtTranscript(raw: string): ParsedTranscriptSegment[] {
  const srtTimeToSeconds = (t: string): number => {
    const m = t.trim().match(/(\d+):(\d{2}):(\d{2})[,.](\d{3})/)
    if (!m) return NaN
    return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000
  }
  const blocks = raw.replace(/\r\n/g, '\n').split(/\n\s*\n/).map(b => b.trim()).filter(Boolean)
  const segments: ParsedTranscriptSegment[] = []
  for (const block of blocks) {
    const lines = block.split('\n')
    const timeLineIdx = lines.findIndex(l => l.includes('-->'))
    if (timeLineIdx === -1) continue
    const [rawStart, rawEnd] = lines[timeLineIdx].split('-->')
    const start = srtTimeToSeconds(rawStart)
    const end = srtTimeToSeconds(rawEnd)
    const text = lines.slice(timeLineIdx + 1).join(' ').trim()
    if (!Number.isNaN(start) && !Number.isNaN(end) && text) segments.push({ start, end, text })
  }
  return segments
}

// Conventional single-line subtitle length — long enough to read comfortably in one glance,
// short enough not to cover the frame.
export const CAPTION_CHUNK_MAX_CHARS = 42

// Requirement (PASTE TRANSCRIPT, Option B: "plain transcript with no timestamps ... auto-segment
// into subtitle-sized chunks ... OR create draft segments for manual timing"). Real speech-to-
// audio alignment is a separate ML capability this codebase has no infrastructure for (out of
// scope — see the report); this implements the explicit fallback the spec itself offers instead:
// even, word-boundary-respecting chunks at a conventional per-line length, given sequential
// draft timing starting at startAt, for the user to then trim/move like any other real segment —
// never one giant permanent text box.
export function autoSegmentPlainTranscript(raw: string, startAt: number, secondsPerChunk = 3, maxChars = CAPTION_CHUNK_MAX_CHARS): ParsedTranscriptSegment[] {
  const words = raw.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
  const chunks: string[] = []
  let current = ''
  for (const word of words) {
    const next = current ? `${current} ${word}` : word
    if (next.length > maxChars && current) { chunks.push(current); current = word }
    else current = next
  }
  if (current) chunks.push(current)
  return chunks.map((text, i) => ({ start: startAt + i * secondsPerChunk, end: startAt + (i + 1) * secondsPerChunk, text }))
}

// Phase 6 (Video Studio V2 — Safe Areas / Guides / Snapping) — Requirement: "Snapping should
// help but should NOT prevent free positioning." Pure nearest-within-threshold snap: returns
// the closest candidate in `guides` if it's within `thresholdPct`, otherwise `value` completely
// unchanged — there is no clamping, no rejection, nothing that can ever stop a drag from landing
// wherever the pointer actually is once it's outside every threshold. Picks the SINGLE nearest
// candidate (not just the first below threshold) so two nearby guides never fight over the
// result.
export function snapToGuides(value: number, guides: number[], thresholdPct = 1.5): number {
  let best = value
  let bestDist = thresholdPct
  for (const g of guides) {
    const d = Math.abs(value - g)
    if (d <= bestDist) { bestDist = d; best = g }
  }
  return best
}

// Turns a list of raw guide LINES (canvas percentages — e.g. 50 for the centre line, 10 for a
// title-safe inset) into the list of EDGE-POSITION targets an element could snap to against
// each one: its left edge on the line, its right edge on the line, or its centre on the line —
// the same three-way snap every mainstream design tool (Figma, Canva) offers, rather than only
// ever aligning one edge. `size` is the element's own width (or height, for the Y axis) in the
// same percentage units; passing 0 (an element with no stored height, e.g. Text/Subtitle, whose
// box height is implicit from content) degrades gracefully — all three targets collapse to the
// bare guide value itself, i.e. a simple line-snap on that axis.
export function buildSnapTargets(guides: number[], size: number): number[] {
  const targets: number[] = []
  for (const g of guides) targets.push(g, g - size, g - size / 2)
  return targets
}
