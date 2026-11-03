// M4.1 -- classify what a tracked thing most likely is, from evidence the analysis already stored. Deterministic rules, no model, no pixels. Every result carries its explanation, its evidence and its
// confidence, and the rules are built so that doubt wins: too little evidence is UNKNOWN, and confidence is capped and scaled down by few sightings and noisy OCR.
//
// What this does NOT do, on purpose: it never turns OCR text into a graphical class. A creator handle is TEXT_HANDLE however long it stays on screen; a probable watermark word is TEXT_OTHER with a note that it
// could be a logo if a person says so. LOGO_MARK, ICON_GRAPHIC and SHAPE_GRAPHIC can only come from a person's correction.
import type { Classification, ClassCorrection, EvidenceRef, Track, VisualClass } from './contract'
import { levelOf, round3, USER_ONLY_CLASSES } from './contract'
import { cx, cy, distinctSpots, looksLikeHandle, looksLikeWords, mean, spread } from './signals'

/** The most a rule-based judgment can ever score. A person's own correction is the only thing above it. */
export const RULE_CAP = 0.8
export const UNKNOWN_BELOW = 0.4

export interface TextContext { videoSeconds: number | null; subtitleTrackIds: ReadonlySet<string> }

const looksNumeric = (s: string) => /^[\d\s.,:%+\-/]+$/.test(s.trim())
const clamp01 = (n: number) => Math.max(0, Math.min(1, n))
const norm = (s: string) => s.trim().toLowerCase()

const evidenceOf = (track: Track): EvidenceRef[] => {
  const out: EvidenceRef[] = []
  if (track.linkage.by === 'recurring_element') out.push({ kind: 'recurring_element', id: track.id.replace(/^tt:rec:/, ''), certainty: 'INFERRED', note: `The analysis linked ${track.linkage.ids.length} text groups as the same recurring element${track.linkage.crossesShotBoundary ? ' across a shot boundary' : ''}.` })
  for (const id of track.linkage.ids) out.push({ kind: 'text_element', id, certainty: 'MEASURED', note: 'An OCR occurrence group (its readings, boxes and times are stored evidence).' })
  return out
}

/** Subtitle lines: several short, distinct texts at about the same height in the lower part of the frame. Only unlinked tracks qualify (a text the analysis found recurring is not a one-off spoken line). */
export function findSubtitleLines(tracks: readonly Track[]): Set<string> {
  const cand = tracks.filter(t => t.kind === 'text' && t.linkage.by !== 'recurring_element' && t.observations.length > 0
    && cy(t.observations[0].box) >= 0.6 && (t.intervals[t.intervals.length - 1].end - t.intervals[0].start) <= 4 && Array.from(t.observations[0].text?.trim() ?? '').length >= 3)
  const out = new Set<string>()
  const used = new Set<string>()
  for (const t of cand) {
    if (used.has(t.id)) continue
    const line = cand.filter(u => Math.abs(cy(u.observations[0].box) - cy(t.observations[0].box)) <= 0.04)
    const distinct = new Set(line.map(u => norm(u.observations[0].text ?? '')))
    if (line.length >= 3 && distinct.size >= 3) for (const u of line) { out.add(u.id); used.add(u.id) }
  }
  return out
}

