// C6 -- "Use blueprint": turn a CURRENT reconstruction blueprint into a durable Video Studio V2 draft and hand the editor over to it.
// No new editor, no model call: the draft is created through the existing video-studio-drafts API, and the editor opens it through
// its own Open-Draft path (CreateEditTab.handleOpenDraft) on arrival.
import { videoStudioDraftsApi } from '../../../api/client'
import type { BlueprintResponse } from '../../../types/deconstructor'
import { buildBlueprintPlan, buildDraftSnapshot, checkBlueprintUsable, draftNameFor, type BlueprintPlan } from './blueprintPlan'
import { setBlueprintPlan } from './blueprintPlanStore'
import { setOpenDraftHint } from './openDraftHint'

// Same keys VideoStudioV2.tsx uses for its own refresh-recovery (kept in sync by hand; that file owns them).
export const STUDIO_PROJECT_KEY = 'sg-video-studio-v2-project'
export const STUDIO_STAGE_KEY = 'sg-video-studio-v2-stage'
export const STUDIO_PROJECT_BACKUP_KEY = 'sg-video-studio-v2-project-backup'
export const STUDIO_ROUTE = '/video-studio-v2'

/** Number of items already in the editor's recovered project (0 = nothing worth protecting). */
export function existingProjectItems(storage: Pick<Storage, 'getItem'> = localStorage): number {
  try {
    const raw = storage.getItem(STUDIO_PROJECT_KEY)
    if (!raw) return 0
    const p = JSON.parse(raw) as Record<string, unknown>
    return ['videoClips', 'textOverlays', 'mediaOverlays', 'audioTracks'].reduce((n, k) => n + (Array.isArray(p[k]) ? (p[k] as unknown[]).length : 0), 0)
  } catch {
    return 0
  }
}

export type UseBlueprintResult =
  | { ok: true; draftId: number; plan: BlueprintPlan; route: string }
  | { ok: false; reason: 'blocked' | 'cancelled' | 'failed'; message: string }

export interface UseBlueprintDeps {
  createDraft: (body: { name: string; project_json: unknown }) => Promise<{ data: { id: number } }>
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
  confirmReplace: (itemCount: number) => boolean
  now: () => Date
}

const defaultDeps = (): UseBlueprintDeps => ({
  createDraft: body => videoStudioDraftsApi.create(body) as Promise<{ data: { id: number } }>,
  storage: localStorage,
  confirmReplace: n => window.confirm(`Video Studio already holds a project with ${n} ${n === 1 ? 'item' : 'items'} in it. Opening this blueprint will replace it in the editor (a backup copy is kept, and any draft you saved is unaffected). Continue?`),
  now: () => new Date(),
})

export async function createStudioDraftFromBlueprint(resp: BlueprintResponse | null | undefined, overrides: Partial<UseBlueprintDeps> = {}): Promise<UseBlueprintResult> {
  const deps = { ...defaultDeps(), ...overrides }
  const usable = checkBlueprintUsable(resp)
  if (!usable.ok) return { ok: false, reason: 'blocked', message: usable.message }   // stale / unknown / missing: never create silently

  const now = deps.now()
  const plan = buildBlueprintPlan(resp as BlueprintResponse, now)

  const items = existingProjectItems(deps.storage)
  if (items > 0 && !deps.confirmReplace(items)) return { ok: false, reason: 'cancelled', message: 'Cancelled — your current Video Studio project was left untouched.' }

  let draftId: number
  try {
    const { data } = await deps.createDraft({ name: draftNameFor(plan, now), project_json: buildDraftSnapshot(plan) })
    draftId = data.id
  } catch {
    return { ok: false, reason: 'failed', message: 'Could not create the Video Studio draft. Nothing was changed — please try again.' }
  }

  try {
    if (items > 0) {
      const old = deps.storage.getItem(STUDIO_PROJECT_KEY)
      if (old) deps.storage.setItem(STUDIO_PROJECT_BACKUP_KEY, old)
    }
    deps.storage.removeItem(STUDIO_PROJECT_KEY)      // the editor then opens the new draft cleanly instead of merging a recovered project into it
    deps.storage.setItem(STUDIO_STAGE_KEY, 'create')
  } catch { /* storage unavailable: the hint + plan below still open the draft */ }
  setBlueprintPlan(plan)
  setOpenDraftHint(draftId)
  return { ok: true, draftId, plan, route: STUDIO_ROUTE }
}
