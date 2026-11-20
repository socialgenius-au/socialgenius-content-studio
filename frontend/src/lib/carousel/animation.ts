// Carousel Creator - motion: slide transitions and element animations.
//
// Everything here is a PURE function of the document and a time in milliseconds, so the on-screen preview and the animated video export ask the same questions and get the same answers
// (what you preview is what you export). Static PNG / JPEG / PDF exports never call any of this.
//
//   TIMELINE   slide i starts at start[i]; start[0] = 0; start[i] = start[i-1] + duration[i-1] - transition[i] (a transition OVERLAPS the end of the previous slide, like a video editor's
//              cross-dissolve). Total length = last start + last duration. A transition is capped at half of the shorter neighbouring slide so every slide always has time on its own.
//   ELEMENTS   an element may have one entrance, one exit and one emphasis (see ElementAnimation). Entrances can be sequenced per slide: together, staggered, or one after another.
//   STATE      an element's motion at a moment is a small record (opacity multiplier, offset, scale, rotation, typewriter reveal) that the renderer applies on top of its static look.
import type { EasingName, ElementAnimation, MotionDirection, PostDocument, PostElement, PostPage, SlideSequence, SlideTransition, TransitionKind } from '../postDocument'

export const DEFAULT_SLIDE_MS = 3000
export const DEFAULT_TRANSITION: SlideTransition = { kind: 'none', durationMs: 600, easing: 'ease-in-out' }
export const DEFAULT_SEQUENCE: SlideSequence = { mode: 'together', staggerMs: 150 }
export const SLIDE_TRAVEL = 0.3                  // how far (fraction of the canvas) a slide-in element travels

export const ENTRANCE_KINDS = ['fade', 'slide', 'pop', 'zoom', 'bounce', 'rotate', 'typewriter'] as const
export const EXIT_KINDS = ['fade', 'slide', 'pop', 'zoom', 'bounce', 'rotate'] as const
export const EMPHASIS_KINDS = ['pulse', 'bounce', 'rotate', 'zoom', 'fade'] as const
export const TRANSITION_KINDS: { id: TransitionKind; label: string; hint: string }[] = [
  { id: 'none', label: 'None (cut)', hint: 'Jump straight to the next slide' },
  { id: 'dissolve', label: 'Dissolve', hint: 'The next slide fades in over the last one' },
  { id: 'fade', label: 'Fade', hint: 'Fades out to black, then in' },
  { id: 'slide', label: 'Slide', hint: 'The next slide slides over the last one' },
  { id: 'push', label: 'Push', hint: 'The next slide pushes the last one out' },
  { id: 'wipe', label: 'Wipe', hint: 'The next slide is revealed by a moving edge' },
  { id: 'zoom', label: 'Zoom', hint: 'The last slide zooms away as the next arrives' },
  { id: 'flip', label: 'Flip', hint: 'The slide turns over like a card' },
]
export const EASINGS: { id: EasingName; label: string }[] = [
  { id: 'linear', label: 'Linear' }, { id: 'ease-in', label: 'Ease in' }, { id: 'ease-out', label: 'Ease out' }, { id: 'ease-in-out', label: 'Ease in-out' }, { id: 'back', label: 'Overshoot' }, { id: 'bounce', label: 'Bounce' },
]

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/** Maps linear progress 0..1 to eased progress. 'back' overshoots past 1 and returns; 'bounce' lands with decaying bounces. */
export function ease(name: EasingName, p: number): number {
  const x = clamp(p, 0, 1)
  switch (name) {
    case 'linear': return x
    case 'ease-in': return x * x * x
    case 'ease-out': return 1 - (1 - x) ** 3
    case 'ease-in-out': return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2
    case 'back': { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2 }
    case 'bounce': {
      const n1 = 7.5625, d1 = 2.75
      if (x < 1 / d1) return n1 * x * x
      if (x < 2 / d1) { const t = x - 1.5 / d1; return n1 * t * t + 0.75 }
      if (x < 2.5 / d1) { const t = x - 2.25 / d1; return n1 * t * t + 0.9375 }
      const t = x - 2.625 / d1
      return n1 * t * t + 0.984375
    }
  }
}

