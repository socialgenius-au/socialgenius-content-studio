// M2.5a -- candidates: one per transcript segment, with flags that say how far to trust it and whether the exporter can draw its script. Whether the words are included by
// default depends on whose they are (a third party's reference: no) and how the recogniser rated them.
import { THRESHOLDS, SCRIPT_LABEL, unsupportedScript, type UnsupportedScript } from './contract'
import type { SegmentEvidence, SpeechEvidence } from './evidence'

export type SpeechFlagCode = 'third_party_words' | 'low_quality' | 'maybe_not_speech' | 'repetitive' | 'very_short' | 'very_long' | 'script_unsupported' | 'machine_transcript'
export interface SpeechFlag { code: SpeechFlagCode; severity: 'info' | 'warning'; message: string }

export interface SpeechCandidate {
  id: string
  segment: SegmentEvidence
  flags: SpeechFlag[]
  script: UnsupportedScript | null
  defaultInclude: boolean
}

export function buildSpeechCandidates(evidence: SpeechEvidence): SpeechCandidate[] {
  const thirdParty = evidence.rightsStatus === 'unknown_third_party'
  return evidence.segments.map(segment => {
    const d = segment.diagnostics, flags: SpeechFlag[] = []
    const lowQuality = d.avgLogprob !== null && d.avgLogprob < THRESHOLDS.lowLogprob
    const notSpeech = d.noSpeechProb !== null && d.noSpeechProb > THRESHOLDS.noSpeechProb
    const repetitive = d.compressionRatio !== null && d.compressionRatio > THRESHOLDS.repetition
    const dur = segment.end - segment.start
    const script = unsupportedScript(segment.text)
    flags.push({ code: 'machine_transcript', severity: 'info', message: 'Written by a speech recogniser and not checked against the audio.' })
    if (thirdParty) flags.push({ code: 'third_party_words', severity: 'info', message: 'The reference is someone else’s video, so these are their speaker’s words.' })
    if (lowQuality) flags.push({ code: 'low_quality', severity: 'warning', message: `The recogniser rated this segment poorly (average log-probability ${d.avgLogprob!.toFixed(2)}).` })
    if (notSpeech) flags.push({ code: 'maybe_not_speech', severity: 'warning', message: `The recogniser thought this might not be speech (${Math.round(d.noSpeechProb! * 100)} % no-speech).` })
    if (repetitive) flags.push({ code: 'repetitive', severity: 'warning', message: `Highly repetitive text (compression ratio ${d.compressionRatio!.toFixed(2)}): a common sign of a looping or wrong transcript.` })
    if (dur < THRESHOLDS.shortSeconds) flags.push({ code: 'very_short', severity: 'info', message: 'Shorter than half a second: hard to read on screen.' })
    if (dur > THRESHOLDS.longSeconds) flags.push({ code: 'very_long', severity: 'info', message: 'Longer than seven seconds: consider splitting it in the editor.' })
    if (script) flags.push({ code: 'script_unsupported', severity: 'warning', message: `This text is in ${SCRIPT_LABEL[script]}. It looks right in the editor, but the exporter cannot lay it out correctly yet, so the exported subtitle would be wrong.` })
    return { id: `sp:${segment.id}`, segment, flags, script, defaultInclude: !thirdParty && !lowQuality && !notSpeech && !repetitive }
  })
}
