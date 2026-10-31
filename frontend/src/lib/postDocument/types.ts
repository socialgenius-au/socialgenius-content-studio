// Post Document — the data model of a "Post" in SocialGenius.
//
// A post is DATA, not markup: PostDocument -> PostPage -> PostElement -> (renderer) -> canvas. Pure TypeScript; no React, no DOM,
// no dependency on Video Studio's timeline model or on any AI provider.
//
// UNITS (the rules every field below follows)
//  * Geometry is CANVAS-RELATIVE, 0..1 — never screen/browser pixels:
//      x, width  = fraction of the canvas WIDTH        y, height = fraction of the canvas HEIGHT
//      x/y is the element's top-left corner; text may use height 'auto' (sized by its content).
//  * Typography, strokes, corner radii and padding are fractions of the canvas SHORTER side (min(width, height)). A headline with
//    fontSize 0.07 is 7% of the shorter side whatever the export size, so it scales with the canvas.
//  * Rotation is in degrees, opacity is 0..1.
//
// LAYERING: the order of `PostPage.elements` IS the paint order (index 0 = back, last = front). There is deliberately no zIndex and no
// separate layer-order array, so nothing can disagree with the array. Group children follow the same rule inside their group.
//
// COLOURS are document/brand colours, independent of the SocialGenius UI theme: a literal hex, or a brand token with a literal fallback.
import type { PostElementRole } from './roles'

export const POST_DOCUMENT_SCHEMA_VERSION = 1 as const

// ── paints ───────────────────────────────────────────────────────────────────────────────────

/** A literal hex colour ("#1E8A55") or a brand token that always carries a literal fallback so the document renders without a Brand Kit. */
export type ColorRef = string | { token: string; fallback: string }
export type FontRef = string | { token: string; fallback: string }

export interface GradientStop { offset: number; color: ColorRef }
/** CSS-style angle in degrees (0 = to top, 90 = to right, 180 = to bottom). */
export interface Gradient { kind: 'gradient'; angle: number; stops: GradientStop[] }
export type Paint = ColorRef | Gradient

export interface Point { x: number; y: number }
export interface Rect { x: number; y: number; width: number; height: number }

// ── image sources ────────────────────────────────────────────────────────────────────────────

export type ImageSource =
  | { kind: 'asset'; assetId?: number; url?: string }
  /** A slot filled from the Brand Kit later (not resolved in P2). */
  | { kind: 'brand'; slot: 'logo' | 'mark' }
  /** No real image yet (e.g. the mock logo wordmark, or an AI-generated image still to come). */
  | { kind: 'placeholder'; label: string; glyph?: 'sparkles' | 'none' }

export type Background =
  | { kind: 'solid'; color: ColorRef }
  | Gradient
  | { kind: 'image'; source: ImageSource; fit: 'cover' | 'contain'; focal?: Point }

// ── reserved: platform adaptation hints (schema only — no behaviour in P2) ───────────────────

export type AdaptAnchor = 'top-left' | 'top-center' | 'top-right' | 'middle-left' | 'center' | 'middle-right' | 'bottom-left' | 'bottom-center' | 'bottom-right'
export type AdaptPriority = 'must' | 'high' | 'normal' | 'low'

export interface AdaptHints {
  anchor?: AdaptAnchor
  priority?: AdaptPriority
  /** Allowed scale range as multiples of the master size. */
  scale?: { min?: number; max?: number }
  keepAspect?: boolean
  /** How the element relates to a platform's UI safe area. */
  safeArea?: 'inside' | 'avoid-ui' | 'ignore'
  allowCrop?: boolean
  allowHide?: boolean
  /** Readability floor for text, as a fraction of the shorter side. */
  minFontSize?: number
}

// ── provenance (provider-neutral) ────────────────────────────────────────────────────────────

export type ProvenanceOrigin = 'manual' | 'template' | 'ai_generated' | 'imported' | 'adapted'

export interface Provenance {
  origin: ProvenanceOrigin
  templateId?: string
  importRef?: string
  adaptedFrom?: { documentId: string; platformKey: string; formatKey: string }
  generation?: {
    briefRef?: string
    intelligenceRefs?: { kind: string; id: string }[]
    promptSummary?: string
    generatedAt?: string
    /** Free-text label of whatever produced it. Deliberately not tied to any provider. */
    engine?: string
  }
  note?: string
}

// ── elements ─────────────────────────────────────────────────────────────────────────────────

/** Common to every element. */
export interface ElementBase {
  id: string
  /** WHY the element exists (see roles.ts) — not how it looks. */
  role: PostElementRole
  /** Human-readable layer name. */
  name: string
  x: number
  y: number
  width: number
  /** A fraction of the canvas height, or 'auto' (text only: sized by its content). */
  height: number | 'auto'
  rotation: number
  opacity: number
  visible: boolean
  /** Data only in P2: the flag survives save/reopen; nothing enforces it yet. */
  locked: boolean
  /** Reserved for platform adaptation. Most elements will not need it: role defaults will supply it. */
  adapt?: AdaptHints
  /** Who made this element (lets AI Select distinguish hand-made from generated elements). */
  origin?: ProvenanceOrigin
}

