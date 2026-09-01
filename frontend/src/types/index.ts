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
