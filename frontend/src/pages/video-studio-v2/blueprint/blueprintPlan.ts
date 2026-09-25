// C6 -- Reconstruction Blueprint -> Video Studio V2. PURE mapping logic (no React, no network), so it is unit-tested directly.
//
// CONTRACT
//  * One blueprint SECTION -> one ordered PLAN SCENE (stable order = section_number; start/end are the cumulative sum of the
//    sections' target_duration_seconds).
//  * `section.mechanisms_applied` is the ONLY source of a scene's mechanism metadata. The disposition-level `applied_in_sections`
//    is explanatory / audit metadata and is NEVER read here (dispositions are consulted only to LABEL an id that a section already
//    lists, e.g. its type and principle).
//  * The blueprint holds INSTRUCTIONS, not final content. Every placeholder created here says so ("TEXT PLACEHOLDER — ...") and
//    carries the instruction verbatim. Nothing is rewritten into marketing copy.
//  * A blueprint that is not `current` is NEVER turned into a plan (stale / unknown / not_run are refused with a reason).
//  * Every scene and every overlay retains blueprint_id + section number (+ reference video, C3 attempt, mechanism ids) so the
//    draft can later be reopened and traced.
import type { TextOverlay } from '../../../types'
import type { Blueprint, BlueprintResponse, BlueprintSection } from '../../../types/deconstructor'

export const PLAN_SCHEMA = 'blueprint-plan-v1' as const

export interface SceneTrace {
  blueprintId: string
  sectionNumber: number
  referenceVideoId: number
  videoAnalysisId: number
  c3AttemptId: number | null
  blueprintAttemptId: number | null
  mechanismIds: string[]
}

export interface PlanMechanism { id: string; type: string; principle: string }

export interface PlanScene {
  sceneNumber: number          // == blueprint section_number
  order: number                // 0-based position in the plan
  startTime: number
  endTime: number
  duration: number
  purpose: string
  structuralRole: string
  contentInstruction: string   // scene creation instruction
  requiredInformation: string[]
  visual: string               // visual placeholder instruction
  text: string                 // text placeholder instruction
  speech: string               // voice / speech placeholder instruction
  pacing: string               // pacing metadata / instruction
  transition: string | null    // transition placeholder instruction
  cta: string | null           // CTA instruction (relevant scenes only)
  mandatoryPoints: { id: string; text: string }[]
  mechanisms: PlanMechanism[]  // from section.mechanisms_applied ONLY
  anatomySections: number[]
  confidence: string
  limitations: string[]
  trace: SceneTrace
}

export interface BlueprintPlan {
  schema: typeof PLAN_SCHEMA
  blueprintId: string
  blueprintVersion: string
  referenceVideoId: number
  videoAnalysisId: number
  c3AttemptId: number | null
  blueprintAttemptId: number | null
  anatomyFingerprint: string | null
  intentHash: string | null
  intentSummary: string
  structuralApproach: string
  platform: string | null
  totalSeconds: number
  mechanismsUsed: string[]     // derived from the scenes (the authoritative mapping)
  createdAt: string
  scenes: PlanScene[]
}

export type UsableResult = { ok: true } | { ok: false; code: 'missing' | 'not_run' | 'stale' | 'unknown'; message: string }

/** USE BLUEPRINT is allowed only for a `current` blueprint. Never silently create from a stale one. */
export function checkBlueprintUsable(resp: BlueprintResponse | null | undefined): UsableResult {
  if (!resp || !resp.blueprint) {
    return { ok: false, code: resp?.status === 'not_run' ? 'not_run' : 'missing', message: 'There is no blueprint for this reference yet. Build one first.' }
  }
  if (resp.status === 'stale') {
    const anat = resp.input_pin.anatomy_fingerprint !== resp.input_pin.current_anatomy_fingerprint
    const mech = resp.input_pin.mechanism_attempt_id !== resp.input_pin.current_mechanism_attempt_id
    const why = anat && mech ? 'the reference analysis and the learned mechanisms have changed' : anat ? 'the reference analysis has changed' : mech ? 'the learned mechanisms have changed' : 'its inputs have changed'
    return { ok: false, code: 'stale', message: `This blueprint is out of date: ${why} since it was built. Build a new blueprint before using it.` }
  }
  if (resp.status === 'unknown') {
    return { ok: false, code: 'unknown', message: 'We could not confirm this blueprint still matches the reference analysis, so it cannot be used yet.' }
  }
  if (resp.status === 'not_run') return { ok: false, code: 'not_run', message: 'There is no blueprint for this reference yet. Build one first.' }
  return { ok: true }
}

