// Which saved draft (and which identity it carries) the Video Studio session is attached to. The editor owns this fact (CreateEditTab); the sidebar card and the Learn stage read it.
// A tiny external store, like the blueprint plan store: not part of StudioContext, not persisted (it is rebuilt when a draft is opened or saved, exactly like the editor's own draft id).
import { useSyncExternalStore } from 'react'
import type { StoredIdentity } from './projectIdentity'

export interface ProjectContext { draftId: number | null; draftName: string; storedIdentity: StoredIdentity | null }

const EMPTY: ProjectContext = { draftId: null, draftName: '', storedIdentity: null }
let ctx: ProjectContext = EMPTY
const listeners = new Set<() => void>()

export function getProjectContext(): ProjectContext {
  return ctx
}

export function setProjectContext(next: Partial<ProjectContext> | null): void {
  ctx = next === null ? EMPTY : { ...ctx, ...next }
  listeners.forEach(l => l())
}

function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

export function useProjectContext(): ProjectContext {
  return useSyncExternalStore(subscribe, getProjectContext, () => EMPTY)
}
