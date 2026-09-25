// C5 -- pure view-model helpers for the Deconstructor workspace. No React, no network: everything the UI shows in business language is
// derived here so it can be unit-tested. Technical stage numbers ("Stage 10", "11.4") never reach the primary UI.
import type { ReferenceVideo } from '../../types'
import type {
  Anatomy, AnatomySection, Blueprint, BlueprintGap, DeconStatus, DerivedStatus, Mechanism, MechanismSet,
} from '../../types/deconstructor'

// ── labels ───────────────────────────────────────────────────────────────────────────────────

export const MECHANISM_TYPE_LABELS: Record<string, string> = {
  hook_curiosity: 'Hook / curiosity', problem_tension: 'Problem / tension', information_reveal: 'Information reveal', progression: 'Progression',
  contrast: 'Contrast', proof_credibility: 'Proof / credibility', demonstration: 'Demonstration', pattern_interruption: 'Pattern interruption',
  pacing_rhythm: 'Pacing & rhythm', emotional_progression: 'Emotional progression', payoff_resolution: 'Payoff / resolution',
  cta_next_step: 'Call to action / next step', visual_attention: 'Visual attention', audio_attention: 'Audio attention', text_attention: 'On-screen text attention',
}

export const STRUCTURAL_ROLE_LABELS: Record<string, string> = {
  opening: 'Opening', hook: 'Hook', contrast: 'Contrast', development: 'Development', closing: 'Closing', call_to_action: 'Call to action',
  problem: 'Problem', proof: 'Proof', payoff: 'Payoff', transition: 'Transition',
}

export const NON_TRANSFERABLE_LABELS: Record<string, string> = {
  wording: 'Wording', brand_or_name: 'Brand or name', visual_specific: 'Specific visuals', audio_specific: 'Specific audio',
  subject_matter: 'Subject matter', timing_specific: 'Specific timing', other: 'Other',
}

const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase())
export const mechanismTypeLabel = (t: string, other?: string | null) => (t === 'other' && other ? other : MECHANISM_TYPE_LABELS[t] ?? titleCase(t))
export const structuralRoleLabel = (r: string) => STRUCTURAL_ROLE_LABELS[r] ?? titleCase(r)
export const nonTransferableLabel = (k: string) => NON_TRANSFERABLE_LABELS[k] ?? titleCase(k)
export const confidenceLabel = (c: string) => (c === 'high' ? 'High confidence' : c === 'medium' ? 'Medium confidence' : c === 'low' ? 'Low confidence' : titleCase(c))

/** m:ss (or m:ss.t for short spans). */
export function fmtTime(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return '—'
  const m = Math.floor(sec / 60), s = sec - m * 60
  return `${m}:${s.toFixed(1).padStart(4, '0')}`
}
export const fmtRange = (a: number, b: number) => `${fmtTime(a)} – ${fmtTime(b)}`
export const fmtSeconds = (n: number) => `${Math.round(n * 10) / 10}s`

/** Strip technical stage numbering from a backend stage label: "Retention devices (Stage 11.4)" -> "Retention devices". */
export function friendlyStageLabel(label: string): string {
  return label.replace(/\s*\((?:Stage\s*)?[\d.]+\)\s*/gi, ' ').replace(/\s*\bStage\s*[\d.]+\b\s*/gi, ' ').replace(/\s{2,}/g, ' ').trim()
}

// ── reference ────────────────────────────────────────────────────────────────────────────────

export interface ReferenceCard {
  id: number
  title: string
  durationSeconds: number | null
  status: 'ready' | 'running' | 'failed' | 'pending'
  statusLabel: string
  thumbnailPath: string | null
  addedAt: string
}

export function referenceCard(v: ReferenceVideo): ReferenceCard {
  const st = v.latest_analysis?.status
  const status = st === 'complete' ? 'ready' : st === 'running' ? 'running' : st === 'failed' ? 'failed' : 'pending'
  const label = { ready: 'Analysed', running: 'Analysing…', failed: 'Analysis failed', pending: 'Not analysed yet' }[status]
  const thumb = (v.shots ?? []).flatMap(s => s.frames ?? []).find(f => !!f.asset_file_path)
  return {
    id: v.id, title: v.original_filename, durationSeconds: v.technical_details?.container?.duration_seconds ?? null,
    status, statusLabel: label, thumbnailPath: thumb?.asset_file_path ?? null, addedAt: v.created_at,
  }
}

