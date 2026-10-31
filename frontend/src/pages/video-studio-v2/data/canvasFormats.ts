// Multi-platform canvas system for Video Studio V2 → Create/Edit.
//
// Platforms/placements are UI-facing labels only. Internally everything maps onto a small,
// reusable set of master ratios — no platform gets its own layout/editor logic. Two placements
// that happen to share a ratio (e.g. Instagram Reel and TikTok Vertical, both 9:16) share the
// exact same canvas box, just reached via a different menu entry.

export type MasterRatio = "9:16" | "16:9" | "1:1" | "4:5" | "1.91:1" | "2:3" | "4:3" | "CUSTOM";

export interface CanvasPlacement {
  key: string;
  label: string;
  ratio: MasterRatio;
  width: number;
  height: number;
}

export interface CanvasPlatformGroup {
  key: string;
  label: string;
  placements: CanvasPlacement[];
}

export const CANVAS_PLATFORMS: CanvasPlatformGroup[] = [
  {
    key: "instagram", label: "Instagram", placements: [
      { key: "reel_story", label: "Reel / Story", ratio: "9:16", width: 1080, height: 1920 },
      { key: "feed_portrait", label: "Feed Portrait", ratio: "4:5", width: 1080, height: 1350 },
      { key: "square", label: "Square", ratio: "1:1", width: 1080, height: 1080 },
      { key: "landscape", label: "Landscape", ratio: "1.91:1", width: 1080, height: 566 },
    ],
  },
  {
    key: "facebook", label: "Facebook", placements: [
      { key: "reel_story", label: "Reel / Story", ratio: "9:16", width: 1080, height: 1920 },
      { key: "feed_portrait", label: "Feed Portrait", ratio: "4:5", width: 1080, height: 1350 },
      { key: "square", label: "Square", ratio: "1:1", width: 1080, height: 1080 },
      { key: "landscape", label: "Landscape", ratio: "16:9", width: 1920, height: 1080 },
    ],
  },
  {
    key: "tiktok", label: "TikTok", placements: [
      { key: "vertical", label: "Vertical Video", ratio: "9:16", width: 1080, height: 1920 },
      { key: "square", label: "Square", ratio: "1:1", width: 1080, height: 1080 },
      { key: "landscape", label: "Landscape", ratio: "16:9", width: 1920, height: 1080 },
    ],
  },
  {
    key: "youtube", label: "YouTube", placements: [
      { key: "standard", label: "Standard Video", ratio: "16:9", width: 1920, height: 1080 },
      { key: "shorts", label: "Shorts", ratio: "9:16", width: 1080, height: 1920 },
      { key: "square", label: "Square", ratio: "1:1", width: 1080, height: 1080 },
    ],
  },
  {
    key: "linkedin", label: "LinkedIn", placements: [
      { key: "landscape_video", label: "Landscape Video", ratio: "16:9", width: 1920, height: 1080 },
      { key: "portrait_video", label: "Portrait Video", ratio: "4:5", width: 1080, height: 1350 },
      { key: "vertical_video", label: "Vertical Video", ratio: "9:16", width: 1080, height: 1920 },
      { key: "square", label: "Square", ratio: "1:1", width: 1080, height: 1080 },
    ],
  },
  {
    key: "pinterest", label: "Pinterest", placements: [
      { key: "pin", label: "Pin", ratio: "2:3", width: 1000, height: 1500 },
      { key: "video_pin", label: "Video Pin", ratio: "9:16", width: 1080, height: 1920 },
      { key: "square", label: "Square", ratio: "1:1", width: 1000, height: 1000 },
    ],
  },
  {
    key: "x", label: "X", placements: [
      { key: "landscape", label: "Landscape", ratio: "16:9", width: 1920, height: 1080 },
      { key: "square", label: "Square", ratio: "1:1", width: 1080, height: 1080 },
      { key: "portrait", label: "Portrait", ratio: "9:16", width: 1080, height: 1920 },
    ],
  },
  {
    key: "google_business", label: "Google Business Profile", placements: [
      { key: "landscape", label: "Landscape", ratio: "4:3", width: 1200, height: 900 },
      { key: "square", label: "Square", ratio: "1:1", width: 1200, height: 1200 },
    ],
  },
  {
    key: "website", label: "Website / General", placements: [
      { key: "full_hd_landscape", label: "Full HD Landscape", ratio: "16:9", width: 1920, height: 1080 },
      { key: "hd_landscape", label: "HD Landscape", ratio: "16:9", width: 1280, height: 720 },
      { key: "square", label: "Square", ratio: "1:1", width: 1080, height: 1080 },
      { key: "vertical", label: "Vertical", ratio: "9:16", width: 1080, height: 1920 },
      { key: "custom", label: "Custom Size", ratio: "CUSTOM", width: 1080, height: 1080 },
    ],
  },
];

// Platforms wired into the (future) "Resize for Platforms" batch action — see
// PENDING_REFRAME_NOTE below. Uses each platform group's first/primary placement as the
// default target when generating a version for that platform.
export const RESIZE_TARGET_PLATFORMS = CANVAS_PLATFORMS.map(p => p.key);

export function findPlacement(platformKey: string, placementKey: string): CanvasPlacement | undefined {
  return CANVAS_PLATFORMS.find(p => p.key === platformKey)?.placements.find(pl => pl.key === placementKey);
}

export function defaultPlacementForPlatform(platformKey: string): CanvasPlacement | undefined {
  return CANVAS_PLATFORMS.find(p => p.key === platformKey)?.placements[0];
}

export const DEFAULT_PLATFORM_KEY = "instagram";
export const DEFAULT_PLACEMENT_KEY = "reel_story";

// Fits a target width/height ratio inside a bounding box without ever stretching it —
// same "letterbox to fit" math used for every canvas box in this editor, platform-agnostic.
export function fitCanvasBox(width: number, height: number, maxW: number, maxH: number): { w: number; h: number } {
  const ratio = width / height;
  let w = maxW;
  let h = w / ratio;
  if (h > maxH) {
    h = maxH;
    w = h * ratio;
  }
  return { w: Math.round(w), h: Math.round(h) };
}

// Automatic intelligent reframing (content-aware repositioning of the subject when the aspect
// ratio changes) is NOT implemented. Every version currently uses the same master footage
// letterboxed/pillarboxed into its target ratio — never stretched, never cropped by guesswork.
export const PENDING_REFRAME_NOTE = "Automatic intelligent reframing is not yet implemented — versions currently reuse the master frame as-is, fitted (not stretched) to each platform's canvas.";
