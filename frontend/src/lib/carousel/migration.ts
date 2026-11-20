// Carousel Creator — bringing browser-only carousels into the signed-in account.
//
// Before server persistence, carousels lived only in this browser (storage.ts). Nothing here runs by itself: the person presses "Copy to my account", per carousel or for all.
// Rules, each covered by tests:
//   • a copy is only ever CREATED on the server. If the account already has a carousel with that id, it is left exactly as it is (never overwritten); when its content is
//     identical the local one is simply recorded as already imported, otherwise the person may import it as a separate copy under a new id;
//   • local copies are never deleted by an import. Removing one from the browser is a separate, explicit action, offered only after it is safely in the account;
//   • an unreadable local record is reported and left alone;
//   • what is sent is the document with media tokens removed, like every other save.
import type { PostDocument } from '../postDocument'
import { stripMediaToken } from '../../api/mediaAccess'
import { CarouselServerError, type CarouselServer } from './serverStore'
import { deleteCarousel, listCarousels, loadCarousel, stripTokens, type CarouselSummary, type KeyValueStorage } from './storage'

export const IMPORTED_KEY = 'sg.carousel.imported.v1'

export interface ImportRecord { serverId: string; at: string; asCopy: boolean }
export type ImportMap = Record<string, ImportRecord>

export function readImportMap(storage: KeyValueStorage): ImportMap {
  try {
    const raw = storage.getItem(IMPORTED_KEY)
    const m = raw ? JSON.parse(raw) : {}
    return m && typeof m === 'object' && !Array.isArray(m) ? m as ImportMap : {}
  } catch { return {} }
}

function writeImportMap(storage: KeyValueStorage, m: ImportMap): void {
  try { storage.setItem(IMPORTED_KEY, JSON.stringify(m)) } catch { /* the import itself already succeeded on the server */ }
}

export interface LocalEntry extends CarouselSummary { imported?: ImportRecord }

/** Everything saved in this browser, flagged with whether it has already been copied to the account. */
export function localCarousels(storage: KeyValueStorage): LocalEntry[] {
  const map = readImportMap(storage)
  return listCarousels(storage).map(s => ({ ...s, imported: map[s.id] }))
}

export type ImportOutcome =
  | { id: string; status: 'imported'; serverId: string }
  | { id: string; status: 'already-in-account'; serverId: string }       // identical content was already there
  | { id: string; status: 'exists-different'; message: string }          // same id, different content: left untouched, the person decides
  | { id: string; status: 'unreadable'; message: string }
  | { id: string; status: 'failed'; message: string; kind: string }

const canonical = (v: unknown): string => JSON.stringify(v, (_k, val) => (val && typeof val === 'object' && !Array.isArray(val) ? Object.fromEntries(Object.entries(val as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : val))

export interface ImportDeps { newId?: () => string; now?: () => Date }
const defaultNewId = () => `car_${Math.random().toString(16).slice(2, 14).padEnd(12, '0')}`

export async function importLocalCarousel(storage: KeyValueStorage, server: CarouselServer, id: string, opts: { asCopy?: boolean } = {}, deps: ImportDeps = {}): Promise<ImportOutcome> {
  const loaded = loadCarousel(storage, id)
  if (!loaded.ok) return { id, status: 'unreadable', message: loaded.error }
  const { document: original, themeId, activeSlideId } = loaded.record
  const doc: PostDocument = opts.asCopy ? { ...original, id: (deps.newId ?? defaultNewId)(), title: `${original.title} (imported copy)`.slice(0, 255) } : original
  const at = (deps.now ?? (() => new Date()))().toISOString()
  try {
    await server.create(doc, { themeId, activeSlideId, importedFrom: 'browser' })
  } catch (e) {
    if (e instanceof CarouselServerError && e.kind === 'exists' && !opts.asCopy) {
      try {
        const there = await server.get(id)
        if (canonical(stripTokens(there.document, stripMediaToken)) === canonical(stripTokens(original, stripMediaToken))) {
          const map = readImportMap(storage); map[id] = { serverId: id, at, asCopy: false }; writeImportMap(storage, map)
          return { id, status: 'already-in-account', serverId: id }
        }
      } catch { /* fall through: report it as existing */ }
      return { id, status: 'exists-different', message: 'A different carousel with this id is already in your account. It was not changed. You can import this one as a separate copy.' }
    }
    const err = e instanceof CarouselServerError ? e : new CarouselServerError('server', e instanceof Error ? e.message : String(e))
    return { id, status: 'failed', message: err.message, kind: err.kind }
  }
  const map = readImportMap(storage)
  map[id] = { serverId: doc.id, at, asCopy: !!opts.asCopy }
  writeImportMap(storage, map)
  return { id, status: 'imported', serverId: doc.id }
}

/** Imports every not-yet-imported local carousel, one after another. A failure on one does not stop the rest. */
export async function importAllLocal(storage: KeyValueStorage, server: CarouselServer, deps: ImportDeps = {}): Promise<ImportOutcome[]> {
  const out: ImportOutcome[] = []
  for (const e of localCarousels(storage)) {
    if (e.imported) continue
    const r = await importLocalCarousel(storage, server, e.id, {}, deps)
    out.push(r)
    if (r.status === 'failed' && (r.kind === 'auth' || r.kind === 'network')) break      // everything after would fail the same way
  }
  return out
}

/** Removes a browser-only copy. Refused unless that carousel is recorded as imported AND is confirmed to still be in the account right now, so this can never destroy the only copy. */
export async function removeLocalCopy(storage: KeyValueStorage, server: CarouselServer, id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const rec = readImportMap(storage)[id]
  if (!rec) return { ok: false, error: 'This carousel has not been copied to your account, so it was kept.' }
  try { await server.get(rec.serverId) } catch { return { ok: false, error: 'Could not confirm the copy in your account right now, so this one was kept in the browser.' } }
  deleteCarousel(storage, id)
  return { ok: true }
}
