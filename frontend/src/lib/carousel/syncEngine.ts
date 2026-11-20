// Carousel Creator — autosave to the server without losing edits.
//
// One engine per open carousel. The editor calls `notifyChange` with its latest document after every edit; the engine
//   • waits a short pause (debounce) so a burst of typing or a drag becomes one save,
//   • keeps AT MOST ONE save request in flight, and when edits arrive meanwhile it keeps only the newest and sends it right after (so overlapping requests can never
//     arrive out of order and an older document can never overwrite a newer one),
//   • sends the server version it last saw, so a save from another device is detected (conflict) instead of being silently overwritten,
//   • retries a dropped connection or server error with growing pauses, always re-sending the NEWEST document,
//   • stops (and says why) on anything a retry cannot fix: conflict, signed out, or a document the server rejects.
// The newest unsent document is also kept in a small local "unsynced" buffer (document JSON only, no media tokens, no credentials) so an edit survives a closed tab or a
// crash; the buffer is removed as soon as the server has everything, and the editor offers it back explicitly the next time that carousel is opened.
import type { PostDocument } from '../postDocument'
import { stripMediaToken } from '../../api/mediaAccess'
import { CarouselServerError, type CarouselServer, type ServerCarousel } from './serverStore'
import { stripTokens, type KeyValueStorage } from './storage'

export type SyncStatus =
  | 'clean'      // nothing changed since open / last save
  | 'dirty'      // changed, waiting for the pause before saving
  | 'saving'     // a request is in flight
  | 'saved'      // the server has the latest
  | 'retrying'   // the last attempt failed (network / server); another is scheduled
  | 'failed'     // the server refused the document; edits are kept, fix the cause (or edit again) to retry
  | 'conflict'   // the server has a newer version from elsewhere; waiting for the person's choice
  | 'auth'       // signed out

export interface SyncState {
  status: SyncStatus
  /** The server version this editor is based on. */
  version: number
  lastSavedAt?: string
  error?: string
  /** True while edits exist that the server does not have yet. */
  unsaved: boolean
  attempts: number
  conflictVersion?: number
}

export interface Snapshot { doc: PostDocument; themeId: string; activeSlideId?: string }

export const UNSYNCED_PREFIX = 'sg.carousel.unsynced.v1.'
export const unsyncedKey = (docId: string) => `${UNSYNCED_PREFIX}${docId}`

export interface UnsyncedRecord { recordVersion: 1; docId: string; baseVersion: number; bufferedAt: string; themeId: string; activeSlideId?: string; document: PostDocument }

export interface SyncOptions {
  server: CarouselServer
  docId: string
  initialVersion: number
  /** Where the newest unsent document is kept. null = no local safety copy (storage blocked). */
  buffer: KeyValueStorage | null
  debounceMs?: number
  /** Pause before retry number `attempt` (1-based), in ms. */
  backoffMs?: (attempt: number) => number
  /** Called after the person chose "use the server's version": the editor should load this document. */
  onServerDocument?: (c: ServerCarousel) => void
  now?: () => Date
}

export const defaultBackoff = (attempt: number) => Math.min(30_000, 2_000 * 2 ** (attempt - 1))

export class SyncEngine {
  private state: SyncState
  private pending: Snapshot | null = null
  private inflight = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private forceNext = false
  private disposed = false
  private listeners = new Set<(s: SyncState) => void>()
  private waiters: Array<() => void> = []
  private readonly o: Required<Pick<SyncOptions, 'debounceMs' | 'backoffMs'>> & SyncOptions

  constructor(options: SyncOptions) {
    this.o = { debounceMs: 800, backoffMs: defaultBackoff, ...options }
    this.state = { status: 'clean', version: options.initialVersion, unsaved: false, attempts: 0 }
  }

  getState(): SyncState { return this.state }

