// M1 / Stage 2 -- save an assembled draft through the EXISTING drafts API and hand it to the EXISTING Video Studio V2.
// Mirrors the C6 flow (createStudioDraft.ts) but in two deliberate steps: SAVE (touches only the drafts API) and OPEN (touches the editor's recovery state,
// after asking when it would replace a project in progress). Nothing here edits the editor; it uses the same keys, hint and plan store the C6 hand-off uses.
import { videoStudioDraftsApi } from '../../../api/client'
import type { BlueprintResponse } from '../../../types/deconstructor'
import { checkBlueprintUsable, type BlueprintPlan } from '../../video-studio-v2/blueprint/blueprintPlan'
import { setBlueprintPlan } from '../../video-studio-v2/blueprint/blueprintPlanStore'
import { setOpenDraftHint } from '../../video-studio-v2/blueprint/openDraftHint'
import { STUDIO_PROJECT_BACKUP_KEY, STUDIO_PROJECT_KEY, STUDIO_ROUTE, STUDIO_STAGE_KEY, existingProjectItems } from '../../video-studio-v2/blueprint/createStudioDraft'
import { assembleDraft, type AssemblyIssue, type AssemblyOptions, type FootageClip, type SceneAssignment } from '../assembly'
import { errorMessage } from '../useDeconstructor'
import { mergeTextLayers, type TextLayerPlan } from '../textlayers'
import { mergeImageLayers, type ImageLayerPlan } from '../imagelayers'
import { mergeTransitions, type TransitionPlan } from '../transitions'
import { mergeSpeech, type SpeechPlan } from '../transcript'
import { applyComposition, mergeBackground, type BackgroundPlan, type OrderPolicy } from '../background'

export interface SaveDeps {
  createDraft: (body: { name: string; project_json: unknown }) => Promise<{ data: { id: number } }>
  updateDraft: (id: number, body: { name: string; project_json: unknown }) => Promise<unknown>
  now: () => Date
}

export const defaultSaveDeps = (): SaveDeps => ({
  createDraft: body => videoStudioDraftsApi.create(body) as Promise<{ data: { id: number } }>,
  updateDraft: (id, body) => videoStudioDraftsApi.update(id, body),
  now: () => new Date(),
})

export interface SaveInput {
  resp: BlueprintResponse | null | undefined
  plan: BlueprintPlan
  footage: FootageClip[]
  assignments: SceneAssignment[]
  options: AssemblyOptions
  /** The draft this workspace already saved, if any: saving again updates it instead of piling up copies. */
  existingDraftId: number | null
  /** M2.1a (optional): reconstructed text layers a person approved. Absent = exactly the M1 draft. */
  textLayers?: TextLayerPlan | null
  /** M2.2a (optional): reconstructed image layers a person approved, already uploaded. Absent = exactly the draft saved without them. */
  imageLayers?: ImageLayerPlan | null
  /** M2.4a (optional): approved transitions, applied to the clips whose end sits on a planned scene join. Absent = exactly the draft saved without them. */
  transitionPlan?: TransitionPlan | null
  /** M2.5a (optional): approved transcript subtitles, with the per-scene script recorded beside them. Absent = exactly the draft saved without them. */
  speechPlan?: SpeechPlan | null
  /** M2.3b (optional): approved background plates (flat shapes in measured bars). Absent = exactly the draft saved without them. */
  backgroundPlan?: BackgroundPlan | null
  /** M2.3c (optional): the stacking policy applied, last, to the layers the Reconstructor generated. Absent or 'as_generated' = nothing is reordered. */
  compositionPolicy?: OrderPolicy | null
}

export type SaveResult =
  | { ok: true; draftId: number; name: string; clips: number; plan: BlueprintPlan; issues: AssemblyIssue[] }
  | { ok: false; reason: 'blocked' | 'failed'; message: string }

const statusOf = (e: unknown) => (e as { response?: { status?: number } })?.response?.status

export async function saveAssembledDraft(input: SaveInput, overrides: Partial<SaveDeps> = {}): Promise<SaveResult> {
  const deps = { ...defaultSaveDeps(), ...overrides }
  const usable = checkBlueprintUsable(input.resp)
  if (!usable.ok) return { ok: false, reason: 'blocked', message: usable.message }          // stale / missing blueprints are never turned into a draft

  const assembled = assembleDraft({ plan: input.plan, footage: input.footage, assignments: input.assignments, createdAt: deps.now().toISOString(), options: input.options })
  if (!assembled.ok) {
    const first = assembled.issues.filter(i => i.severity === 'error').map(i => i.message)
    return { ok: false, reason: 'blocked', message: first.length ? first.join(' ') : 'The draft could not be assembled.' }
  }
  if (assembled.snapshot.videoClips.length === 0) return { ok: false, reason: 'blocked', message: 'Assign footage to at least one scene first.' }

  const body = { name: assembled.name, project_json: applyComposition(mergeBackground(mergeSpeech(mergeTransitions(mergeImageLayers(mergeTextLayers(assembled.snapshot, input.textLayers), input.imageLayers), input.transitionPlan), input.speechPlan), input.backgroundPlan), input.compositionPolicy) }          // each returns the snapshot itself when there is nothing to add
  try {
    let draftId: number
    if (input.existingDraftId != null) {
      try {
        await deps.updateDraft(input.existingDraftId, body)
        draftId = input.existingDraftId
      } catch (e) {
        if (statusOf(e) !== 404) throw e                                                        // the saved draft was deleted elsewhere: save a fresh one instead
        draftId = (await deps.createDraft(body)).data.id
      }
    } else {
      draftId = (await deps.createDraft(body)).data.id
    }
    return { ok: true, draftId, name: assembled.name, clips: assembled.snapshot.videoClips.length, plan: input.plan, issues: assembled.issues }
  } catch (e) {
    return { ok: false, reason: 'failed', message: `${errorMessage(e, 'Could not save the draft.')} Nothing in Video Studio was changed — please try again.` }
  }
}

// ── open in the editor ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface OpenDeps {
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
  confirmReplace: (itemCount: number) => boolean
}

const defaultOpenDeps = (): OpenDeps => ({
  storage: localStorage,
  confirmReplace: n => window.confirm(`Video Studio already holds a project with ${n} ${n === 1 ? 'item' : 'items'} in it. Opening this draft will replace it in the editor (a backup copy is kept, and any draft you saved is unaffected). Continue?`),
})

export type OpenResult = { ok: true; route: string } | { ok: false; reason: 'cancelled'; message: string }

/** The same hand-off the C6 "Use blueprint" flow performs: back up and clear the recovered project (only after confirmation), then tell the editor which draft to open. */
export function openAssembledDraft(draftId: number, plan: BlueprintPlan, overrides: Partial<OpenDeps> = {}): OpenResult {
  const deps = { ...defaultOpenDeps(), ...overrides }
  const items = existingProjectItems(deps.storage)
  if (items > 0 && !deps.confirmReplace(items)) return { ok: false, reason: 'cancelled', message: 'Cancelled — your current Video Studio project was left untouched.' }
  try {
    if (items > 0) {
      const old = deps.storage.getItem(STUDIO_PROJECT_KEY)
      if (old) deps.storage.setItem(STUDIO_PROJECT_BACKUP_KEY, old)
    }
    deps.storage.removeItem(STUDIO_PROJECT_KEY)
    deps.storage.setItem(STUDIO_STAGE_KEY, 'create')
  } catch { /* storage unavailable: the hint + plan below still open the draft */ }
  setBlueprintPlan(plan)
  setOpenDraftHint(draftId)
  return { ok: true, route: STUDIO_ROUTE }
}
