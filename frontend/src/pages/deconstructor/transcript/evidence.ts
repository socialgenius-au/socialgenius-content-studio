// M2.5a -- READ the transcript from the existing reference-video response. Pure: no network, no storage, no mutation of the input, and no speech recognition is started -- it
// only re-reads rows the analysis already stored. Output is a normalised, DEEP-FROZEN copy.
import type { ReferenceVideo } from '../../../types'
import { deepFreeze, normaliseText, round3 } from './contract'

export type SpeechEvidenceInput = Pick<ReferenceVideo, 'id'> & Partial<Pick<ReferenceVideo, 'shots' | 'speech_segments' | 'technical_details' | 'rights_status'>>

export interface SegmentEvidence {
  id: number
  start: number                          // reference seconds, as the recogniser gave them
  end: number
  text: string                           // whitespace-normalised, otherwise verbatim
  language: string | null
  diagnostics: { avgLogprob: number | null; noSpeechProb: number | null; compressionRatio: number | null }
}

export interface SpeechEvidence {
  referenceVideoId: number
  videoAnalysisId: number
  durationSeconds: number | null
  rightsStatus: string | null
  segments: SegmentEvidence[]
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
const num = (n: unknown) => (finite(n) ? n : null)

export function readSpeechEvidence(ref: SpeechEvidenceInput, videoAnalysisId: number): SpeechEvidence {
  const segments: SegmentEvidence[] = []
  for (const s of ref.speech_segments ?? []) {
    const text = typeof s.text === 'string' ? normaliseText(s.text) : ''
    if (!finite(s.id) || !finite(s.start_time) || !finite(s.end_time) || s.end_time <= s.start_time || text === '') continue          // not evidence of speech: nothing to reconstruct
    const d = s.analysis_details ?? {}
    segments.push({ id: s.id, start: round3(s.start_time), end: round3(s.end_time), text, language: s.language ?? null, diagnostics: { avgLogprob: num(d.avg_logprob), noSpeechProb: num(d.no_speech_prob), compressionRatio: num(d.compression_ratio) } })
  }
  let maxShotEnd = 0
  for (const s of ref.shots ?? []) if (finite(s.end_time)) maxShotEnd = Math.max(maxShotEnd, s.end_time)
  const tech = ref.technical_details
  const probed = tech?.container?.duration_seconds ?? tech?.video?.duration_seconds
  return deepFreeze({
    referenceVideoId: ref.id, videoAnalysisId, durationSeconds: finite(probed) && probed > 0 ? probed : maxShotEnd > 0 ? maxShotEnd : null,
    rightsStatus: ref.rights_status ?? null, segments: segments.sort((a, b) => a.start - b.start || a.id - b.id),
  })
}
