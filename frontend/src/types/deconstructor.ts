// Types for the Deconstructor -> Reconstructor flow (backend C1 status, C2 anatomy, C3 mechanisms, C4 blueprint).
// Deliberately a READ-side subset: only the fields the UI and the Video Studio mapping actually use. Extra backend fields are ignored.

// ── C1: deconstruction status ────────────────────────────────────────────────────────────────
export type StageRunStatus = 'complete' | 'already_complete' | 'failed' | 'blocked' | 'skipped' | 'not_run' | 'running'

export interface DeconStage {
  key: string
  label: string
  kind: string
  status: StageRunStatus | string
  error: string | null
  reason: string | null
  requires_ai: boolean
}

export interface DeconStatus {
  reference_video_id: number
  video_analysis_id: number
  orchestration: { status?: string; [k: string]: unknown } | null
  stages: DeconStage[]
}

export interface DeconRun extends DeconStatus {
  mode: 'background' | 'inline'
  overall_status: string
}

// ── C2: content anatomy ──────────────────────────────────────────────────────────────────────
export interface AnatomyGap { field: string; kind: string; reason: string; section_number: number | null }

export interface AnatomySpeech { id: number; start_time: number; end_time: number; text: string; language: string | null; overlap_seconds: number }
export interface AnatomyText { id: number; text: string; start_time: number; end_time: number; recurring_element_id: number | null }
export interface AnatomyDevice { id: number; start_time: number; end_time: number; device_type: string | null; probable_attention_function: string | null; confidence: string | null }
export interface AnatomyRejected { attempt_id: number | null; candidate_start: number; candidate_end: number; device_type: string | null; status: string }

export interface AnatomySection {
  number: number
  start_time: number
  end_time: number
  duration: number
  source_partition: string
  is_opening: boolean
  overlaps_hook_window: boolean
  transcript_excerpt: string | null
  speech: AnatomySpeech[]
  on_screen_text: AnatomyText[]
  visual: { objects: { label: string; category: string; count: number }[]; persistent_visual_element_count: number }
  audio: { audio_stream_present: boolean | null; silence_seconds: number }
  pacing: { shot_count: number; cut_count: number }
  retention_devices: AnatomyDevice[]
  rejected_candidates: AnatomyRejected[]
  interpretive: { narrative_role: string | null; messaging_role: string | null; emotional_function: string | null; cta_role: string | null }
  features: string[]
}

export interface Anatomy {
  video: {
    duration: number
    section_count: number
    hook: {
      window: { start_time: number; end_time: number } | null
      hook_section_numbers: number[]
      classification: { primary_type?: string; secondary_types?: string[]; probable_intent?: string } | null
    }
    pacing_profile: { shot_count: number; cut_count: number; average_shot_duration_seconds: number | null; cuts_per_minute: number | null }
    structural_pattern: { summary: string }
    retention: { analysis_status: string; accepted_count: number; examined_count: number }
  }
  section_source: { selected: string | null }
  sections: AnatomySection[]
  gaps: AnatomyGap[]
  provenance: { reference_video_id: number | null; video_analysis_id: number | null; fingerprint: string; anatomy_version: string }
}

// ── C3: transferable mechanisms ──────────────────────────────────────────────────────────────
export type ConfidenceLevel = 'low' | 'medium' | 'high'

export interface NonTransferable { kind: string; description: string }

export interface Mechanism {
  mechanism_id: string
  mechanism_type: string
  other_label: string | null
  statement: string
  scope: 'video' | 'sections'
  section_numbers: number[]
  transferable_principle: string
  non_transferable_elements: NonTransferable[]
  confidence: ConfidenceLevel
  limitations: { model_stated: string[]; anatomy_gaps: { field: string; kind: string; reason: string }[] }
}

export type DerivedStatus = 'not_run' | 'current' | 'stale' | 'unknown'

export interface MechanismSet {
  status: DerivedStatus
  reference_video_id: number
  video_analysis_id: number
  input_pin: { anatomy_fingerprint: string | null; current_anatomy_fingerprint: string | null }
  mechanism_count: number
  mechanisms: Mechanism[]
  overall_limitations: string[]
  provenance: { reasoning_attempt_id: number | null; provider: string | null; model: string | null; prompt_version: string | null } | null
}

// ── C4: reconstruction blueprint ─────────────────────────────────────────────────────────────
export interface NewContentIntent {
  product_service_or_topic: string
  target_audience: string
  objective: string
  business_or_brand?: string | null
  desired_cta?: string | null
  tone_style_constraints?: string[]
  duration_platform_constraints?: { platform?: string | null; target_duration_seconds?: number | null; notes?: string | null } | null
  mandatory_points?: string[]
  prohibited_claims_or_elements?: string[]
}

export interface BlueprintDisposition {
  mechanism_id: string
  mechanism_type: string
  decision: 'USED' | 'NOT_USED'
  reason_category: string | null
  reason: string | null
  applied_in_sections: number[]            // explanatory / audit metadata ONLY
  authoritative_sections?: number[]        // computed from section.mechanisms_applied
  application_rationale: string | null
  transferable_principle: string
}

export interface BlueprintSection {
  section_number: number
  section_purpose: string
  structural_role: string
  target_duration_seconds: number
  mechanisms_applied: string[]             // THE authoritative mechanism -> section mapping
  source_anatomy_relationship: { relationship: string; anatomy_section_numbers: number[] }
  content_instruction: string
  required_information: string[]
  visual_direction: string
  text_direction: string
  speech_direction: string
  pacing_direction: string
  transition_direction: string | null
  cta_direction: string | null
  mandatory_points_assigned: string[]
  prohibited_elements: string[]
  evidence_refs: { anatomy_section_numbers: number[]; mechanism_ids: string[] }
  confidence: ConfidenceLevel
  limitations: string[]
}

export interface BlueprintGap { field: string; kind: string; reason: string }

export interface Blueprint {
  blueprint_id: string
  blueprint_version: string
  intent: NewContentIntent
  intent_summary: string
  structural_approach: string
  target: { platform: string | null; target_duration_seconds: number | null; planned_total_seconds: number }
  mechanisms_used: string[]
  mechanisms_not_used: BlueprintDisposition[]
  mechanism_dispositions: BlueprintDisposition[]
  constraints: {
    tone_style: string[]
    duration_platform: Record<string, unknown> | null
    prohibited_claims_or_elements: string[]
    do_not_reproduce: { mechanism_id: string; kind: string; description: string }[]
    copy_policy: string
    performance_policy: string
  }
  sections: BlueprintSection[]
  mandatory_point_accounting: { id: string; text: string; status: 'ASSIGNED' | 'UNASSIGNED'; section_numbers: number[]; reason: string | null }[]
  gaps: BlueprintGap[]
  limitations: string[]
  provenance: Record<string, unknown>
}

export interface BlueprintResponse {
  status: DerivedStatus
  reused: boolean
  reference_video_id: number
  video_analysis_id: number
  input_pin: {
    anatomy_fingerprint: string | null
    current_anatomy_fingerprint: string | null
    mechanism_attempt_id: number | null
    current_mechanism_attempt_id: number | null
    intent_hash: string | null
  }
  blueprint: Blueprint | null
  provenance: { reasoning_attempt_id: number | null; provider: string | null; model: string | null; prompt_version: string | null } | null
}

export interface BlueprintRequest {
  intent: NewContentIntent
  video_analysis_id?: number | null
  anatomy_fingerprint?: string | null
  mechanism_attempt_id?: number | null
  force?: boolean
}