// ── element motion ───────────────────────────────────────────────────────────────────────────

export interface MotionState {
  /** Multiplies the element's own opacity. */
  opacity: number
  /** Offset in canvas fractions (x of the width, y of the height). */
  dx: number
  dy: number
  scale: number
  /** Degrees added to the element's own rotation. */
  rotation: number
  /** Typewriter: fraction of the characters shown (null = all). */
  reveal: number | null
}
export const REST: MotionState = { opacity: 1, dx: 0, dy: 0, scale: 1, rotation: 0, reveal: null }

const vec = (d: MotionDirection | undefined, fallback: MotionDirection): [number, number] => {
  switch (d ?? fallback) { case 'left': return [-1, 0]; case 'right': return [1, 0]; case 'up': return [0, -1]; case 'down': return [0, 1] }
}

/** The look of an entrance at eased progress p (0 = just hidden, 1 = at rest). `isText` lets the typewriter fall back to a fade on anything that is not text. */
function entranceAt(kind: string, p: number, direction: MotionDirection | undefined, isText: boolean): MotionState {
  const o = clamp(p, 0, 1)
  switch (kind) {
    case 'fade': return { ...REST, opacity: o }
    case 'slide': { const [vx, vy] = vec(direction, 'left'); return { ...REST, opacity: clamp(p * 3, 0, 1), dx: vx * (1 - p) * SLIDE_TRAVEL, dy: vy * (1 - p) * SLIDE_TRAVEL } }
    case 'pop': return { ...REST, opacity: clamp(p * 3, 0, 1), scale: 0.5 + 0.5 * p }
    case 'zoom': return { ...REST, opacity: o, scale: 0.2 + 0.8 * p }
    case 'bounce': return { ...REST, opacity: clamp(p * 4, 0, 1), dy: -(1 - p) * 0.35 }
    case 'rotate': return { ...REST, opacity: o, rotation: -90 * (1 - p), scale: 0.5 + 0.5 * p }
    case 'typewriter': return isText ? { ...REST, reveal: o } : { ...REST, opacity: o }
    default: return REST
  }
}

function emphasisAt(kind: string, u: number): MotionState {       // u: eased progress within one cycle, 0..1
  const s = Math.sin(Math.PI * u)
  switch (kind) {
    case 'pulse': return { ...REST, scale: 1 + 0.08 * s }
    case 'bounce': return { ...REST, dy: -0.05 * s }
    case 'rotate': return { ...REST, rotation: 8 * Math.sin(2 * Math.PI * u) }
    case 'zoom': return { ...REST, scale: 1 + 0.15 * s }
    case 'fade': return { ...REST, opacity: 1 - 0.6 * s }
    default: return REST
  }
}

const combine = (a: MotionState, b: MotionState): MotionState => ({
  opacity: a.opacity * b.opacity, dx: a.dx + b.dx, dy: a.dy + b.dy, scale: a.scale * b.scale, rotation: a.rotation + b.rotation, reveal: a.reveal === null ? b.reveal : b.reveal === null ? a.reveal : Math.min(a.reveal, b.reveal),
})

export const slideDuration = (page: PostPage): number => page.durationMs ?? DEFAULT_SLIDE_MS
const phaseOf = (el: PostElement, phase: ElementAnimation['phase']) => el.animations?.find(a => a.phase === phase)

/** Milliseconds each animated element's entrance is pushed back by the slide's sequencing, keyed by element id (layer order: back to front). */
export function sequenceOffsets(page: PostPage): Map<string, number> {
  const seq = page.sequence ?? DEFAULT_SEQUENCE
  const out = new Map<string, number>()
  let n = 0
  let cursor = 0
  for (const el of page.elements) {
    const ent = phaseOf(el, 'entrance')
    if (!ent) continue
    out.set(el.id, seq.mode === 'stagger' ? n * seq.staggerMs : seq.mode === 'one-by-one' ? cursor : 0)
    cursor += ent.delayMs + ent.durationMs
    n++
  }
  return out
}