function mechanismLabel(bp: Blueprint, id: string): PlanMechanism {
  // Dispositions are consulted ONLY to label an id the SECTION already lists -- never to decide which section applies it.
  const d = bp.mechanism_dispositions.find(x => x.mechanism_id === id)
  return { id, type: d?.mechanism_type ?? 'unknown', principle: d?.transferable_principle ?? '' }
}

function buildScene(bp: Blueprint, s: BlueprintSection, order: number, start: number, resp: BlueprintResponse): PlanScene {
  const mpText = new Map(bp.mandatory_point_accounting.map(a => [a.id, a.text]))
  return {
    sceneNumber: s.section_number, order, startTime: round(start), endTime: round(start + s.target_duration_seconds), duration: s.target_duration_seconds,
    purpose: s.section_purpose, structuralRole: s.structural_role, contentInstruction: s.content_instruction,
    requiredInformation: [...s.required_information],
    visual: s.visual_direction, text: s.text_direction, speech: s.speech_direction, pacing: s.pacing_direction,
    transition: s.transition_direction, cta: s.cta_direction,
    mandatoryPoints: s.mandatory_points_assigned.map(id => ({ id, text: mpText.get(id) ?? id })),
    mechanisms: s.mechanisms_applied.map(id => mechanismLabel(bp, id)),     // <- section.mechanisms_applied ONLY
    anatomySections: [...s.source_anatomy_relationship.anatomy_section_numbers],
    confidence: s.confidence, limitations: [...s.limitations],
    trace: {
      blueprintId: bp.blueprint_id, sectionNumber: s.section_number, referenceVideoId: resp.reference_video_id, videoAnalysisId: resp.video_analysis_id,
      c3AttemptId: resp.input_pin.mechanism_attempt_id, blueprintAttemptId: resp.provenance?.reasoning_attempt_id ?? null,
      mechanismIds: [...s.mechanisms_applied],
    },
  }
}

const round = (n: number) => Math.round(n * 1000) / 1000

/** Blueprint -> plan. Throws if the blueprint is not usable (stale / unknown / missing) -- it never creates from one. */
export function buildBlueprintPlan(resp: BlueprintResponse, now: Date = new Date()): BlueprintPlan {
  const usable = checkBlueprintUsable(resp)
  if (!usable.ok) throw new Error(usable.message)
  const bp = resp.blueprint as Blueprint
  const ordered = [...bp.sections].sort((a, b) => a.section_number - b.section_number)
  let cursor = 0
  const scenes = ordered.map((s, i) => {
    const scene = buildScene(bp, s, i, cursor, resp)
    cursor += s.target_duration_seconds
    return scene
  })
  const used = Array.from(new Set(scenes.flatMap(sc => sc.mechanisms.map(m => m.id)))).sort()
  return {
    schema: PLAN_SCHEMA, blueprintId: bp.blueprint_id, blueprintVersion: bp.blueprint_version,
    referenceVideoId: resp.reference_video_id, videoAnalysisId: resp.video_analysis_id,
    c3AttemptId: resp.input_pin.mechanism_attempt_id, blueprintAttemptId: resp.provenance?.reasoning_attempt_id ?? null,
    anatomyFingerprint: resp.input_pin.anatomy_fingerprint, intentHash: resp.input_pin.intent_hash,
    intentSummary: bp.intent_summary, structuralApproach: bp.structural_approach, platform: bp.target.platform,
    totalSeconds: round(cursor), mechanismsUsed: used, createdAt: now.toISOString(), scenes,
  }
}