// ── deconstruction progress (C1) ─────────────────────────────────────────────────────────────

export interface DeconProgress {
  state: 'not_started' | 'running' | 'done' | 'failed'
  done: number
  total: number
  percent: number
  current: string | null
  failures: { label: string; error: string }[]
  headline: string
}

const DONE_STATES = new Set(['complete', 'already_complete', 'skipped'])

export function summarizeDeconStatus(s: DeconStatus | null | undefined): DeconProgress {
  if (!s) return { state: 'not_started', done: 0, total: 0, percent: 0, current: null, failures: [], headline: 'Not deconstructed yet' }
  const total = s.stages.length
  const done = s.stages.filter(x => DONE_STATES.has(x.status)).length
  const failures = s.stages.filter(x => x.status === 'failed').map(x => ({ label: friendlyStageLabel(x.label), error: x.error ?? 'Unknown problem' }))
  const orch = s.orchestration?.status
  const running = orch === 'running' || s.stages.some(x => x.status === 'running')
  const cur = s.stages.find(x => x.status === 'running')
  const percent = total ? Math.round((done / total) * 100) : 0
  const state: DeconProgress['state'] = running ? 'running' : failures.length ? 'failed' : done > 0 ? 'done' : 'not_started'
  const headline = { running: 'Deconstructing…', failed: 'Deconstruction finished with problems', done: 'Deconstruction complete', not_started: 'Not deconstructed yet' }[state]
  return { state, done, total, percent, current: cur ? friendlyStageLabel(cur.label) : null, failures, headline }
}

// ── anatomy (C2) ─────────────────────────────────────────────────────────────────────────────

export interface AnatomyCard {
  number: number
  timeRange: string
  duration: string
  role: string
  whatHappens: string[]
  transcript: string | null
  visual: string
  onScreenText: string[]
  audio: string
  pacing: string
  retention: string
  evidenceNotes: string[]
}

function roleFor(s: AnatomySection): string {
  if (s.is_opening && s.overlaps_hook_window) return 'Opening — inside the hook window'
  if (s.is_opening) return 'Opening'
  if (s.overlaps_hook_window) return 'Hook window'
  const i = s.interpretive
  return i.narrative_role ?? i.messaging_role ?? 'Structural section'
}

export function anatomyCard(s: AnatomySection): AnatomyCard {
  const objs = s.visual.objects.map(o => (o.count > 1 ? `${o.count} × ${o.label}` : o.label))
  const what: string[] = []
  if (s.speech.length) what.push(`${s.speech.length} spoken ${s.speech.length === 1 ? 'segment' : 'segments'}`)
  if (s.on_screen_text.length) what.push(`${s.on_screen_text.length} on-screen text ${s.on_screen_text.length === 1 ? 'element' : 'elements'}`)
  if (objs.length) what.push(`Visible: ${objs.join(', ')}`)
  if (!what.length) what.push('No speech, text or recognised objects in this stretch')
  const shots = s.pacing.shot_count
  const dev = s.retention_devices
  return {
    number: s.number, timeRange: fmtRange(s.start_time, s.end_time), duration: fmtSeconds(s.duration), role: roleFor(s), whatHappens: what,
    transcript: s.transcript_excerpt || null,
    visual: objs.length ? objs.join(', ') : 'No recognised objects',
    onScreenText: s.on_screen_text.map(t => t.text),
    audio: s.audio.audio_stream_present === false ? 'No audio' : s.audio.silence_seconds > 0 ? `${fmtSeconds(s.audio.silence_seconds)} of silence` : 'Continuous audio',
    pacing: `${shots} ${shots === 1 ? 'shot' : 'shots'}, ${s.pacing.cut_count} ${s.pacing.cut_count === 1 ? 'cut' : 'cuts'}`,
    retention: dev.length
      ? dev.map(d => `${d.device_type ?? 'device'}${d.probable_attention_function ? ` — ${d.probable_attention_function}` : ''}${d.confidence ? ` (${d.confidence})` : ''}`).join('; ')
      : s.rejected_candidates.length ? `No retention device confirmed (${s.rejected_candidates.length} ${s.rejected_candidates.length === 1 ? 'candidate' : 'candidates'} examined and rejected)` : 'No retention device confirmed',
    evidenceNotes: s.features.map(f => titleCase(f)),
  }
}

