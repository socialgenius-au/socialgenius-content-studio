// D1 -- where a blending transition (dissolve) is on the editor's timeline, using the SAME rules as the exporter (backend timeline_plan.py `plan_timeline`, blend branch), so the preview shows the window the MP4
// will contain: a blend window [J - x, J + y] around the join J. The incoming clip is shown from J - x using REAL source frames from before its trim-in (pre-roll), the outgoing clip continues to J + y using
// REAL source frames after its trim-out (post-roll); both clips' main footage stays where the editor puts it. Where the source file has no spare frames on a side the window is shortened to what exists
// (policy "shorten", the default), or -- policy "hold_incoming" -- the missing frames are filled by repeating the incoming clip's first frame ("hold" repeats both edge frames).
//
// Pure and dependency free. It is a port of the Python, kept honest by a shared fixture (`__fixtures__/dissolveWindow.cases.json`, regenerated and compared by backend/tests/test_dissolve_window_fixture.py).
// Differences that are inherent, not bugs: the exporter probes the source file's real duration with ffprobe; the editor only knows `clip.duration` (the source length it recorded when the clip was added).
import { EDITOR_FPS as FPS } from './transitionFade'

export type BlendPolicy = 'shorten' | 'hold_incoming' | 'hold'
const MIN_BLEND_FRAMES = 2
/** Transition names that are rendered as a blend between two live pictures (everything but cut and fade through black). */
const BLEND_TRANSITIONS = new Set(['dissolve', 'whip_pan', 'zoom_punch'])

export interface PlanClip {
  id: string
  transition: string
  transitionDuration: number
  startTime: number
  endTime: number
  trimIn: number
  speed: number
  /** Source length in seconds; undefined/0 = unknown (no spare frames after the trim-out). */
  duration?: number
}

export interface BlendWindow {
  /** clip that is leaving / arriving */
  outId: string
  inId: string
  transition: string
  /** timeline frame of the join J */
  joinFrame: number
  /** x: frames before J (incoming clip's pre-roll), y: frames after J (outgoing clip's post-roll) */
  pre: number
  post: number
  /** frames the transition duration asked for (the window can be shorter) */
  requested: number
}

/** Python's round(): halves go to the even neighbour (the exporter's `to_frames`). */
const pyRound = (x: number) => {
  const f = Math.floor(x), d = x - f
  if (d < 0.5) return f
  if (d > 0.5) return f + 1
  return f % 2 === 0 ? f : f + 1
}
const toFrames = (s: number) => pyRound(s * FPS)

interface Cp { n: number; speed: number; trimIn: number; durationS: number | null }
interface Jn { index: number; kind: 'cut' | 'fade' | 'blend'; joinF: number; pre: number; post: number; requested: number }

/** The blend windows of ONE contiguous run of V1 clips (each starts where the previous ends), in timeline order. */
function planRun(clips: readonly PlanClip[], policy: BlendPolicy): BlendWindow[] {
  const bnd = [toFrames(clips[0].startTime)]
  let cum = clips[0].startTime
  for (const c of clips) {
    cum += c.endTime - c.startTime
    bnd.push(Math.max(bnd[bnd.length - 1] + 1, toFrames(cum)))
  }
  const plans: Cp[] = clips.map((c, i) => ({ n: bnd[i + 1] - bnd[i], speed: c.speed || 1, trimIn: c.trimIn, durationS: c.duration && c.duration > 0 ? c.duration : null }))
  const spareBefore = (i: number) => Math.max(0, Math.trunc((plans[i].trimIn / plans[i].speed) * FPS) - 1)
  const spareAfter = (i: number) => {
    const p = plans[i]
    if (p.durationS === null) return 0
    const usedEnd = p.trimIn + (p.n / FPS) * p.speed
    return Math.max(0, Math.trunc(((p.durationS - usedEnd) / p.speed) * FPS) - 1)
  }

  const joins: Jn[] = []
  for (let j = 0; j < clips.length - 1; j++) {
    const name = clips[j].transition
    const joinF = bnd[j + 1]
    const d = clips[j].transitionDuration ?? 0.5
    if (name === 'cut' || !name) joins.push({ index: j, kind: 'cut', joinF, pre: 0, post: 0, requested: 0 })
    else if (name === 'fade_black' || name === 'fade_to_black') joins.push({ index: j, kind: 'fade', joinF, pre: 0, post: 0, requested: Math.max(2, toFrames(d)) })
    else {
      const req = Math.max(MIN_BLEND_FRAMES, toFrames(d))
      const xReq = Math.floor(req / 2), yReq = req - xReq
      let x: number, y: number
      if (policy === 'hold') { x = xReq; y = yReq }
      else if (policy === 'hold_incoming') { y = Math.min(yReq, spareAfter(j)); x = req - y }
      else {
        x = Math.min(xReq, spareBefore(j + 1))
        y = Math.min(yReq, spareAfter(j))
        let left = req - x - y
        if (left > 0) { const add = Math.min(left, spareBefore(j + 1) - x); x += add; left -= add }
        if (left > 0) { const add = Math.min(left, spareAfter(j) - y); y += add }
      }
      joins.push({ index: j, kind: 'blend', joinF, pre: x, post: y, requested: req })
    }
  }

  const fadeSplit = (jn: Jn): [number, number] => { const out = Math.floor(jn.requested / 2); return [out, jn.requested - out] }
  for (let pass = 0; pass < 2; pass++) {
    plans.forEach((p, k) => {
      let startUse = 0, endUse = 0
      if (k > 0) { const pj = joins[k - 1]; startUse = pj.kind === 'blend' ? pj.post : pj.kind === 'fade' ? fadeSplit(pj)[1] : 0 }
      if (k < plans.length - 1) { const nj = joins[k]; endUse = nj.kind === 'blend' ? nj.pre : nj.kind === 'fade' ? fadeSplit(nj)[0] : 0 }
      if (startUse + endUse > p.n) {
        const scale = p.n / (startUse + endUse)
        if (k > 0) { const pj = joins[k - 1]; if (pj.kind === 'blend') pj.post = Math.trunc(pj.post * scale); else if (pj.kind === 'fade') pj.requested = Math.max(2, Math.trunc(pj.requested * scale)) }
        if (k < plans.length - 1) { const nj = joins[k]; if (nj.kind === 'blend') nj.pre = Math.trunc(nj.pre * scale); else if (nj.kind === 'fade') nj.requested = Math.max(2, Math.trunc(nj.requested * scale)) }
      }
    })
  }

  const out: BlendWindow[] = []
  for (const jn of joins) {
    if (jn.kind !== 'blend' || jn.pre + jn.post < MIN_BLEND_FRAMES) continue            // a window under two frames is a hard cut
    out.push({ outId: clips[jn.index].id, inId: clips[jn.index + 1].id, transition: clips[jn.index].transition, joinFrame: jn.joinF, pre: jn.pre, post: jn.post, requested: jn.requested })
  }
  return out
}

