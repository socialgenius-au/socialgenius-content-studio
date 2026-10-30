// M2.1a -- READ the Stage-6 OCR evidence from the existing reference-video response. Pure: no network, no storage, no mutation of the input.
// Output is a normalised, DEEP-FROZEN copy: whatever happens later (candidates, corrections, layers), the evidence itself cannot change.
import type { ReferenceVideo, TextElementSummary } from '../../../types'
import { deepFreeze, normaliseText, round3, type Rect } from './contract'

/** The part of the reference-video response this reads. Anything missing is tolerated (older or partial analyses). */
export type ReferenceEvidenceInput = Pick<ReferenceVideo, 'id' | 'shots'> & Partial<Pick<ReferenceVideo, 'recurring_elements' | 'technical_details' | 'rights_status'>>

export interface ObservationEvidence { id: number; text: string; timestamp: number; confidence: number | null; box: Rect; framePath: string | null }

export interface TextEvidenceGroup {
  id: number                                     // the Occurrence Group head's TextElement id -- the stable id of this text item
  shotId: number
  shotStart: number
  shotEnd: number
  text: string                                   // the head reading: the group's highest-confidence observation, never an average
  confidence: number | null                      // the OCR engine's own reported confidence for that reading
  box: Rect                                      // normalised 0..1, top-left origin (the head's own geometry)
  first: number                                  // earliest / latest sampled instant at which this group was actually READ
  last: number
  observations: ObservationEvidence[]            // every raw reading, head first -- nothing is hidden
  frame: { path: string | null; width: number | null; height: number | null }
  recurringIds: number[]                         // Recurring Element cross-references (INFERRED upstream) this group belongs to
  storedStyle: Readonly<Record<string, unknown>> | null   // kept as evidence only: its two colours are not assigned text/background reliably (see appearance.ts)
}

export interface TextEvidence {
  referenceVideoId: number
  videoAnalysisId: number
  durationSeconds: number | null
  rightsStatus: string | null
  frameSize: { width: number; height: number } | null
  groups: TextEvidenceGroup[]
  /** Every distinct instant at which OCR demonstrably ran AND read something, ascending. Timing uncertainty is measured against these. */
  sampleTimes: number[]
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
const box = (e: { x: number; y: number; width: number; height: number }): Rect | null =>
  finite(e.x) && finite(e.y) && finite(e.width) && finite(e.height) && e.width > 0 && e.height > 0 ? { x: e.x, y: e.y, w: e.width, h: e.height } : null

export function readTextEvidence(ref: ReferenceEvidenceInput, videoAnalysisId: number): TextEvidence {
  const recurringByGroup = new Map<number, number[]>()
  for (const r of ref.recurring_elements ?? []) for (const id of r.member_text_element_ids ?? []) recurringByGroup.set(id, [...(recurringByGroup.get(id) ?? []), r.id])

  const tech = ref.technical_details
  const vw = tech?.video?.width, vh = tech?.video?.height
  const frameSize = finite(vw) && finite(vh) && vw > 0 && vh > 0 ? { width: vw, height: vh } : null
  let maxShotEnd = 0
  const groups: TextEvidenceGroup[] = []
  const samples = new Set<number>()

  for (const shot of ref.shots ?? []) {
    if (finite(shot.end_time)) maxShotEnd = Math.max(maxShotEnd, shot.end_time)
    for (const t of (shot.text_elements ?? []) as TextElementSummary[]) {
      const b = box(t)
      const text = typeof t.text === 'string' ? normaliseText(t.text) : ''
      if (!b || text === '' || !finite(t.id)) continue                                   // not evidence of text: nothing to reconstruct
      const observations: ObservationEvidence[] = (t.observations ?? []).flatMap(o => {
        const ob = box(o)
        return ob && finite(o.timestamp) && typeof o.text === 'string'
          ? [{ id: o.id, text: normaliseText(o.text), timestamp: round3(o.timestamp), confidence: finite(o.confidence_score) ? o.confidence_score : null, box: ob, framePath: o.source_frame_asset_file_path ?? null }]
          : []
      })
      const times = observations.map(o => o.timestamp)
      const first = times.length ? Math.min(...times) : round3(finite(t.start_time) ? t.start_time : 0)
      const last = times.length ? Math.max(...times) : round3(finite(t.end_time) ? t.end_time : first)
      for (const x of times) samples.add(x)
      if (!times.length) samples.add(first)
      const path = t.source_frame_asset_file_path ?? null
      const frame = path ? (shot.frames ?? []).find(f => f.asset_file_path === path) : undefined
      groups.push({
        id: t.id, shotId: shot.id, shotStart: finite(shot.start_time) ? shot.start_time : 0, shotEnd: finite(shot.end_time) ? shot.end_time : last,
        text, confidence: finite(t.confidence_score) ? t.confidence_score : null, box: b, first, last, observations,
        frame: { path, width: frame && finite(frame.width) ? frame.width : frameSize?.width ?? null, height: frame && finite(frame.height) ? frame.height : frameSize?.height ?? null },
        recurringIds: recurringByGroup.get(t.id) ?? [], storedStyle: t.style_details ? { ...t.style_details } : null,   // a copy: freezing must never touch the caller's object
      })
    }
  }

  const probed = tech?.container?.duration_seconds ?? tech?.video?.duration_seconds
  return deepFreeze({
    referenceVideoId: ref.id, videoAnalysisId, durationSeconds: finite(probed) && probed > 0 ? probed : maxShotEnd > 0 ? maxShotEnd : null,
    rightsStatus: ref.rights_status ?? null, frameSize, groups: groups.sort((a, b) => a.first - b.first || a.id - b.id), sampleTimes: [...samples].sort((a, b) => a - b),
  })
}
