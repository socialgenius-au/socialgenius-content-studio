// An in-memory implementation of the CarouselServer contract for tests. It follows the real backend's rules (backend/app/routers/carousels.py):
// every user sees only their own carousels, a create never overwrites, an update is refused with a conflict when the server version is newer than the one the editor saw
// (unless forced), versions only go up, and documents are stored without media tokens. Tests can take the "network" down, make a call fail once, or hold a call in flight.
import { stripMediaToken } from '../../api/mediaAccess'
import { parsePostDocument, type PostDocument } from '../postDocument'
import { CarouselServerError, type CarouselServer, type ServerCarousel, type ServerCarouselSummary } from './serverStore'
import { stripTokens } from './storage'

interface Row { id: string; title: string; slideCount: number; platformKey: string; formatKey: string; themeId: string; origin: string; version: number; createdAt: string; updatedAt: string; activeSlideId?: string; document: string }

export interface FakeBackend {
  /** A client signed in as this user. Several clients for the same user model "another device". */
  serverFor(userId: number): CarouselServer & { calls: string[] }
  /** Every request fails as if offline, until set back to false. */
  setOffline(offline: boolean): void
  /** The next request (any method) fails with this error. */
  failNext(err: CarouselServerError): void
  /** Holds the next request of this method until the returned function is called (to test overlapping saves). */
  hold(method: 'update' | 'create' | 'get' | 'list'): () => void
  /** What the server stores for a user's carousel (not what a client sees). */
  peek(userId: number, id: string): { version: number; document: PostDocument; title: string; origin: string } | undefined
  count(userId: number): number
  /** Edits a stored carousel as another device would, bumping its version. */
  editElsewhere(userId: number, id: string, mutate: (doc: PostDocument) => PostDocument): void
  clock: { now: () => Date }
}

