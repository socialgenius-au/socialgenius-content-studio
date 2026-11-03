// M2.2a -- turn the frozen visual evidence into CANDIDATES a person can review: one per detected region, plus one per region the person drew by hand.
// A candidate is a SLOT (where something stood, on which frame, at which instant), never an image: what fills it is chosen at review. Nothing here edits the
// evidence, and nothing is included by default that is the reference's own footage (people) or that the detector itself is unsure of.
import { MIN_REGION, type CandidateOrigin, type ImageFlag, type Rect } from './contract'
import type { DetectionEvidence, FrameEvidence, ImageEvidence, RecurringMarkEvidence } from './evidence'
import { clampRegion, isValidRegion } from './geometry'
import { estimateFrameTiming, isTimingUncertain, type FrameTiming } from './timing'
import { MIN_VISIBLE_SECONDS } from './contract'

export const LOW_CONFIDENCE = 0.5

/** A region a person drew on a frame. It is not evidence (nothing detected it); it is the person's own statement of where an image stood. */
export interface ManualRegion { id: string; frameId: number; region: Rect }

export interface ImageCandidate {
  id: string
  origin: CandidateOrigin
  label: string                                    // "person (detector label)" or "Region you marked"
  evidence: ({ kind: 'visual_object'; id: number } | { kind: 'recurring_element'; id: number })[]   // empty for a drawn region
  frame: FrameEvidence
  region: Rect                                     // the suggestion: the detector's box, or the region as drawn
  sourceConfidence: number | null                  // the detector's own score; null for a drawn region
  timing: FrameTiming
  flags: ImageFlag[]
  defaultInclude: boolean
}

export const isPerson = (d: Pick<DetectionEvidence, 'label' | 'category'>) => d.category === 'person' || d.label.toLowerCase() === 'person'

const candidateFlags = (origin: CandidateOrigin, label: string, person: boolean, confidence: number | null, region: Rect, timing: FrameTiming, frame: FrameEvidence): ImageFlag[] => {
  const flags: ImageFlag[] = []
  if (person) flags.push({ code: 'person_detected', severity: 'info', message: 'A person was detected here. That is the reference’s own footage, not a graphic, so it is left out unless you choose it.' })
  if (confidence !== null && confidence < LOW_CONFIDENCE) flags.push({ code: 'low_confidence', severity: 'warning', message: `The detector was only ${Math.round(confidence * 100)}% sure of this region.` })
  if (origin === 'detected_region') flags.push({ code: 'box_only', severity: 'info', message: `Only a bounding box labelled “${label}” is known. The object itself is not outlined or separated from its background.` })
  flags.push({ code: 'single_frame', severity: 'info', message: 'Seen on one sampled frame only, so how long it stayed is not known.' })
  flags.push({ code: 'timing_inferred', severity: isTimingUncertain(timing) ? 'warning' : 'info', message: `Start and end are a guess between sampled frames (up to about ${Math.max(timing.startUncertainty, timing.endUncertainty).toFixed(1)} s either way).` })
  if (!isValidRegion(region)) flags.push({ code: 'region_too_small', severity: 'warning', message: `The region is smaller than ${Math.round(MIN_REGION * 100)}% of the frame, too small to hold an image.` })
  if (!(frame.width && frame.height)) flags.push({ code: 'frame_size_assumed', severity: 'info', message: 'The frame’s pixel size was not reported, so crop sizes cannot be checked.' })
  return flags
}

/** A slot from a recurring mark the analysis INFERRED from repeated text. Never included by default; the span is the outer bounds of its sightings, not a claim that it was visible in between. */
function recurringCandidate(r: RecurringMarkEvidence, frameById: ReadonlyMap<number, FrameEvidence>, evidence: ImageEvidence): ImageCandidate {
  const frame = frameById.get(r.frameId)!
  const base = estimateFrameTiming(frame, evidence.frames)
  const timing: FrameTiming = { ...base, start: r.first, end: Math.max(r.last, r.first + MIN_VISIBLE_SECONDS), startUncertainty: 0, endUncertainty: 0, shotStart: Math.min(base.shotStart, r.first), shotEnd: Math.max(base.shotEnd, r.last) }
  const flags: ImageFlag[] = [
    { code: 'recurring_inferred', severity: 'info', message: `Inferred, not detected: the same text (“${r.text.slice(0, 24)}”) was linked across ${r.members} sightings in about the same place${r.confidence !== null ? ` (${Math.round(r.confidence * 100)}% sure)` : ''}. It may be a watermark or logo, but nothing says what it looks like.` },
    { code: 'span_outer_bounds', severity: 'warning', message: 'The span runs from the first to the last sighting. Whether it was visible in between is not known.' },
    { code: 'box_only', severity: 'info', message: 'Only the box around the recognised text is known. The mark itself is not outlined or separated from its background.' },
  ]
  if (!isValidRegion(r.box)) flags.push({ code: 'region_too_small', severity: 'warning', message: `The region is smaller than ${Math.round(MIN_REGION * 100)}% of the frame, too small to hold an image.` })
  return { id: `rec:${r.id}`, origin: 'inferred_region', label: 'Recurring mark (inferred from repeated text)', evidence: [{ kind: 'recurring_element', id: r.id }], frame, region: r.box, sourceConfidence: r.confidence, timing, flags, defaultInclude: false }
}

export function buildImageCandidates(evidence: ImageEvidence, manual: readonly ManualRegion[] = []): ImageCandidate[] {
  const frameById = new Map(evidence.frames.map(f => [f.id, f] as const))
  const out: ImageCandidate[] = []
  for (const d of evidence.detections) {
    const frame = d.frameId !== null ? frameById.get(d.frameId) : undefined
    if (!frame) continue                                                     // no still to show or crop from: nothing the person could review
    const person = isPerson(d)
    const timing = estimateFrameTiming(frame, evidence.frames)
    out.push({
      id: `det:${d.id}`, origin: 'detected_region', label: `${d.label} (detector label)`, evidence: [{ kind: 'visual_object', id: d.id }], frame, region: d.box,
      sourceConfidence: d.confidence, timing, flags: candidateFlags('detected_region', d.label, person, d.confidence, d.box, timing, frame),
      defaultInclude: !person && !(d.confidence !== null && d.confidence < LOW_CONFIDENCE),
    })
  }
  for (const r of evidence.recurring ?? []) { if (frameById.has(r.frameId)) out.push(recurringCandidate(r, frameById, evidence)) }
  for (const m of manual) {
    const frame = frameById.get(m.frameId)
    if (!frame) continue
    const region = clampRegion(m.region)
    const timing = estimateFrameTiming(frame, evidence.frames)
    out.push({
      id: m.id, origin: 'user_region', label: 'Region you marked', evidence: [], frame, region, sourceConfidence: null, timing,
      flags: candidateFlags('user_region', 'region', false, null, region, timing, frame), defaultInclude: true,
    })
  }
  return out.sort((a, b) => a.frame.timestamp - b.frame.timestamp || (a.origin === b.origin ? a.id.localeCompare(b.id) : a.origin === 'detected_region' ? -1 : 1))
}