/** All blend windows of the V1 timeline. Clips are split into contiguous runs exactly as the exporter does (a gap of a frame or more ends a run; no transition is applied across a gap). */
export function planBlendWindows(clips: readonly PlanClip[], policy: BlendPolicy = 'shorten'): BlendWindow[] {
  const ordered = [...clips].sort((a, b) => a.startTime - b.startTime)
  const windows: BlendWindow[] = []
  let run: PlanClip[] = []
  const flush = () => { if (run.length > 1) windows.push(...planRun(run, policy)); run = [] }
  for (const c of ordered) {
    if (run.length === 0) run = [c]
    else {
      const gap = toFrames(c.startTime) - toFrames(run[run.length - 1].endTime)
      if (gap >= 1) { flush(); run = [c] } else run.push(c)
    }
  }
  flush()
  return windows
}

export interface ActiveBlend {
  window: BlendWindow
  /** 0 at the first frame of the window, 1 at its end -- how much of the INCOMING picture is showing */
  alpha: number
  /** 'before': the join has not been reached (the outgoing clip is the active one); 'after': it has (the incoming clip is the active one) */
  phase: 'before' | 'after'
}

/** The blend window the timeline time `t` (seconds) is inside, if any. Only the transitions the editor can render (`only`, default dissolve) count. */
export function activeBlendAt(windows: readonly BlendWindow[], t: number, only: readonly string[] = ['dissolve']): ActiveBlend | null {
  const f = t * FPS
  for (const w of windows) {
    if (!only.includes(w.transition)) continue
    const start = w.joinFrame - w.pre, end = w.joinFrame + w.post
    if (f >= start && f < end) return { window: w, alpha: (f - start) / (w.pre + w.post), phase: f < w.joinFrame ? 'before' : 'after' }
  }
  return null
}

export interface BlendPreview {
  window: BlendWindow
  /** the clip whose picture the extra preview element shows: the incoming clip before the join, the outgoing clip after it */
  otherId: string
  phase: 'before' | 'after'
  /** true while t is inside the window; false during the look-ahead (the element is mounted and parked on its first frame, invisible) */
  inside: boolean
  /** timeline seconds of the window's first frame */
  startS: number
  /** opacity of the extra element. It always sits ON TOP of the active clip: before the join it is the incoming picture at alpha; after the join it is the outgoing picture at 1 - alpha over the incoming one. Both are the same blend, with no change of stacking at the join. */
  opacity: number
}

/** What the editor's preview needs at timeline time `t`: the blend it is inside, or about to enter within `lookaheadS` seconds (so the second element can load before it is shown). */
export function blendPreviewAt(windows: readonly BlendWindow[], t: number, lookaheadS = 1, only: readonly string[] = ['dissolve']): BlendPreview | null {
  const f = t * FPS
  for (const w of windows) {
    if (!only.includes(w.transition)) continue
    const start = w.joinFrame - w.pre, end = w.joinFrame + w.post
    if (f < start - lookaheadS * FPS || f >= end) continue
    const inside = f >= start
    const phase = f < w.joinFrame ? 'before' : 'after'
    const alpha = inside ? (f - start) / (w.pre + w.post) : 0
    return { window: w, otherId: phase === 'before' ? w.inId : w.outId, phase, inside, startS: start / FPS, opacity: !inside ? 0 : phase === 'before' ? alpha : 1 - alpha }
  }
  return null
}

/** Source-file time a clip shows at timeline time `t`, using the editor's own linear mapping -- which simply continues past the clip's trimmed ends into the real pre-roll / post-roll. */
export const sourceTimeAt = (clip: Pick<PlanClip, 'startTime' | 'trimIn' | 'speed'>, t: number) => Math.max(0, (t - clip.startTime) * (clip.speed || 1) + clip.trimIn)

export const isBlendTransition = (name: string) => BLEND_TRANSITIONS.has(name)
