// The ACTIVE blueprint plan of the Video Studio V2 session. A tiny external store (localStorage-backed, so it survives a refresh exactly like
// the editor's own auto-recovery snapshot) that React reads with useSyncExternalStore -- deliberately NOT part of StudioContext, so the shared
// editor state and legacy /studio are untouched. It is written into every saved draft (CreateEditTab.buildProjectSnapshot) and restored when
// a draft is opened, so a draft always knows which blueprint created it.
import { useSyncExternalStore } from 'react'
import { isBlueprintPlan, type BlueprintPlan } from './blueprintPlan'

export const PLAN_STORAGE_KEY = 'sg-video-studio-v2-blueprint-plan'

let cache: BlueprintPlan | null | undefined
const listeners = new Set<() => void>()

function load(): BlueprintPlan | null {
  try {
    const raw = localStorage.getItem(PLAN_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return isBlueprintPlan(parsed) ? parsed : null
  } catch {
    return null   // corrupted / unavailable storage: behave as "no plan", never crash the editor
  }
}

export function getBlueprintPlan(): BlueprintPlan | null {
  if (cache === undefined) cache = load()
  return cache
}

export function setBlueprintPlan(plan: BlueprintPlan | null): void {
  cache = plan
  try {
    if (plan) localStorage.setItem(PLAN_STORAGE_KEY, JSON.stringify(plan))
    else localStorage.removeItem(PLAN_STORAGE_KEY)
  } catch {
    // storage unavailable (private mode / quota): the in-memory plan still works for this session
  }
  listeners.forEach(l => l())
}

function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

export function useBlueprintPlan(): BlueprintPlan | null {
  return useSyncExternalStore(subscribe, getBlueprintPlan, () => null)
}

/** Test helper: forget the cached value so the next read re-loads from storage. */
export function _resetBlueprintPlanCache(): void {
  cache = undefined
}
