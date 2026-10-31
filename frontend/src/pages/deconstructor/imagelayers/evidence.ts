// M2.2a -- READ the visual evidence from the existing reference-video response: the Stage-5 frames and the Stage-8 detections. Pure: no network, no storage,
// no mutation of the input, and NO detection of any kind -- it only re-reads rows the analysis already stored.
// Output is a normalised, DEEP-FROZEN copy: whatever happens later (candidates, corrections, layers), the evidence itself cannot change.
import type { ReferenceVideo, VisualObjectSummary } from '../../../types'
import { deepFreeze, round3, type Rect } from './contract'

export type ImageEvidenceInput = Pick<ReferenceVideo, 'id' | 'shots'> & Partial<Pick<ReferenceVideo, 'technical_details' | 'rights_status'>>

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

export interface ImageEvidence {
  referenceVideoId: number
  videoAnalysisId: number
  durationSeconds: number | null
  rightsStatus: string | null
  frameSize: { width: number; height: number } | null
  frames: FrameEvidence[]           // every sampled still, chronological
  detections: DetectionEvidence[]
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
      frames.push(fe); frameById.set(fe.id, fe)
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

  const probed = tech?.container?.duration_seconds ?? tech?.video?.duration_seconds
  return deepFreeze({
    referenceVideoId: ref.id, videoAnalysisId, durationSeconds: finite(probed) && probed > 0 ? probed : maxShotEnd > 0 ? maxShotEnd : null,
    rightsStatus: ref.rights_status ?? null, frameSize,
    frames: frames.sort((a, b) => a.timestamp - b.timestamp || a.id - b.id), detections: detections.sort((a, b) => a.timestamp - b.timestamp || a.id - b.id),
  })
}
