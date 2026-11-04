// M5 -- write the element reconstruction record into a draft snapshot. Like every other merge in the Reconstructor chain it returns the SAME snapshot when there is nothing to add, never touches a layer, and
// adds exactly one top-level key (`elementReconstruction`). The editor reads named keys only, so older editors ignore it and the draft opens unchanged; nothing in the draft schema or the API changes.
import type { ElementReconstructionPlan, ElementReconstructionRecord } from './plan'
import { validateElementAccount } from './validate'

export const ELEMENT_RECONSTRUCTION_KEY = 'elementReconstruction'

export function mergeElementReconstruction<S extends object>(snapshot: S, plan: ElementReconstructionPlan | null | undefined): S | (S & { elementReconstruction: ElementReconstructionRecord }) {
  if (!plan || plan.items.length === 0) return snapshot
  return { ...snapshot, [ELEMENT_RECONSTRUCTION_KEY]: plan.record } as S & { elementReconstruction: ElementReconstructionRecord }
}

/** Reads the record back from a saved draft's project JSON, tolerating drafts that never had one. */
export function readElementReconstruction(projectJson: unknown): ElementReconstructionRecord | null {
  const r = (projectJson as Record<string, unknown> | null | undefined)?.[ELEMENT_RECONSTRUCTION_KEY] as Partial<ElementReconstructionRecord> | undefined
  return r && validateElementAccount(r).length === 0 ? (r as ElementReconstructionRecord) : null                   // a record that fails the gate is never read as an account
}
