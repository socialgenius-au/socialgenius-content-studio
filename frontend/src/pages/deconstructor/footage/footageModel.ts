// M1 / Stage 2 -- the Footage Assignment workspace's pure model. It holds NO assembly logic: every placement, trim, timing and boundary decision is made by the
// Stage-1 `assembleDraft` engine. This file only (a) turns what the person typed and picked into the engine's input, and (b) turns the engine's answer into rows
// to display. No clock, no network, no DOM -- so everything here is unit-testable.
import type { Asset } from '../../../types'
import type { BlueprintPlan } from '../../video-studio-v2/blueprint/blueprintPlan'
import {
  ALLOWED_SPEEDS, ALL_ELEMENT_KINDS, ELEMENT_CLASSES, assembleDraft,
  type AssemblyIssue, type AssemblyResult, type ClipSpeed, type ClipUse, type FootageClip, type PlacedClip, type SceneAssignment, type UnderfilledPolicy,
} from '../assembly'

// ── footage library ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Stable handle for an asset inside one workspace session. */
export const footageKeyFor = (assetId: number): string => `a${assetId}`

export type LibraryEntry =
  | { state: 'probing'; key: string; assetId: number; name: string }
  | { state: 'ready'; key: string; assetId: number; name: string; clip: FootageClip }
  | { state: 'failed'; key: string; assetId: number; name: string; reason: string }

export const isVideoAsset = (a: Pick<Asset, 'file_type'>): boolean => a.file_type === 'video'

export const referenceAssetIdsOf = (refs: ReadonlyArray<{ asset_id: number }> | null | undefined): number[] =>
  Array.from(new Set((refs ?? []).map(r => r.asset_id).filter(Number.isInteger))).sort((a, b) => a - b)

/** A duration is only ever the file's REAL length. Anything else is a failure, never a guess. */
export function readyEntry(asset: Asset, duration: number, previewUrl: (filePath: string) => string, size?: { width?: number; height?: number }): LibraryEntry {
  const key = footageKeyFor(asset.id)
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) {
    return { state: 'failed', key, assetId: asset.id, name: asset.original_filename, reason: 'The length of this video could not be read, so it cannot be placed on the timeline.' }
  }
  return { state: 'ready', key, assetId: asset.id, name: asset.original_filename, clip: { key, assetId: asset.id, url: previewUrl(asset.file_path), name: asset.original_filename, duration, ...(size?.width && size?.height ? { width: size.width, height: size.height } : {}), asset } }
}

// ── what the person typed ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** One clip placed in a scene, exactly as the form holds it: text fields, so a half-typed number is never silently dropped. Blank = the engine's default. */
export interface ClipEdit { uid: string; footageKey: string; trimIn: string; useDuration: string; speed: string }
export type SceneEdits = Record<number, ClipEdit[]>

export const newClipEdit = (uid: string, footageKey: string): ClipEdit => ({ uid, footageKey, trimIn: '', useDuration: '', speed: '' })

const withScene = (e: SceneEdits, scene: number, next: ClipEdit[]): SceneEdits => {
  const out = { ...e }
  if (next.length === 0) delete out[scene]; else out[scene] = next
  return out
}
export const addClip = (e: SceneEdits, scene: number, clip: ClipEdit): SceneEdits => withScene(e, scene, [...(e[scene] ?? []), clip])
export const removeClip = (e: SceneEdits, scene: number, uid: string): SceneEdits => withScene(e, scene, (e[scene] ?? []).filter(c => c.uid !== uid))
export const clearScene = (e: SceneEdits, scene: number): SceneEdits => withScene(e, scene, [])
export const updateClip = (e: SceneEdits, scene: number, uid: string, patch: Partial<Omit<ClipEdit, 'uid'>>): SceneEdits =>
  withScene(e, scene, (e[scene] ?? []).map(c => (c.uid === uid ? { ...c, ...patch } : c)))
export function moveClip(e: SceneEdits, scene: number, uid: string, by: -1 | 1): SceneEdits {
  const list = [...(e[scene] ?? [])]
  const i = list.findIndex(c => c.uid === uid)
  const j = i + by
  if (i < 0 || j < 0 || j >= list.length) return e
  ;[list[i], list[j]] = [list[j], list[i]]
  return withScene(e, scene, list)
}

export interface EditProblem { sceneNumber: number; uid: string; field: 'trimIn' | 'useDuration' | 'speed'; message: string }

