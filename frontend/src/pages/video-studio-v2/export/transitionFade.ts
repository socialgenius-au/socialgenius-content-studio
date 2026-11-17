// D2 -- the editor's fade-through-black preview, using the SAME rule as the exporter (backend timeline_plan.py): a clip's `transition` describes the JOIN with the next clip. Over a window of
// max(2, round(d * 30)) frames the outgoing clip fades out over the first floor(window / 2) frames (its own last frames) and the incoming clip fades in over the remaining frames (its own
// first frames). The very start and the very end of the project are not faded. Before this, the editor faded every faded clip in at its start and out at its end by the full duration.
// Pure; the editor's `getClipTransitionOpacity` calls it.
export const EDITOR_FPS = 30

export interface FadeClip { id: string; transition: string; transitionDuration: number; startTime: number; endTime: number }

const windowFrames = (d: number) => Math.max(2, Math.round(d * EDITOR_FPS))
/** Seconds the outgoing clip fades out for, and the incoming clip fades in for, at a join whose outgoing clip has duration `d`. */
export const fadeParts = (d: number) => { const total = windowFrames(d), out = Math.floor(total / 2); return { out: out / EDITOR_FPS, in: (total - out) / EDITOR_FPS } }

/** A join exists only between clips that touch (the exporter splits a timeline into runs at every gap of a frame or more and does no transition across one). */
const touches = (a: FadeClip, b: FadeClip) => Math.abs(b.startTime - a.endTime) < 1 / EDITOR_FPS

export function clipFadeOpacity(clips: readonly FadeClip[], clip: FadeClip, t: number): number {
  const ordered = [...clips].sort((a, b) => a.startTime - b.startTime)
  const i = ordered.findIndex(c => c.id === clip.id)
  if (i < 0) return 1
  let opacity = 1
  const next = i < ordered.length - 1 ? ordered[i + 1] : null
  if (next && touches(clip, next) && clip.transition === 'fade_black' && clip.transitionDuration > 0) {
    const outS = fadeParts(clip.transitionDuration).out
    const beforeEnd = clip.endTime - t
    if (outS > 0 && beforeEnd < outS) opacity = Math.min(opacity, Math.max(0, beforeEnd / outS))
  }
  const prev = i > 0 ? ordered[i - 1] : null
  if (prev && touches(prev, clip) && prev.transition === 'fade_black' && prev.transitionDuration > 0) {
    const inS = fadeParts(prev.transitionDuration).in
    const intoClip = t - clip.startTime
    if (intoClip < inS) opacity = Math.min(opacity, Math.max(0, intoClip / inS))
  }
  return opacity
}
