// M1 / Stage 1 -- Assembly engine types. PURE data shapes: no React, no network, no storage.
//
// WHAT THIS MODULE FAMILY DOES
//   blueprint PLAN (structure inferred from a reference)  +  footage the USER supplied  +  which footage goes in which scene
//   ->  a Video Studio V2 draft snapshot (the exact shape the editor's own Save/Open Draft uses)  +  an honest report.
//
// WHAT IT DELIBERATELY DOES NOT DO
//   * It never uses the reference video's own footage, text or graphics (see ElementKind / referenceAssetIds).
//   * It never claims flattened reference content (burned-in text, baked-in effects, the original audio mix) is editable.
//   * It makes no network call, no model call, and touches no storage: the caller decides what to do with the result.
import type { Asset, TextOverlay, VideoClip } from '../../../types'
import type { BlueprintDraftSnapshot, BlueprintPlan } from '../../video-studio-v2/blueprint/blueprintPlan'

export const ASSEMBLY_SCHEMA = 'assembly-v1' as const
export const ASSEMBLY_ENGINE_VERSION = '1.0.0'

/** The speeds the editor and the exporter both understand (VideoClip.speed). */
export const ALLOWED_SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2] as const
export type ClipSpeed = (typeof ALLOWED_SPEEDS)[number]

/** Tolerance for floating-point time comparisons (one millisecond). All emitted times are rounded to 3 decimals. */
export const TIME_EPSILON = 0.001
/** A placement shorter than this is not worth a timeline clip; it is reported instead. */
export const MIN_CLIP_SECONDS = 0.1

// ── inputs ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Footage the user supplied (already uploaded). `key` is the caller's own stable handle for it. */
export interface FootageClip {
  key: string
  assetId: number             // the backend Asset id; required, because export resolves media by asset id
  url: string                 // playable URL the editor will load (same value the Media panel uses)
  name: string
  duration: number            // source length in seconds
  hasAudio?: boolean
  asset?: Asset               // optional full record, so the Media panel can list it when the draft opens
}

/** One piece of footage placed in a scene. Everything but `footageKey` is optional and has a documented default. */
export interface ClipUse {
  footageKey: string
  trimIn?: number             // seconds into the source where this use starts (default 0)
  useDuration?: number        // TIMELINE seconds this clip occupies (default: an equal share of the scene's remaining time)
  speed?: ClipSpeed           // default 1 (or chosen by the 'stretch' policy when the source is too short and no speed was given)
  fit?: 'fit' | 'fill'        // how the frame maps onto the canvas; omitted = the editor's own default
  muted?: boolean
  volume?: number             // 0..1
}

export interface SceneAssignment {
  sceneNumber: number         // == blueprint section_number
  clips: ClipUse[]            // played in this order, back to back, from the scene's start
}

/** What to do when the footage assigned to a scene is shorter than the scene. */
export type UnderfilledPolicy = 'gap' | 'stretch'

export interface AssemblyOptions {
  /** 'gap' (default): use what exists and report the uncovered seconds. 'stretch': slow the clip to an allowed speed to fill the scene when one fits. */
  underfilled?: UnderfilledPolicy
  /** If true, every scene must have at least one clip, otherwise assembly fails with `missing_clips`. Default false: unassigned scenes keep their placeholders. */
  requireAllScenes?: boolean
  /** Asset ids that belong to REFERENCE videos. Footage with one of these ids is refused: a reconstruction never reuses the reference's own media. */
  referenceAssetIds?: number[]
  /** Elements the caller would like. Unsupported ones are reported (never silently faked); partial ones are noted. */
  requestedElements?: ElementKind[]
  identity?: { client?: string | null; campaign?: string | null }
}

export interface AssemblyInput {
  plan: BlueprintPlan
  footage: FootageClip[]
  assignments: SceneAssignment[]
  /** ISO timestamp supplied by the caller. The engine never reads a clock, so assembly is reproducible. */
  createdAt: string
  options?: AssemblyOptions
}

// ── what can and cannot be edited (Requirement: automatically / partially editable vs unsupported) ──────────────────────────────────

export type Editability = 'automatic' | 'partial' | 'unsupported'

export type ElementKind =
  // rebuilt as real, editable Video Studio V2 elements
  | 'scene_structure' | 'clip_placement' | 'clip_trim' | 'clip_speed' | 'text_placeholder' | 'cta_placeholder'
  // the editor can hold them, but assembly does not generate them (the blueprint only gives plain-language direction)
  | 'transition' | 'voiceover' | 'music' | 'captions' | 'lower_third' | 'shape'
  // flattened inside the reference video: never extracted, never presented as editable
  | 'reference_footage' | 'reference_burned_in_text' | 'reference_graphics' | 'reference_color_grade' | 'reference_effects' | 'reference_audio_mix'

