// M2.5a -- the SPEECH kind of the reconstruction contract (see ../textlayers/contract.ts for the three rules every kind obeys: evidence is immutable, every property says where
// it came from, nothing is claimed beyond the evidence).
//
// What the analysis really has: a MACHINE transcript -- a local speech recogniser's segments with start/end times and its own quality diagnostics. It is not a script, its words
// can be wrong, and nothing in it is the speaker's voice. The reference's spoken words are also somebody else's unless the reference is the person's own. So this path turns the
// transcript into EDITABLE subtitles and a per-scene script to rewrite or re-record, labels every piece as machine-transcribed, and leaves the words out by default when the
// reference is a third party's.
export { deepFreeze, round3, clamp, fromUser, measured, inferred, defaulted, normaliseText, type Basis, type Level, type Prop } from '../textlayers/contract'

export const SPEECH_ENGINE_VERSION = '1.0.0'

/** The recogniser's own diagnostics, judged against the limits its authors document (Whisper's own defaults). Provisional, never shown as a probability. */
export const THRESHOLDS = { lowLogprob: -1.0, noSpeechProb: 0.6, repetition: 2.4, shortSeconds: 0.4, longSeconds: 7 } as const
export const MIN_VISIBLE_SECONDS = 0.3

/** The box the editor itself gives a subtitle (CreateEditTab's DEFAULT_SUBTITLE_BOX; a wiring test pins the numbers to its source). */
export const DEFAULT_SUBTITLE_BOX = { x: 10, y: 82, width: 80 } as const

/** What the plan never claims. Always false -- the type makes any other value a compile error. */
export const NO_CLAIMS = { wordsVerifiedAgainstAudio: false, speakerVoiceRecovered: false, scriptIsOriginal: false } as const

export const LIMITATIONS: readonly string[] = [
  'This is a machine transcript: the words can be wrong and were not checked against the audio. Read it before you use it.',
  'The timing is the recogniser’s, usually within a few tenths of a second, and is stretched if the draft is a different length.',
  'The speaker’s voice, music and sound effects are not recovered: this gives words and times only. Narration, music and effects are yours to supply.',
  'The words are the reference’s speaker’s. Unless the reference is yours, treat them as a draft to rewrite, not text to publish.',
  'The exporter has one font and no right-to-left or complex-text layout. Arabic, Hebrew, Indic, Thai and CJK subtitles look right in the editor but export in the wrong direction, and any letter the font lacks (for example the Urdu letters U+06C1 and U+06D2) shows as an empty box, until a font and layout engine are added.',
]

/** Scripts the exporter cannot draw correctly (no shaping / right-to-left layout / glyphs): flagged, never silently exported. */
export type UnsupportedScript = 'arabic' | 'hebrew' | 'indic' | 'thai' | 'cjk'
const RANGES: [UnsupportedScript, number, number][] = [
  ['arabic', 0x0600, 0x06ff], ['arabic', 0x0750, 0x077f], ['arabic', 0x08a0, 0x08ff], ['arabic', 0xfb50, 0xfdff], ['arabic', 0xfe70, 0xfeff], ['hebrew', 0x0590, 0x05ff],
  ['indic', 0x0900, 0x0dff], ['thai', 0x0e00, 0x0e7f], ['cjk', 0x3040, 0x30ff], ['cjk', 0x3400, 0x9fff], ['cjk', 0xac00, 0xd7af],
]
export function unsupportedScript(text: string): UnsupportedScript | null {
  for (const ch of text) {
    const cp = ch.codePointAt(0)!
    const hit = RANGES.find(([, lo, hi]) => cp >= lo && cp <= hi)
    if (hit) return hit[0]
  }
  return null
}
export const SCRIPT_LABEL: Record<UnsupportedScript, string> = { arabic: 'Arabic script', hebrew: 'Hebrew', indic: 'an Indic script', thai: 'Thai', cjk: 'CJK characters' }
