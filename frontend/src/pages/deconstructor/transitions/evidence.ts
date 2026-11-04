// M2.4a -- READ the stored transition measurements from the existing reference-video response. Pure: no network, no storage, no mutation of the input, and no analysis is
// started -- it only re-reads rows the analysis already stored. Output is a normalised, DEEP-FROZEN copy.
import type { ReferenceVideo } from '../../../types'
import { deepFreeze, round3 } from './contract'
import type { MotionMeasurements } from './motion'

export type TransitionEvidenceInput = Pick<ReferenceVideo, 'id'> & Partial<Pick<ReferenceVideo, 'shots' | 'transition_evidence' | 'technical_details' | 'rights_status'>>

export interface BoundaryEvidence {
  id: number
  boundary: number                       // reference seconds: the detected cut
  windowStart: number
  windowEnd: number
  fps: number                            // sampling rate inside the window
  luminance: { values: number[]; first: number; last: number; min: number; max: number }
  diff: { values: number[]; median: number; max: number }          // normalised frame-to-frame difference, one per consecutive pair
  blackFlags: boolean[]
  /** The stored per-pair motion measurements, when the response carries them and the frame size is known. */
  motion: MotionMeasurements | null
  precedingShotId: number | null
  followingShotId: number | null
}

export interface TransitionEvidence {
  referenceVideoId: number
  videoAnalysisId: number
  durationSeconds: number | null
  boundaries: BoundaryEvidence[]
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
const allFinite = (a: unknown): a is number[] => Array.isArray(a) && a.length > 0 && a.every(finite)

export function readTransitionEvidence(ref: TransitionEvidenceInput, videoAnalysisId: number): TransitionEvidence {
  const boundaries: BoundaryEvidence[] = []
  const vw = ref.technical_details?.video?.width, vh = ref.technical_details?.video?.height
  const frame = finite(vw) && finite(vh) && vw > 0 && vh > 0 ? { width: vw, height: vh } : null
  for (const t of ref.transition_evidence ?? []) {
    if (!finite(t.id) || !finite(t.boundary_timestamp) || !finite(t.sampling_fps) || t.sampling_fps <= 0) continue
    const lum = t.luminance, fd = t.frame_difference
    if (!lum || !fd || !allFinite(lum.values) || !allFinite(fd.values) || lum.values.length < 3) continue         // too short a window to say anything about
    boundaries.push({
      id: t.id, boundary: round3(t.boundary_timestamp), windowStart: round3(finite(t.window_start) ? t.window_start : t.boundary_timestamp), windowEnd: round3(finite(t.window_end) ? t.window_end : t.boundary_timestamp),
      fps: t.sampling_fps, luminance: { values: [...lum.values], first: lum.first_value, last: lum.last_value, min: lum.min, max: lum.max },
      diff: { values: [...fd.values], median: fd.median, max: fd.max }, blackFlags: Array.isArray(t.black_frame_flags) ? t.black_frame_flags.map(Boolean) : [],
      motion: frame && Array.isArray(t.affine?.pairs) && t.affine!.pairs.length > 0 ? {
        frame, fps: t.sampling_fps,
        affine: t.affine!.pairs.map(p => ({ ok: !!p.estimation_success, tx: finite(p.translation_x) ? p.translation_x : null, ty: finite(p.translation_y) ? p.translation_y : null, scale: finite(p.scale) ? p.scale : null, inlierRatio: finite(p.ransac_inlier_ratio) ? p.ransac_inlier_ratio : null })),
        phase: (t.phase_correlation?.pairs ?? []).map(p => ({ dx: finite(p.dx) ? p.dx : 0, dy: finite(p.dy) ? p.dy : 0, response: finite(p.response) ? p.response : 0, issue: p.phase_quality_issue ?? null })),
      } : null,
      precedingShotId: t.preceding_shot_id ?? null, followingShotId: t.following_shot_id ?? null,
    })
  }
  let maxShotEnd = 0
  for (const s of ref.shots ?? []) if (finite(s.end_time)) maxShotEnd = Math.max(maxShotEnd, s.end_time)
  const tech = ref.technical_details
  const probed = tech?.container?.duration_seconds ?? tech?.video?.duration_seconds
  return deepFreeze({
    referenceVideoId: ref.id, videoAnalysisId, durationSeconds: finite(probed) && probed > 0 ? probed : maxShotEnd > 0 ? maxShotEnd : null,
    boundaries: boundaries.sort((a, b) => a.boundary - b.boundary || a.id - b.id),
  })
}
