import { describe, expect, it } from 'vitest'
import { createCarouselDocument } from './document'
import { IMPORTED_KEY, importAllLocal, importLocalCarousel, localCarousels, readImportMap, removeLocalCopy } from './migration'
import type { OpContext } from './ops'
import { createFakeBackend } from './serverStore.fake'
import { CarouselServerError, createHttpCarouselServer, toServerError, type CarouselsApiLike } from './serverStore'
import { carouselKey, loadCarousel, memoryStorage, saveCarousel } from './storage'

function ctx(): OpContext { let n = 0; return { newId: p => `${p}_${++n}`, now: () => new Date('2026-11-19T09:00:00Z') } }
const makeDoc = (title: string, id: string) => ({ ...createCarouselDocument({ title, layouts: ['cover', 'cta'] }, ctx()), id })

function browserWith(...titles: string[]) {
  const storage = memoryStorage()
  const docs = titles.map((t, i) => makeDoc(t, `car_local${i}`))
  for (const d of docs) saveCarousel(storage, d, { themeId: 'ocean' })
  return { storage, docs }
}

describe('importing browser-only carousels', () => {
  it('lists what is only in this browser, then copies each to the account on request, keeping the local copies', async () => {
    const { storage, docs } = browserWith('One', 'Two')
    const backend = createFakeBackend(); const server = backend.serverFor(1)
    expect(localCarousels(storage).map(e => e.imported)).toEqual([undefined, undefined])
    const out = await importAllLocal(storage, server)
    expect(out.map(o => o.status)).toEqual(['imported', 'imported'])
    expect(backend.count(1)).toBe(2)
    expect(backend.peek(1, docs[0].id)).toMatchObject({ version: 1, origin: 'browser_import', title: 'One' })
    // local copies are untouched and now flagged as imported
    for (const d of docs) expect(loadCarousel(storage, d.id).ok).toBe(true)
    expect(localCarousels(storage).every(e => !!e.imported)).toBe(true)
    // running it again does nothing
    expect(await importAllLocal(storage, server)).toEqual([])
    expect(backend.count(1)).toBe(2)
  })

  it('keeps the slide order, layouts, theme and every element exactly', async () => {
    const { storage, docs } = browserWith('Order check')
    const backend = createFakeBackend(); const server = backend.serverFor(1)
    await importLocalCarousel(storage, server, docs[0].id)
    const there = backend.peek(1, docs[0].id)!
    expect(there.document.pages.map(p => p.id)).toEqual(docs[0].pages.map(p => p.id))
    expect(there.document.pages.map(p => p.elements.length)).toEqual(docs[0].pages.map(p => p.elements.length))
    expect((await server.get(docs[0].id)).themeId).toBe('ocean')
  })

  it('NEVER overwrites a different carousel that already has the same id in the account', async () => {
    const { storage, docs } = browserWith('Local version')
    const backend = createFakeBackend(); const server = backend.serverFor(1)
    await server.create({ ...docs[0], title: 'Server version' }, { themeId: 'forest' })
    const r = await importLocalCarousel(storage, server, docs[0].id)
    expect(r.status).toBe('exists-different')
    expect(backend.peek(1, docs[0].id)).toMatchObject({ title: 'Server version', version: 1 })
    expect(readImportMap(storage)).toEqual({})                                  // not marked imported
    expect(loadCarousel(storage, docs[0].id).ok).toBe(true)                      // local kept
  })

  it('...but it can be imported as a separate copy under a new id, leaving the server one alone', async () => {
    const { storage, docs } = browserWith('Local version')
    const backend = createFakeBackend(); const server = backend.serverFor(1)
    await server.create({ ...docs[0], title: 'Server version' }, { themeId: 'forest' })
    const r = await importLocalCarousel(storage, server, docs[0].id, { asCopy: true }, { newId: () => 'car_importedcopy' })
    expect(r).toMatchObject({ status: 'imported', serverId: 'car_importedcopy' })
    expect(backend.peek(1, 'car_importedcopy')?.title).toBe('Local version (imported copy)')
    expect(backend.peek(1, docs[0].id)?.title).toBe('Server version')
    expect(readImportMap(storage)[docs[0].id]).toMatchObject({ serverId: 'car_importedcopy', asCopy: true })
  })

  it('an identical carousel already in the account (e.g. after a lost record of the import) is recognised, not duplicated or changed', async () => {
    const { storage, docs } = browserWith('Same')
    const backend = createFakeBackend(); const server = backend.serverFor(1)
    await server.create(docs[0], { themeId: 'ocean' })
    const r = await importLocalCarousel(storage, server, docs[0].id)
    expect(r.status).toBe('already-in-account')
    expect(backend.count(1)).toBe(1)
    expect(backend.peek(1, docs[0].id)?.version).toBe(1)
  })

  it('reports an unreadable local record and leaves it alone', async () => {
    const { storage, docs } = browserWith('Fine')
    storage.setItem(carouselKey(docs[0].id), '{not json')
    const backend = createFakeBackend()
    const r = await importLocalCarousel(storage, backend.serverFor(1), docs[0].id)
    expect(r.status).toBe('unreadable')
    expect(storage.getItem(carouselKey(docs[0].id))).toBe('{not json')
    expect(backend.count(1)).toBe(0)
  })

  it('a failure on one does not lose it: offline stops the batch, nothing is marked imported, and a retry later works', async () => {
    const { storage } = browserWith('A', 'B')
    const backend = createFakeBackend(); const server = backend.serverFor(1)
    backend.setOffline(true)
    const out = await importAllLocal(storage, server)
    expect(out).toHaveLength(1)                                                   // stopped after the first network failure
    expect(out[0]).toMatchObject({ status: 'failed', kind: 'network' })
    expect(storage.getItem(IMPORTED_KEY)).toBeNull()
    backend.setOffline(false)
    expect((await importAllLocal(storage, server)).map(o => o.status)).toEqual(['imported', 'imported'])
  })

  it('a document the server refuses (image embedded in the browser copy) is reported and kept', async () => {
    const { storage, docs } = browserWith('Has embedded image')
    const bad = { ...docs[0], title: 'Has embedded image', description: 'data:image/png;base64,AAAA' } as unknown as typeof docs[0]
    saveCarousel(storage, bad, { themeId: 'forest' })
    const r = await importLocalCarousel(storage, createFakeBackend().serverFor(1), docs[0].id)
    expect(r).toMatchObject({ status: 'failed', kind: 'invalid' })
    expect(loadCarousel(storage, docs[0].id).ok).toBe(true)
  })

  it('removing a browser copy is explicit, and refused unless the account copy is confirmed present', async () => {
    const { storage, docs } = browserWith('Keep me')
    const backend = createFakeBackend(); const server = backend.serverFor(1)
    expect((await removeLocalCopy(storage, server, docs[0].id)).ok).toBe(false)   // never imported → refused
    expect(loadCarousel(storage, docs[0].id).ok).toBe(true)
    await importLocalCarousel(storage, server, docs[0].id)
    expect(loadCarousel(storage, docs[0].id).ok).toBe(true)                        // importing alone never removes it
    backend.setOffline(true)
    expect((await removeLocalCopy(storage, server, docs[0].id)).ok).toBe(false)    // cannot confirm → refused
    backend.setOffline(false)
    expect((await removeLocalCopy(storage, server, docs[0].id)).ok).toBe(true)
    expect(loadCarousel(storage, docs[0].id).ok).toBe(false)
    expect(backend.count(1)).toBe(1)
  })

  it("importing as one user never exposes the carousel to another", async () => {
    const { storage, docs } = browserWith('Mine')
    const backend = createFakeBackend()
    await importLocalCarousel(storage, backend.serverFor(1), docs[0].id)
    await expect(backend.serverFor(2).get(docs[0].id)).rejects.toMatchObject({ kind: 'not_found' })
    expect(await backend.serverFor(2).list()).toEqual([])
  })
})