/** The motion of one top-level element at `localMs` from the start of its slide. An element with no animations is always at rest. */
export function elementMotion(page: PostPage, el: PostElement, localMs: number, offsets: Map<string, number> = sequenceOffsets(page)): MotionState {
  if (!el.animations || el.animations.length === 0) return REST
  const dur = slideDuration(page)
  const isText = el.type === 'text'
  let state = REST

  const ent = phaseOf(el, 'entrance')
  if (ent) {
    const start = ent.delayMs + (offsets.get(el.id) ?? 0)
    const p = ease(ent.easing, (localMs - start) / ent.durationMs)
    const raw = (localMs - start) / ent.durationMs
    state = combine(state, raw >= 1 ? REST : entranceAt(ent.kind, raw <= 0 ? 0 : p, ent.direction, isText))
  }
  const ex = phaseOf(el, 'exit')
  if (ex) {
    const start = Math.max(0, dur - ex.durationMs - ex.delayMs)
    const raw = (localMs - start) / ex.durationMs
    if (raw > 0) state = combine(state, raw >= 1 ? entranceAt(ex.kind, 0, ex.direction, false) : entranceAt(ex.kind, 1 - ease(ex.easing, raw), ex.direction, false))
  }
  const em = phaseOf(el, 'emphasis')
  if (em) {
    const t = localMs - em.delayMs
    const cycles = em.repeat ?? 1
    if (t > 0 && t < em.durationMs * cycles) state = combine(state, emphasisAt(em.kind, ease(em.easing, (t / em.durationMs) % 1)))
  }
  return state
}

// ── timeline ─────────────────────────────────────────────────────────────────────────────────

export interface SlideTiming {
  index: number
  start: number
  duration: number
  /** How this slide arrives (kind 'none' and 0 ms for the first slide or a plain cut). */
  transition: { kind: TransitionKind; durationMs: number; easing: EasingName; direction: MotionDirection }
}
export interface Timeline { slides: SlideTiming[]; totalMs: number }

export function buildTimeline(doc: PostDocument): Timeline {
  const slides: SlideTiming[] = []
  let start = 0
  doc.pages.forEach((p, i) => {
    const duration = slideDuration(p)
    const t = p.transition ?? DEFAULT_TRANSITION
    let ms = i === 0 || t.kind === 'none' ? 0 : t.durationMs
    if (i > 0) ms = clamp(ms, 0, Math.floor(Math.min(slideDuration(doc.pages[i - 1]), duration) / 2))
    if (i > 0) start = start - ms
    slides.push({ index: i, start, duration, transition: { kind: ms === 0 ? 'none' : t.kind, durationMs: ms, easing: t.easing, direction: t.direction ?? 'left' } })
    start += duration
  })
  return { slides, totalMs: Math.max(0, start) }
}

export interface FramePlan {
  /** The slide to draw alone, when no transition is running. */
  solo?: { index: number; localMs: number }
  /** During a transition: the slide leaving and the slide arriving, and the eased progress. */
  transition?: { out: { index: number; localMs: number }; in: { index: number; localMs: number }; p: number; kind: TransitionKind; direction: MotionDirection }
}

/** What to draw at `tMs` on the timeline. Past the end it repeats the last frame. */
export function planFrame(tl: Timeline, tMs: number): FramePlan {
  const t = clamp(tMs, 0, Math.max(0, tl.totalMs - 1))
  for (let i = tl.slides.length - 1; i >= 0; i--) {
    const s = tl.slides[i]
    if (t < s.start) continue
    const prev = tl.slides[i - 1]
    if (prev && s.transition.durationMs > 0 && t < s.start + s.transition.durationMs) {
      const p = ease(s.transition.easing, (t - s.start) / s.transition.durationMs)
      return { transition: { out: { index: prev.index, localMs: t - prev.start }, in: { index: s.index, localMs: t - s.start }, p, kind: s.transition.kind, direction: s.transition.direction } }
    }
    return { solo: { index: s.index, localMs: t - s.start } }
  }
  return { solo: { index: 0, localMs: 0 } }
}

// ── slide transitions: how the two slides are placed while one replaces the other ────────────

