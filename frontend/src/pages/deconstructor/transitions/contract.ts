// M2.4a -- the TRANSITION kind of the reconstruction contract (see ../textlayers/contract.ts for the three rules every kind obeys: evidence is immutable, every
// property says where it came from, nothing is claimed beyond the evidence).
//
// What the analysis really has: for each detected cut, a short window of MEASUREMENTS -- how much consecutive sampled frames differ, and how bright they are. It stores no
// transition name, no effect, no curve. So this path only ESTIMATES a type from those measurements, only for the three signatures the measurements can honestly tell apart
// (hard cut, dissolve, fade through black), and leaves whip pan and zoom punch to the person. The editor offers exactly five types; the original effect and its
// settings are never recovered.
import type { VideoClip } from '../../../types'
export { deepFreeze, round3, clamp, fromUser, measured, inferred, defaulted, type Basis, type Level, type Prop } from '../textlayers/contract'

export type TransitionKind = VideoClip['transition']
export const TRANSITION_KINDS: readonly TransitionKind[] = ['cut', 'dissolve', 'fade_black', 'whip_pan', 'zoom_punch']
/** The only kinds the classifier ever proposes. The others exist in the editor and can be chosen by a person. */
export const DETECTABLE_KINDS: readonly TransitionKind[] = ['cut', 'dissolve', 'fade_black']
export const KIND_LABEL: Record<TransitionKind, string> = { cut: 'Hard cut', dissolve: 'Dissolve', fade_black: 'Fade through black', whip_pan: 'Whip pan', zoom_punch: 'Zoom punch' }

export const TRANSITIONS_ENGINE_VERSION = '1.0.0'
export type Confidence = 'high' | 'medium' | 'low'

export const MIN_DURATION = 0.2
export const MAX_DURATION = 2.0
export const DEFAULT_DURATION = 0.5                  // the editor's own default for a clip's transition

/** What the plan never claims. Always false -- the type makes any other value a compile error. */
export const NO_CLAIMS = { originalEffectRecovered: false, originalSettingsRecovered: false } as const

export const LIMITATIONS: readonly string[] = [
  'The analysis stores measurements around each cut, not the effect that was used. The type here is an estimate from those measurements.',
  'Only a hard cut, a dissolve and a fade through black can be told apart from the measurements, and a blink or fade of white is recognised from the brightness (the editor has no white transition, so it is proposed as a hard cut or a dissolve). Whip pan and zoom punch are never guessed: they are yours to choose.',
  'A dissolve-like signature can also be fast motion or a flash. It is flagged, and the person decides.',
  'The reference’s cuts and the blueprint’s scene joins are different things. A cut is applied only to a scene join close to it in time; the rest stay hard cuts.',
]
