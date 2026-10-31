// M1 / Stage 1 -- PURE assembly engine.
//
//   assembleDraft({ plan, footage, assignments, createdAt, options })  ->  { ok, name, snapshot, issues }
//
// Reuses the existing blueprint plan + snapshot builders (buildDraftSnapshot / buildPlaceholderOverlays), so the result is the same draft
// shape the editor's own Open Draft path already restores; it only adds real video clips, the footage's media entries, and one extra
// `assembly` record (provenance + editability). It never reads a clock, a random source, storage or the network.
//
// TIME MODEL (matches the editor's playback math and the exporter exactly)
//   source range used  = [trimIn, trimIn + (endTime - startTime) * speed)
//   trimOut            = sourceDuration - trimIn - (endTime - startTime) * speed
//   endTime            = startTime + sourceSpan / speed          (== computeEndTimeForSpeed in videoPreviewUtils)
import type { Asset, VideoClip } from '../../../types'
import {
  buildDraftSnapshot, draftNameFor, isBlueprintPlan,
  type BlueprintPlan, type PlanScene,
} from '../../video-studio-v2/blueprint/blueprintPlan'
import { ELEMENT_CLASSES, classifyElement } from './elementClasses'
import {
  ALLOWED_SPEEDS, ASSEMBLY_ENGINE_VERSION, ASSEMBLY_SCHEMA, MIN_CLIP_SECONDS, TIME_EPSILON,
  type AssembledDraftSnapshot, type AssembledScene, type AssemblyInput, type AssemblyIssue, type AssemblyOptions, type AssemblyRecord,
  type AssemblyResult, type ClipSpeed, type ClipUse, type FootageClip, type IssueCode, type PlacedClip, type SceneAssignment,
} from './types'

const round3 = (n: number) => Math.round(n * 1000) / 1000
const round6 = (n: number) => Math.round(n * 1e6) / 1e6
const floor3 = (n: number) => Math.floor(n * 1000 + 1e-9) / 1000
const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
const isSpeed = (n: unknown): n is ClipSpeed => (ALLOWED_SPEEDS as readonly number[]).includes(n as number)

const issue = (severity: AssemblyIssue['severity'], code: IssueCode, message: string, extra: Partial<AssemblyIssue> = {}): AssemblyIssue => ({ severity, code, message, ...extra })
const err = (code: IssueCode, message: string, extra: Partial<AssemblyIssue> = {}) => issue('error', code, message, extra)

// ── repeatability: a stable digest of everything that can change the result (cyrb53; not cryptographic, only a fingerprint) ──────────

function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return `{${Object.keys(o).filter(k => o[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(',')}}`
  }
  return JSON.stringify(v) ?? 'null'
}

function cyrb53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0')
}

// ── validation ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

function validatePlan(plan: BlueprintPlan): { scenes: PlanScene[]; issues: AssemblyIssue[] } {
  const issues: AssemblyIssue[] = []
  if (!isBlueprintPlan(plan) || plan.scenes.length === 0) {
    return { scenes: [], issues: [err('invalid_plan', 'The blueprint plan is missing, not a blueprint plan, or has no scenes.')] }
  }
  const scenes = [...plan.scenes].sort((a, b) => a.order - b.order)
  const numbers = new Set<number>()
  let cursor = 0
  scenes.forEach((s, i) => {
    if (numbers.has(s.sceneNumber)) issues.push(err('invalid_plan', `Scene number ${s.sceneNumber} appears more than once.`, { sceneNumber: s.sceneNumber }))
    numbers.add(s.sceneNumber)
    if (s.order !== i) issues.push(err('inconsistent_scene_timing', `Scene order is not contiguous at scene ${s.sceneNumber} (expected position ${i}, found ${s.order}).`, { sceneNumber: s.sceneNumber }))
    if (!isNum(s.duration) || s.duration <= 0 || !isNum(s.startTime) || !isNum(s.endTime)) {
      issues.push(err('invalid_duration', `Scene ${s.sceneNumber} has a missing, zero, negative or non-numeric duration or time.`, { sceneNumber: s.sceneNumber }))
      return
    }
    if (Math.abs(s.startTime - cursor) > 2 * TIME_EPSILON || Math.abs(s.endTime - (s.startTime + s.duration)) > 2 * TIME_EPSILON) {
      issues.push(err('inconsistent_scene_timing', `Scene ${s.sceneNumber} does not start where the previous scene ends, or its end does not equal start + duration.`, { sceneNumber: s.sceneNumber }))
    }
    cursor = s.startTime + s.duration
  })
  if (isNum(plan.totalSeconds) && Math.abs(plan.totalSeconds - cursor) > 2 * TIME_EPSILON) {
    issues.push(err('inconsistent_scene_timing', `The plan says it lasts ${plan.totalSeconds}s but its scenes add up to ${round3(cursor)}s.`))
  }
  return { scenes, issues }
}