  subscribe(fn: (s: SyncState) => void): () => void {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  /** The editor's newest document. Cheap to call on every edit. */
  notifyChange(snap: Snapshot): void {
    if (this.disposed) return
    this.pending = snap
    const blocked = this.state.status === 'conflict' || this.state.status === 'auth'
    if (blocked) { this.persistBuffer(snap); this.set({ unsaved: true }); return }
    this.set({ status: this.inflight ? 'saving' : 'dirty', unsaved: true, error: undefined })
    this.arm(this.o.debounceMs)
  }

  /** Sends whatever is pending now (leaving a page, "Save now"). Resolves when everything is saved or the engine is stopped by an error/conflict. */
  flush(): Promise<void> {
    if (this.disposed) return Promise.resolve()
    this.disarm()
    void this.pump()
    if (this.isSettled()) return Promise.resolve()
    return new Promise(res => { this.waiters.push(res) })
  }

  /** Try again immediately after a retry/failed state. */
  retryNow(): void {
    if (this.disposed || (this.state.status !== 'retrying' && this.state.status !== 'failed')) return
    this.disarm()
    void this.pump()
  }

  /** The person's decision after a conflict. 'keep-mine' overwrites the server's newer version with this editor's document (an explicit choice); 'use-server' discards this editor's unsent edits. */
  async resolveConflict(choice: 'keep-mine' | 'use-server'): Promise<void> {
    if (this.disposed || this.state.status !== 'conflict') return
    if (choice === 'keep-mine') {
      this.forceNext = true
      this.set({ status: 'dirty', error: undefined, conflictVersion: undefined })
      await this.flush()
      return
    }
    try {
      const fresh = await this.o.server.get(this.o.docId)
      this.pending = null
      this.clearBuffer()
      this.set({ status: 'saved', version: fresh.version, unsaved: false, error: undefined, conflictVersion: undefined, attempts: 0, lastSavedAt: fresh.updatedAt })
      this.o.onServerDocument?.(fresh)
      this.settle()
    } catch (e) {
      this.set({ error: asError(e).message })
    }
  }

  /** Writes the newest unsent document to the local safety copy right now (call on pagehide / visibility hidden). */
  persistNow(): void { if (this.pending) this.persistBuffer(this.pending) }

  dispose(): void {
    this.disposed = true
    this.disarm()
    this.listeners.clear()
    this.settle()
  }

  // ── internals ────────────────────────────────────────────────────────────────────────────────────────────────────────

  private set(patch: Partial<SyncState>): void {
    this.state = { ...this.state, ...patch }
    for (const l of [...this.listeners]) l(this.state)
  }

  private arm(ms: number): void {
    this.disarm()
    this.timer = setTimeout(() => { this.timer = null; void this.pump() }, ms)
  }

  private disarm(): void { if (this.timer) { clearTimeout(this.timer); this.timer = null } }

  private isSettled(): boolean {
    const s = this.state.status
    return (!this.inflight && !this.pending) || s === 'conflict' || s === 'auth' || s === 'failed' || s === 'retrying'
  }

  private settle(): void {
    if (!this.isSettled() && !this.disposed) return
    const w = this.waiters
    this.waiters = []
    for (const r of w) r()
  }

  private async pump(): Promise<void> {
    if (this.disposed || this.inflight || !this.pending) return
    const st = this.state.status
    if (st === 'conflict' || st === 'auth') return
    const snap = this.pending
    this.pending = null
    this.inflight = true
    const force = this.forceNext
    this.set({ status: 'saving', unsaved: true })
    this.persistBuffer(snap)
    try {
      const ack = await this.o.server.update(this.o.docId, snap.doc, { themeId: snap.themeId, activeSlideId: snap.activeSlideId, expectedVersion: this.state.version, force })
      this.inflight = false
      if (force) this.forceNext = false
      if (this.disposed) return
      if (this.pending) {                               // edits arrived while this one was in flight: send only the newest, right away
        this.set({ version: ack.version, lastSavedAt: ack.updatedAt, attempts: 0, error: undefined, status: 'saving' })
        void this.pump()
        return
      }
      this.clearBuffer()
      this.set({ status: 'saved', version: ack.version, lastSavedAt: ack.updatedAt, unsaved: false, attempts: 0, error: undefined })
      this.settle()
    } catch (e) {
      this.inflight = false
      if (this.disposed) return
      if (!this.pending) this.pending = snap            // a newer document (if any) supersedes this one; otherwise keep it for the retry
      const err = asError(e)
      switch (err.kind) {
        case 'conflict':
          this.set({ status: 'conflict', conflictVersion: err.opts.serverVersion, error: err.message, unsaved: true })
          break
        case 'auth':
          this.persistBuffer(this.pending)
          this.set({ status: 'auth', error: err.message, unsaved: true })
          break
        case 'network':
        case 'server': {
          const attempts = this.state.attempts + 1
          this.set({ status: 'retrying', attempts, error: err.message, unsaved: true })
          this.arm(this.o.backoffMs(attempts))
          break
        }
        default:                                        // invalid / too_large / limit / not_found / exists: a retry of the same document cannot succeed
          this.set({ status: 'failed', error: err.message, unsaved: true })
      }
      this.settle()
    }
  }

  private persistBuffer(snap: Snapshot): void {
    const b = this.o.buffer
    if (!b) return
    const rec: UnsyncedRecord = {
      recordVersion: 1, docId: this.o.docId, baseVersion: this.state.version, bufferedAt: (this.o.now ?? (() => new Date()))().toISOString(),
      themeId: snap.themeId, activeSlideId: snap.activeSlideId, document: stripTokens(snap.doc, stripMediaToken),
    }
    try { b.setItem(unsyncedKey(this.o.docId), JSON.stringify(rec)) } catch { /* storage full or blocked: the in-memory copy still retries */ }
  }

  private clearBuffer(): void {
    try { this.o.buffer?.removeItem(unsyncedKey(this.o.docId)) } catch { /* nothing to clear */ }
  }
}

const asError = (e: unknown): CarouselServerError => (e instanceof CarouselServerError ? e : new CarouselServerError('server', e instanceof Error ? e.message : String(e)))

// ── recovery of an unsynced local copy ─────────────────────────────────────────────────────────────────────────────────────

const canonical = (v: unknown): string => JSON.stringify(v, (_k, val) => (val && typeof val === 'object' && !Array.isArray(val) ? Object.fromEntries(Object.entries(val as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : val))

export function readUnsynced(buffer: KeyValueStorage | null, docId: string): UnsyncedRecord | null {
  if (!buffer) return null
  try {
    const raw = buffer.getItem(unsyncedKey(docId))
    if (!raw) return null
    const r = JSON.parse(raw) as Partial<UnsyncedRecord>
    if (r.recordVersion !== 1 || r.docId !== docId || !r.document || typeof r.baseVersion !== 'number') return null
    return r as UnsyncedRecord
  } catch { return null }
}

export function discardUnsynced(buffer: KeyValueStorage | null, docId: string): void {
  try { buffer?.removeItem(unsyncedKey(docId)) } catch { /* nothing to discard */ }
}

export type RecoveryPlan =
  | { kind: 'none' }
  | { kind: 'already-saved' }                                          // the buffered copy is exactly what the server has (the save landed before the tab closed)
  | { kind: 'offer'; record: UnsyncedRecord; serverNewer: boolean }    // different: ask the person; `serverNewer` means another save happened in between

/** Compares a local unsynced copy with what the server returned on open. Nothing is applied or deleted here. */
export function planRecovery(buffer: KeyValueStorage | null, server: ServerCarousel): RecoveryPlan {
  const rec = readUnsynced(buffer, server.id)
  if (!rec) return { kind: 'none' }
  if (canonical(rec.document) === canonical(stripTokens(server.document, stripMediaToken)) && rec.themeId === server.themeId) return { kind: 'already-saved' }
  return { kind: 'offer', record: rec, serverNewer: server.version > rec.baseVersion }
}
