// Draft "extras": records a draft carries that the editor does not model itself (the Reconstructor's `*Reconstruction` records, e.g. `elementReconstruction`, and the `assembly` table). The editor's save writes
// ONLY the keys it models, and a save replaces the whole project JSON, so these were silently dropped the first time a draft was saved from the editor. This picks them up when a draft is opened so the save can
// write them back.
//
// Rules: a record is NEVER discarded. Anything under a matching key is carried exactly as stored (a deep copy, so later edits to the opened draft cannot reach it), even if it is unusually large or does not have
// the shape expected; such cases are REPORTED, in the console and in the saved draft's `extrasPreservation` list, never hidden. The only change made on save is that the element account's statuses are recomputed
// from the layers that exist at that moment (reconcileElementReconstruction), so the persisted account matches the draft. Named editor keys are written after these and always win.
import { reconcileElementReconstruction } from '../../deconstructor/reconstruction/reconcile'
import { ELEMENT_RECONSTRUCTION_SCHEMA, type ElementReconstructionRecord, type GeneratedLayers } from '../../deconstructor/reconstruction/plan'
import { validateElementAccount } from '../../deconstructor/reconstruction/validate'

export const DRAFT_EXTRAS_LARGE_BYTES = 512 * 1024
const EXTRA_KEY = /^(assembly|[a-z][A-Za-z]*Reconstruction)$/
export const EXTRAS_REPORT_KEY = 'extrasPreservation'

export interface ExtrasIssue { key: string; issue: 'large' | 'not_an_object' | 'copy_failed' | 'unrecognised_account' | 'invalid_account'; bytes?: number; note: string }
export interface DraftExtras { kept: Record<string, unknown>; issues: ExtrasIssue[] }
export const emptyExtras = (): DraftExtras => ({ kept: {}, issues: [] })

const INVALID_NOTE = (why: string) => `is not a valid reconstruction account (${why}); kept exactly as stored and NOT used as an account or an instruction. Your layers, timing and canvas are unaffected; rebuild the draft from the Reconstructor to get a current account.`

/** The problem with a carried element account, if any. Found when a draft is OPENED (so the status line can say so at once) and again on save. A record that has a problem is kept exactly as stored and never reconciled. */
function accountIssue(acct: unknown, issues: readonly ExtrasIssue[]): ExtrasIssue | null {
  if (acct === undefined || issues.some(i => i.key === 'elementReconstruction' && i.issue === 'not_an_object')) return null
  const schemaOk = !!acct && typeof acct === 'object' && (acct as { schema?: unknown }).schema === ELEMENT_RECONSTRUCTION_SCHEMA
  if (!schemaOk) return { key: 'elementReconstruction', issue: 'unrecognised_account', note: 'is not a recognised account version; kept exactly as stored and NOT used. Your layers are unaffected; rebuild the draft from the Reconstructor to get a current account.' }
  const problems = validateElementAccount(acct)
  return problems.length ? { key: 'elementReconstruction', issue: 'invalid_account', note: INVALID_NOTE(problems.join('; ')) } : null
}

function report(issues: ExtrasIssue[]) {
  if (issues.length && typeof console !== 'undefined') console.warn('[video-studio] draft records kept with a note:', issues.map(i => `${i.key}: ${i.note}`).join('; '))
}

/** Picks up the records of an opened draft. Nothing matching is dropped. */
export function pickDraftExtras(snapshot: unknown): DraftExtras {
  const out = emptyExtras()
  if (!snapshot || typeof snapshot !== 'object') return out
  for (const [k, v] of Object.entries(snapshot as Record<string, unknown>)) {
    if (!EXTRA_KEY.test(k) || v === undefined) continue
    let copy: unknown = v
    let bytes: number | undefined
    try {
      const text = JSON.stringify(v)
      bytes = text.length
      copy = JSON.parse(text)
    } catch {
      out.issues.push({ key: k, issue: 'copy_failed', note: 'could not be copied; the original value is kept as it is' })       // carried by reference rather than lost
    }
    out.kept[k] = copy
    if (v === null || typeof v !== 'object' || Array.isArray(v)) out.issues.push({ key: k, issue: 'not_an_object', note: 'is not a record object; kept unchanged' })
    if (bytes !== undefined && bytes > DRAFT_EXTRAS_LARGE_BYTES) out.issues.push({ key: k, issue: 'large', bytes, note: `is large (${Math.round(bytes / 1024)} KB); kept in full` })
  }
  const ai = accountIssue(out.kept.elementReconstruction, out.issues)
  if (ai) out.issues.push(ai)
  report(out.issues)
  return out
}

/** What the editor spreads into the saved draft: the carried records, the element account recomputed against the layers as they are now, and a list of anything unusual that was kept. */
export function draftExtrasForSave(extras: DraftExtras, layers: { textOverlays?: unknown; mediaOverlays?: unknown; shapes?: unknown }): Record<string, unknown> {
  const out: Record<string, unknown> = { ...extras.kept }
  const issues = [...extras.issues]
  const acct = extras.kept.elementReconstruction as ElementReconstructionRecord | undefined
  if (acct !== undefined && !issues.some(i => i.key === 'elementReconstruction' && (i.issue === 'invalid_account' || i.issue === 'unrecognised_account' || i.issue === 'not_an_object'))) {
    try { out.elementReconstruction = reconcileElementReconstruction(acct, layers as GeneratedLayers) } catch { issues.push({ key: 'elementReconstruction', issue: 'invalid_account', note: INVALID_NOTE('it could not be reconciled with the layers') }) }
  }
  const unique = issues.filter((i, n) => issues.findIndex(j => j.key === i.key && j.issue === i.issue) === n)
  if (unique.length) { out[EXTRAS_REPORT_KEY] = unique; report(unique.filter(i => !extras.issues.includes(i))) }
  return out
}

/** One plain sentence for the editor's save/open status line when records were kept with a warning; "" when there is nothing to say. (Wiring it in is a protected-file change that is proposed, not applied: docs/proposals/EXTRAS_WARNING_STATUS.md.) */
export function extrasNote(extras: DraftExtras): string {
  const bad = extras.issues.filter(i => i.issue === 'invalid_account' || i.issue === 'unrecognised_account' || i.issue === 'not_an_object' || i.issue === 'copy_failed')
  const big = extras.issues.filter(i => i.issue === 'large')
  const parts: string[] = []
  if (bad.length) parts.push(`${bad.length} saved reconstruction record${bad.length === 1 ? ' is' : 's are'} not valid and ${bad.length === 1 ? 'was' : 'were'} kept unchanged but not used (your layers are unaffected; rebuild the draft from the Reconstructor to refresh ${bad.length === 1 ? 'it' : 'them'})`)
  if (big.length) parts.push(`${big.length} saved reconstruction record${big.length === 1 ? ' is' : 's are'} unusually large and ${big.length === 1 ? 'was' : 'were'} kept in full`)
  return parts.length ? ` — note: ${parts.join('; ')}.` : ''
}