function validateFootage(footage: FootageClip[], options: AssemblyOptions): { byKey: Map<string, FootageClip>; issues: AssemblyIssue[] } {
  const issues: AssemblyIssue[] = []
  const byKey = new Map<string, FootageClip>()
  const referenceIds = new Set(options.referenceAssetIds ?? [])
  for (const f of footage) {
    if (!f || typeof f.key !== 'string' || f.key === '') { issues.push(err('invalid_footage', 'A footage item has no key.')); continue }
    if (byKey.has(f.key)) { issues.push(err('duplicate_footage_key', `Footage key "${f.key}" is used more than once.`, { footageKey: f.key })); continue }
    byKey.set(f.key, f)
    if (!Number.isInteger(f.assetId)) issues.push(err('footage_missing_asset', `"${f.name}" has no uploaded asset id, so it could not be exported.`, { footageKey: f.key }))
    if (!isNum(f.duration) || f.duration <= 0) issues.push(err('invalid_footage', `"${f.name}" has an unknown or non-positive duration.`, { footageKey: f.key }))
    if (typeof f.url !== 'string' || f.url === '') issues.push(err('invalid_footage', `"${f.name}" has no playable URL.`, { footageKey: f.key }))
    if (Number.isInteger(f.assetId) && referenceIds.has(f.assetId)) {
      issues.push(err('reference_media_not_allowed', `"${f.name}" is the reference video itself. A reconstruction never reuses the reference's own footage; supply your own media.`, { footageKey: f.key }))
    }
  }
  return { byKey, issues }
}

function validateOptions(options: AssemblyOptions): AssemblyIssue[] {
  const out: AssemblyIssue[] = []
  if (options.underfilled !== undefined && options.underfilled !== 'gap' && options.underfilled !== 'stretch') out.push(err('invalid_option', `Unknown underfilled policy "${String(options.underfilled)}".`))
  for (const k of options.requestedElements ?? []) {
    try { classifyElement(k) } catch { out.push(err('invalid_option', `Unknown element kind "${String(k)}".`)) }
  }
  return out
}

// ── fitting one clip into its slot ────────────────────────────────────────────────────────────────────────────────────────────────

interface Fit { timeline: number; speed: ClipSpeed; sourceSpan: number; underfilled: boolean }

/** Decide how much source a slot of `want` timeline-seconds consumes, honouring the source's real length. Pure and deterministic.
 *  A clip never reads past the end of its file: when the source is the limit, the timeline length is rounded DOWN (never up). */
function fitClip(sourceDuration: number, trimIn: number, want: number, speed: ClipSpeed | undefined, policy: 'gap' | 'stretch'): Fit {
  const available = round3(sourceDuration - trimIn)
  const limited = (s: ClipSpeed): Fit => {                       // the source cannot cover the whole slot at speed s
    const timeline = floor3(available / s)
    return { timeline, speed: s, sourceSpan: round3(timeline * s), underfilled: want - timeline > TIME_EPSILON }   // under 1 ms short is not a gap worth reporting
  }
  if (speed !== undefined) {                                   // an explicit speed always wins
    if (want * speed <= available + 1e-9) return { timeline: want, speed, sourceSpan: round3(want * speed), underfilled: false }
    return limited(speed)
  }
  if (want <= available + 1e-9) return { timeline: want, speed: 1, sourceSpan: want, underfilled: false }
  if (policy === 'stretch') {
    const fits = ALLOWED_SPEEDS.filter(s => s < 1 && want * s <= available + 1e-9)
    if (fits.length > 0) {
      const s = Math.max(...fits) as ClipSpeed                 // the gentlest slow-down that still covers the slot
      return { timeline: want, speed: s, sourceSpan: round3(want * s), underfilled: false }
    }
  }
  return limited(1)
}

