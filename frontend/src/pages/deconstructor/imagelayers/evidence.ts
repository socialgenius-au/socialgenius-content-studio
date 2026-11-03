// M2.2a -- READ the visual evidence from the existing reference-video response: the Stage-5 frames and the Stage-8 detections. Pure: no network, no storage,
// no mutation of the input, and NO detection of any kind -- it only re-reads rows the analysis already stored.
// Output is a normalised, DEEP-FROZEN copy: whatever happens later (candidates, corrections, layers), the evidence itself cannot change.
import type { ReferenceVideo, VisualObjectSummary } from '../../../types'
import { deepFreeze, round3, type Rect } from './contract'

export type ImageEvidenceInput = Pick<ReferenceVideo, 'id' | 'shots'> & Partial<Pick<ReferenceVideo, 'technical_details' | 'rights_status' | 'recurring_elements'>>

export interface FrameEvidence {
  id: number
  shotId: number
  shotStart: number
  shotEnd: number
  order: number
  timestamp: number                 // reference-video seconds: the ONE instant this still shows
  path: string
  width: number | null
  height: number | null
}

export interface DetectionEvidence {
  id: number
  label: string                     // the detector's own COCO label, verbatim ("person", "laptop"...)
  category: string                  // "person" or the neutral "object"
  confidence: number | null         // the detector's own score
  box: Rect                         // normalised 0..1, top-left origin, on `frameId`'s still
  frameId: number | null
  shotId: number
  timestamp: number
}

/** A mark the analysis INFERRED by linking the same recognised text across several moments (a possible watermark or logo). It is not a detection: it says the same text sat in about the same place, and nothing about what it looks like. */
export interface RecurringMarkEvidence {
  id: number                        // the Recurring Element's own id
  confidence: number | null
  members: number                   // how many occurrence groups were linked
  first: number                     // outer bounds of its members (visibility in the gaps between them is never claimed)
  last: number
  box: Rect                         // the median box of the members
  frameId: number                   // the sampled still the earliest member was read on
  text: string                      // that member's reading, for the person's orientation only
}

export interface ImageEvidence {
  referenceVideoId: number
  videoAnalysisId: number
  durationSeconds: number | null
  rightsStatus: string | null
  frameSize: { width: number; height: number } | null
  frames: FrameEvidence[]           // every sampled still, chronological
  detections: DetectionEvidence[]
  recurring: RecurringMarkEvidence[]
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

function boxOf(v: Pick<VisualObjectSummary, 'x' | 'y' | 'width' | 'height'>): Rect | null {
  if (!finite(v.x) || !finite(v.y) || !finite(v.width) || !finite(v.height) || v.width <= 0 || v.height <= 0) return null
  const x = Math.max(0, v.x), y = Math.max(0, v.y)
  const w = Math.min(1, v.x + v.width) - x, h = Math.min(1, v.y + v.height) - y          // a detector box can poke past the frame edge: keep only the part inside
  return w > 0 && h > 0 ? { x, y, w, h } : null
}

export function readImageEvidence(ref: ImageEvidenceInput, videoAnalysisId: number): ImageEvidence {
  const tech = ref.technical_details
  const vw = tech?.video?.width, vh = tech?.video?.height
  const frameSize = finite(vw) && finite(vh) && vw > 0 && vh > 0 ? { width: vw, height: vh } : null
  const frames: FrameEvidence[] = []
  const detections: DetectionEvidence[] = []
  const frameById = new Map<number, FrameEvidence>()
  const frameByPath = new Map<string, FrameEvidence>()
  const textById = new Map<number, { box: Rect; path: string | null; text: string; start: number }>()
  let maxShotEnd = 0

  for (const shot of ref.shots ?? []) {
    const shotStart = finite(shot.start_time) ? shot.start_time : 0
    const shotEnd = finite(shot.end_time) ? shot.end_time : shotStart
    if (finite(shot.end_time)) maxShotEnd = Math.max(maxShotEnd, shot.end_time)
    for (const f of shot.frames ?? []) {
      if (!finite(f.id) || typeof f.asset_file_path !== 'string' || f.asset_file_path === '' || !finite(f.timestamp)) continue          // not a usable still
      const fe: FrameEvidence = {
        id: f.id, shotId: shot.id, shotStart, shotEnd, order: finite(f.order) ? f.order : 0, timestamp: round3(f.timestamp), path: f.asset_file_path,
        width: finite(f.width) && f.width > 0 ? f.width : frameSize?.width ?? null, height: finite(f.height) && f.height > 0 ? f.height : frameSize?.height ?? null,
      }
      frames.push(fe); frameById.set(fe.id, fe); frameByPath.set(fe.path, fe)
    }
    for (const t of shot.text_elements ?? []) {
      const b = boxOf(t)
      if (b && finite(t.id)) textById.set(t.id, { box: b, path: typeof t.source_frame_asset_file_path === 'string' ? t.source_frame_asset_file_path : null, text: typeof t.text === 'string' ? t.text : '', start: finite(t.start_time) ? t.start_time : shotStart })
    }
    for (const v of shot.visual_objects ?? []) {
      const b = boxOf(v)
      if (!b || !finite(v.id) || typeof v.label !== 'string') continue
      const frame = v.source_frame_id != null ? frameById.get(v.source_frame_id) : undefined
      detections.push({
        id: v.id, label: v.label, category: v.category, confidence: finite(v.confidence_score) ? v.confidence_score : null, box: b,
        frameId: frame ? frame.id : null, shotId: shot.id, timestamp: round3(frame ? frame.timestamp : finite(v.start_time) ? v.start_time : shotStart),
      })
    }
  }

  const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
  const recurring: RecurringMarkEvidence[] = []
  for (const r of ref.recurring_elements ?? []) {
    const members = (r.member_text_element_ids ?? []).map(id => textById.get(id)).filter((m): m is NonNullable<typeof m> => !!m).sort((a, b) => a.start - b.start)
    const head = members.find(m => m.path !== null && frameByPath.has(m.path))                  // a member read on a still we have: the slot has to sit on a frame the person can see
    if (!finite(r.id) || members.length < 2 || !head) continue
    recurring.push({
      id: r.id, confidence: finite(r.confidence_score) ? r.confidence_score : null, members: members.length, first: round3(finite(r.start_time) ? r.start_time : members[0].start), last: round3(finite(r.end_time) ? r.end_time : members[members.length - 1].start),
      box: { x: round3(median(members.map(m => m.box.x))), y: round3(median(members.map(m => m.box.y))), w: round3(median(members.map(m => m.box.w))), h: round3(median(members.map(m => m.box.h))) }, frameId: frameByPath.get(head.path!)!.id, text: head.text,
    })
  }

  const probed = tech?.container?.duration_seconds ?? tech?.video?.duration_seconds
  return deepFreeze({
    referenceVideoId: ref.id, videoAnalysisId, durationSeconds: finite(probed) && probed > 0 ? probed : maxShotEnd > 0 ? maxShotEnd : null,
    rightsStatus: ref.rights_status ?? null, frameSize,
    frames: frames.sort((a, b) => a.timestamp - b.timestamp || a.id - b.id), detections: detections.sort((a, b) => a.timestamp - b.timestamp || a.id - b.id), recurring: recurring.sort((a, b) => a.first - b.first || a.id - b.id),
  })
}
