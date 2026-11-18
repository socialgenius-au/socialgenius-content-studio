// M5 -- turn a visual element into a region the EXISTING image-slot panel understands (a ManualRegion on a sampled still), so a person who says "this text is really my logo" gets a slot to fill with their own
// image at the place the analysis saw it. Nothing is fabricated: the box is the analysis's, the class is theirs, and the image has to be theirs too.
import type { ManualRegion } from '../imagelayers/candidates'
import type { VisualElement } from '../visual/contract'

/** The element's best sighting that sits on a sampled still. Null when none does (then the person marks the region by hand). */
export function manualRegionFromElement(e: VisualElement): ManualRegion | null {
  const obs = [...e.track.observations].filter(o => o.frameId !== null).sort((a, b) => (b.ocrConfidence ?? 0) - (a.ocrConfidence ?? 0) || a.time - b.time)[0]
  if (!obs || obs.box.w <= 0 || obs.box.h <= 0) return null
  return { id: `user:ve:${e.id}`, frameId: obs.frameId as number, region: { x: obs.box.x, y: obs.box.y, w: obs.box.w, h: obs.box.h } }
}
