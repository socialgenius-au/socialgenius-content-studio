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
  'Arabic-script subtitles (Arabic, Urdu, Persian...) are drawn on export in Noto Naskh Arabic with joined letters, right to left; this was checked on sample Urdu lines. It is the Naskh style, not Nastaliq, and rare characters were not all checked. Hebrew, Indic, Thai and CJK subtitles look right in the editor but the exporter has no font or layout for them yet, so they export wrongly.',
]

/** Scripts the exporter does not draw correctly (no shaping / right-to-left layout / glyphs): flagged, never silently exported. Arabic script is the exception since the exporter bundles Noto Naskh Arabic: it is drawn, with the limits in ARABIC_NOTE. */
export type UnsupportedScript = 'arabic' | 'hebrew' | 'indic' | 'thai' | 'cjk'
const RANGES: [UnsupportedScript, number, number][] = [
  ['arabic', 0x0600, 0x06ff], ['arabic', 0x0750, 0x077f], ['arabic', 0x08a0, 0x08ff], ['arabic', 0xfb50, 0xfdff], ['arabic', 0xfe70, 0xfeff], ['hebrew', 0x0590, 0x05ff],
  ['indic', 0x0900, 0x0dff], ['thai', 0x0e00, 0x0e7f], ['cjk', 0x3040, 0x30ff], ['cjk', 0x3400, 0x9fff], ['cjk', 0xac00, 0xd7af],
]
/** The script in `text` the exporter has trouble with: a truly unsupported one wins over Arabic script (which the exporter does draw), and Arabic script is reported only when nothing worse is present. */
export function unsupportedScript(text: string): UnsupportedScript | null {
  let arabic = false
  for (const ch of text) {
    const cp = ch.codePointAt(0)!
    const hit = RANGES.find(([, lo, hi]) => cp >= lo && cp <= hi)
    if (!hit) continue
    if (hit[0] === 'arabic') arabic = true; else return hit[0]
  }
  return arabic ? 'arabic' : null
}
/** What to tell the person about Arabic-script lines (Arabic, Urdu, Persian, Pashto...). */
export const ARABIC_NOTE =
  'The exporter draws Arabic script in Noto Naskh Arabic, the standard Arabic style; it does not have the Nastaliq style often used for Urdu. Letters join and run right to left, and it was checked on sample Urdu lines, but not on every dialect or rare character, so look at the exported frame.'
/** True for a script the exporter cannot draw correctly. Arabic script is not one of them. */
export const exporterCannotDraw = (s: UnsupportedScript | null): boolean => s !== null && s !== 'arabic'
export const SCRIPT_LABEL: Record<UnsupportedScript, string> = { arabic: 'Arabic script', hebrew: 'Hebrew', indic: 'an Indic script', thai: 'Thai', cjk: 'CJK characters' }
