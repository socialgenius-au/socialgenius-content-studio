export interface User {
  id: number
  username: string
  email: string
  role: string
}

export interface TokenResponse {
  access_token: string
  token_type: string
  user_id: number
  username: string
  role: string
}

export interface JobStep {
  step: number
  action: string
  description: string
  tool: string
  inputs: string[]
  outputs: string[]
  estimated_duration: string
}

export interface JobPlan {
  title: string
  summary: string
  platforms: string[]
  content_types: string[]
  steps: JobStep[]
  estimated_total_time: string
  brand_guidelines_applied: boolean
  error?: string
}

export interface Job {
  id: number
  user_id: number
  brand_id: number | null
  title: string
  prompt: string
  plan_json: JobPlan | null
  status: 'pending' | 'running' | 'done' | 'failed'
  created_at: string
  updated_at: string
}

export interface Brand {
  id: number
  user_id: number
  name: string
  colors: Record<string, string>
  fonts: Record<string, string>
  logo_url: string | null
  tone_of_voice: string | null
  created_at: string
  updated_at: string
}

export interface Template {
  id: number
  user_id: number
  name: string
  description: string | null
  prompt: string
  plan_json: JobPlan | null
  created_at: string
  updated_at: string
}

export interface Asset {
  id: number
  job_id: number | null
  user_id: number
  original_filename: string
  stored_filename: string
  file_path: string
  file_type: string
  mime_type: string
  file_size: number
  created_at: string
}

// Video Deconstructor — Stage 2 (Reference Video Ingestion) and Stage 3 (Technical Analysis).
// Mirrors backend app/schemas/reference_video.py exactly; see reference_videos.py's own module
// docstring for scope.
export interface VideoAnalysisSummary {
  id: number
  analysis_tier: 'quick' | 'standard' | 'deep'
  status: 'pending' | 'running' | 'complete' | 'failed'
  created_at: string
  started_at: string | null
  completed_at: string | null
  // Populated on a real failure of whichever pass most recently failed (Stage 3's
  // technical_probe, or Stage 4's scene_segmentation) — a real, truthful message, never
  // fabricated.
  error: string | null
  // Stage 4: each named pass's own state, tracked independently — e.g.
  // {"technical_probe": "complete", "scene_segmentation": "running"}. A running/failed
  // scene_segmentation never implies technical_probe's own already-complete state changed.
  pass_status: Record<string, string>
}

// One Stage-5 representative still frame extracted from a Shot. certainty is always "MEASURED" —
// every field here is a direct, deterministic fact about the extracted image itself (timestamp,
// dimensions, pixel measurements), never an interpretation of what it shows. measurements mirrors
// TechnicalDetails' own "small versioned JSON payload" convention:
// {width, height, luminance_mean, is_black_frame, sharpness_score}.
export interface ShotFrameSummary {
  id: number
  order: number
  timestamp: number
  extraction_method: string
  width: number
  height: number
  measurements: Record<string, number | boolean>
  certainty: string
  evidence_summary: string | null
  produced_by_pass: string | null
  // The extracted frame's own file — build a thumbnail URL via the existing
  // assetsApi.previewUrl(), same helper ReferenceVideo.asset_file_path already uses.
  asset_file_path: string
}

// One RAW OCR observation (Stage 6) — a single engine reading of a single candidate frame.
// Always certainty "MEASURED". Never edited/merged/dropped once written — the permanent,
// auditable evidence record a TextElementSummary's own `observations` list is built from.
export interface TextObservationSummary {
  id: number
  text: string
  timestamp: number
  x: number
  y: number
  width: number
  height: number
  confidence_score: number | null
  evidence_summary: string | null
  source_frame_asset_file_path: string | null
}

// One Stage-6 Occurrence Group, represented by its own canonical head observation (the group's
// highest-confidence raw reading — never a synthetic average). certainty is always "MEASURED" —
// the recognized string, geometry, and confidence_score (the OCR engine's own reported
// confidence) are all direct recognizer output on this one head row. category is always null
// until a later, genuinely INFERRED stage populates it — Stage 6 cannot honestly know a text
// occurrence's ROLE from OCR alone. `observations` carries EVERY raw detection grouped under
// this head (head included, never hidden); start_time/end_time are this group's derived span
// (earliest/latest member) — never a claim of continuous visibility across it.
export interface TextElementSummary {
  id: number
  text: string
  start_time: number
  end_time: number
  x: number
  y: number
  width: number
  height: number
  certainty: string
  confidence_score: number | null
  category: string | null
  style_details: Record<string, unknown> | null
  evidence_summary: string | null
  produced_by_pass: string | null
  source_frame_asset_file_path: string | null
  observations: TextObservationSummary[]
}

