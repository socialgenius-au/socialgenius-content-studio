// M2.3a -- the BACKGROUND kind of the reconstruction contract (see ../textlayers/contract.ts for the three rules every kind obeys: evidence is immutable, every property
// says where it came from, nothing is claimed beyond the evidence).
//
// What the reference really offers: about one small still per few seconds. From a still this path can MEASURE flat bands along the edges (letterbox / pillarbox bars), the
// colours along the border and how plain or busy that border is. It cannot recover what lies behind text or graphics, a gradient's exact curve, or a texture. So the only thing
// it ever rebuilds is a flat block of a measured colour in a measured bar, and it says so.
export {
  RECONSTRUCTION_SCHEMA, deepFreeze, round3, clamp, measured, inferred, defaulted, fromUser,
  type Rect, type Basis, type Level, type Prop,
} from '../textlayers/contract'

export const BACKGROUND_ENGINE_VERSION = '1.0.0'

export type Side = 'top' | 'bottom' | 'left' | 'right'
export const SIDES: readonly Side[] = ['top', 'bottom', 'left', 'right']
export type VarianceClass = 'solid' | 'gradient' | 'busy'
export const VARIANCE_LABEL: Record<VarianceClass, string> = { solid: 'Plain colour', gradient: 'Smooth gradient', busy: 'Busy (picture or texture)' }

/** What a plate never claims. Always false -- the type makes any other value a compile error. */
export const NO_CLAIMS = { backgroundRecovered: false, contentBehindOverlaysRecovered: false, inpainted: false } as const

export const LIMITATIONS: readonly string[] = [
  'Only flat bands along a still’s edges are measured. Nothing behind text, graphics or the picture itself is recovered, and nothing is painted over or removed.',
  'A plate is one flat colour. A gradient or a texture is reported as such, but is not rebuilt.',
  'The stills are small and sparse (about one per few seconds), so a colour is a measurement of a few samples, not a copy.',
  'Plates sit above your footage in the editor. They only make sense where your footage does not reach the bar; if it does, leave the plate out.',
  'Colours measured from a reference are facts about its pixels, not content; no picture from the reference is copied by this step.',
]

// measurement tolerances (summed absolute RGB difference, 0..765)
export const UNIFORM_TOLERANCE = 36             // one pixel versus its line's mean
export const BAR_COLOUR_TOLERANCE = 18          // every line of one bar stays this close to the bar's first line (a drifting colour is a gradient, not a bar)
export const BAR_EDGE_STEP = 30                 // and the line where the bar ends differs from the bar by at least this much, or is not flat at all (a bar has an edge; a gradient has none)
export const UNIFORM_SHARE = 0.985              // a line counts as flat when this share of its sampled pixels is within tolerance
export const MIN_BAR = 0.02                     // a band thinner than 2% of the frame is not a bar
export const MAX_BAR = 0.45                     // a band over 45% is not a letterbox bar: the frame is mostly one colour
export const RING = 0.06                        // the outer 6% of the frame is "the border"
export const MIN_PLATE = 0.03                   // a plate thinner than 3% of the canvas is not worth a layer
export const ASPECT_TOLERANCE = 0.08            // reference frame versus canvas proportions
export const DEFAULT_UNIFORMITY = 0.97

export type BackgroundFlagCode = 'single_frame' | 'seen_in_some_frames' | 'aspect_differs' | 'thin' | 'not_uniform' | 'frame_size_unknown' | 'footage_overlap' | 'footage_size_unknown' | 'no_footage_yet'
export interface BackgroundFlag { code: BackgroundFlagCode; severity: 'info' | 'warning'; message: string }
