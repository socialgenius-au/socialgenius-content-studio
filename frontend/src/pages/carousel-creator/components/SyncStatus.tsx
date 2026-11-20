import { AlertTriangle, CheckCircle2, CloudOff, Loader2 } from 'lucide-react'
import type { SyncState } from '../../../lib/carousel/syncEngine'

const clock = (iso?: string) => {
  const d = iso ? new Date(iso) : null
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleTimeString(undefined, { timeStyle: 'short' }) : ''
}

/** The Saving / Saved / Failed indicator in the editor header. Always says which state the carousel is in, in words (not colour alone). */
export function SaveBadge({ state, onRetry }: { state: SyncState; onRetry?: () => void }) {
  const s = state.status
  let body: JSX.Element
  if (s === 'saving' || s === 'dirty') body = <><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />Saving…</>
  else if (s === 'saved') body = <><CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-hidden />Saved{state.lastSavedAt ? ` ${clock(state.lastSavedAt)}` : ''}</>
  else if (s === 'clean') body = <><CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-hidden />All changes saved</>
  else if (s === 'retrying') body = <><CloudOff className="h-3.5 w-3.5 text-amber-600" aria-hidden />Not saved yet — retrying. Your changes are kept.{onRetry && <button type="button" className="ml-1 underline" onClick={onRetry} data-testid="retry-save">Retry now</button>}</>
  else if (s === 'failed') body = <><AlertTriangle className="h-3.5 w-3.5 text-destructive" aria-hidden /><span className="text-destructive">Save failed: {state.error}</span>{onRetry && <button type="button" className="ml-1 underline" onClick={onRetry} data-testid="retry-save">Try again</button>}</>
  else if (s === 'conflict') body = <><AlertTriangle className="h-3.5 w-3.5 text-amber-600" aria-hidden />Not saved — needs your decision</>
  else body = <><AlertTriangle className="h-3.5 w-3.5 text-destructive" aria-hidden /><span className="text-destructive">Not saved — you are signed out</span></>
  return <p className="inline-flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground" role="status" aria-live="polite" data-testid="save-status" data-sync-status={s}>{body}</p>
}

/** Another device saved a newer version. Nothing is overwritten until the person chooses. */
export function ConflictBanner({ state, busy, onKeepMine, onUseServer }: { state: SyncState; busy?: boolean; onKeepMine: () => void; onUseServer: () => void }) {
  if (state.status !== 'conflict') return null
  return (
    <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-50" data-testid="conflict-banner">
      <p className="font-medium">This carousel was changed somewhere else.</p>
      <p className="mt-1 text-xs">Another device or tab saved a newer version after you opened it. Your edits here are not saved yet and are kept safe. Choose which version to keep — nothing is overwritten until you do.</p>
      {state.error && state.error !== 'This carousel was saved from somewhere else since you opened it.' && <p className="mt-1 text-xs text-destructive">{state.error}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={onKeepMine} className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-60" data-testid="keep-mine">Keep my version (replaces the other)</button>
        <button type="button" disabled={busy} onClick={onUseServer} className="inline-flex h-8 items-center rounded-md border border-border bg-card px-3 text-xs font-medium hover:bg-muted disabled:opacity-60" data-testid="use-server">Load the saved version (discards my unsaved edits)</button>
      </div>
    </div>
  )
}

export function AuthBanner({ state }: { state: SyncState }) {
  if (state.status !== 'auth') return null
  return <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive" data-testid="auth-banner">Your session has ended, so nothing more can be saved. Your latest edits are kept in this browser. Sign in again in another tab, then reopen this carousel to restore them.</p>
}

/** Shown on open when this browser holds edits the server never received (a closed tab, a crash, a long outage). */
export function RecoveryPrompt({ title, serverNewer, onRestore, onDiscard }: { title: string; serverNewer: boolean; onRestore: () => void; onDiscard: () => void }) {
  return (
    <div role="alertdialog" aria-label="Unsaved edits found" className="mx-auto max-w-xl space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-50" data-testid="recovery-prompt">
      <h2 className="text-base font-semibold">Unsaved edits found</h2>
      <p className="text-sm">This browser still has edits to “{title}” that were never saved to your account.{serverNewer ? ' The saved version has also changed since then, so restoring will ask you to choose which one to keep.' : ''}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onRestore} className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground" data-testid="recovery-restore">Restore my unsaved edits</button>
        <button type="button" onClick={onDiscard} className="inline-flex h-9 items-center rounded-md border border-border bg-card px-3 text-sm hover:bg-muted" data-testid="recovery-discard">Discard them and open the saved version</button>
      </div>
    </div>
  )
}
