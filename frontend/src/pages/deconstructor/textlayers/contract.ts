// M2.1a -- the reusable RECONSTRUCTION CONTRACT. Kind-agnostic on purpose: text is the first kind, but images, logos, shapes and (later) Post/Image
// reconstruction all follow the same path:   evidence  ->  candidate  ->  review (corrections)  ->  layer  ->  provenance.
//
// Three rules the whole family obeys:
//   1. EVIDENCE IS IMMUTABLE. Detection evidence is read, deep-frozen and never edited; a person's corrections live in a separate structure.
//   2. EVERY PROPERTY SAYS WHERE IT CAME FROM: measured (read straight off the evidence), inferred (estimated from it), default (nothing to
//      estimate from), or user (a person set it). Nothing inferred is ever labelled measured.
//   3. NOTHING IS CLAIMED BEYOND THE EVIDENCE: no recovered fonts, no separate layers, no clean background pixels.
import type { TextOverlay } from '../../../types'

export const RECONSTRUCTION_SCHEMA = 'reconstruction-v1' as const
export const TEXT_ENGINE_VERSION = '1.0.0'

export type ReconstructionKind = 'text'                // M2.2+ add 'image' | 'logo' | 'shape' | ... here; nothing else in this file changes.

/** Where a property's value came from. */
export type Basis = 'measured' | 'inferred' | 'default' | 'user'
export type Level = 'high' | 'medium' | 'low'

export interface Prop<T> { value: T; basis: Basis; confidence?: Level; note?: string }
export const measured = <T>(value: T, note?: string): Prop<T> => ({ value, basis: 'measured', ...(note ? { note } : {}) })
export const inferred = <T>(value: T, confidence: Level, note: string): Prop<T> => ({ value, basis: 'inferred', confidence, note })
export const defaulted = <T>(value: T, note: string): Prop<T> => ({ value, basis: 'default', note })
export const fromUser = <T>(value: T): Prop<T> => ({ value, basis: 'user' })

export type EvidenceRef = { kind: 'ocr_group' | 'ocr_observation'; id: number }

export type FlagCode =
  | 'low_confidence' | 'fragment' | 'third_party_branding' | 'timing_uncertain' | 'alternate_readings' | 'colour_unknown'
  | 'frame_size_assumed' | 'single_observation' | 'duplicate_candidate' | 'placeholder_conflict' | 'outside_timeline' | 'duplicate_of_existing'
export type Severity = 'info' | 'warning'
export interface Flag { code: FlagCode; severity: Severity; message: string }

export type ReconstructionProvenance = NonNullable<TextOverlay['reconstruction']>

/** Detection evidence is frozen so any code that tries to edit it throws in strict mode (and tests assert it does not change). */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const k of Object.keys(value as object)) deepFreeze((value as Record<string, unknown>)[k])
  }
  return value
}

export const round3 = (n: number) => Math.round(n * 1000) / 1000
export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/** Compare wording the way a person would: case, spacing and non-breaking spaces do not make two texts different. */
export function normaliseText(s: string): string {
  return s.replace(new RegExp(String.fromCharCode(160), 'g'), ' ').replace(/\s+/g, ' ').trim()
}
export const comparable = (s: string) => normaliseText(s).toLowerCase()

export interface Rect { x: number; y: number; w: number; h: number }
/** Intersection-over-union of two rectangles (0 when either is empty). */
export function iou(a: Rect, b: Rect): number {
  const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y), x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h)
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0)
  const union = a.w * a.h + b.w * b.h - inter
  return union > 0 ? inter / union : 0
}
export const overlapSeconds = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))
