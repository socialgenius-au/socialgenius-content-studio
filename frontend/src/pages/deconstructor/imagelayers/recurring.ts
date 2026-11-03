// What kind of thing is a recurring on-screen text? The analysis links the same recognised text across several moments; that can be a watermark or logo-like mark that stays (or hops between fixed spots) for most of
// the video, or just a caption word that happens to come up again. This weighs the evidence the analysis already stored -- how much of the video it spans, whether its text looks like a handle or a word,
// whether it returns to the same spots or slides along a line of text, whether OCR keeps reading it the same way -- and says which it looks like and WHY. It is a judgment from a handful of readings, never a
// detection: nothing here looks at the picture, and the result only orders and labels the slot (every inferred slot stays off by default and editable).
//
// Calibrated on the one real reference we have (VA5368): a creator handle that hops between two fixed spots across 92% of the video (probable mark), and the caption word "Aap" sliding along one text line for 44% (caption).
import type { Rect } from './contract'

export interface Sighting { text: string; box: Rect; time: number }
export type RecurringKind = 'probable_mark' | 'unclear' | 'caption_text'
export interface RecurringClassification { kind: RecurringKind; score: number; reasons: string[] }

export const KIND_LABEL: Record<RecurringKind, string> = {
  probable_mark: 'Probable watermark or logo (inferred from repeated text)',
  unclear: 'Recurring text, unclear whether it is a mark (inferred)',
  caption_text: 'Recurring caption text (inferred; probably not a logo)',
}
export const PROBABLE_AT = 3
export const CAPTION_AT = 0
const SPOT_TOLERANCE = 0.02            // two sightings are "the same spot" when their box corners are within 2% of the frame

const cx = (b: Rect) => b.x + b.w / 2, cy = (b: Rect) => b.y + b.h / 2
const spread = (xs: number[]) => (xs.length ? Math.max(...xs) - Math.min(...xs) : 0)

/** A handle, address or code-like string: an @, a digit, an underscore, a web address, or a long run of capitals with no spaces. */
export const looksLikeHandle = (s: string) => /[@_\d]|www\.|\.(com|net|org|tv|app)\b|^[A-Z]{8,}$/.test(s.trim())
/** A plain word or short phrase of letters, as a caption would be. */
export const looksLikeWords = (s: string) => /^[\p{L}][\p{L}'’\- ]{1,40}$/u.test(s.trim()) && !/^[A-Z]{3,}$/.test(s.trim()) && !looksLikeHandle(s)

/** How many distinct places the sightings sit in (boxes within the tolerance count as one place). */
export function distinctSpots(boxes: readonly Rect[]): number {
  const spots: Rect[] = []
  for (const b of boxes) if (!spots.some(s => Math.abs(s.x - b.x) <= SPOT_TOLERANCE && Math.abs(s.y - b.y) <= SPOT_TOLERANCE)) spots.push(b)
  return spots.length
}

export function classifyRecurring(sightings: readonly Sighting[], videoSeconds: number | null, first: number, last: number): RecurringClassification {
  const reasons: string[] = []
  let score = 0
  const n = sightings.length
  if (n < 3) return { kind: 'unclear', score: 0, reasons: [`Only ${n} sighting${n === 1 ? '' : 's'}: too few to say whether it is a mark or a caption.`] }

  const texts = sightings.map(s => s.text.trim()).filter(Boolean)
  const handle = texts.some(looksLikeHandle)
  const words = !handle && texts.length > 0 && texts.every(looksLikeWords)
  if (handle) { score += 2; reasons.push('Its text looks like a handle or code (an @, underscore, digits or a long run of capitals), as a watermark often does.') }
  if (words) { score -= 2; reasons.push('Its text is a plain word, as a caption would be.') }

  if (videoSeconds && videoSeconds > 0) {
    const share = Math.max(0, last - first) / videoSeconds
    if (share >= 0.6) { score += 2; reasons.push(`It comes up from ${first.toFixed(1)} s to ${last.toFixed(1)} s, ${Math.round(share * 100)}% of the video: a mark stays for most of it.`) }
    else if (share >= 0.35) { score += 1; reasons.push(`It spans ${Math.round(share * 100)}% of the video.`) }
    else reasons.push(`It spans only ${Math.round(share * 100)}% of the video.`)
  }

  const spots = distinctSpots(sightings.map(s => s.box))
  if (n / spots >= 1.8) { score += 1; reasons.push(`It returns to the same ${spots === 1 ? 'spot' : `${spots} spots`} (${n} sightings in ${spots}): a mark sits in fixed places.`) }
  const xs = sightings.map(s => cx(s.box)), ys = sightings.map(s => cy(s.box))
  if (spread(ys) < 0.02 && spread(xs) > 0.15) { score -= 2; reasons.push('It slides along one line of text (same height, different positions), as caption words do.') }

  const distinctReadings = new Set(texts.map(t => t.toLowerCase())).size
  if (distinctReadings >= 2 && handle) { score += 1; reasons.push('OCR reads it slightly differently each time, as small, low-contrast marks tend to be.') }

  const kind: RecurringKind = score >= PROBABLE_AT ? 'probable_mark' : score <= CAPTION_AT ? 'caption_text' : 'unclear'
  return { kind, score, reasons }
}