// A cross-reference between 2+ Occurrence Groups (by TextElementSummary.id) that probably
// represent the same real on-screen element reappearing — e.g. a watermark seen at separated
// moments. Explicitly, unconditionally certainty "INFERRED" — never confused with the
// unconditionally "MEASURED" TextElementSummary/TextObservationSummary above it. Carries no
// merged time-span claim beyond start_time/end_time (the outer bounds of its own members) —
// visibility in any gap between members is never claimed.
export interface RecurringElementSummary {
  id: number
  member_text_element_ids: number[]
  start_time: number
  end_time: number
  certainty: string
  confidence_score: number | null
  reasoning: string | null
  evidence_summary: string | null
  produced_by_pass: string | null
}

// One deterministically-detected cut-bounded segment (Stage 4). certainty is always "MEASURED".
// evidence_summary carries the detector's own score/threshold as human-readable text — detector
// evidence, not semantic confidence (a separate, unused-here confidence_score field is reserved
// for later, genuinely INFERRED judgments).
export interface ShotSummary {
  id: number
  order: number
  start_time: number
  end_time: number
  certainty: string
  evidence_summary: string | null
  produced_by_pass: string | null
  // Stage 5's representative-frame evidence set for this Shot, chronological order — empty
  // until visual-evidence extraction completes at least once.
  frames: ShotFrameSummary[]
  // Stage 6's OCR text occurrences for this Shot, chronological order — empty until text
  // analysis completes at least once.
  text_elements: TextElementSummary[]
}

// Mirrors backend app/services/ffmpeg_svc._empty_technical_details() exactly — a controlled,
// versioned structure (schema_version), not an unrestricted raw-ffmpeg dump. Every non-null
// value is directly observed/measured by ffmpeg's own container/stream metadata; null means
// "not reliably determined by this probe mechanism," never a guess. Derived-only values (aspect
// ratio label, etc.) are deliberately absent here — see CreateEditTab's deriveAspectRatioLabel.
export interface TechnicalDetails {
  schema_version: number
  probe: { mechanism: string; ffmpeg_build: string | null }
  container: {
    format_name: string | null
    format_long_name: string | null
    duration_seconds: number | null
    size_bytes: number | null
    bitrate_kbps: number | null
  }
  video: {
    codec_name: string | null
    codec_long_name: string | null
    profile: string | null
    width: number | null
    height: number | null
    coded_width: number | null
    coded_height: number | null
    pixel_format: string | null
    sample_aspect_ratio: string | null
    display_aspect_ratio: string | null
    frame_rate: number | null
    average_frame_rate: number | null
    time_base: string | null
    frame_count: number | null
    bitrate_kbps: number | null
    rotation_degrees: number | null
    duration_seconds: number | null
  }
  audio: {
    present: boolean
    codec_name: string | null
    codec_long_name: string | null
    sample_rate_hz: number | null
    channels: number | null
    channel_layout: string | null
    bitrate_kbps: number | null
    duration_seconds: number | null
  }
  streams: { count: number; video_count: number; audio_count: number }
}

export interface ReferenceVideo {
  id: number
  asset_id: number
  original_filename: string
  // Reference Preview (post-Stage-4 UI gap fix): the underlying Asset's own file_path — build a
  // preview URL with the existing assetsApi.previewUrl(), same as every editor clip already
  // does. Never used to write/modify anything; read-only source for an independent player.
  asset_file_path: string
  source: 'upload' | 'url'
  original_url: string | null
  rights_status: 'owned' | 'licensed' | 'unknown_third_party'
  created_at: string
  latest_analysis: VideoAnalysisSummary
  technical_details: TechnicalDetails | null
  // Stage 4's deterministically-detected shot segments, chronological order — empty until
  // structural analysis completes at least once.
  shots: ShotSummary[]
  // Stage 6's Recurring Element cross-references — video-level (a recurring element may span
  // multiple Shots), not nested under any one Shot; empty until text analysis completes at
  // least once, and even then only present when 2+ Occurrence Groups were actually linked.
  recurring_elements: RecurringElementSummary[]
}