describe('server store contract (fake) — what the backend guarantees', () => {
  it('create/list/open/update/duplicate/delete round trip, versions only go up, and other users see nothing', async () => {
    const backend = createFakeBackend(); const a = backend.serverFor(1); const b = backend.serverFor(2)
    const doc = makeDoc('Round trip', 'car_rt')
    const created = await a.create(doc, { themeId: 'sand', activeSlideId: doc.pages[1].id })
    expect(created).toMatchObject({ id: 'car_rt', version: 1, themeId: 'sand', activeSlideId: doc.pages[1].id })
    expect((await a.list()).map(s => s.id)).toEqual(['car_rt'])
    const ack = await a.update('car_rt', { ...doc, title: 'Renamed' }, { themeId: 'sand', expectedVersion: 1 })
    expect(ack.version).toBe(2)
    expect((await a.get('car_rt')).document.title).toBe('Renamed')
    const dup = await a.duplicate('car_rt')
    expect(dup.id).not.toBe('car_rt'); expect(dup.title).toBe('Renamed (copy)'); expect(dup.version).toBe(1)
    await a.remove('car_rt')
    expect((await a.list()).map(s => s.id)).toEqual([dup.id])
    expect(await b.list()).toEqual([])
    await expect(b.update(dup.id, dup.document, { themeId: 'forest', expectedVersion: 1 })).rejects.toMatchObject({ kind: 'not_found' })
    await expect(b.remove(dup.id)).rejects.toMatchObject({ kind: 'not_found' })
  })
})