export interface TransitionLayer { opacity: number; dx: number; dy: number; scaleX: number; scaleY: number; /** visible part, canvas fractions */ clip?: { x0: number; y0: number; x1: number; y1: number } }
export interface TransitionLayers { out: TransitionLayer; in: TransitionLayer }
const L = (over: Partial<TransitionLayer> = {}): TransitionLayer => ({ opacity: 1, dx: 0, dy: 0, scaleX: 1, scaleY: 1, ...over })
const HIDDEN = L({ opacity: 0 })

/** Where the outgoing and incoming slides are at eased progress p. `direction` is the side the NEW slide comes from (slide, push, wipe) or the flip axis (left/right = horizontal). */
export function transitionLayers(kind: TransitionKind, p: number, direction: MotionDirection = 'left'): TransitionLayers {
  const [vx, vy] = vec(direction, 'left')
  switch (kind) {
    case 'none': return { out: p >= 1 ? HIDDEN : L(), in: p >= 1 ? L() : HIDDEN }
    case 'dissolve': return { out: L({ opacity: 1 - p }), in: L({ opacity: p }) }
    case 'fade': return p < 0.5 ? { out: L({ opacity: 1 - 2 * p }), in: HIDDEN } : { out: HIDDEN, in: L({ opacity: 2 * p - 1 }) }
    case 'slide': return { out: L(), in: L({ dx: vx * (1 - p), dy: vy * (1 - p) }) }
    case 'push': return { out: L({ dx: -vx * p, dy: -vy * p }), in: L({ dx: vx * (1 - p), dy: vy * (1 - p) }) }
    case 'wipe': {
      const clip = vx < 0 ? { x0: 0, y0: 0, x1: p, y1: 1 } : vx > 0 ? { x0: 1 - p, y0: 0, x1: 1, y1: 1 } : vy < 0 ? { x0: 0, y0: 0, x1: 1, y1: p } : { x0: 0, y0: 1 - p, x1: 1, y1: 1 }
      return { out: L(), in: L({ clip }) }
    }
    case 'zoom': return { out: L({ opacity: 1 - p, scaleX: 1 + 0.5 * p, scaleY: 1 + 0.5 * p }), in: L({ opacity: p, scaleX: 0.7 + 0.3 * p, scaleY: 0.7 + 0.3 * p }) }
    case 'flip': {
      const horizontal = vx !== 0
      const squash = (s: number) => (horizontal ? { scaleX: s } : { scaleY: s })
      return p < 0.5 ? { out: L(squash(1 - 2 * p)), in: HIDDEN } : { out: HIDDEN, in: L(squash(2 * p - 1)) }
    }
  }
}

/** True when the document has any motion at all (a transition other than a cut, or any element animation). Used to decide whether an animated export is meaningful. */
export function hasMotion(doc: PostDocument): boolean {
  return doc.pages.some((p, i) => (i > 0 && p.transition && p.transition.kind !== 'none') || p.elements.some(e => (e.animations?.length ?? 0) > 0))
}

// ── editing helpers (pure) ───────────────────────────────────────────────────────────────────

export function defaultAnimation(phase: ElementAnimation['phase'], kind: string, id: string): ElementAnimation {
  return { id, phase, kind: kind as ElementAnimation['kind'], durationMs: phase === 'emphasis' ? 800 : 600, delayMs: phase === 'emphasis' ? 800 : 0, easing: kind === 'pop' || kind === 'bounce' ? (kind === 'bounce' ? 'bounce' : 'back') : 'ease-out', ...(kind === 'slide' ? { direction: 'left' as const } : {}), ...(phase === 'emphasis' ? { repeat: 2 } : {}) }
}

/** The element with its animation of `phase` set (or removed when `anim` is null). Other phases are kept. */
export function withAnimation<T extends PostElement>(el: T, phase: ElementAnimation['phase'], anim: ElementAnimation | null): T {
  const rest = (el.animations ?? []).filter(a => a.phase !== phase)
  const animations = anim ? [...rest, anim] : rest
  return { ...el, animations: animations.length ? animations : undefined }
}