// ── Studio types ──────────────────────────────────────────────────────────────

export type Platform =
  | 'instagram_post'
  | 'instagram_reel'
  | 'instagram_story'
  | 'tiktok'
  | 'youtube_short'
  | 'youtube_16_9'
  | 'facebook_post'
  | 'facebook_reel'
  | 'linkedin_post'
  | 'pinterest'
  | 'twitter_x'

export interface PlatformSpec {
  label: string
  width: number
  height: number
  aspectRatio: string
  safeZoneTop: number
  safeZoneBottom: number
}

export type ContentType = 'video' | 'image' | 'carousel' | 'audio' | 'blog' | 'newsletter'

export interface VideoClip {
  id: string
  assetId?: number
  url: string
  name: string
  duration: number
  startTime: number
  endTime: number
  trimIn: number
  trimOut: number
  colorGrade: 'none' | 'warm' | 'cool' | 'cinematic' | 'bw' | 'high_contrast' | 'desaturated' | 'sepia'
  speed: 0.25 | 0.5 | 0.75 | 1 | 1.25 | 1.5 | 2
  brightness: number
  contrast: number
  saturation: number
  transition: 'cut' | 'dissolve' | 'whip_pan' | 'fade_black' | 'zoom_punch'
  transitionDuration: number
  // Step 7 (Original Video Audio controls): this clip's OWN embedded audio only — mirrors
  // MediaOverlay's own muted/volume convention exactly. Independent of, and additive to, the
  // existing "muted once separated to A1" auto-mute rule (Step 7.6A) — this is a separate,
  // explicit per-clip control the user can set regardless of whether an A1 track exists for
  // it. Optional/undefined (treated as unmuted/100%) for any clip created before this field
  // existed, so it never needs a migration.
  muted?: boolean
  volume?: number
  // STEP 7 (Platform Canvas / Full-Screen Video Acceptance): how this clip's source frame maps
  // onto the platform canvas box when their aspect ratios differ (near-universal across 7
  // platform formats spanning 9:16 down to 2:3 — a single source rarely matches all of them).
  // 'fit' (the long-standing default, so every clip authored before this field existed renders
  // exactly as it always has) letterboxes/pillarboxes to show the whole frame, same as CSS
  // object-fit:contain. 'fill' scales to cover the entire canvas with no bars, cropping
  // whichever dimension overflows — same as object-fit:cover — which is what "Crop &
  // Reposition" in the toolbar switches a clip into; cropOffsetX/Y (both 0-100, default 50/50
  // = centered) are that crop's position, directly usable as CSS object-position so the
  // preview and export share the exact same positioning math. Optional/undefined (treated as
  // 'fit'/50/50) for any clip created before this field existed.
  fitMode?: 'fit' | 'fill'
  cropOffsetX?: number
  cropOffsetY?: number
  // Phase 1 (V2 Inserts/B-roll): canvas placement, meaningful ONLY on an entry in
  // StudioContext's additionalVideoClips array (V2) — a V1 clip never sets these and stays
  // full-frame exactly as before. Percent-of-canvas, same convention as MediaOverlay's own
  // x/y/width/height, so the same drag/resize math already used for Overlay applies unchanged.
  // Undefined on any V2 clip until it's actually moved/resized — insertAdditionalVideoClipAt
  // gives every new V2 clip an explicit starting box, so this is never read as "undefined" in
  // practice, just optional for type-safety/backward-compat.
  insertX?: number
  insertY?: number
  insertWidth?: number
  insertHeight?: number
  // Phase 1 — Requirement 5 ("opacity where appropriate"): meaningful only on a V2 clip, same
  // 0-100 convention MediaOverlay's own `opacity` field would use if it were on that scale
  // (MediaOverlay's is actually 0-1 — VideoClip's other %-based fields here are all 0-100, so
  // this follows THIS type's own convention instead). Undefined/100 = fully opaque.
  opacity?: number
  // Phase 1: how a V2 clip's own embedded audio is handled — meaningful ONLY when the source
  // video actually has an embedded audio track (probeHasAudioTrack). 'keep' mirrors it onto an
  // independent AudioTrack (A1), exactly like V1's own embedded-audio separation. 'muted' and
  // 'removed' both mean "play back silent, no AudioTrack created" at this layer — genuinely
  // stripping the audio stream from the file is an export-time (ffmpeg) concern, out of Phase
  // 1's scope (preview/canvas/timeline only) — the distinct value is still stored so a later
  // export phase can act on the user's real choice rather than only ever seeing "muted".
  brollAudio?: 'keep' | 'muted' | 'removed'
  // Phase 1: id of the AudioTrack (in StudioContext's audioTracks/A1) created when brollAudio
  // was set to 'keep' — lets switching back to 'muted'/'removed' clean up that exact track
  // (and switching to 'keep' again be a no-op if it's still there) instead of stacking
  // duplicate tracks on repeated toggling. Undefined whenever brollAudio isn't 'keep'.
  brollAudioTrackId?: string
}

