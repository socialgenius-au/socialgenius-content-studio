// One-click deconstruction: WHEN the page keeps asking the server how far the run has got. PURE, so it is unit-tested directly.
//
// Why this exists: the page used to stop asking the first time one reply did not say "running", and nothing ever restarted it. A single early reply that had not yet seen the
// run (or a reload while a run was in progress) left the page frozen on its first snapshot ("2 of 19 steps, Keyframes", card "Analysing…") although the server finished the run.
import type { DeconProgress } from './viewModel'

export const POLL_MS = 3000
/** Right after the person clicks Deconstruct the page keeps asking this many times even if a reply looks settled, so one stale reply cannot end the follow-up. */
export const GRACE_POLLS = 3
/** Stop following after this long and say so. The server treats a run older than 30 minutes as crashed (ORCHESTRATION_STALE_SECONDS = 1800). */
export const MAX_FOLLOW_MS = 35 * 60 * 1000

export type PollDecision = 'continue' | 'settle' | 'give_up'

export function nextPoll(a: { progress: Pick<DeconProgress, 'state'>; pollsSoFar: number; startedByClick: boolean; elapsedMs: number }): PollDecision {
  if (a.elapsedMs > MAX_FOLLOW_MS) return 'give_up'
  if (a.progress.state === 'running') return 'continue'
  if (a.startedByClick && a.pollsSoFar < GRACE_POLLS) return 'continue'
  return 'settle'
}

export const GIVE_UP_MESSAGE = 'Deconstruction is taking longer than expected, so this page stopped following it. The steps finished so far are kept. Press Refresh status to check again, or Deconstruct to continue where it stopped.'