// ── Placeholder text overlays (real editor primitives, visible on the timeline / canvas) ──────────────

export const PLACEHOLDER_TEXT_PREFIX = 'TEXT PLACEHOLDER — '
export const PLACEHOLDER_CTA_PREFIX = 'CTA PLACEHOLDER — '

function overlay(plan: BlueprintPlan, scene: PlanScene, kind: 'text' | 'cta', instruction: string): TextOverlay {
  return {
    id: `bp:${plan.blueprintId}:s${scene.sceneNumber}:${kind}`,
    text: (kind === 'cta' ? PLACEHOLDER_CTA_PREFIX : PLACEHOLDER_TEXT_PREFIX) + instruction,
    x: 5, y: kind === 'cta' ? 58 : 72, width: 90,
    startTime: scene.startTime, endTime: scene.endTime,
    fontFamily: 'Inter', fontSize: 30, bold: false, italic: true,
    color: '#FFFFFF', bgColor: '#111827', bgOpacity: 0.78, animation: 'none',
    blueprint: {
      blueprintId: plan.blueprintId, sectionNumber: scene.sceneNumber, kind,
      mechanismIds: scene.trace.mechanismIds, referenceVideoId: plan.referenceVideoId, c3AttemptId: plan.c3AttemptId,
    },
  }
}

/** One text placeholder per scene (from text_direction) + one CTA placeholder for each scene that carries a CTA instruction. */
export function buildPlaceholderOverlays(plan: BlueprintPlan): TextOverlay[] {
  const out: TextOverlay[] = []
  for (const scene of plan.scenes) {
    out.push(overlay(plan, scene, 'text', scene.text))
    if (scene.cta) out.push(overlay(plan, scene, 'cta', scene.cta))
  }
  return out
}

/** The project snapshot for a NEW Video Studio V2 draft (same shape the editor's own Save Draft writes; unknown keys are ignored by it). */
export interface BlueprintDraftSnapshot {
  videoClips: never[]
  additionalVideoClips: never[]
  textOverlays: TextOverlay[]
  mediaOverlays: never[]
  audioTracks: never[]
  lowerThirds: never[]
  shapes: never[]
  subtitles: never[]
  mediaAssets: never[]
  timeline: { currentTime: number; duration: number; playing: boolean; markIn: number | null; markOut: number | null }
  canvasItemPositions: Record<string, never>
  clientIdentity: { client: string; campaign: string }
  blueprintPlan: BlueprintPlan
}

export function buildDraftSnapshot(plan: BlueprintPlan, identity?: { client?: string | null; campaign?: string | null }): BlueprintDraftSnapshot {
  return {
    videoClips: [], additionalVideoClips: [], textOverlays: buildPlaceholderOverlays(plan), mediaOverlays: [], audioTracks: [], lowerThirds: [],
    shapes: [], subtitles: [], mediaAssets: [],
    timeline: { currentTime: 0, duration: plan.totalSeconds, playing: false, markIn: null, markOut: null },
    canvasItemPositions: {},
    clientIdentity: { client: identity?.client || 'Blueprint draft', campaign: identity?.campaign || plan.intentSummary.slice(0, 80) },
    blueprintPlan: plan,
  }
}

export function draftNameFor(plan: BlueprintPlan, now: Date = new Date()): string {
  const topic = plan.intentSummary.replace(/^Topic:\s*/i, '').split('. ')[0].replace(/\.$/, '').slice(0, 60)
  return `Blueprint — ${topic} (${now.toISOString().slice(0, 10)})`
}

/** Type guard used when restoring a plan from storage / a saved draft. */
export function isBlueprintPlan(x: unknown): x is BlueprintPlan {
  const p = x as BlueprintPlan | null
  return !!p && p.schema === PLAN_SCHEMA && typeof p.blueprintId === 'string' && Array.isArray(p.scenes)
}