export interface AnatomyOverview {
  durationText: string
  sectionCount: number
  hookNote: string | null
  structuralSummary: string | null
  pacing: string
  retention: string
  gaps: string[]
}

export function anatomyOverview(a: Anatomy): AnatomyOverview {
  const v = a.video
  const p = v.pacing_profile
  const r = v.retention
  return {
    durationText: fmtSeconds(v.duration), sectionCount: v.section_count,
    hookNote: v.hook.classification?.primary_type ? `Hook style: ${titleCase(v.hook.classification.primary_type)}` : null,
    structuralSummary: v.structural_pattern?.summary || null,
    pacing: `${p.shot_count} shots, ${p.cut_count} cuts${p.average_shot_duration_seconds != null ? `, ~${fmtSeconds(p.average_shot_duration_seconds)} per shot` : ''}`,
    retention: r.accepted_count === 0
      ? `No retention devices were confirmed (${r.examined_count} examined) — the analysis does not assume any.`
      : `${r.accepted_count} retention ${r.accepted_count === 1 ? 'device' : 'devices'} confirmed`,
    gaps: dedupe(a.gaps.map(g => g.reason)),
  }
}

const dedupe = <T,>(xs: T[]) => Array.from(new Set(xs))

/** Whether the reference has enough analysed structure to move on. Based on the anatomy actually being available (the C1 status can show
 *  derived stages as "not run" for a video that was analysed stage-by-stage, so it is not used to gate readiness). */
export function anatomyReady(a: Anatomy | null | undefined): boolean {
  return !!a && Array.isArray(a.sections) && a.sections.length > 0
}

// ── mechanisms (C3) ──────────────────────────────────────────────────────────────────────────

export interface MechanismCard {
  id: string
  typeLabel: string
  statement: string
  principle: string
  whyStructural: string
  whereItAppears: string
  canTransfer: string
  mustNotCopy: { kind: string; description: string }[]
  confidence: string
  confidenceLevel: string
  limitations: string[]
}

export function mechanismCard(m: Mechanism): MechanismCard {
  return {
    id: m.mechanism_id, typeLabel: mechanismTypeLabel(m.mechanism_type, m.other_label), statement: m.statement, principle: m.transferable_principle,
    whyStructural: m.statement,
    whereItAppears: m.scope === 'video' ? 'Across the whole video' : m.section_numbers.length ? `Section${m.section_numbers.length > 1 ? 's' : ''} ${m.section_numbers.join(', ')} of the reference` : 'Specific sections of the reference',
    canTransfer: m.transferable_principle,
    mustNotCopy: m.non_transferable_elements.map(n => ({ kind: nonTransferableLabel(n.kind), description: n.description })),
    confidence: confidenceLabel(m.confidence), confidenceLevel: m.confidence,
    limitations: dedupe([...m.limitations.model_stated, ...m.limitations.anatomy_gaps.map(g => g.reason)]),
  }
}

export interface MechanismsView {
  state: 'none' | 'current' | 'stale' | 'unknown'
  message: string | null
  cards: MechanismCard[]
  overallLimitations: string[]
}

export function mechanismsView(r: MechanismSet | null | undefined): MechanismsView {
  if (!r || r.status === 'not_run' || !r.mechanisms?.length) return { state: 'none', message: null, cards: [], overallLimitations: [] }
  const message = r.status === 'stale' ? 'These mechanisms were learned from an earlier version of the reference analysis. They are shown for reference; derive them again to refresh.'
    : r.status === 'unknown' ? 'We could not confirm these mechanisms still match the current reference analysis.' : null
  return { state: r.status as 'current' | 'stale' | 'unknown', message, cards: r.mechanisms.map(mechanismCard), overallLimitations: dedupe(r.overall_limitations ?? []) }
}

// ── blueprint (C4) ───────────────────────────────────────────────────────────────────────────

