// Shared Platform & Format Registry — types.
//
// ONE description of "where content is published and at what canvas size", meant to be the source of truth for Video Studio, Post Creator,
// Carousel Creator and any future content tool. Pure data + pure functions: no React, no network, no browser APIs.
//
// Everything here is expressed in the platform's own pixel size (`width`/`height`) plus percentages for safe areas. Nothing is a screen
// coordinate: a consumer fits the canvas into whatever space it has with `fitCanvasBox` and works in canvas-relative units.

export type MasterRatio = '9:16' | '16:9' | '1:1' | '4:5' | '1.91:1' | '2:3' | '4:3' | 'CUSTOM'

/** What kind of content a placement can carry. */
export type MediaType = 'image' | 'video' | 'carousel'

/** How the placement is used on the platform. `link_post` = 1.91:1 image/link card. */
export type PlacementKind = 'post' | 'story' | 'reel' | 'video' | 'carousel' | 'pin' | 'link_post' | 'general'

/**
 * Approximate area (percent of the canvas, measured inward from each edge) that the platform's own interface tends to cover.
 * These are APPROXIMATIONS drawn from the guides already used in this codebase — not published platform specifications — and are
 * only present where such data exists. `approximate` is always true so no consumer presents them as guarantees.
 */
export interface SafeArea {
  top: number
  bottom: number
  left: number
  right: number
  approximate: true
}

export interface Placement {
  /** Unique within its platform (e.g. "feed_portrait"). Platform + placement key together identify a format. */
  key: string
  /** Label as used by Video Studio V2 (kept identical for parity). */
  label: string
  /** Optional label to use when the V2 label reads as video-only (e.g. "Landscape Video") in an image/post context. */
  postLabel?: string
  ratio: MasterRatio
  width: number
  height: number
  kind: PlacementKind
  mediaTypes: MediaType[]
  safeArea?: SafeArea
  /** Legacy `/studio` Platform keys (frontend/src/types `Platform`) that correspond to this placement — for future compatibility. */
  legacyAliases?: string[]
  /** Free-text caveat shown to reviewers, e.g. an assumption about media support. */
  note?: string
}

export interface PlatformGroup {
  key: string
  label: string
  /** Format a still-image / post tool selects first when this platform is chosen (must be one of `placements`). */
  defaultPostFormatKey?: string
  placements: Placement[]
}

/** A user's current choice. `customSize` only matters when the chosen placement's ratio is CUSTOM. */
export interface FormatSelection {
  platformKey: string
  formatKey: string
  customSize: { width: number; height: number }
}

export interface ResolvedCanvas {
  platformKey: string
  platformLabel: string
  formatKey: string
  formatLabel: string
  ratio: MasterRatio
  width: number
  height: number
  kind: PlacementKind
  isCustom: boolean
  /** Reduced ratio text for display, e.g. "4:5", "1.91:1" or "1000:667" for an arbitrary custom size. */
  ratioLabel: string
  safeArea?: SafeArea
}
