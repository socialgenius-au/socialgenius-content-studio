// Shared Platform & Format Registry — DATA.
//
// The first block of placements for each platform is a COPY of Video Studio V2's `CANVAS_PLATFORMS`
// (frontend/src/pages/video-studio-v2/data/canvasFormats.ts): identical keys, labels, ratios and pixel sizes, in the same order. A parity
// test (registry.test.ts) fails if the two ever drift, so Video Studio can adopt this registry later without any behaviour change.
// Video Studio does NOT consume this file yet.
//
// Additions approved for post creation are appended AFTER the copied placements of their platform:
//   Instagram Carousel 4:5, Facebook 1.91:1 image/link post, LinkedIn 1.91:1 image/link post.
//
// `mediaTypes` says what each placement can carry. Where a placement was defined for video (e.g. YouTube Standard Video) and is also
// used for still images (thumbnails, community posts), 'image' is listed with a `note`; these are working assumptions for Ayub to confirm.
//
// `safeArea` values reuse the approximations already in this codebase (V2's platform UI zone: bottom 14% / right 8% on vertical
// formats; the legacy /studio per-platform top/bottom fractions) and are only set where that data exists.
import type { PlatformGroup, SafeArea } from './types'

const safe = (top: number, bottom: number, left = 0, right = 0): SafeArea => ({ top, bottom, left, right, approximate: true })