export interface BlueprintSummaryView {
  structuralApproach: string
  platform: string
  duration: string
  mechanismsUsed: { id: string; label: string }[]
  mechanismsNotUsed: { id: string; label: string; reason: string }[]
  constraints: string[]
  doNotReproduce: string[]
  gaps: string[]
  qualityNotes: string[]
}

/** Split gaps into user-facing "limitations" and reviewer "quality notes" (kind `quality_note`); any other/unknown kind is a limitation. */
export function partitionGaps(gaps: BlueprintGap[] | undefined | null): { limitations: string[]; qualityNotes: string[] } {
  const lim: string[] = [], q: string[] = []
  for (const g of gaps ?? []) (g.kind === 'quality_note' ? q : lim).push(g.reason)
  return { limitations: dedupe(lim), qualityNotes: dedupe(q) }
}

export function blueprintSummary(bp: Blueprint): BlueprintSummaryView {
  const label = (id: string, type?: string) => `${id} · ${mechanismTypeLabel(type ?? bp.mechanism_dispositions.find(d => d.mechanism_id === id)?.mechanism_type ?? 'other')}`
  const { limitations, qualityNotes } = partitionGaps(bp.gaps)
  const c = bp.constraints
  const t = bp.target
  return {
    structuralApproach: bp.structural_approach,
    platform: t.platform ?? 'Not specified',
    duration: t.target_duration_seconds != null ? `${fmtSeconds(t.target_duration_seconds)} target · ${fmtSeconds(t.planned_total_seconds)} planned` : `${fmtSeconds(t.planned_total_seconds)} planned (no target set)`,
    mechanismsUsed: bp.mechanisms_used.map(id => ({ id, label: label(id) })),
    mechanismsNotUsed: bp.mechanisms_not_used.map(d => ({ id: d.mechanism_id, label: label(d.mechanism_id, d.mechanism_type), reason: d.reason ?? 'No reason recorded' })),
    constraints: dedupe([...c.tone_style, ...c.prohibited_claims_or_elements.map(p => `Avoid: ${p}`)]),
    doNotReproduce: dedupe(c.do_not_reproduce.map(d => d.description)),
    gaps: [...limitations, ...(bp.limitations ?? [])].filter((x, i, a) => a.indexOf(x) === i),
    qualityNotes,
  }
}

export interface BlueprintSectionCard {
  number: number
  role: string
  purpose: string
  duration: string
  contentInstruction: string
  directions: { label: string; text: string }[]
  cta: string | null
  mandatoryPoints: { id: string; text: string }[]
  mechanisms: { id: string; label: string }[]     // from section.mechanisms_applied ONLY
  requiredInformation: string[]
  confidence: string
  limitations: string[]
}

export function blueprintSectionCards(bp: Blueprint): BlueprintSectionCard[] {
  const mp = new Map(bp.mandatory_point_accounting.map(a => [a.id, a.text]))
  return [...bp.sections].sort((a, b) => a.section_number - b.section_number).map(s => ({
    number: s.section_number, role: structuralRoleLabel(s.structural_role), purpose: s.section_purpose, duration: fmtSeconds(s.target_duration_seconds),
    contentInstruction: s.content_instruction,
    directions: ([
      ['Visual', s.visual_direction], ['On-screen text', s.text_direction], ['Speech / voice', s.speech_direction],
      ['Pacing', s.pacing_direction], ['Transition', s.transition_direction],
    ] as [string, string | null][]).filter(([, t]) => !!t).map(([label, text]) => ({ label, text: text as string })),
    cta: s.cta_direction,
    mandatoryPoints: s.mandatory_points_assigned.map(id => ({ id, text: mp.get(id) ?? id })),
    mechanisms: s.mechanisms_applied.map(id => ({ id, label: `${id} · ${mechanismTypeLabel(bp.mechanism_dispositions.find(d => d.mechanism_id === id)?.mechanism_type ?? 'other')}` })),
    requiredInformation: s.required_information, confidence: confidenceLabel(s.confidence), limitations: s.limitations,
  }))
}

/** Friendly explanation of a derived status for banners. */
export function derivedStatusNote(status: DerivedStatus | undefined): string | null {
  if (status === 'stale') return 'Out of date — the inputs it was built from have changed.'
  if (status === 'unknown') return 'We could not confirm this still matches the reference analysis.'
  return null
}