// ── the engine ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function assembleDraft(input: AssemblyInput): AssemblyResult {
  const options: AssemblyOptions = input.options ?? {}
  const policy = options.underfilled ?? 'gap'
  const errors: AssemblyIssue[] = []
  const notes: AssemblyIssue[] = []

  if (typeof input.createdAt !== 'string' || Number.isNaN(Date.parse(input.createdAt))) errors.push(err('invalid_option', 'createdAt must be an ISO timestamp supplied by the caller (the engine never reads a clock).'))
  errors.push(...validateOptions(options))
  const { scenes, issues: planIssues } = validatePlan(input.plan)
  errors.push(...planIssues)
  const { byKey, issues: footageIssues } = validateFootage(Array.isArray(input.footage) ? input.footage : [], options)
  errors.push(...footageIssues)

  // assignments: one per scene, each referencing a scene that exists and footage that was supplied
  const sceneNumbers = new Set(scenes.map(s => s.sceneNumber))
  const assignmentByScene = new Map<number, SceneAssignment>()
  for (const a of Array.isArray(input.assignments) ? input.assignments : []) {
    if (!sceneNumbers.has(a.sceneNumber)) { errors.push(err('unknown_scene', `An assignment refers to scene ${a.sceneNumber}, which is not in the plan.`, { sceneNumber: a.sceneNumber })); continue }
    if (assignmentByScene.has(a.sceneNumber)) { errors.push(err('duplicate_assignment', `Scene ${a.sceneNumber} is assigned more than once.`, { sceneNumber: a.sceneNumber })); continue }
    assignmentByScene.set(a.sceneNumber, a)
  }

  if (errors.length > 0) return { ok: false, issues: errors }

  // ── place clips scene by scene ──
  const videoClips: VideoClip[] = []
  const assembledScenes: AssembledScene[] = []
  const warnings: AssemblyIssue[] = []
  const usedFootage = new Map<string, number>()                                  // footageKey -> times used
  let filledTotal = 0

  for (const scene of scenes) {
    const uses: ClipUse[] = assignmentByScene.get(scene.sceneNumber)?.clips ?? []
    const placed: PlacedClip[] = []

    // validate this scene's uses before placing anything
    let sceneOk = true
    uses.forEach((u, idx) => {
      const src = byKey.get(u.footageKey)
      if (!src) { errors.push(err('missing_footage', `Scene ${scene.sceneNumber} uses footage "${u.footageKey}", which was not supplied.`, { sceneNumber: scene.sceneNumber, footageKey: u.footageKey })); sceneOk = false; return }
      const trimIn = u.trimIn ?? 0
      if (!isNum(trimIn) || trimIn < 0 || trimIn >= src.duration) { errors.push(err('invalid_trim', `Scene ${scene.sceneNumber}, clip ${idx + 1}: trim start ${String(u.trimIn)} is outside "${src.name}" (0 to ${src.duration}s).`, { sceneNumber: scene.sceneNumber, footageKey: u.footageKey })); sceneOk = false }
      if (u.useDuration !== undefined && (!isNum(u.useDuration) || u.useDuration <= 0)) { errors.push(err('invalid_duration', `Scene ${scene.sceneNumber}, clip ${idx + 1}: duration ${String(u.useDuration)} must be a positive number.`, { sceneNumber: scene.sceneNumber, footageKey: u.footageKey })); sceneOk = false }
      if (u.speed !== undefined && !isSpeed(u.speed)) { errors.push(err('invalid_speed', `Scene ${scene.sceneNumber}, clip ${idx + 1}: speed ${String(u.speed)} is not one of ${ALLOWED_SPEEDS.join(', ')}.`, { sceneNumber: scene.sceneNumber, footageKey: u.footageKey })); sceneOk = false }
      if (u.volume !== undefined && (!isNum(u.volume) || u.volume < 0 || u.volume > 1)) { errors.push(err('invalid_option', `Scene ${scene.sceneNumber}, clip ${idx + 1}: volume must be between 0 and 1.`, { sceneNumber: scene.sceneNumber, footageKey: u.footageKey })); sceneOk = false }
    })
    if (!sceneOk) continue

    // slots: explicit durations are honoured; the rest share what is left equally
    const explicit = uses.reduce((n, u) => n + (u.useDuration ?? 0), 0)
    const implicitCount = uses.filter(u => u.useDuration === undefined).length
    if (explicit > scene.duration + TIME_EPSILON) {
      errors.push(err('scene_overflow', `Scene ${scene.sceneNumber} is ${scene.duration}s long but its clips ask for ${round3(explicit)}s.`, { sceneNumber: scene.sceneNumber }))
      continue
    }
    const share = implicitCount > 0 ? round3((scene.duration - explicit) / implicitCount) : 0
    let implicitSeen = 0
    let cursor = scene.startTime

    uses.forEach((u, idx) => {
      const src = byKey.get(u.footageKey) as FootageClip
      const trimIn = round3(u.trimIn ?? 0)
      let want = u.useDuration
      if (want === undefined) {
        implicitSeen++
        want = implicitSeen === implicitCount ? round3(scene.duration - explicit - share * (implicitCount - 1)) : share   // the last share absorbs rounding, so a scene is filled exactly
      }
      const fit = fitClip(src.duration, trimIn, round3(want), u.speed, policy)
      if (fit.timeline < MIN_CLIP_SECONDS) {
        warnings.push(issue('warning', 'clip_too_short', `Scene ${scene.sceneNumber}, clip ${idx + 1}: only ${fit.timeline}s of "${src.name}" is available from that point, so no clip was placed.`, { sceneNumber: scene.sceneNumber, footageKey: u.footageKey }))
        return
      }
      if (fit.underfilled) {
        warnings.push(issue('warning', 'scene_underfilled', `Scene ${scene.sceneNumber}, clip ${idx + 1}: "${src.name}" has only ${fit.timeline}s available for a ${round3(want)}s slot, so ${round3(want - fit.timeline)}s is left uncovered.`, { sceneNumber: scene.sceneNumber, footageKey: u.footageKey }))
      }
      const start = round3(cursor)
      const end = Math.min(round3(start + fit.timeline), scene.endTime)                 // never cross the scene boundary
      const timelineSpan = round3(end - start)
      // trimOut keeps 6 decimals: at speed 0.25 a 3-decimal rounding would be amplified 4x on the timeline, so it would drift from the editor's own formula.
      const trimOut = Math.max(0, round6(src.duration - trimIn - timelineSpan * fit.speed))
      const id = `asm:${input.plan.blueprintId}:s${scene.sceneNumber}:c${idx}`

      const clip: VideoClip = {
        id, assetId: src.assetId, url: src.url, name: src.name, duration: src.duration,
        startTime: start, endTime: end, trimIn, trimOut,
        colorGrade: 'none', speed: fit.speed,
        brightness: 0, contrast: 0, saturation: 0,
        transition: 'cut', transitionDuration: 0.5,
        ...(u.fit !== undefined ? { fitMode: u.fit } : {}),
        ...(u.muted !== undefined ? { muted: u.muted } : {}),
        ...(u.volume !== undefined ? { volume: u.volume } : {}),
      }
      videoClips.push(clip)
      placed.push({ elementId: id, footageKey: src.key, assetId: src.assetId, name: src.name, sourceDuration: src.duration, trimIn, trimOut, speed: fit.speed, timelineStart: start, timelineEnd: end })
      usedFootage.set(src.key, (usedFootage.get(src.key) ?? 0) + 1)
      cursor = end
    })

    const filled = round3(placed.reduce((n, p) => n + (p.timelineEnd - p.timelineStart), 0))
    filledTotal += filled
    const gap = round3(scene.duration - filled)
    if (placed.length === 0) {
      if (uses.length === 0) warnings.push(issue('warning', 'scene_unassigned', `Scene ${scene.sceneNumber} has no footage. It stays an empty scene with its text placeholder.`, { sceneNumber: scene.sceneNumber }))
      if (options.requireAllScenes) errors.push(err('missing_clips', `Scene ${scene.sceneNumber} has no clip, and every scene was required to have one.`, { sceneNumber: scene.sceneNumber }))
    }
    assembledScenes.push(buildScene(input.plan, scene, placed, filled, gap))
  }

  // scenes that were skipped because their clips were invalid never reach buildScene; any error ends the run here
  if (errors.length > 0) return { ok: false, issues: errors }

  // ── notes ──
  for (const [key, n] of usedFootage) if (n > 1) notes.push(issue('note', 'footage_reused', `"${byKey.get(key)?.name}" is used ${n} times (different parts of it should be used each time).`, { footageKey: key }))
  for (const key of [...byKey.keys()].sort()) if (!usedFootage.has(key)) notes.push(issue('note', 'footage_unused', `"${byKey.get(key)?.name}" was supplied but not placed in any scene.`, { footageKey: key }))
  if (videoClips.length === 0) warnings.push(issue('warning', 'no_video_clips', 'No clips were placed. The draft can be opened and edited, but the editor cannot export a video until at least one clip is added.'))
  const base = buildDraftSnapshot(input.plan, options.identity)           // the existing builder: placeholders, timeline, plan
  const placeholderCount = base.textOverlays.length                       // every overlay the blueprint builder makes is a placeholder
  notes.push(issue('note', 'placeholder_text_present', `${placeholderCount} text placeholder${placeholderCount === 1 ? '' : 's'} are in the draft. They are real text overlays: replace or delete them before exporting, or their instruction text will be rendered into the video.`))

  // ── what the caller asked for that assembly does not produce ──
  const unsupported: AssemblyRecord['unsupported'] = []
  for (const kind of [...new Set(options.requestedElements ?? [])].sort()) {
    const c = classifyElement(kind)
    if (c.editability === 'unsupported') {
      unsupported.push({ kind, reason: c.reason })
      warnings.push(issue('warning', 'unsupported_element', `Not produced: ${kind.replace(/_/g, ' ')}. ${c.reason}`))
    } else if (c.editability === 'partial') {
      notes.push(issue('note', 'partial_element', `Only partly supported: ${kind.replace(/_/g, ' ')}. ${c.reason}`))
    }
  }

  const issues = [...warnings, ...notes]
  const media: Asset[] = [...byKey.values()].filter(f => f.asset && usedFootage.has(f.key)).sort((a, b) => a.key.localeCompare(b.key)).map(f => f.asset as Asset)
  const planned = round3(scenes.reduce((n, s) => n + s.duration, 0))
  const digest = cyrb53(stableStringify({
    engine: ASSEMBLY_ENGINE_VERSION,
    blueprintId: input.plan.blueprintId,
    scenes: scenes.map(s => [s.sceneNumber, s.startTime, s.endTime, s.duration]),
    footage: [...byKey.values()].map(f => [f.key, f.assetId, f.duration, f.url]).sort(),
    assignments: [...assignmentByScene.values()].sort((a, b) => a.sceneNumber - b.sceneNumber),
    options: { underfilled: policy, requireAllScenes: !!options.requireAllScenes, referenceAssetIds: [...(options.referenceAssetIds ?? [])].sort(), requestedElements: [...new Set(options.requestedElements ?? [])].sort() },
  }))

  const record: AssemblyRecord = {
    schema: ASSEMBLY_SCHEMA, engineVersion: ASSEMBLY_ENGINE_VERSION, blueprintId: input.plan.blueprintId,
    referenceVideoId: input.plan.referenceVideoId, videoAnalysisId: input.plan.videoAnalysisId, createdAt: input.createdAt, inputDigest: digest,
    scenes: assembledScenes,
    summary: {
      scenes: scenes.length, scenesWithMedia: assembledScenes.filter(s => s.media.clips.length > 0).length,
      scenesWithoutMedia: assembledScenes.filter(s => s.media.clips.length === 0).length, clipsPlaced: videoClips.length,
      plannedSeconds: planned, filledSeconds: round3(filledTotal), gapSeconds: round3(planned - filledTotal),
    },
    elementClasses: ELEMENT_CLASSES.map(c => ({ ...c })),
    unsupported,
    issues,
  }

  // The existing builder supplied everything an editor draft already had (placeholders, timeline, plan); assembly only adds real media.
  const snapshot: AssembledDraftSnapshot = { ...base, videoClips, mediaAssets: media, assembly: record }
  return { ok: true, name: draftNameFor(input.plan, new Date(input.createdAt)), snapshot, issues }
}