export const PLATFORM_FORMATS: PlatformGroup[] = [
  {
    key: 'instagram', label: 'Instagram', defaultPostFormatKey: 'feed_portrait', placements: [
      { key: 'reel_story', label: 'Reel / Story', ratio: '9:16', width: 1080, height: 1920, kind: 'story', mediaTypes: ['image', 'video'], safeArea: safe(10, 20, 0, 8), legacyAliases: ['instagram_reel', 'instagram_story'] },
      { key: 'feed_portrait', label: 'Feed Portrait', ratio: '4:5', width: 1080, height: 1350, kind: 'post', mediaTypes: ['image', 'video', 'carousel'] },
      { key: 'square', label: 'Square', ratio: '1:1', width: 1080, height: 1080, kind: 'post', mediaTypes: ['image', 'video', 'carousel'], legacyAliases: ['instagram_post'] },
      { key: 'landscape', label: 'Landscape', ratio: '1.91:1', width: 1080, height: 566, kind: 'post', mediaTypes: ['image', 'video'] },
      { key: 'carousel', label: 'Carousel', ratio: '4:5', width: 1080, height: 1350, kind: 'carousel', mediaTypes: ['carousel', 'image'], note: 'Each carousel slide uses the 4:5 feed portrait size.' },
    ],
  },
  {
    key: 'facebook', label: 'Facebook', defaultPostFormatKey: 'feed_portrait', placements: [
      { key: 'reel_story', label: 'Reel / Story', ratio: '9:16', width: 1080, height: 1920, kind: 'story', mediaTypes: ['image', 'video'], safeArea: safe(10, 20, 0, 8), legacyAliases: ['facebook_reel'] },
      { key: 'feed_portrait', label: 'Feed Portrait', ratio: '4:5', width: 1080, height: 1350, kind: 'post', mediaTypes: ['image', 'video'] },
      { key: 'square', label: 'Square', ratio: '1:1', width: 1080, height: 1080, kind: 'post', mediaTypes: ['image', 'video'] },
      { key: 'landscape', label: 'Landscape', ratio: '16:9', width: 1920, height: 1080, kind: 'post', mediaTypes: ['image', 'video'] },
      { key: 'link_post', label: 'Image / Link Post', ratio: '1.91:1', width: 1200, height: 630, kind: 'link_post', mediaTypes: ['image'], legacyAliases: ['facebook_post'] },
    ],
  },
  {
    key: 'tiktok', label: 'TikTok', defaultPostFormatKey: 'vertical', placements: [
      { key: 'vertical', label: 'Vertical Video', postLabel: 'Vertical', ratio: '9:16', width: 1080, height: 1920, kind: 'video', mediaTypes: ['video', 'image'], safeArea: safe(10, 25, 0, 8), legacyAliases: ['tiktok'], note: 'Image use assumes TikTok photo posts.' },
      { key: 'square', label: 'Square', ratio: '1:1', width: 1080, height: 1080, kind: 'video', mediaTypes: ['video'] },
      { key: 'landscape', label: 'Landscape', ratio: '16:9', width: 1920, height: 1080, kind: 'video', mediaTypes: ['video'] },
    ],
  },
  {
    key: 'youtube', label: 'YouTube', defaultPostFormatKey: 'standard', placements: [
      { key: 'standard', label: 'Standard Video', postLabel: 'Landscape 16:9', ratio: '16:9', width: 1920, height: 1080, kind: 'video', mediaTypes: ['video', 'image'], safeArea: { top: 0, bottom: 5, left: 0, right: 0, approximate: true }, legacyAliases: ['youtube_16_9'], note: 'Image use assumes thumbnails / community images.' },
      { key: 'shorts', label: 'Shorts', ratio: '9:16', width: 1080, height: 1920, kind: 'video', mediaTypes: ['video'], safeArea: safe(5, 15, 0, 8), legacyAliases: ['youtube_short'] },
      { key: 'square', label: 'Square', ratio: '1:1', width: 1080, height: 1080, kind: 'post', mediaTypes: ['image', 'video'], note: 'Image use assumes community posts.' },
    ],
  },
  {
    key: 'linkedin', label: 'LinkedIn', defaultPostFormatKey: 'square', placements: [
      { key: 'landscape_video', label: 'Landscape Video', postLabel: 'Landscape', ratio: '16:9', width: 1920, height: 1080, kind: 'post', mediaTypes: ['video', 'image'] },
      { key: 'portrait_video', label: 'Portrait Video', postLabel: 'Portrait', ratio: '4:5', width: 1080, height: 1350, kind: 'post', mediaTypes: ['video', 'image'] },
      { key: 'vertical_video', label: 'Vertical Video', ratio: '9:16', width: 1080, height: 1920, kind: 'video', mediaTypes: ['video'] },
      { key: 'square', label: 'Square', ratio: '1:1', width: 1080, height: 1080, kind: 'post', mediaTypes: ['image', 'video'] },
      { key: 'link_post', label: 'Image / Link Post', ratio: '1.91:1', width: 1200, height: 627, kind: 'link_post', mediaTypes: ['image'], legacyAliases: ['linkedin_post'] },
    ],
  },
  {
    key: 'pinterest', label: 'Pinterest', defaultPostFormatKey: 'pin', placements: [
      { key: 'pin', label: 'Pin', ratio: '2:3', width: 1000, height: 1500, kind: 'pin', mediaTypes: ['image'], safeArea: safe(0, 10), legacyAliases: ['pinterest'] },
      { key: 'video_pin', label: 'Video Pin', ratio: '9:16', width: 1080, height: 1920, kind: 'video', mediaTypes: ['video'] },
      { key: 'square', label: 'Square', ratio: '1:1', width: 1000, height: 1000, kind: 'pin', mediaTypes: ['image', 'video'] },
    ],
  },
  {
    key: 'x', label: 'X', defaultPostFormatKey: 'landscape', placements: [
      { key: 'landscape', label: 'Landscape', ratio: '16:9', width: 1920, height: 1080, kind: 'post', mediaTypes: ['image', 'video'], legacyAliases: ['twitter_x'], note: 'Legacy /studio used 1200×675 (same 16:9 ratio).' },
      { key: 'square', label: 'Square', ratio: '1:1', width: 1080, height: 1080, kind: 'post', mediaTypes: ['image', 'video'] },
      { key: 'portrait', label: 'Portrait', ratio: '9:16', width: 1080, height: 1920, kind: 'video', mediaTypes: ['video'] },
    ],
  },
  {
    key: 'google_business', label: 'Google Business Profile', defaultPostFormatKey: 'landscape', placements: [
      { key: 'landscape', label: 'Landscape', ratio: '4:3', width: 1200, height: 900, kind: 'post', mediaTypes: ['image'] },
      { key: 'square', label: 'Square', ratio: '1:1', width: 1200, height: 1200, kind: 'post', mediaTypes: ['image'] },
    ],
  },
  {
    key: 'website', label: 'Website / General', defaultPostFormatKey: 'full_hd_landscape', placements: [
      { key: 'full_hd_landscape', label: 'Full HD Landscape', ratio: '16:9', width: 1920, height: 1080, kind: 'general', mediaTypes: ['image', 'video'] },
      { key: 'hd_landscape', label: 'HD Landscape', ratio: '16:9', width: 1280, height: 720, kind: 'general', mediaTypes: ['image', 'video'] },
      { key: 'square', label: 'Square', ratio: '1:1', width: 1080, height: 1080, kind: 'general', mediaTypes: ['image', 'video'] },
      { key: 'vertical', label: 'Vertical', ratio: '9:16', width: 1080, height: 1920, kind: 'general', mediaTypes: ['image', 'video'] },
      { key: 'custom', label: 'Custom Size', ratio: 'CUSTOM', width: 1080, height: 1080, kind: 'general', mediaTypes: ['image', 'video'] },
    ],
  },
]

/** Default selection for new content tools (Instagram Feed Portrait 4:5 — the same ratio Post Creator's mock post already used). */
export const DEFAULT_PLATFORM_KEY = 'instagram'
export const DEFAULT_FORMAT_KEY = 'feed_portrait'
