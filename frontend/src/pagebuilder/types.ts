/**
 * Page Builder — core config model.
 *
 * This is the data shape a page is described BY, not the JSX that renders it. A page is a tree:
 *   PageConfig -> SectionConfig[] -> ElementConfig[] (elements may themselves be containers with
 *   their own `children: ElementConfig[]`, so nesting is arbitrary depth, not just two levels).
 *
 * Nothing about layout direction is assumed to be "one normal vertical page forever" — a
 * SectionConfig's `role` covers top/left/right nav and floating/sticky panels alongside ordinary
 * content sections (see Section 3 of the brief), and a full-screen "scene" is just a section with
 * `layout: 'freeform'` and `fullscreen: true`.
 *
 * DELIBERATE V1 SCOPE DECISION (documented, not hidden): elements render in NORMAL DOCUMENT FLOW
 * by the page's own responsive CSS (exactly the fluid, breakpoint-aware layout the current
 * PositioningLandingPage.css already implements) UNTIL an element has an explicit `x`/`y`
 * (from a drag) or `width`/`height` (from a resize) override recorded for the active breakpoint.
 * Only then does the renderer apply that as a positioning/sizing override on top of the flow
 * layout. This is what keeps VIEW MODE visually identical to today's page until someone actually
 * edits something in EDIT MODE — a full absolute-canvas rewrite of the whole page was judged out
 * of scope for a first checkpoint (see the report's "known limitations" section) and would risk
 * breaking a design that isn't approved yet anyway.
 */

export type PageBuilderMode = 'view' | 'edit'

export type Breakpoint = 'desktop' | 'tablet' | 'mobile'

export type ElementType =
  | 'text'
  | 'image'
  | 'button'
  | 'icon'
  | 'shape'
  | 'container'
  | 'card'
  | 'navigation'
  | 'video'
  | 'badge'
  | 'divider'

export type SectionRole =
  | 'top-nav'
  | 'left-nav'
  | 'right-nav'
  | 'content'
  | 'floating'
  | 'sticky'
  | 'footer'

export type SectionLayout = 'flow' | 'freeform'

export type AnimationTrigger =
  | 'page-load'
  | 'viewport-enter'
  | 'scroll'
  | 'hover'
  | 'click'
  | 'focus'
  | 'time-delay'
  | 'section-enter'
  | 'section-exit'

/** Registry key — see AnimationPresets.ts for which of these are actually wired up in v1
 * (unimplemented ones stay selectable in the UI as "coming soon" so the picker shows the full
 * intended library without pretending every effect exists yet — Section 16 of the brief). */
export type AnimationPresetId =
  | 'none'
  | 'fade-in'
  | 'fade-out'
  | 'slide-in-left'
  | 'slide-in-right'
  | 'slide-in-up'
  | 'slide-in-down'
  | 'scale-in'
  | 'scale-out'
  | 'blur-reveal'
  | 'stagger-children'
  | 'parallax'
  | 'image-zoom'
  | 'text-reveal'
  | 'wipe-mask'
  | 'crossfade'

export interface AnimationConfig {
  preset: AnimationPresetId
  trigger: AnimationTrigger
  durationMs: number
  delayMs: number
  easing?: string
  /** Distance in px for slide presets, or scale delta for scale presets. */
  intensity?: number
  /** Repeat every time the trigger fires (e.g. every hover) vs only the very first time. */
  once: boolean
}

export const DEFAULT_ANIMATION: AnimationConfig = {
  preset: 'none',
  trigger: 'viewport-enter',
  durationMs: 600,
  delayMs: 0,
  once: true,
}

/** Optional interaction rule beyond the built-in animation slot — schema provisioned per Section
 * 14 of the brief; only a small subset of trigger/response pairs are actually wired in v1 (see
 * useInteractions.ts). Kept separate from AnimationConfig because an interaction can target a
 * DIFFERENT element (`targetId`), where an element's own `animation` always plays on itself. */
export interface InteractionRule {
  id: string
  trigger: AnimationTrigger
  response: 'animate' | 'show' | 'hide' | 'navigate' | 'toggle-class'
  targetId?: string
  /** For response: 'animate' — which preset to run on the target. */
  preset?: AnimationPresetId
  /** For response: 'navigate' — the path/URL to go to. */
  href?: string
}

export type ObjectFit = 'cover' | 'contain' | 'fill'

export interface ImageProps {
  src: string | null
  alt: string
  /** IMAGE OBJECT SIZE — the image's own natural rendering box (Section 8: distinct from the
   * frame). Left undefined to size from the element's own width/height. */
  objectWidth?: number
  objectHeight?: number
  fit: ObjectFit
  /** Focal point as % of the image, used by `fit: cover` cropping. */
  focalX: number
  focalY: number
  /** IMAGE FRAME / CROP SIZE — an inset crop rectangle in % of the frame, independent of the
   * frame's own width/height (which live on the element's own width/height fields). */
  crop: { top: number; right: number; bottom: number; left: number }
  zoom: number
  aspectRatioLocked: boolean
  opacity: number
  rotationDeg: number
  borderRadius: number
}

export const DEFAULT_IMAGE_PROPS: ImageProps = {
  src: null,
  alt: '',
  fit: 'cover',
  focalX: 50,
  focalY: 50,
  crop: { top: 0, right: 0, bottom: 0, left: 0 },
  zoom: 1,
  aspectRatioLocked: true,
  opacity: 1,
  rotationDeg: 0,
  borderRadius: 0,
}