describe('HTTP server store (maps the backend\'s JSON and errors)', () => {
  const doc = makeDoc('Wire', 'car_wire')
  const wire = (over: Record<string, unknown> = {}) => ({
    doc_id: 'car_wire', title: 'Wire', slide_count: 2, platform_key: 'instagram', format_key: 'carousel', theme_id: 'forest', origin: 'server', version: 3,
    created_at: '2026-11-19T09:00:00Z', updated_at: '2026-11-19T09:05:00Z', active_slide_id: doc.pages[1].id, document: doc, ...over,
  })
  const apiWith = (over: Partial<CarouselsApiLike>): CarouselsApiLike => ({
    list: async () => ({ data: [wire()] }), get: async () => ({ data: wire() }), create: async () => ({ data: wire() }), update: async () => ({ data: { version: 4, updated_at: 'now' } }),
    duplicate: async () => ({ data: wire() }), delete: async () => ({}), ...over,
  })

  it('maps field names and validates the document it receives', async () => {
    const s = createHttpCarouselServer(apiWith({}))
    expect((await s.list())[0]).toMatchObject({ id: 'car_wire', slideCount: 2, platformKey: 'instagram', version: 3, themeId: 'forest' })
    const full = await s.get('car_wire')
    expect(full.document.pages).toHaveLength(2)
    expect(full.activeSlideId).toBe(doc.pages[1].id)
    const damaged = createHttpCarouselServer(apiWith({ get: async () => ({ data: wire({ document: { nope: true } }) }) }))
    await expect(damaged.get('car_wire')).rejects.toMatchObject({ kind: 'invalid' })
  })

  it('sends the version it last saw, strips media tokens from what it sends, and never sends credentials in the body', async () => {
    let body: Record<string, unknown> = {}
    const tokenDoc = JSON.parse(JSON.stringify(doc).replace('"title":"Wire"', '"title":"Wire"')) as typeof doc
    tokenDoc.pages[0].background = { kind: 'image', source: { kind: 'asset', assetId: 5, url: '/uploads/1/bg.jpg?mt=ABC.DEF.GHI' } } as never
    const s = createHttpCarouselServer(apiWith({ update: async (_id, b) => { body = b; return { data: { version: 4, updated_at: 'now' } } } }))
    const ack = await s.update('car_wire', tokenDoc, { themeId: 'forest', activeSlideId: tokenDoc.pages[0].id, expectedVersion: 3 })
    expect(ack).toEqual({ version: 4, updatedAt: 'now' })
    expect(body).toMatchObject({ expected_version: 3, theme_id: 'forest', force: false })
    expect(JSON.stringify(body)).not.toContain('ABC.DEF.GHI')
    expect(JSON.stringify(body)).toContain('/uploads/1/bg.jpg')
  })

  it('turns transport and HTTP failures into typed errors', async () => {
    const reject = (e: unknown) => createHttpCarouselServer(apiWith({ update: async () => { throw e } }))
    const upd = (s: ReturnType<typeof createHttpCarouselServer>) => s.update('car_wire', doc, { themeId: 'forest', expectedVersion: 1 })
    await expect(upd(reject({ message: 'Network Error' }))).rejects.toBeInstanceOf(CarouselServerError)
    await expect(upd(reject({ response: { status: 409, data: { detail: { code: 'version_conflict', server_version: 9 } } } }))).rejects.toMatchObject({ kind: 'conflict', opts: { serverVersion: 9 } })
    await expect(upd(reject({ response: { status: 500, data: {} } }))).rejects.toMatchObject({ kind: 'server' })
    expect(toServerError(new Error('boom')).kind).toBe('network')
  })
})