const SECONDS = /^\d+(\.\d+)?$/
function parseSeconds(text: string): number | undefined | 'bad' {
  const t = text.trim()
  if (t === '') return undefined
  if (!SECONDS.test(t)) return 'bad'
  const n = Number(t)
  return Number.isFinite(n) ? n : 'bad'
}

/** Syntax only (is this a number of seconds / an allowed speed?). Whether the number is sensible for the file and the scene is the engine's call. */
export function parseClipEdit(sceneNumber: number, c: ClipEdit): { use: ClipUse; problems: EditProblem[] } {
  const problems: EditProblem[] = []
  const use: ClipUse = { footageKey: c.footageKey }
  const trim = parseSeconds(c.trimIn)
  if (trim === 'bad') problems.push({ sceneNumber, uid: c.uid, field: 'trimIn', message: 'Start point must be a number of seconds, 0 or more.' }); else if (trim !== undefined) use.trimIn = trim
  const dur = parseSeconds(c.useDuration)
  if (dur === 'bad') problems.push({ sceneNumber, uid: c.uid, field: 'useDuration', message: 'Length must be a number of seconds, more than 0.' }); else if (dur !== undefined) use.useDuration = dur
  if (c.speed.trim() !== '') {
    const s = Number(c.speed)
    if ((ALLOWED_SPEEDS as readonly number[]).includes(s)) use.speed = s as ClipSpeed
    else problems.push({ sceneNumber, uid: c.uid, field: 'speed', message: `Speed must be one of ${ALLOWED_SPEEDS.join(', ')}.` })
  }
  return { use, problems }
}

// ── running the engine ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export type RowStatus = 'empty' | 'filled' | 'partial' | 'invalid' | 'pending'

export interface SceneRow {
  sceneNumber: number; order: number; startTime: number; endTime: number; duration: number; purpose: string
  status: RowStatus
  filledSeconds: number | null; gapSeconds: number | null
  placed: PlacedClip[]
  issues: AssemblyIssue[]                       // the engine's errors/warnings for this scene
  problems: string[]                            // local problems: unreadable numbers, footage that is not ready
}

export interface AssemblyView {
  result: AssemblyResult
  rows: SceneRow[]
  /** Everything that stops "Save draft", in plain language. Empty = the draft can be saved. */
  blockers: string[]
  warnings: AssemblyIssue[]
  notes: AssemblyIssue[]
  clipCount: number
  canSave: boolean
  /** Exactly what was validated, so saving uses the same input. */
  assignments: SceneAssignment[]
  footage: FootageClip[]
}

export interface RunInput {
  plan: BlueprintPlan
  library: ReadonlyMap<string, LibraryEntry>
  edits: SceneEdits
  referenceAssetIds: number[]
  underfilled: UnderfilledPolicy
  /** Used only for live validation; the saved draft is stamped by the caller at save time. */
  createdAt: string
}

/** Elements the reconstruction cannot produce automatically. Passed to the engine so each draft records them (it reports them; it never fakes them). */
export const REQUESTED_ELEMENTS = ALL_ELEMENT_KINDS.filter(k => ELEMENT_CLASSES.find(c => c.kind === k)?.editability !== 'automatic')

export function buildAssignments(plan: BlueprintPlan, library: ReadonlyMap<string, LibraryEntry>, edits: SceneEdits): {
  assignments: SceneAssignment[]; footage: FootageClip[]; problems: EditProblem[]; notReady: { sceneNumber: number; name: string; reason: string }[]
} {
  const problems: EditProblem[] = []
  const notReady: { sceneNumber: number; name: string; reason: string }[] = []
  const assignments: SceneAssignment[] = []
  const footage = new Map<string, FootageClip>()
  for (const scene of [...plan.scenes].sort((a, b) => a.order - b.order)) {
    const uses: ClipUse[] = []
    for (const c of edits[scene.sceneNumber] ?? []) {
      const parsed = parseClipEdit(scene.sceneNumber, c)
      problems.push(...parsed.problems)
      const entry = library.get(c.footageKey)
      if (!entry) { notReady.push({ sceneNumber: scene.sceneNumber, name: c.footageKey, reason: 'This footage is no longer available.' }); continue }
      if (entry.state === 'probing') { notReady.push({ sceneNumber: scene.sceneNumber, name: entry.name, reason: 'Still reading the length of this video…' }); continue }
      if (entry.state === 'failed') { notReady.push({ sceneNumber: scene.sceneNumber, name: entry.name, reason: entry.reason }); continue }
      footage.set(entry.key, entry.clip)
      if (parsed.problems.length === 0) uses.push(parsed.use)
    }
    if (uses.length > 0) assignments.push({ sceneNumber: scene.sceneNumber, clips: uses })
  }
  return { assignments, footage: [...footage.values()], problems, notReady }
}

