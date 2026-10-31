// M2.2a -- the IMAGE kind of the reconstruction contract (see ../textlayers/contract.ts for the three rules every kind obeys:
// evidence is immutable, every property says where it came from, nothing is claimed beyond the evidence).
//
// What is different about images, and why the wording here is careful: the reference is a FLATTENED video. A detector can say "a region of this frame was
// labelled X", and a person can say "an image stood here", but nobody has a separate, clean copy of the thing. So this path never extracts or isolates
// anything. A slot is a rectangle on a frame; the picture that fills it is either the person's own upload (the normal case) or a plain rectangular crop of
// the reference frame (opt-in, with the background included, at the frame's low resolution, and only after the person confirms they may use it).
export {
  RECONSTRUCTION_SCHEMA, deepFreeze, round3, clamp, iou, measured, inferred, defaulted, fromUser,
  type Rect, type Basis, type Level, type Prop,
} from '../textlayers/contract'

export const IMAGE_ENGINE_VERSION = '1.0.0'

export type ImageSource = 'user_upload' | 'reference_frame_crop'
export type CandidateOrigin = 'detected_region' | 'user_region'

export type ImageFlagCode =
  | 'person_detected' | 'low_confidence' | 'box_only' | 'single_frame' | 'timing_inferred' | 'region_too_small' | 'frame_size_assumed'
export type Severity = 'info' | 'warning'
export interface ImageFlag { code: ImageFlagCode; severity: Severity; message: string }

/** What the layer never claims. Always false -- the type makes any other value a compile error. */
export const NO_CLAIMS = { isolated: false, backgroundRemoved: false, burnedInContentRemoved: false, originalResolutionRecovered: false } as const

export const LIMITATIONS: readonly string[] = [
  'The reference is a flattened video. Nothing was cut out, isolated or removed: whatever stood in this region is still in its pixels.',
  'A detected region is only a bounding box with a label from a general object detector. It is not an outline of the object and not a logo finder.',
  'A crop of the reference is a plain rectangle of one low-resolution still, with its background included. It is enlarged to fit, so it will look soft.',
  'When the image appeared and disappeared is only known to within the gaps between sampled frames; a single sighting says nothing about how long it stayed.',
  'The editor has no rotation or crop for image layers yet, and exports draw image layers beneath text.',
]

export const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'] as const
/** A sanity limit for what the review panel accepts (the server allows far more); the export has to hold the picture in memory. */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024
export const MIN_REGION = 0.01                     // a region narrower or shorter than 1% of the frame cannot hold a readable image
export const MIN_VISIBLE_SECONDS = 0.5
