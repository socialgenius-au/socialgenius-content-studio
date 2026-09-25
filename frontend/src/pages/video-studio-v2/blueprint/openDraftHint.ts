// USE BLUEPRINT creates a durable backend draft and then navigates to Video Studio V2. This one-shot hint (sessionStorage, so it can never
// outlive the tab or fire twice) tells the editor which draft to open on arrival, so the editor is attached to that draft's id and the
// user's next Save updates the SAME draft instead of creating a duplicate.
export const OPEN_DRAFT_HINT_KEY = 'sg-video-studio-v2-open-draft'

export function setOpenDraftHint(draftId: number): void {
  try { sessionStorage.setItem(OPEN_DRAFT_HINT_KEY, String(draftId)) } catch { /* storage unavailable: the editor simply opens with its recovered project */ }
}

/** Read AND clear the hint (one-shot). Returns null when absent or malformed. */
export function consumeOpenDraftHint(): number | null {
  try {
    const raw = sessionStorage.getItem(OPEN_DRAFT_HINT_KEY)
    sessionStorage.removeItem(OPEN_DRAFT_HINT_KEY)
    const n = raw == null ? NaN : Number(raw)
    return Number.isInteger(n) && n > 0 ? n : null
  } catch {
    return null
  }
}
