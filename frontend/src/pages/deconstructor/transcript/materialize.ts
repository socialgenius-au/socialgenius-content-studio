// M2.5a -- turn approved transcript lines into native Video Studio V2 SUBTITLES and a per-scene SCRIPT, and merge them into a draft snapshot. Pure. Handles time mapping, clipping to the
// draft, duplicates, and the provenance every subtitle carries. It never edits evidence, never touches the editor, and never claims more than a machine transcript shows.
import type { SpeechReconstructionProvenance, SubtitleSegment } from '../../../types'
import { DEFAULT_SUBTITLE_BOX, LIMITATIONS, NO_CLAIMS, SPEECH_ENGINE_VERSION, round3, unsupportedScript, type Prop } from './contract'
import type { SpeechCandidate } from './candidates'
import { resolveSpeech, type ResolvedSpeech, type SpeechCorrections, type TimeMap } from './corrections'
import { POSITION_Y, breakLines, normaliseLayout, type SubtitleLayout } from './layout'

export interface SceneSpan { sceneNumber: number; startTime: number; endTime: number }
export interface SpeechContext {
  referenceVideoId: number
  videoAnalysisId: number
  timeMap: TimeMap
  scenes: readonly SceneSpan[]
  /** What the draft already holds. A subtitle whose id is already there is not added twice. */
  existingSubtitleIds: readonly string[]
  createdAt: string
  /** Where the subtitles sit, how big their text is and how long a line may be. Absent = the editor's own defaults, exactly as before. */
  layout?: Partial<SubtitleLayout>
}

export type SpeechItemStatus = 'included' | 'excluded_default' | 'excluded_user' | 'outside_timeline' | 'duplicate' | 'invalid'
export interface SpeechPlanItem { candidateId: string; status: SpeechItemStatus; message: string }

export interface ScriptLine { candidateId: string; segmentId: number; start: number; end: number; text: string; transcribedText: string; edited: boolean }
export interface ScriptScene { sceneNumber: number; startTime: number; endTime: number; lines: ScriptLine[] }

export interface SpeechReconstructionRecord {
  schema: 'reconstruction-v1'
  kind: 'speech'
  engineVersion: string
  referenceVideoId: number
  videoAnalysisId: number
  createdAt: string
  timeMap: { mode: TimeMap['mode']; factor: number; referenceSeconds: number | null; planSeconds: number }
  counts: { transcribed: number; included: number; excluded: number; outside: number; duplicates: number; invalid: number; unsupportedScript: number }
  items: SpeechPlanItem[]
  /** The kept lines grouped by blueprint scene: something to rewrite or re-record. Reference words, machine-transcribed unless edited. */
  script: ScriptScene[]
  claims: typeof NO_CLAIMS
  limitations: string[]
}

export interface SpeechPlan { subtitles: SubtitleSegment[]; items: SpeechPlanItem[]; script: ScriptScene[]; record: SpeechReconstructionRecord; signature: string }

export const subtitleId = (videoAnalysisId: number, c: Pick<SpeechCandidate, 'id'>) => `rs:${videoAnalysisId}:${c.id}`

function provenanceOf(r: ResolvedSpeech, ctx: SpeechContext, layout: SubtitleLayout): SpeechReconstructionProvenance {
  const c = r.candidate, seg = c.segment
  const p = (v: Prop<unknown>) => ({ basis: v.basis, ...(v.confidence ? { confidence: v.confidence } : {}), ...(v.note ? { note: v.note } : {}) })
  return {
    schema: 'reconstruction-v1', kind: 'speech', candidateId: c.id, referenceVideoId: ctx.referenceVideoId, videoAnalysisId: ctx.videoAnalysisId, engineVersion: SPEECH_ENGINE_VERSION,
    evidence: [{ kind: 'speech_segment', id: seg.id }], language: seg.language, diagnostics: { ...seg.diagnostics }, transcribedText: seg.text,
    properties: {
      text: p(r.text), startTime: p(r.start), endTime: p(r.end),
      position: layout.position === 'bottom' ? { basis: 'default', note: 'The editor’s own default subtitle box.' } : { basis: 'user', note: `Placed at the ${layout.position} of the frame, as you chose.` },
      ...(layout.fontSize ? { fontSize: { basis: 'user' as const, note: `Text size ${layout.fontSize}, as you chose.` } } : {}),
      ...(layout.maxChars ? { lineBreaks: { basis: 'user' as const, note: `Lines broken before ${layout.maxChars} characters, as you chose. The words are unchanged.` } } : {}),
    }, corrected: [...r.corrected], claims: { ...NO_CLAIMS },
  }
}