/** One call per change: validate and (if valid) assemble. The engine decides everything; this only arranges the answer for display. */
export function runAssembly(input: RunInput): AssemblyView {
  const { assignments, footage, problems, notReady } = buildAssignments(input.plan, input.library, input.edits)
  const result = assembleDraft({
    plan: input.plan, footage, assignments, createdAt: input.createdAt,
    options: { underfilled: input.underfilled, referenceAssetIds: input.referenceAssetIds, requestedElements: REQUESTED_ELEMENTS },
  })

  const byScene = new Map(result.ok ? result.snapshot.assembly.scenes.map(s => [s.sceneNumber, s]) : [])
  const rows: SceneRow[] = [...input.plan.scenes].sort((a, b) => a.order - b.order).map(sc => {
    const assigned = (input.edits[sc.sceneNumber] ?? []).length > 0
    const issues = result.issues.filter(i => i.sceneNumber === sc.sceneNumber && i.severity !== 'note')
    const local = [
      ...problems.filter(p => p.sceneNumber === sc.sceneNumber).map(p => p.message),
      ...notReady.filter(n => n.sceneNumber === sc.sceneNumber).map(n => `${n.name}: ${n.reason}`),
    ]
    const assembled = byScene.get(sc.sceneNumber)
    let status: RowStatus
    if (local.length > 0 || issues.some(i => i.severity === 'error')) status = 'invalid'
    else if (!assigned) status = 'empty'
    else if (assembled) status = assembled.media.coverage.status === 'filled' ? 'filled' : assembled.media.coverage.status === 'partial' ? 'partial' : 'empty'
    else status = 'pending'                                              // the engine could not finish because of a problem elsewhere
    return {
      sceneNumber: sc.sceneNumber, order: sc.order, startTime: sc.startTime, endTime: sc.endTime, duration: sc.duration, purpose: sc.purpose,
      status, filledSeconds: assembled?.media.coverage.filledSeconds ?? null, gapSeconds: assembled?.media.coverage.gapSeconds ?? null,
      placed: assembled?.media.clips ?? [], issues, problems: local,
    }
  })

  const blockers: string[] = []
  for (const p of problems) blockers.push(`Scene ${p.sceneNumber}: ${p.message}`)
  for (const n of notReady) blockers.push(`Scene ${n.sceneNumber} — ${n.name}: ${n.reason}`)
  if (!result.ok) for (const i of result.issues.filter(x => x.severity === 'error')) blockers.push(i.sceneNumber != null ? `Scene ${i.sceneNumber}: ${i.message}` : i.message)
  const clipCount = result.ok ? result.snapshot.videoClips.length : 0
  if (result.ok && clipCount === 0 && blockers.length === 0) blockers.push('Assign footage to at least one scene first — a draft with no clips cannot be exported from Video Studio.')

  return {
    result, rows, blockers,
    warnings: result.issues.filter(i => i.severity === 'warning'),
    notes: result.issues.filter(i => i.severity === 'note'),
    clipCount,
    canSave: result.ok && blockers.length === 0,
    assignments, footage,
  }
}

/** The plan's own scene-sorted row counts, for the header ("3 of 7 scenes have footage"). */
export function coverageHeadline(view: AssemblyView): string {
  const total = view.rows.length
  const done = view.rows.filter(r => r.status === 'filled' || r.status === 'partial').length
  return `${done} of ${total} scenes have footage`
}

/** The second lock behind the picker: a reference video's asset can never be added to a scene, however the request arrives. */
export const canUseAsFootage = (asset: Pick<Asset, 'id' | 'file_type'>, referenceAssetIds: ReadonlySet<number>): boolean => isVideoAsset(asset) && !referenceAssetIds.has(asset.id)

/** Opening is only offered for a saved draft that still matches what is on screen; otherwise the editor would open an out-of-date draft. */
export const canOpenSaved = (saved: { signature: string } | null, currentSignature: string): boolean => saved !== null && saved.signature === currentSignature

/** Seed for the footage picker only; sorted newest first, reference videos last so they are never the default choice. */
export function pickerOrder(assets: Asset[], referenceIds: number[]): Asset[] {
  const ref = new Set(referenceIds)
  return [...assets.filter(isVideoAsset)].sort((a, b) => Number(ref.has(a.id)) - Number(ref.has(b.id)) || b.id - a.id)
}
