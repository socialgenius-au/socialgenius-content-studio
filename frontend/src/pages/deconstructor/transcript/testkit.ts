// M2.5a -- test helpers ONLY (not imported by any product code). Every word and number here is invented; the shape mirrors the real VA5368 transcript (about fifteen segments
// 1-3 s long, one recogniser rating per audio window, Whisper's own diagnostics).
import type { ReferenceVideo, SpeechSegmentSummary } from '../../../types'
import { buildSpeechCandidates } from './candidates'
import { readSpeechEvidence } from './evidence'

export interface Seg { id: number; start: number; end: number; text: string; lang?: string | null; logprob?: number; noSpeech?: number; compression?: number }
export const seg = (s: Seg): SpeechSegmentSummary => ({
  id: s.id, start_time: s.start, end_time: s.end, text: s.text, language: s.lang === undefined ? 'en' : s.lang, certainty: 'MEASURED',
  analysis_details: { avg_logprob: s.logprob ?? -0.3, no_speech_prob: s.noSpeech ?? 0.03, compression_ratio: s.compression ?? 1.4, temperature: 0 },
})

export const ARABIC_LINE = 'مرحبا بكم في الفيديو'          // invented greeting, Arabic script

/** A short invented transcript covering the cases: normal lines, a poor rating, a looping one, a not-speech one, a very short and a very long one, an Arabic-script one. */
export const CAST: Seg[] = [
  { id: 11, start: 0, end: 2.4, text: 'Welcome to the show' },
  { id: 12, start: 2.7, end: 4.8, text: '  Today   we  look at pricing ' },
  { id: 13, start: 5, end: 8, text: 'Pricing is a story', logprob: -1.4 },
  { id: 14, start: 8.2, end: 10, text: 'la la la la la la', compression: 3.1 },
  { id: 15, start: 10.2, end: 12, text: 'Background hum', noSpeech: 0.8 },
  { id: 16, start: 12.1, end: 12.3, text: 'Yes' },
  { id: 17, start: 13, end: 21.5, text: 'A very long explanation that the recogniser kept as a single segment' },
  { id: 18, start: 22, end: 24, text: ARABIC_LINE, lang: 'hi' },
  { id: 19, start: 40, end: 42, text: 'After the draft ends' },
]

export function reference(segments: Seg[] = CAST, rights: ReferenceVideo['rights_status'] = 'owned', duration: number | null = 42.6): Pick<ReferenceVideo, 'id' | 'shots' | 'speech_segments' | 'rights_status' | 'technical_details'> {
  return {
    id: 5127, rights_status: rights, shots: [], speech_segments: segments.map(seg),
    technical_details: (duration ? { container: { duration_seconds: duration }, video: { duration_seconds: duration } } : null) as unknown as ReferenceVideo['technical_details'],
  }
}
export const evidenceFor = (segments: Seg[] = CAST, rights: ReferenceVideo['rights_status'] = 'owned', duration: number | null = 42.6) => readSpeechEvidence(reference(segments, rights, duration), 5368)
export const candidatesFor = (segments: Seg[] = CAST, rights: ReferenceVideo['rights_status'] = 'owned') => buildSpeechCandidates(evidenceFor(segments, rights))
export const SCENES = [{ sceneNumber: 1, startTime: 0, endTime: 10 }, { sceneNumber: 2, startTime: 10, endTime: 20 }, { sceneNumber: 3, startTime: 20, endTime: 30 }]