export function createFakeBackend(opts: { now?: () => Date } = {}): FakeBackend {
  const tables = new Map<number, Map<string, Row>>()
  let offline = false
  let failure: CarouselServerError | null = null
  const holds = new Map<string, Array<Promise<void>>>()
  let tick = 0
  const clock = { now: opts.now ?? (() => new Date(Date.UTC(2026, 10, 19, 9, 0, tick++))) }
  const table = (u: number) => { let t = tables.get(u); if (!t) { t = new Map(); tables.set(u, t) } return t }
  const summary = (r: Row): ServerCarouselSummary => ({ id: r.id, title: r.title, slideCount: r.slideCount, platformKey: r.platformKey, formatKey: r.formatKey, themeId: r.themeId, origin: r.origin, version: r.version, createdAt: r.createdAt, updatedAt: r.updatedAt })
  const full = (r: Row): ServerCarousel => ({ ...summary(r), activeSlideId: r.activeSlideId, document: JSON.parse(r.document) as PostDocument })
  const store = (doc: PostDocument) => {
    const parsed = parsePostDocument(JSON.stringify(stripTokens(doc, stripMediaToken)))
    if (!parsed.ok) throw new CarouselServerError('invalid', `The server rejected this carousel: ${parsed.errors.slice(0, 3).join('; ')}`, { status: 422, details: parsed.errors })
    if (JSON.stringify(parsed.document).includes('data:')) throw new CarouselServerError('invalid', 'The server rejected this carousel: an image is embedded in the document.', { status: 422 })
    return parsed.document
  }
  const apply = (r: Row, doc: PostDocument, themeId: string, active?: string) => {
    r.title = doc.title; r.slideCount = doc.pages.length; r.platformKey = doc.format.platformKey; r.formatKey = doc.format.formatKey; r.themeId = themeId
    r.activeSlideId = active && doc.pages.some(p => p.id === active) ? active : undefined
    r.document = JSON.stringify(doc); r.updatedAt = clock.now().toISOString()
  }

  async function gate(method: string, calls: string[], label: string) {
    calls.push(label)
    if (offline) throw new CarouselServerError('network', 'Could not reach the server. Your changes are kept in this tab and will be sent when the connection returns.')
    if (failure) { const f = failure; failure = null; throw f }
    const queue = holds.get(method)
    if (queue?.length) await queue.shift()
  }

  return {
    clock,
    setOffline: v => { offline = v },
    failNext: e => { failure = e },
    hold(method) {
      let release!: () => void
      const p = new Promise<void>(res => { release = res })
      holds.set(method, [...(holds.get(method) ?? []), p])
      return release
    },
    peek(userId, id) { const r = tables.get(userId)?.get(id); return r ? { version: r.version, document: JSON.parse(r.document) as PostDocument, title: r.title, origin: r.origin } : undefined },
    count: u => tables.get(u)?.size ?? 0,
    editElsewhere(userId, id, mutate) {
      const r = tables.get(userId)?.get(id)
      if (!r) throw new Error(`no such carousel ${id}`)
      apply(r, store(mutate(JSON.parse(r.document) as PostDocument)), r.themeId, r.activeSlideId); r.version += 1
    },
    serverFor(userId) {
      const calls: string[] = []
      return {
        calls,
        async list() { await gate('list', calls, 'list'); return [...table(userId).values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(summary) },
        async get(id) {
          await gate('get', calls, `get ${id}`)
          const r = table(userId).get(id)
          if (!r) throw new CarouselServerError('not_found', 'That carousel was not found in your account.', { status: 404 })
          return full(r)
        },
        async create(doc, meta) {
          await gate('create', calls, `create ${doc.id}`)
          const t = table(userId)
          const clean = store(doc)
          const existing = t.get(clean.id)
          if (existing) throw new CarouselServerError('exists', 'A carousel with this id already exists in your account; it was not changed.', { status: 409, serverVersion: existing.version })
          const row: Row = { id: clean.id, title: '', slideCount: 0, platformKey: '', formatKey: '', themeId: meta.themeId, origin: meta.importedFrom === 'browser' ? 'browser_import' : 'server', version: 1, createdAt: clock.now().toISOString(), updatedAt: '', document: '' }
          apply(row, clean, meta.themeId, meta.activeSlideId)
          t.set(row.id, row)
          return full(row)
        },
        async update(id, doc, meta) {
          await gate('update', calls, `update ${id} v${meta.expectedVersion}${meta.force ? ' force' : ''}`)
          const clean = store(doc)
          if (clean.id !== id) throw new CarouselServerError('invalid', 'The server rejected this carousel: the document id does not match.', { status: 422 })
          const r = table(userId).get(id)
          if (!r) throw new CarouselServerError('not_found', 'That carousel was not found in your account.', { status: 404 })
          if (r.version !== meta.expectedVersion && !meta.force) throw new CarouselServerError('conflict', 'This carousel was saved from somewhere else since you opened it.', { status: 409, serverVersion: r.version })
          apply(r, clean, meta.themeId, meta.activeSlideId)
          r.version += 1
          return { version: r.version, updatedAt: r.updatedAt }
        },
        async duplicate(id) {
          await gate('duplicate', calls, `duplicate ${id}`)
          const src = table(userId).get(id)
          if (!src) throw new CarouselServerError('not_found', 'That carousel was not found in your account.', { status: 404 })
          const newId = `car_dup${table(userId).size}${id.slice(-3)}`
          const doc = { ...(JSON.parse(src.document) as PostDocument), id: newId, title: `${src.title} (copy)` }
          const row: Row = { id: newId, title: '', slideCount: 0, platformKey: '', formatKey: '', themeId: src.themeId, origin: 'duplicate', version: 1, createdAt: clock.now().toISOString(), updatedAt: '', document: '' }
          apply(row, doc, src.themeId, src.activeSlideId)
          table(userId).set(newId, row)
          return full(row)
        },
        async remove(id) {
          await gate('remove', calls, `remove ${id}`)
          if (!table(userId).delete(id)) throw new CarouselServerError('not_found', 'That carousel was not found in your account.', { status: 404 })
        },
      }
    },
  }
}
