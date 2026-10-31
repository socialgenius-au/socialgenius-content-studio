// M2.2a -- test helpers ONLY (not imported by any product code). Builds a synthetic reference analysis shaped like the real VA5368 one (9:16, 480x864 stills about
// 5 s apart, general-object detections that are all "person"), but every number and name here is invented.
import type { ReferenceVideo, ShotFrameSummary, ShotSummary, VisualObjectSummary } from '../../../types'
import { buildImageCandidates, type ManualRegion } from './candidates'
import { readImageEvidence, type ImageEvidenceInput } from './evidence'
import type { ImageRef } from './materialize'

export const FW = 480
export const FH = 864
export const DURATION = 42.6
export const framePath = (id: number) => `/data/uploads/1/frame-${id}.jpg`

export const frame = (id: number, timestamp: number, order: number): ShotFrameSummary => ({
  id, order, timestamp, extraction_method: 'x', width: FW, height: FH, measurements: {}, certainty: 'MEASURED', evidence_summary: null, produced_by_pass: null, asset_file_path: framePath(id),
})

export interface DetSpec { id: number; label?: string; category?: string; box: [number, number, number, number]; conf?: number | null; frameId?: number | null }
export const detection = (d: DetSpec): VisualObjectSummary => ({
  id: d.id, label: d.label ?? 'person', category: d.category ?? ((d.label ?? 'person') === 'person' ? 'person' : 'object'), class_id: 1,
  x: d.box[0], y: d.box[1], width: d.box[2], height: d.box[3], start_time: 0, end_time: 0, certainty: 'MEASURED', confidence_score: d.conf === undefined ? 0.9 : d.conf,
  evidence_summary: null, source: 'torchvision', produced_by_pass: 'visual_objects_v1', source_frame_id: d.frameId === undefined ? null : d.frameId, source_frame_asset_file_path: null,
})

export interface RefOptions {
  /** Shot A holds frames 1..3 (0.15, 5, 10 s); shot B holds frame 4 (40.2 s). */
  detections?: DetSpec[]
  duration?: number | null
  rights?: ReferenceVideo['rights_status']
  noFrames?: boolean
}

export function reference(o: RefOptions = {}): ImageEvidenceInput {
  const duration = o.duration === undefined ? DURATION : o.duration
  const framesA = o.noFrames ? [] : [frame(1, 0.15, 0), frame(2, 5, 1), frame(3, 10, 2)]
  const framesB = o.noFrames ? [] : [frame(4, 40.2, 0)]
  const dets = o.detections ?? DEFAULT_DETECTIONS
  const shot = (id: number, order: number, start: number, end: number, frames: ShotFrameSummary[], frameIds: number[]): ShotSummary => ({
    id, order, start_time: start, end_time: end, certainty: 'MEASURED', evidence_summary: null, produced_by_pass: null, frames, text_elements: [],
    // a detection whose still is unknown (null, or an id no shot holds) is kept on the first shot, as the real API would
    visual_objects: dets.filter(d => (d.frameId != null && frameIds.includes(d.frameId)) || (id === 9 && (d.frameId == null || ![1, 2, 3, 4].includes(d.frameId)))).map(detection),
  })
  return {
    id: 5127,
    rights_status: o.rights ?? 'unknown_third_party',
    technical_details: { container: { duration_seconds: duration }, video: { width: FW, height: FH, duration_seconds: duration } } as unknown as ReferenceVideo['technical_details'],
    shots: [shot(9, 0, 0, 40, framesA, [1, 2, 3]), shot(10, 1, 40, duration ?? 42.6, framesB, [4])],
  }
}

/** A cast covering the cases: a person (excluded by default), a confident object, a low-confidence object, a box that pokes past the frame, and a detection with no still. */
export const DEFAULT_DETECTIONS: DetSpec[] = [
  { id: 101, label: 'person', box: [0.08, 0.11, 0.88, 0.71], conf: 0.91, frameId: 1 },
  { id: 102, label: 'laptop', box: [0.6, 0.1, 0.3, 0.12], conf: 0.88, frameId: 2 },
  { id: 103, label: 'keyboard', box: [0.1, 0.5, 0.5, 0.1], conf: 0.31, frameId: 3 },
  { id: 104, label: 'tv', box: [0.7, 0.8, 0.5, 0.3], conf: 0.75, frameId: 4 },
  { id: 105, label: 'cell phone', box: [0.2, 0.2, 0.2, 0.1], conf: 0.8, frameId: 999 },
]

export const evidenceFor = (o: RefOptions = {}) => readImageEvidence(reference(o), 5368)
export const candidatesFor = (o: RefOptions = {}, manual: ManualRegion[] = []) => { const evidence = evidenceFor(o); return { evidence, candidates: buildImageCandidates(evidence, manual) } }

export const uploaded = (over: Partial<ImageRef> = {}): ImageRef => ({ source: 'user_upload', width: 600, height: 300, fileName: 'logo.png', hasAlpha: true, assetId: 77, url: '/uploads/1/logo.png', ...over })
export const pending = (over: Partial<ImageRef> = {}): ImageRef => { const { assetId: _a, url: _u, ...rest } = uploaded(over); return rest }
