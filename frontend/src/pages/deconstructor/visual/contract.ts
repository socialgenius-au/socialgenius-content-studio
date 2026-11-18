// M4 -- the VISUAL ELEMENT contract (versioned). One object per thing the analysis found on screen: what it most likely is, how sure we are and why, where and when it was seen, and whether it could be rebuilt
// as an editable layer. M5 (reconstruction planning) consumes ONLY this shape, so the two tracks can develop against fixtures of it.
//
// Rules this contract encodes (they are the point, not decoration):
//   * Detection, classification, tracking and readiness are separate steps with separate outputs. A class is a judgment from evidence; it is never a detection, and a recurring text is never a graphic.
//   * Graphical classes (LOGO_MARK, ICON_GRAPHIC, SHAPE_GRAPHIC) are NEVER assigned from OCR text. They exist so a person can correct a class (basis 'user'); nothing in the stored analysis grounds them.
//   * When the evidence does not support a class the class is UNKNOWN. Confidence is capped for rule-based judgments and falls with few sightings and noisy OCR: it never defaults to high.
//   * Every classification names the evidence behind it, with the analysis's own certainty vocabulary (OBSERVED, MEASURED, INFERRED, RESEARCH_SUPPORTED, RECOMMENDED).
//   * Readiness says what COULD be rebuilt, never that it has been.
import type { Rect } from '../textlayers/contract'

export type { Rect }
export const VISUAL_ELEMENT_SCHEMA = 'visual-element-v1'
export const VISUAL_ENGINE_VERSION = '1.0.0'

/** The analysis's own certainty vocabulary (backend `models/certainty.py`). */
export type Certainty = 'OBSERVED' | 'MEASURED' | 'INFERRED' | 'RESEARCH_SUPPORTED' | 'RECOMMENDED'

export type VisualClass =
  | 'TEXT_CAPTION' | 'TEXT_SUBTITLE' | 'TEXT_HANDLE' | 'TEXT_OTHER'
  | 'LOGO_MARK' | 'ICON_GRAPHIC' | 'IMAGE_REGION' | 'SHAPE_GRAPHIC' | 'BACKGROUND_ELEMENT'
  | 'UNKNOWN'

export const TEXT_CLASSES: readonly VisualClass[] = ['TEXT_CAPTION', 'TEXT_SUBTITLE', 'TEXT_HANDLE', 'TEXT_OTHER']
/** Classes a rule may never assign: only a person's own correction can. */
export const USER_ONLY_CLASSES: readonly VisualClass[] = ['LOGO_MARK', 'ICON_GRAPHIC', 'SHAPE_GRAPHIC']
export const isTextClass = (c: VisualClass) => TEXT_CLASSES.includes(c)

export const CLASS_LABEL: Record<VisualClass, string> = {
  TEXT_CAPTION: 'Caption text', TEXT_SUBTITLE: 'Subtitle line', TEXT_HANDLE: 'Handle or watermark text', TEXT_OTHER: 'Other text',
  LOGO_MARK: 'Logo or mark (set by you)', ICON_GRAPHIC: 'Icon or graphic (set by you)', IMAGE_REGION: 'Image region', SHAPE_GRAPHIC: 'Shape graphic (set by you)', BACKGROUND_ELEMENT: 'Background element', UNKNOWN: 'Unknown',
}

export type ConfidenceLevel = 'low' | 'medium' | 'high'
export interface Confidence { level: ConfidenceLevel; score: number }

export type EvidenceKind = 'text_element' | 'text_observation' | 'recurring_element' | 'visual_object' | 'persistent_visual_element' | 'frame' | 'background_measurement' | 'user_correction'
export interface EvidenceRef { kind: EvidenceKind; id: number | string; certainty: Certainty; note: string }

export interface Classification {
  class: VisualClass
  /** What kind of claim this is. A rule over measured evidence is INFERRED; a person's correction is OBSERVED and carries basis 'user'. */
  certainty: Certainty
  basis: 'rule' | 'user'
  confidence: Confidence
  /** Why, in plain sentences, strongest first. Always at least one. */
  explanation: string[]
  evidence: EvidenceRef[]
  /** The next most likely classes with their scores, so a person can see what it nearly was. */
  alternatives: { class: VisualClass; score: number }[]
}

export type MovementKind = 'single_sighting' | 'static' | 'fixed_spots' | 'slides' | 'moves'
export interface Movement { kind: MovementKind; spots: number; spread: { x: number; y: number }; notes: string[] }

export interface TrackObservation { time: number; frameId: number | null; shotId: number | null; box: Rect; text?: string; ocrConfidence: number | null; evidence: EvidenceRef }
/** `observed` lists the sampled instants it was actually seen at; `kind` says the interval itself is a span between sightings, not an observed continuous visibility. */
export interface VisibilityInterval { start: number; end: number; observed: number[]; kind: 'single_instant' | 'span_between_sightings'; shotId: number | null }

export interface Track {
  /** Stable: derived from the analysis's own ids (never from array order), so it survives reloads and re-runs on the same analysis. */
  id: string
  kind: 'text' | 'object' | 'background'
  shotIds: number[]
  observations: TrackObservation[]
  intervals: VisibilityInterval[]
  movement: Movement
  /** How the sightings were linked into one identity: 'single' (nothing linked), the backend's occurrence grouping or recurring linkage, or its persistent-element derivation. Never this module's own position matching. */
  linkage: { by: 'single' | 'occurrence_group' | 'recurring_element' | 'persistent_visual_element'; ids: number[]; crossesShotBoundary: boolean }
}

export type Readiness = 'native_text' | 'native_shape' | 'image_layer' | 'needs_user_asset' | 'needs_background_restoration' | 'not_reliable'
export interface ReadinessResult { state: Readiness; reasons: string[]; limitations: string[] }

export interface VisualElement {
  schema: typeof VISUAL_ELEMENT_SCHEMA
  id: string
  /** Reference-video seconds of the first and last sighting (the draft's own timeline is the reconstructor's business). */
  first: number
  last: number
  /** A representative box on a sampled still, normalised 0..1, top-left origin. */
  box: Rect
  /** Present for text elements: the best reading (highest OCR confidence) and every distinct reading. */
  text?: { best: string; readings: string[]; ocrConfidence: number | null }
  /** Present for object elements: the detector's own label, verbatim. */
  detectorLabel?: string
  classification: Classification
  track: Track
  readiness: ReadinessResult
  /** What this element NEVER claims. All false. */
  claims: { originalAssetRecovered: false; backgroundSeparated: false; exactStyleRecovered: false }
}

export const NO_CLAIMS = { originalAssetRecovered: false, backgroundSeparated: false, exactStyleRecovered: false } as const

/** A person's correction of a class. Everything else (readiness, track) is recomputed from it. */
export interface ClassCorrection { class: VisualClass }
export type ClassCorrections = Readonly<Record<string, ClassCorrection>>

export const levelOf = (score: number): ConfidenceLevel => (score >= 0.75 ? 'high' : score >= 0.45 ? 'medium' : 'low')
export const round3 = (n: number) => Math.round(n * 1000) / 1000
