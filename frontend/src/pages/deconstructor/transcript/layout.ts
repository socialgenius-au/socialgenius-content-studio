// M2.5 -- subtitle LAYOUT controls for the transcript panel: where the subtitles sit, how big their text is, and how long a line may get before it breaks. Pure.
// All three end up as ordinary editable properties of each native subtitle (its box position, its style override, line breaks in its text), so the editor and the export read them the same way:
// the editor draws subtitles with `white-space: pre-wrap` and the exporter breaks lines on "\n".
import { DEFAULT_SUBTITLE_BOX } from './contract'

export type SubtitlePosition = 'bottom' | 'middle' | 'top'
export interface SubtitleLayout {
  position: SubtitlePosition
  /** Canvas pixels at the editor's 1080-wide reference, or null for the project's own subtitle style. */
  fontSize: number | null
  /** Break a line before it gets longer than this many characters; 0 = leave lines as they are. */
  maxChars: number
}

export const DEFAULT_LAYOUT: SubtitleLayout = { position: 'bottom', fontSize: null, maxChars: 0 }
export const POSITION_LABEL: Record<SubtitlePosition, string> = { bottom: 'Bottom (the editor’s default)', middle: 'Middle', top: 'Top' }
/** Top-left y of the subtitle box, in percent of the canvas height. Bottom is the editor's own default box. */
export const POSITION_Y: Record<SubtitlePosition, number> = { bottom: DEFAULT_SUBTITLE_BOX.y, middle: 45, top: 8 }
export const FONT_SIZES: readonly number[] = [24, 30, 36, 44, 52]
export const MAX_CHARS_RANGE = { min: 10, max: 80 } as const

export const isDefaultLayout = (l: SubtitleLayout) => l.position === 'bottom' && l.fontSize === null && l.maxChars === 0

/** Sanitise whatever the controls hand over: unknown positions fall back to the default, sizes snap to a known one, line length is 0 or within range. */
export function normaliseLayout(l: Partial<SubtitleLayout> | undefined): SubtitleLayout {
  const position: SubtitlePosition = l?.position === 'middle' || l?.position === 'top' ? l.position : 'bottom'
  const fontSize = typeof l?.fontSize === 'number' && FONT_SIZES.includes(l.fontSize) ? l.fontSize : null
  const m = typeof l?.maxChars === 'number' && Number.isFinite(l.maxChars) ? Math.round(l.maxChars) : 0
  const maxChars = m <= 0 ? 0 : Math.min(MAX_CHARS_RANGE.max, Math.max(MAX_CHARS_RANGE.min, m))
  return { position, fontSize, maxChars }
}

/** Greedy word wrap at `maxChars` characters (counted in code points). Existing line breaks are kept. A single word longer than the limit stays whole (breaking inside a word would break joining in
 *  Arabic-script text and a word's meaning everywhere), and text with no spaces at all (for example Chinese) is left alone. */
export function breakLines(text: string, maxChars: number): string {
  if (!maxChars || maxChars <= 0) return text
  const len = (s: string) => Array.from(s).length
  return text.split('\n').map(paragraph => {
    if (len(paragraph) <= maxChars || !paragraph.includes(' ')) return paragraph
    const lines: string[] = []
    let current = ''
    for (const word of paragraph.split(' ')) {
      if (current === '') { current = word; continue }
      if (len(current) + 1 + len(word) > maxChars) { lines.push(current); current = word } else current += ' ' + word
    }
    if (current !== '') lines.push(current)
    return lines.join('\n')
  }).join('\n')
}
