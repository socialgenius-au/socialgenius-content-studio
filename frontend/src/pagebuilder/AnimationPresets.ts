import { useEffect, useState, type CSSProperties, type RefObject } from 'react'
import type { AnimationConfig, AnimationPresetId } from './types'

/**
 * Small starter preset library (Section 16 of the brief). Each WIRED preset is expressed as a
 * "start state" inline-style object (applied before the animation plays) and an "end state"
 * class name (applied once the trigger fires) — plain CSS transitions, no animation library, so
 * this stays trivially inspectable/extensible. Presets marked `wired: false` are registered (so
 * the picker shows the full intended library) but not yet implemented — selecting one is a no-op
 * until a future pass adds it, exactly the "small useful starter set, expandable later" scope.
 */
export const ANIMATION_PRESET_LIBRARY: { id: AnimationPresetId; label: string; wired: boolean }[] = [
  { id: 'none', label: 'None', wired: true },
  { id: 'fade-in', label: 'Fade In', wired: true },
  { id: 'fade-out', label: 'Fade Out', wired: true },
  { id: 'slide-in-left', label: 'Slide In Left', wired: true },
  { id: 'slide-in-right', label: 'Slide In Right', wired: true },
  { id: 'slide-in-up', label: 'Slide In Up', wired: true },
  { id: 'slide-in-down', label: 'Slide In Down', wired: true },
  { id: 'scale-in', label: 'Scale In', wired: true },
  { id: 'scale-out', label: 'Scale Out', wired: true },
  { id: 'blur-reveal', label: 'Blur Reveal', wired: true },
  { id: 'stagger-children', label: 'Stagger Children', wired: false },
  { id: 'parallax', label: 'Parallax', wired: false },
  { id: 'image-zoom', label: 'Image Zoom', wired: false },
  { id: 'text-reveal', label: 'Text Reveal', wired: false },
  { id: 'wipe-mask', label: 'Wipe / Mask Reveal', wired: false },
  { id: 'crossfade', label: 'Crossfade', wired: false },
]

function startStyle(preset: AnimationPresetId, intensity: number): CSSProperties {
  switch (preset) {
    case 'fade-in': return { opacity: 0 }
    case 'fade-out': return { opacity: 1 }
    case 'slide-in-left': return { opacity: 0, transform: `translateX(-${intensity}px)` }
    case 'slide-in-right': return { opacity: 0, transform: `translateX(${intensity}px)` }
    case 'slide-in-up': return { opacity: 0, transform: `translateY(${intensity}px)` }
    case 'slide-in-down': return { opacity: 0, transform: `translateY(-${intensity}px)` }
    case 'scale-in': return { opacity: 0, transform: 'scale(0.9)' }
    case 'scale-out': return { opacity: 1, transform: 'scale(1)' }
    case 'blur-reveal': return { opacity: 0, filter: 'blur(10px)' }
    default: return {}
  }
}

function endStyle(preset: AnimationPresetId): CSSProperties {
  switch (preset) {
    case 'fade-in': return { opacity: 1 }
    case 'fade-out': return { opacity: 0 }
    case 'slide-in-left':
    case 'slide-in-right':
    case 'slide-in-up':
    case 'slide-in-down': return { opacity: 1, transform: 'translate(0, 0)' }
    case 'scale-in': return { opacity: 1, transform: 'scale(1)' }
    case 'scale-out': return { opacity: 0, transform: 'scale(1.08)' }
    case 'blur-reveal': return { opacity: 1, filter: 'blur(0px)' }
    default: return {}
  }
}

/**
 * Applies one element's AnimationConfig. Wires up exactly two triggers fully in v1 —
 * `page-load` (plays on mount) and `viewport-enter` (IntersectionObserver) — plus `hover`/`click`
 * as trivial event-driven variants, since those need no scroll machinery. `scroll`/`focus`/
 * `time-delay`/`section-enter`/`section-exit` remain schema-valid (Section 14) but are not wired
 * to a real behaviour yet — selecting them is inert in this version, not broken; they simply don't
 * fire until a later pass implements the missing plumbing (documented in the report).
 */
export function useElementAnimation(ref: RefObject<HTMLElement>, animation: AnimationConfig, editMode: boolean) {
  const [played, setPlayed] = useState(false)
  const [hoverActive, setHoverActive] = useState(false)
  const presetDef = ANIMATION_PRESET_LIBRARY.find(p => p.id === animation.preset)
  const active = presetDef?.wired && animation.preset !== 'none'

  useEffect(() => {
    if (!active || editMode) return // never auto-play while editing — the element must stay put to select/drag
    const node = ref.current
    if (!node) return

    if (animation.trigger === 'page-load') {
      const t = setTimeout(() => setPlayed(true), animation.delayMs)
      return () => clearTimeout(t)
    }

    if (animation.trigger === 'viewport-enter') {
      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            const t = setTimeout(() => setPlayed(true), animation.delayMs)
            if (animation.once) observer.disconnect()
            return () => clearTimeout(t)
          } else if (!animation.once) {
            setPlayed(false)
          }
        },
        { threshold: 0.15 }
      )
      observer.observe(node)
      return () => observer.disconnect()
    }
    // hover/click are handled via the returned event handlers below, not an effect.
  }, [active, editMode, animation.trigger, animation.delayMs, animation.once, ref])

  const isPlaying = active && !editMode && (
    animation.trigger === 'hover' ? hoverActive :
    animation.trigger === 'click' ? played :
    played
  )

  const style: CSSProperties = active
    ? {
        ...(isPlaying ? endStyle(animation.preset) : startStyle(animation.preset, animation.intensity ?? 32)),
        transition: `opacity ${animation.durationMs}ms ${animation.easing ?? 'ease'}, transform ${animation.durationMs}ms ${animation.easing ?? 'ease'}, filter ${animation.durationMs}ms ${animation.easing ?? 'ease'}`,
      }
    : {}

  const handlers = active && animation.trigger === 'hover'
    ? { onMouseEnter: () => setHoverActive(true), onMouseLeave: () => setHoverActive(!animation.once ? false : hoverActive) }
    : active && animation.trigger === 'click'
    ? { onClick: () => setPlayed(p => (animation.once ? true : !p)) }
    : {}

  return { style, handlers, isWired: !!presetDef?.wired }
}