export interface TextOverlay {
  id: string
  text: string
  x: number
  y: number
  width: number
  startTime: number
  endTime: number
  fontFamily: string
  fontSize: number
  bold: boolean
  italic: boolean
  color: string
  bgColor: string
  bgOpacity: number
  animation: 'none' | 'fade_in' | 'slide_left' | 'slide_right' | 'slide_top' | 'slide_bottom' | 'typewriter' | 'pop'
  // Layers reorder: canvas paint order relative to other visual (Text/Overlay) elements — higher
  // paints later (more in front). Shares one numeric space with MediaOverlay.order so the two
  // types can freely interleave. Optional/undefined (treated as 0) for any element created
  // before this field existed, so it never needs a migration.
  order?: number
}

export interface MediaOverlay {
  id: string
  url: string
  assetId: number
  x: number
  y: number
  width: number
  height: number
  opacity: number
  startTime: number
  endTime: number
  // Step 5 follow-up: audio properties for a video-backed Overlay (ignored for an image-backed
  // one) — mirrors AudioTrack's own `volume` field/convention rather than inventing a new one.
  muted?: boolean
  volume?: number
  // Step 5 follow-up: same non-destructive colour-grade/adjustment fields VideoClip already
  // has, extended to Overlay so Filters/Adjust can apply to a visual Overlay (image or video)
  // too, per that step's requirement — same field shapes, so both share one rendering helper.
  colorGrade?: VideoClip['colorGrade']
  brightness?: number
  contrast?: number
  saturation?: number
  // Layers reorder: see TextOverlay.order — same shared numeric space.
  order?: number
}

export interface AudioTrack {
  id: string
  assetId?: number
  url: string
  name: string
  volume: number
  startTime: number
  endTime: number
  trimIn: number
  trimOut: number
  pauseAt?: number
  resumeAt?: number
  fadeIn: number
  fadeOut: number
  duck: boolean
}

export interface ImageSlide {
  id: string
  assetId?: number
  url: string
  name: string
  filter: 'none' | 'bw' | 'warm' | 'cool' | 'vintage' | 'high_contrast' | 'vivid' | 'cinematic'
  animation: 'none' | 'ken_burns_in' | 'ken_burns_out' | 'pan_left' | 'pan_right' | 'float' | 'pulse'
  duration: number
  transition: 'dissolve' | 'wipe' | 'fade' | 'zoom_punch'
}

export type ApprovalGateStatus = 'waiting' | 'approved' | 'rejected' | 'none'

export interface ApprovalGate {
  id: string
  message: string
  status: ApprovalGateStatus
  timestamp: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: string
  approvalGate?: ApprovalGate
}

export interface SEOPackage {
  instagramCaption?: string
  instagramHashtags?: string
  instagramGeotag?: string
  youtubeTitle?: string
  youtubeDescription?: string
  youtubeTags?: string
  youtubeChapters?: string
  tiktokCaption?: string
  tiktokTrendingSound?: string
  gmbPost?: string
}

export interface LowerThird {
  id: string
  name: string
  title: string
  animation: 'slide_left' | 'fade_in' | 'pop_up'
  duration: number
  positionY: number
  showLogo: boolean
  startTime: number
}

export interface IntroOutro {
  type: 'intro' | 'outro'
  templateId?: string
  duration: number
  logoUrl?: string
  tagline?: string
  ctaText?: string
  socialHandles?: string
  animation: string
}