export interface ElementClass {
  kind: ElementKind
  editability: Editability
  reason: string
}

// ── provenance (Requirement: keep source evidence, inferred structure and replacement media distinct) ───────────────────────────────

export type Origin = 'reference_evidence' | 'inferred_structure' | 'user_supplied' | 'placeholder' | 'none'

export interface SceneEvidence {
  origin: 'reference_evidence'          // what was MEASURED / observed in the reference video, carried over as traceability only
  referenceVideoId: number
  videoAnalysisId: number
  anatomySections: number[]
  confidence: string
  limitations: string[]
}

export interface SceneStructure {
  origin: 'inferred_structure'          // what the blueprint INFERRED the new video should do; not evidence, not content
  purpose: string
  structuralRole: string
  mechanismIds: string[]
  instructions: {
    content: string; visual: string; text: string; speech: string; pacing: string; transition: string | null; cta: string | null
  }
  mandatoryPoints: { id: string; text: string }[]
}

export interface PlacedClip {
  elementId: string                     // the VideoClip.id in the draft
  footageKey: string
  assetId: number
  name: string
  sourceDuration: number
  trimIn: number
  trimOut: number
  speed: ClipSpeed
  timelineStart: number
  timelineEnd: number
}

export interface SceneMedia {
  origin: 'user_supplied' | 'none'      // 'none' = nothing was supplied for this scene: it stays an empty, clearly marked scene
  clips: PlacedClip[]
  coverage: { filledSeconds: number; gapSeconds: number; status: 'filled' | 'partial' | 'empty' }
}

export interface SceneText {
  origin: 'placeholder'                 // the text is an instruction to replace, never final copy
  textElementId: string
  ctaElementId: string | null
  replaced: false                       // assembly never replaces it; a person does, in the editor
  editability: 'automatic'              // it is a real V2 text overlay
}

export interface AssembledScene {
  sceneNumber: number
  order: number
  startTime: number
  endTime: number
  duration: number
  evidence: SceneEvidence
  structure: SceneStructure
  media: SceneMedia
  text: SceneText
}

export type IssueSeverity = 'error' | 'warning' | 'note'
export type IssueCode =
  | 'invalid_plan' | 'inconsistent_scene_timing' | 'invalid_footage' | 'duplicate_footage_key' | 'footage_missing_asset'
  | 'reference_media_not_allowed' | 'unknown_scene' | 'duplicate_assignment' | 'missing_footage' | 'invalid_trim'
  | 'invalid_duration' | 'invalid_speed' | 'invalid_option' | 'scene_overflow' | 'missing_clips'
  | 'scene_unassigned' | 'scene_underfilled' | 'clip_too_short' | 'no_video_clips' | 'unsupported_element'
  | 'partial_element' | 'footage_reused' | 'footage_unused' | 'placeholder_text_present'

export interface AssemblyIssue {
  severity: IssueSeverity
  code: IssueCode
  message: string
  sceneNumber?: number
  footageKey?: string
}

export interface AssemblyRecord {
  schema: typeof ASSEMBLY_SCHEMA
  engineVersion: string
  blueprintId: string
  referenceVideoId: number
  videoAnalysisId: number
  createdAt: string
  inputDigest: string                   // identical inputs -> identical digest (repeatable assembly)
  scenes: AssembledScene[]
  summary: {
    scenes: number; scenesWithMedia: number; scenesWithoutMedia: number; clipsPlaced: number
    plannedSeconds: number; filledSeconds: number; gapSeconds: number
  }
  elementClasses: ElementClass[]        // the editable / partial / unsupported table, stored with the draft so the editor side can show it
  unsupported: { kind: ElementKind; reason: string }[]   // what the caller asked for that was NOT produced
  issues: AssemblyIssue[]               // warnings and notes (errors never reach a snapshot)
}

/** The existing blueprint draft snapshot, with real clips and media, plus the assembly record. Extra keys are ignored by the editor's open-draft path. */
export type AssembledDraftSnapshot = Omit<BlueprintDraftSnapshot, 'videoClips' | 'mediaAssets' | 'textOverlays'> & {
  videoClips: VideoClip[]
  textOverlays: TextOverlay[]
  mediaAssets: Asset[]
  assembly: AssemblyRecord
}

export type AssemblyResult =
  | { ok: true; name: string; snapshot: AssembledDraftSnapshot; issues: AssemblyIssue[] }
  | { ok: false; issues: AssemblyIssue[] }