export function classifyTextTrack(track: Track, ctx: TextContext): Classification {
  const obs = track.observations
  const n = obs.length
  const texts = obs.map(o => (o.text ?? '').trim()).filter(Boolean)
  const ocr = obs.map(o => o.ocrConfidence).filter((x): x is number => typeof x === 'number')
  const meanOcr = ocr.length ? mean(ocr) : null
  const evidence = evidenceOf(track)
  const unknown = (why: string): Classification => ({ class: 'UNKNOWN', certainty: 'INFERRED', basis: 'rule', confidence: { level: 'low', score: 0 }, explanation: [why], evidence, alternatives: [] })
  if (texts.length === 0) return unknown('No readable text was recorded for it, so nothing can be said about what it is.')
  if (meanOcr !== null && meanOcr < 0.35) return unknown(`OCR was only ${Math.round(meanOcr * 100)}% sure of its reading, too unsure to classify.`)
  if (texts.every(t => Array.from(t).length <= 2) && !texts.some(t => /^[@#]/.test(t)) && !texts.every(looksNumeric)) return unknown('Only one or two characters were read: a fragment, not enough to say what it is.')

  const boxes = obs.map(o => o.box)
  const start = track.intervals[0]?.start ?? obs[0].time, end = track.intervals[track.intervals.length - 1]?.end ?? obs[0].time
  const spanShare = ctx.videoSeconds && ctx.videoSeconds > 0 ? Math.max(0, end - start) / ctx.videoSeconds : null
  const best = [...obs].sort((a, b) => (b.ocrConfidence ?? 0) - (a.ocrConfidence ?? 0))[0].text ?? texts[0]
  const numeric = texts.every(looksNumeric)
  const handle = !numeric && texts.some(looksLikeHandle)
  const words = !handle && !numeric && texts.every(looksLikeWords)
  const spots = distinctSpots(boxes)
  const slides = spread(boxes.map(cy)) < 0.02 && spread(boxes.map(cx)) > 0.15
  const revisit = n / Math.max(1, spots)
  const readings = new Set(texts.map(norm)).size
  const inSub = ctx.subtitleTrackIds.has(track.id)
  const meanCy = mean(boxes.map(cy)), meanCx = mean(boxes.map(cx))

  const why: Record<string, string[]> = { TEXT_HANDLE: [], TEXT_SUBTITLE: [], TEXT_CAPTION: [], TEXT_OTHER: [] }
  const score: Record<string, number> = { TEXT_HANDLE: 0, TEXT_SUBTITLE: 0, TEXT_CAPTION: 0, TEXT_OTHER: 0 }

  if (handle) {
    score.TEXT_HANDLE = 0.45
    why.TEXT_HANDLE.push(`Its text (“${best.slice(0, 28)}”) looks like a handle or code: an @, underscore, digits or a long run of capitals.`)
    if (texts.some(t => t.trim().startsWith('@'))) { score.TEXT_HANDLE += 0.1; why.TEXT_HANDLE.push('One reading starts with “@”.') }
    if (spanShare !== null && spanShare >= 0.6) { score.TEXT_HANDLE += 0.15; why.TEXT_HANDLE.push(`It comes up from ${start.toFixed(1)} s to ${end.toFixed(1)} s, ${Math.round(spanShare * 100)}% of the video.`) }
    else if (spanShare !== null && spanShare >= 0.35) score.TEXT_HANDLE += 0.08
    if (n >= 3 && (revisit >= 1.8 || spots === 1)) { score.TEXT_HANDLE += 0.1; why.TEXT_HANDLE.push(spots === 1 ? 'It stays in one place.' : `It returns to the same ${spots} spots.`) }
    if (readings >= 2) { score.TEXT_HANDLE += 0.1; why.TEXT_HANDLE.push('OCR reads it slightly differently each time, as small low-contrast text tends to be.') }
  }
  if (inSub) {
    score.TEXT_SUBTITLE = 0.5
    why.TEXT_SUBTITLE.push('It is one of several short, different texts at the same height in the lower part of the frame, the pattern of a subtitle line. (Not checked against the transcript.)')
    if (meanCy >= 0.7) score.TEXT_SUBTITLE += 0.1
    if (Math.abs(meanCx - 0.5) <= 0.2) { score.TEXT_SUBTITLE += 0.1; why.TEXT_SUBTITLE.push('It is centred horizontally.') }
    if (end - start <= 4) score.TEXT_SUBTITLE += 0.1
  }
  if (words && !inSub) {
    score.TEXT_CAPTION = 0.4
    why.TEXT_CAPTION.push('Its text is plain words, as a caption would be.')
    if (slides) { score.TEXT_CAPTION += 0.15; why.TEXT_CAPTION.push('It slides along one line of text (same height, different positions), as caption words do.') }
    if (spanShare !== null && spanShare < 0.5) { score.TEXT_CAPTION += 0.05; why.TEXT_CAPTION.push(`It spans only ${Math.round(spanShare * 100)}% of the video.`) }
    if (readings >= 2 && texts.length >= 3 && readings === texts.length) score.TEXT_CAPTION -= 0.1
  }
  if (!handle && !(words && !inSub) && !inSub) {
    score.TEXT_OTHER = numeric ? 0.55 : 0.45                                                   // readable text of no further kind: certain that it IS text, so only the confidence (few sightings, OCR) stays low
    why.TEXT_OTHER.push(numeric ? 'Its text is only numbers or punctuation: a count, price or label rather than a caption or a handle.' : 'Its text does not look like a handle, a caption phrase or a subtitle line.')
    if (spanShare !== null && spanShare >= 0.6 && n >= 3 && spots <= 2) { score.TEXT_OTHER += 0.1; why.TEXT_OTHER.push('It stays for most of the video in fixed places, which is how a watermark or logo word behaves. That makes it worth checking, not a logo: nothing here looks at its appearance.') }
  }

  const ranked = (Object.entries(score) as [VisualClass, number][]).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1])
  if (ranked.length === 0 || ranked[0][1] < UNKNOWN_BELOW) return unknown('The evidence points to no single kind of text strongly enough to say.')
  const [cls, raw] = ranked[0]
  const sightings = inSub ? Math.max(n, 3) : n
  const factor = Math.min(1, sightings / 4) * (0.5 + 0.5 * (meanOcr ?? 0.5))
  const conf = round3(Math.min(RULE_CAP, clamp01(raw)) * factor)
  const explanation = [...why[cls]]
  if (n === 1 && !inSub) explanation.push('Seen only once, so this is a first impression, not a pattern.')
  if (meanOcr !== null && meanOcr < 0.7) explanation.push(`OCR confidence averages ${Math.round(meanOcr * 100)}%, which lowers this confidence.`)
  return {
    class: cls, certainty: 'INFERRED', basis: 'rule', confidence: { level: levelOf(conf), score: conf }, explanation, evidence,
    alternatives: ranked.slice(1, 3).map(([c, s]) => ({ class: c, score: round3(Math.min(RULE_CAP, clamp01(s)) * factor) })),
  }
}

export interface ObjectContext { detectorScore: number | null; label: string }

/** A detector box. A person is the reference's own footage, not a graphic. Anything else is only a labelled box: an image-like region, never a logo. */
export function classifyObjectTrack(track: Track, ctx: ObjectContext): Classification {
  const evidence: EvidenceRef[] = track.observations.map(o => o.evidence)
  const n = track.observations.length
  if (/^person$/i.test(ctx.label)) {
    return { class: 'UNKNOWN', certainty: 'INFERRED', basis: 'rule', confidence: { level: 'low', score: 0 },
      explanation: ['A person was detected here. That is the reference’s own footage, not a graphic, so it is not classified as a visual element to rebuild.'], evidence, alternatives: [] }
  }
  const raw = Math.min(0.5, (ctx.detectorScore ?? 0.5) * 0.6) * (n >= 2 ? 1 : 0.8)
  const conf = round3(raw)
  return { class: 'IMAGE_REGION', certainty: 'INFERRED', basis: 'rule', confidence: { level: levelOf(conf), score: conf },
    explanation: [`A general object detector labelled this region “${ctx.label}”${ctx.detectorScore !== null ? ` (${Math.round(ctx.detectorScore * 100)}% sure)` : ''}. That makes it an image-like region on a frame, not a logo and not an outlined object.`,
      n >= 2 ? `The analysis linked ${n} sightings of it within one shot.` : 'Seen on one sampled frame only.'], evidence, alternatives: [] }
}

export interface BarContext { uniformity: number; framesSeen: number; framesMeasured: number; flat: boolean }

/** A flat band measured along a frame edge. The MEASUREMENT is solid; calling it a "background element" is the judgment. */
export function classifyBackgroundBar(track: Track, ctx: BarContext): Classification {
  const evidence = track.observations.map(o => o.evidence)
  if (!ctx.flat) {
    return { class: 'BACKGROUND_ELEMENT', certainty: 'INFERRED', basis: 'rule', confidence: { level: 'low', score: 0.3 }, explanation: ['The border is a smooth gradient or a busy picture rather than one flat band: it is a background element, but not one that can be rebuilt as a single colour.'], evidence, alternatives: [] }
  }
  const raw = Math.min(RULE_CAP, 0.45 + 0.35 * (ctx.framesSeen / Math.max(1, ctx.framesMeasured))) * clamp01(ctx.uniformity)
  const conf = round3(raw)
  return { class: 'BACKGROUND_ELEMENT', certainty: 'INFERRED', basis: 'rule', confidence: { level: levelOf(conf), score: conf },
    explanation: [`A flat band was measured along the edge on ${ctx.framesSeen} of ${ctx.framesMeasured} sampled stills (${Math.round(ctx.uniformity * 100)}% flat).`, 'It is read as a background element; nothing behind overlays or text is recovered.'], evidence, alternatives: [] }
}

/** A person's correction replaces the judgment: their class, their basis, certainty OBSERVED (a person looked), and an explanation that says so. Evidence from the analysis is kept for orientation. */
export function applyCorrection(c: Classification, corr: ClassCorrection | undefined): Classification {
  if (!corr || corr.class === c.class) return c
  const userOnly = USER_ONLY_CLASSES.includes(corr.class)
  return {
    class: corr.class, certainty: 'OBSERVED', basis: 'user', confidence: { level: 'high', score: 1 },
    explanation: [`You set this as ${corr.class.replace('_', ' ').toLowerCase()}${userOnly ? '; nothing in the analysis could have told us that' : ''}. The analysis had judged it ${c.class.toLowerCase().replace('_', ' ')}.`, ...c.explanation],
    evidence: [...c.evidence, { kind: 'user_correction', id: 'user', certainty: 'OBSERVED', note: 'A class you set yourself.' }], alternatives: [{ class: c.class, score: c.confidence.score }],
  }
}