export function planSpeech(candidates: readonly SpeechCandidate[], corrections: SpeechCorrections, ctx: SpeechContext): SpeechPlan {
  const kept: { sub: SubtitleSegment; line: ScriptLine; script: boolean }[] = []
  const items: SpeechPlanItem[] = []
  const existing = new Set(ctx.existingSubtitleIds)
  const plan = ctx.timeMap.planSeconds
  const layout = normaliseLayout(ctx.layout)
  for (const c of candidates) {
    const corr = corrections[c.id]
    const r = resolveSpeech(c, corr, ctx.timeMap)
    const add = (status: SpeechItemStatus, message: string) => items.push({ candidateId: c.id, status, message })
    if (!r.include) {
      const byUser = corr?.include === false
      add(byUser ? 'excluded_user' : 'excluded_default', byUser ? 'Left out by you.' : (c.flags.find(f => f.code === 'third_party_words') && c.defaultInclude === false && !c.flags.some(f => ['low_quality', 'maybe_not_speech', 'repetitive'].includes(f.code))
        ? 'Left out by default: these are someone else’s words. Include them to use them as a starting point.' : (c.flags.find(f => ['low_quality', 'maybe_not_speech', 'repetitive'].includes(f.code))?.message ?? 'Left out by default.')))
      continue
    }
    if (r.invalid) { add('invalid', 'The wording is empty, so there is nothing to show.'); continue }
    const start = Math.max(0, r.start.value), end = Math.min(plan, r.end.value)
    if (end - start < 0.1) { add('outside_timeline', `This is spoken after the draft ends (${round3(r.start.value)} s of ${round3(plan)} s). Move its time or leave it out.`); continue }
    const id = subtitleId(ctx.videoAnalysisId, c)
    if (existing.has(id)) { add('duplicate', 'This is already in the draft as a reconstruction subtitle.'); continue }
    const sub: SubtitleSegment = {
      id, text: breakLines(r.text.value, layout.maxChars), startTime: round3(start), endTime: round3(end), ...DEFAULT_SUBTITLE_BOX, y: POSITION_Y[layout.position],
      ...(layout.fontSize ? { styleOverride: { fontSize: layout.fontSize } } : {}), reconstruction: provenanceOf(r, ctx, layout),
    }
    const script = unsupportedScript(r.text.value) !== null                         // judged on the wording the person kept, not the words as transcribed
    kept.push({ sub, script, line: { candidateId: c.id, segmentId: c.segment.id, start: round3(start), end: round3(end), text: r.text.value, transcribedText: c.segment.text, edited: r.text.basis === 'user' } })
    add('included', script ? 'Will be added as an editable subtitle. The exporter cannot lay out this script correctly yet.' : 'Will be added as an editable subtitle.')
  }
  kept.sort((a, b) => a.sub.startTime - b.sub.startTime)
  kept.forEach((k, i) => { k.sub.order = -(i + 1) })                                       // the editor's own convention for imported transcript lines: list order among themselves
  const scenes = [...ctx.scenes].sort((a, b) => a.startTime - b.startTime)
  const script: ScriptScene[] = scenes.map(s => ({ sceneNumber: s.sceneNumber, startTime: s.startTime, endTime: s.endTime, lines: [] }))
  for (const k of kept) {
    const mid = (k.line.start + k.line.end) / 2
    const target = script.find(s => mid >= s.startTime && mid < s.endTime) ?? (script.length === 0 ? undefined : mid < script[0].startTime ? script[0] : script[script.length - 1])
    target?.lines.push(k.line)
  }
  const count = (...s: SpeechItemStatus[]) => items.filter(i => s.includes(i.status)).length
  const record: SpeechReconstructionRecord = {
    schema: 'reconstruction-v1', kind: 'speech', engineVersion: SPEECH_ENGINE_VERSION, referenceVideoId: ctx.referenceVideoId, videoAnalysisId: ctx.videoAnalysisId, createdAt: ctx.createdAt,
    timeMap: { mode: ctx.timeMap.mode, factor: round3(ctx.timeMap.factor), referenceSeconds: ctx.timeMap.referenceSeconds, planSeconds: ctx.timeMap.planSeconds },
    counts: {
      transcribed: candidates.length, included: count('included'), excluded: count('excluded_default', 'excluded_user'), outside: count('outside_timeline'), duplicates: count('duplicate'), invalid: count('invalid'),
      unsupportedScript: kept.filter(k => k.script).length,
    },
    items, script, claims: { ...NO_CLAIMS }, limitations: [...LIMITATIONS],
  }
  const subtitles = kept.map(k => k.sub)
  return { subtitles, items, script, record, signature: JSON.stringify(subtitles.map(s => [s.id, s.text, s.startTime, s.endTime, s.y, s.styleOverride?.fontSize ?? null])) }
}

/** The part of a draft snapshot this touches. Anything else on the snapshot passes through untouched. */
export interface HasSubtitles { subtitles: readonly unknown[] }

/** Add the approved subtitles to a draft snapshot and attach the record (with the per-scene script). Returns a NEW object; merging the same plan again adds nothing more. */
export function mergeSpeech<S extends HasSubtitles>(snapshot: S, plan: SpeechPlan | null | undefined): S | (Omit<S, 'subtitles'> & { subtitles: SubtitleSegment[]; speechReconstruction: SpeechReconstructionRecord }) {
  if (!plan || plan.subtitles.length === 0) return snapshot
  const have = new Set((snapshot.subtitles as SubtitleSegment[]).map(s => s.id))
  return { ...snapshot, subtitles: [...(snapshot.subtitles as SubtitleSegment[]), ...plan.subtitles.filter(s => !have.has(s.id))], speechReconstruction: plan.record }
}