function buildScene(plan: BlueprintPlan, s: PlanScene, placed: PlacedClip[], filled: number, gap: number): AssembledScene {
  return {
    sceneNumber: s.sceneNumber, order: s.order, startTime: s.startTime, endTime: s.endTime, duration: s.duration,
    evidence: {
      origin: 'reference_evidence', referenceVideoId: plan.referenceVideoId, videoAnalysisId: plan.videoAnalysisId,
      anatomySections: [...s.anatomySections], confidence: s.confidence, limitations: [...s.limitations],
    },
    structure: {
      origin: 'inferred_structure', purpose: s.purpose, structuralRole: s.structuralRole, mechanismIds: s.mechanisms.map(m => m.id),
      instructions: { content: s.contentInstruction, visual: s.visual, text: s.text, speech: s.speech, pacing: s.pacing, transition: s.transition, cta: s.cta },
      mandatoryPoints: s.mandatoryPoints.map(p => ({ ...p })),
    },
    media: {
      origin: placed.length > 0 ? 'user_supplied' : 'none', clips: placed,
      coverage: { filledSeconds: filled, gapSeconds: gap < TIME_EPSILON ? 0 : gap, status: placed.length === 0 ? 'empty' : gap < TIME_EPSILON ? 'filled' : 'partial' },
    },
    text: {
      origin: 'placeholder', textElementId: `bp:${plan.blueprintId}:s${s.sceneNumber}:text`,
      ctaElementId: s.cta ? `bp:${plan.blueprintId}:s${s.sceneNumber}:cta` : null, replaced: false, editability: 'automatic',
    },
  }
}

// ── convenience: a deterministic first-guess assignment (the Footage workspace will let a person change it) ─────────────────────────

/**
 * Suggest one clip per scene, in order. By default footage is not reused: scenes beyond the supplied footage stay empty (reported, never faked).
 * With `reuse: true`, footage cycles. The caller can edit the result before assembling.
 */
export function suggestAssignments(plan: BlueprintPlan, footage: FootageClip[], opts: { reuse?: boolean } = {}): SceneAssignment[] {
  const scenes = [...plan.scenes].sort((a, b) => a.order - b.order)
  const pool = [...footage]
  if (pool.length === 0) return []
  const out: SceneAssignment[] = []
  scenes.forEach((s, i) => {
    if (i >= pool.length && !opts.reuse) return
    out.push({ sceneNumber: s.sceneNumber, clips: [{ footageKey: pool[i % pool.length].key }] })
  })
  return out
}

/** Quick read of an assembly result's problems for display. */
export function summarizeIssues(issues: AssemblyIssue[]): { errors: number; warnings: number; notes: number } {
  return { errors: issues.filter(i => i.severity === 'error').length, warnings: issues.filter(i => i.severity === 'warning').length, notes: issues.filter(i => i.severity === 'note').length }
}