export interface TextStyle {
  fontFamily: FontRef
  /** Fraction of the shorter canvas side. */
  fontSize: number
  fontWeight: number
  italic?: boolean
  /** Unitless multiplier. */
  lineHeight: number
  /** Fraction of the shorter canvas side. */
  letterSpacing?: number
  align: 'left' | 'center' | 'right'
  color: ColorRef
}

/** Optional chip/pill behind the text — this is how a CTA or badge is modelled (a text element with a box). All lengths: shorter-side fractions. */
export interface TextBox {
  fill?: Paint
  stroke?: { color: ColorRef; width: number }
  radius?: number
  paddingX?: number
  paddingY?: number
}

export interface ElementAction {
  kind: 'link' | 'call' | 'message' | 'none'
  value?: string
}

export interface TextElement extends ElementBase {
  type: 'text'
  /** Plain text; "\n" is a line break. (Rich-text runs are deferred.) */
  content: string
  style: TextStyle
  /**
   * fixed          — the box is exactly x/y/width/height (height numeric).
   * auto-height    — width fixed, height follows the content.
   * auto-width     — shrink-wraps the content; `width` is the maximum.
   * shrink-to-fit  — RESERVED (font shrinks to fit; adaptation feature).
   */
  autoSize: 'fixed' | 'auto-height' | 'auto-width' | 'shrink-to-fit'
  maxLines?: number
  box?: TextBox
  action?: ElementAction
}

export interface ImageElement extends ElementBase {
  type: 'image'
  source: ImageSource
  /** 'cover' or 'contain' only — an image is never stretched. */
  fit: 'cover' | 'contain'
  /** Normalized crop rectangle within the source (reserved; not rendered in P2). */
  crop?: Rect
  /** Focal point within the source, 0..1 each. */
  focal?: Point
  alt?: string
  /** Always true for a brand_logo. */
  lockAspect: boolean
  /** Fraction of the shorter side. */
  cornerRadius?: number
  /** Brand clear-space around a logo as a fraction of the logo's height (reserved). */
  clearSpace?: number
}

export interface ShapeElement extends ElementBase {
  type: 'shape'
  shape: 'rect' | 'ellipse' | 'line'
  fill?: Paint
  stroke?: { color: ColorRef; width: number }
  cornerRadius?: number
}

export interface GroupElement extends ElementBase {
  type: 'group'
  /** Paint order back -> front. Child geometry is relative to THIS group's box (0..1 of the group). */
  children: PostElement[]
  clip?: boolean
}

export type PostElement = TextElement | ImageElement | ShapeElement | GroupElement
export type PostElementType = PostElement['type']

// ── pages & document ─────────────────────────────────────────────────────────────────────────

/** One canvas. A normal post has exactly one page; a future carousel has several. */
export interface PostPage {
  id: string
  name?: string
  background: Background
  /** PAINT ORDER, back -> front. The single authority for layering. */
  elements: PostElement[]
}

/** Snapshot of the registry choice this document was designed for (export pixels). Stored, so a reopened post never shifts if the registry changes. */
export interface DocumentFormat {
  platformKey: string
  formatKey: string
  width: number
  height: number
  ratio: string
}

// ── reserved: master + variants (schema only — nothing creates or applies these in P2) ────────
//
// The master pages above stay authoritative. A variant is a set of SPARSE manual overrides keyed by element id, layered on top of a layout
// that is computed from the master (never stored), so a master edit or a re-adapt can never silently overwrite a manual variant edit.

export interface ElementPatch {
  x?: number; y?: number; width?: number; height?: number | 'auto'
  rotation?: number; opacity?: number; visible?: boolean
  /** Text-only overrides (e.g. a shorter headline for a smaller format). */
  content?: string
  fontSize?: number
}

export interface PostVariant {
  /** `${platformKey}/${formatKey}` */
  key: string
  format: DocumentFormat
  /** 'linked' = computed from the master + overrides; 'detached' = a fully independent copy (reserved escape hatch). */
  mode: 'linked' | 'detached'
  /** Master `revision` this variant's overrides were last reconciled against (stale/conflict detection). */
  basedOnRevision: number
  overrides: Record<string, ElementPatch>
  /** Variant-only elements, per page id. */
  addedElements?: Record<string, PostElement[]>
}

export interface PostDocument {
  kind: 'post'
  schemaVersion: typeof POST_DOCUMENT_SCHEMA_VERSION
  id: string
  title: string
  /** Incremented on every content edit of the master. */
  revision: number
  format: DocumentFormat
  /** P2: exactly one. The renderer draws pages[0]. */
  pages: PostPage[]
  context: {
    brand?: { clientId?: string; clientName?: string; brandKitId?: string }
    message?: { keyMessage?: string; audience?: string; objective?: string; cta?: string; language?: string }
  }
  provenance: Provenance
  variants?: Record<string, PostVariant>
  createdAt: string
  updatedAt: string
}
