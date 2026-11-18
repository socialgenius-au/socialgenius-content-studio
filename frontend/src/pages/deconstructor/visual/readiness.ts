// M4.3 -- RECONSTRUCTION READINESS: given what an element is and how sure we are, what could be rebuilt as a native editable layer. "Could be", never "has been": this module only says what is possible and
// what the limits are; M5 decides what was actually generated.
//
// The architecture rebuilds a reference's look on the person's OWN footage. The reference's pictures are never inserted into the result, so there is no original text or graphic left underneath a rebuilt layer
// to duplicate or to remove; what the reconstruction cannot do is recover the reference's own pixels, exact fonts or effects, and the limitations below say so.
import type { Classification, ReadinessResult, Track, VisualClass } from './contract'
import { isTextClass } from './contract'

export const MIN_TEXT_CONFIDENCE_FOR_NATIVE = 0.35

export interface ReadinessInput { classification: Classification; track: Track; ocrConfidence: number | null; hasText: boolean; boxArea: number; objectLabel?: string; flatBackground?: boolean }

const textLimits = ['Font, weight and effects are not recovered: the layer uses the editor’s own text, with size and colour estimated from a small still.', 'Timing is a guess between sampled frames (stills are a few seconds apart).']

export function readinessOf(i: ReadinessInput): ReadinessResult {
  const c = i.classification.class as VisualClass
  const sightings = i.track.observations.length
  if (c === 'UNKNOWN') {
    const person = /person/i.test(i.classification.explanation[0] ?? '')
    return { state: 'not_reliable', reasons: [person ? 'A person in the reference’s own footage is not a graphic; the reconstruction uses your footage.' : 'The evidence does not say what this is, so nothing is rebuilt from it automatically.'], limitations: ['You can set a class yourself to change this.'] }
  }
  if (isTextClass(c)) {
    if (!i.hasText || (i.ocrConfidence !== null && i.ocrConfidence < MIN_TEXT_CONFIDENCE_FOR_NATIVE)) return { state: 'not_reliable', reasons: ['The text reading is missing or too unsure to rebuild.'], limitations: [] }
    const reasons = ['A recognised reading and its position are stored, so it can be rebuilt as an editable text layer.']
    const limitations = [...textLimits]
    if (c === 'TEXT_SUBTITLE') limitations.push('A subtitle line is better rebuilt from the transcript (the Transcript panel); as a text layer it is one fixed line.')
    if (c === 'TEXT_HANDLE') limitations.push('A handle or watermark may be your own handle to type, not the reference’s: check the wording before using it.')
    if (sightings < 2) limitations.push('Seen once: how long it stayed is not known.')
    return { state: 'native_text', reasons, limitations }
  }
  if (c === 'BACKGROUND_ELEMENT') {
    if (i.flatBackground === false) return { state: 'needs_background_restoration', reasons: ['A gradient or busy background is not one flat colour.'], limitations: ['A gradient is rebuilt as two flat steps at most; a texture is not rebuilt. Real restoration is out of scope and would need a separately approved design.'] }
    return { state: 'native_shape', reasons: ['A flat band of one measured colour can be rebuilt as a native rectangle or banner shape.'], limitations: ['It is drawn above your footage, so it only makes sense where your footage does not reach it.', 'Nothing behind overlays or text is recovered.'] }
  }
  if (c === 'IMAGE_REGION') {
    return { state: 'needs_user_asset', reasons: [`Only a labelled box${i.objectLabel ? ` (“${i.objectLabel}”)` : ''} is known, not the picture itself.`], limitations: ['Supply your own image to fill the slot. A crop of the reference would include its background at low resolution and needs your confirmation that you may use it.', 'Nothing was cut out or separated from the reference.'] }
  }
  if (c === 'LOGO_MARK' || c === 'ICON_GRAPHIC') {
    return { state: 'needs_user_asset', reasons: ['You set this as a graphical mark. Its appearance is not in the analysis, so an image of it must come from you.'], limitations: ['A logo is never rebuilt from its text. Without your image the slot stays empty and is reported as a missing asset.'] }
  }
  if (c === 'SHAPE_GRAPHIC') {
    return { state: 'native_shape', reasons: ['You set this as a shape; it can be placed as a native shape at the recorded box.'], limitations: ['Only the box is known: the shape’s outline, colour and style are for you to set.'] }
  }
  return { state: 'not_reliable', reasons: ['No rule applies.'], limitations: [] }
}