/**
 * Every styling field here is OPTIONAL and, unless the user has actually edited it in the
 * property panel, stays unset — the element's own `className` (the existing, not-yet-approved
 * page's CSS) decides font/size/weight/color/etc., exactly as today. This matters because inline
 * styles always beat class-based CSS regardless of specificity: if these defaulted to concrete
 * values (even "sensible-looking" ones like `color: 'inherit'`), every migrated text element would
 * silently override the page's own fluid `clamp()` typography and brand colors the moment it
 * rendered — breaking the "View Mode looks exactly like today" guarantee before a single edit was
 * ever made. Only an explicit user edit should ever populate one of these fields.
 */
export interface TextProps {
  content: string
  as: 'h1' | 'h2' | 'h3' | 'p' | 'span' | 'label'
  fontFamily?: string
  fontSizePx?: number
  fontWeight?: number
  lineHeight?: number
  letterSpacingPx?: number
  align?: 'left' | 'center' | 'right'
  color?: string
  background?: string
}

export const DEFAULT_TEXT_PROPS: TextProps = {
  content: '',
  as: 'p',
}

export interface ButtonProps {
  label: string
  href?: string
  variant: 'primary' | 'secondary' | 'link'
  icon?: string
}

/** Positioning/sizing override for ONE breakpoint. Every field optional — an unset field means
 * "fall back to normal flow / the desktop override / the CSS default," in that order. */
export interface ResponsiveOverride {
  x?: number
  y?: number
  width?: number
  height?: number
  fontSizePx?: number
  align?: 'left' | 'center' | 'right'
  visible?: boolean
  focalX?: number
  focalY?: number
  layoutDirection?: 'row' | 'column'
}

export interface ElementConfig {
  id: string
  type: ElementType
  parentId: string | null
  /** Human label shown in the layers panel / property panel header — never rendered on the page. */
  name: string

  // Box model (desktop/base values; see `responsive` for per-breakpoint overrides).
  x: number
  y: number
  width: number | 'auto'
  height: number | 'auto'
  minWidth?: number
  minHeight?: number
  maxWidth?: number
  maxHeight?: number
  padding?: string
  margin?: string
  background?: string
  overflow?: 'visible' | 'hidden' | 'auto'
  zIndex: number

  visible: boolean
  locked: boolean

  /** Reuses the current, not-yet-approved page's own CSS classes so the migrated config renders
   * visually identically in View Mode (Section 28/35 — this is a functional-shell migration, not
   * a redesign). A future approved-UI pass can replace these with its own classes/tokens without
   * touching the config SHAPE. */
  className?: string
  /** Escape hatch for the one piece of the page that is genuinely interactive React (the lead-
   * capture form), which doesn't fit the plain text/image/button element model. Kept to exactly
   * one value in v1 rather than a generic "arbitrary component" hole, so it stays auditable. */
  custom?: 'lead-capture-form'

  /** Container-only: the DOM tag to render as (defaults to 'div'). Needed only when the migrated
   * page's own CSS has a TAG-qualified selector (e.g. `.pl-cta-points li`) rather than a pure
   * class selector — a plain div would silently fail to match those rules. */
  tag?: 'div' | 'ul' | 'li'

  /** Freeform x/y only takes effect once this is true (i.e. the element has actually been
   * dragged/resized at least once) — see the module docstring's "deliberate v1 scope decision." */
  positionOverridden: boolean
  sizeOverridden: boolean

  responsive: Partial<Record<Breakpoint, ResponsiveOverride>>
  animation: AnimationConfig
  interactions: InteractionRule[]

  // Type-specific payloads — exactly one of these is populated, matching `type`.
  text?: TextProps
  image?: ImageProps
  button?: ButtonProps

  children?: ElementConfig[]
}

export type SectionBackgroundType = 'none' | 'color' | 'gradient' | 'image' | 'video'

/** Section backgrounds as a first-class editable layer, distinct from `SectionConfig.background`
 * (the existing raw CSS value the current, not-yet-approved page's own classes supply — kept
 * untouched for visual fidelity). This is ADDITIVE: `type: 'none'` (the default on every existing
 * section) renders nothing extra and changes nothing visually; setting a real type layers an
 * actual, editable background (color/gradient/image/video) with its own fit/crop/focal/opacity
 * controls, reusing the same ImageProps shape Section 8's image elements already use so an image
 * background gets the identical replace/fit/focal/zoom/opacity capabilities. `responsive` allows
 * a light per-breakpoint treatment (Section 12) without inventing a second, parallel override
 * system — opacity/focal-point/visibility are the fields actually worth tuning per breakpoint for
 * a background layer; position/size follow the section's own responsive width automatically. */
export interface SectionBackgroundConfig {
  type: SectionBackgroundType
  color?: string
  gradient?: string
  image?: ImageProps
  videoSrc?: string
  opacity: number
  responsive?: Partial<Record<Breakpoint, { opacity?: number; focalX?: number; focalY?: number; visible?: boolean }>>
}

export const DEFAULT_SECTION_BACKGROUND: SectionBackgroundConfig = { type: 'none', opacity: 1 }

export interface SectionConfig {
  id: string
  name: string
  role: SectionRole
  layout: SectionLayout
  fullscreen?: boolean
  sticky?: 'normal' | 'sticky' | 'fixed' | 'pinned-for-duration'
  background?: string
  backgroundLayer?: SectionBackgroundConfig
  className?: string
  elements: ElementConfig[]
}

export interface PageConfig {
  id: string
  name: string
  sections: SectionConfig[]
}
