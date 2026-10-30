// M2.4a -- READ the stored transition measurements from the existing reference-video response. Pure: no network, no storage, no mutation of the input, and no analysis is
// started -- it only re-reads rows the analysis already stored. Output is a normalised, DEEP-FROZEN copy.
import type { ReferenceVideo } from '../../../types'
import { deepFreeze, round3 } from './contract'

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
  for (const t of ref.transition_evidence ?? []) {
    if (!finite(t.id) || !finite(t.boundary_timestamp) || !finite(t.sampling_fps) || t.sampling_fps <= 0) continue
    const lum = t.luminance, fd = t.frame_difference
    if (!lum || !fd || !allFinite(lum.values) || !allFinite(fd.values) || lum.values.length < 3) continue         // too short a window to say anything about
    boundaries.push({
      id: t.id, boundary: round3(t.boundary_timestamp), windowStart: round3(finite(t.window_start) ? t.window_start : t.boundary_timestamp), windowEnd: round3(finite(t.window_end) ? t.window_end : t.boundary_timestamp),
      fps: t.sampling_fps, luminance: { values: [...lum.values], first: lum.first_value, last: lum.last_value, min: lum.min, max: lum.max },
      diff: { values: [...fd.values], median: fd.median, max: fd.max }, blackFlags: Array.isArray(t.black_frame_flags) ? t.black_frame_flags.map(Boolean) : [],
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
