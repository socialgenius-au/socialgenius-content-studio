import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCarouselDocument } from './document'
import { addElement, makeImage, type OpContext } from './ops'
import { createFakeBackend } from './serverStore.fake'
import { CarouselServerError, toServerError } from './serverStore'
import { memoryStorage } from './storage'
import { SyncEngine, discardUnsynced, planRecovery, readUnsynced, unsyncedKey, type Snapshot, type SyncState } from './syncEngine'
import type { PostDocument } from '../postDocument'

function ctx(): OpContext { let n = 0; return { newId: p => `${p}_${++n}`, now: () => new Date('2026-11-19T09:00:00Z') } }
const fresh = () => createCarouselDocument({ title: 'Tile tips', layouts: ['cover', 'title_body', 'cta'] }, ctx())
const edit = (d: PostDocument, text: string): PostDocument => ({ ...d, title: text })
const snap = (doc: PostDocument): Snapshot => ({ doc, themeId: 'forest', activeSlideId: doc.pages[0].id })
const flushMicrotasks = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }

async function open(opts: { backend?: ReturnType<typeof createFakeBackend>; buffer?: ReturnType<typeof memoryStorage> | null } = {}) {
  const backend = opts.backend ?? createFakeBackend()
  const server = backend.serverFor(1)
  const doc = fresh()
  const created = await server.create(doc, { themeId: 'forest' })
  const buffer = opts.buffer === undefined ? memoryStorage() : opts.buffer
  const engine = new SyncEngine({ server, docId: doc.id, initialVersion: created.version, buffer, debounceMs: 800, backoffMs: a => 1000 * a })
  const states: SyncState[] = []
  engine.subscribe(s => states.push(s))
  return { backend, server, engine, doc, buffer, states }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('autosave', () => {
  it('waits for a pause, then saves once; a burst of edits becomes ONE request', async () => {
    const { engine, server, doc, backend } = await open()
    server.calls.length = 0
    for (const t of ['a', 'ab', 'abc']) { engine.notifyChange(snap(edit(doc, t))); await vi.advanceTimersByTimeAsync(200) }
    expect(server.calls.filter(c => c.startsWith('update'))).toHaveLength(0)
    expect(engine.getState().status).toBe('dirty')
    await vi.advanceTimersByTimeAsync(800)
    expect(server.calls.filter(c => c.startsWith('update'))).toHaveLength(1)
    expect(engine.getState()).toMatchObject({ status: 'saved', version: 2, unsaved: false })
    expect(backend.peek(1, doc.id)?.document.title).toBe('abc')
  })

  it('shows Saving while the request is out and Saved after, and reports the saved time', async () => {
    const { engine, backend, doc, states } = await open()
    const release = backend.hold('update')
    engine.notifyChange(snap(edit(doc, 'x')))
    await vi.advanceTimersByTimeAsync(800)
    expect(engine.getState().status).toBe('saving')
    release(); await flushMicrotasks()
    expect(engine.getState().status).toBe('saved')
    expect(engine.getState().lastSavedAt).toBeTruthy()
    expect(states.map(s => s.status)).toEqual(expect.arrayContaining(['dirty', 'saving', 'saved']))
  })

  it('never has two requests in flight: edits during a save are coalesced into one follow-up carrying the newest document', async () => {
    const { engine, server, backend, doc } = await open()
    server.calls.length = 0
    const release = backend.hold('update')
    engine.notifyChange(snap(edit(doc, 'first')))
    await vi.advanceTimersByTimeAsync(800)                       // request 1 is now held in flight
    engine.notifyChange(snap(edit(doc, 'second')))
    engine.notifyChange(snap(edit(doc, 'third')))
    await vi.advanceTimersByTimeAsync(2000)                      // debounce elapses, but nothing may be sent while request 1 is out
    expect(server.calls.filter(c => c.startsWith('update'))).toHaveLength(1)
    release(); await flushMicrotasks(); await vi.advanceTimersByTimeAsync(0)
    const updates = server.calls.filter(c => c.startsWith('update'))
    expect(updates).toHaveLength(2)                              // exactly one follow-up, not one per edit
    expect(updates[1]).toBe('update ' + doc.id + ' v2')          // and it used the version the first save returned
    expect(backend.peek(1, doc.id)?.document.title).toBe('third')
    expect(engine.getState()).toMatchObject({ status: 'saved', version: 3, unsaved: false })
  })

  it('an older document can never overwrite a newer one (saves are applied in order)', async () => {
    const { engine, backend, doc } = await open()
    const release = backend.hold('update')
    engine.notifyChange(snap(edit(doc, 'old')))
    await vi.advanceTimersByTimeAsync(800)
    engine.notifyChange(snap(edit(doc, 'new')))
    release(); await flushMicrotasks(); await vi.advanceTimersByTimeAsync(1000); await flushMicrotasks()
    expect(backend.peek(1, doc.id)?.document.title).toBe('new')
  })

  it('flush() sends immediately without waiting for the pause and resolves once saved', async () => {
    const { engine, backend, doc } = await open()
    engine.notifyChange(snap(edit(doc, 'now')))
    const done = engine.flush()
    await vi.advanceTimersByTimeAsync(0)
    await done
    expect(engine.getState().status).toBe('saved')
    expect(backend.peek(1, doc.id)?.document.title).toBe('now')
  })

  it('does nothing when nothing changed', async () => {
    const { engine, server } = await open()
    server.calls.length = 0
    await vi.advanceTimersByTimeAsync(5000)
    await engine.flush()
    expect(server.calls).toEqual([])
    expect(engine.getState().status).toBe('clean')
  })
})

describe('network failures', () => {
  it('keeps the edit, shows a retrying state, and saves it when the connection returns (newest document wins)', async () => {
    const { engine, backend, doc } = await open()
    backend.setOffline(true)
    engine.notifyChange(snap(edit(doc, 'offline edit')))
    await vi.advanceTimersByTimeAsync(800)
    expect(engine.getState()).toMatchObject({ status: 'retrying', unsaved: true, attempts: 1 })
    expect(engine.getState().error).toMatch(/could not reach/i)
    engine.notifyChange(snap(edit(doc, 'later offline edit')))
    await vi.advanceTimersByTimeAsync(800)
    expect(engine.getState().attempts).toBeGreaterThanOrEqual(2)
    backend.setOffline(false)
    await vi.advanceTimersByTimeAsync(5000)
    expect(engine.getState()).toMatchObject({ status: 'saved', unsaved: false })
    expect(backend.peek(1, doc.id)?.document.title).toBe('later offline edit')
  })

  it('backs off between attempts instead of hammering the server', async () => {
    const { engine, backend, doc, server } = await open()
    server.calls.length = 0
    backend.setOffline(true)
    engine.notifyChange(snap(edit(doc, 'x')))
    await vi.advanceTimersByTimeAsync(800)                      // attempt 1 at t=800
    await vi.advanceTimersByTimeAsync(900)                      // before the 1s backoff: still one attempt
    expect(server.calls.filter(c => c.startsWith('update'))).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(200)                      // attempt 2 at ~1800; next wait is 2s
    expect(server.calls.filter(c => c.startsWith('update'))).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1500)
    expect(server.calls.filter(c => c.startsWith('update'))).toHaveLength(2)
    engine.dispose()
  })

  it('a server error (500) is retried; a refused document (422) is not retried but kept, and a later edit tries again', async () => {
    const { engine, backend, doc, server } = await open()
    backend.failNext(new CarouselServerError('server', 'The server had a problem saving. It will be retried.', { status: 500 }))
    engine.notifyChange(snap(edit(doc, 'v1')))
    await vi.advanceTimersByTimeAsync(800)
    expect(engine.getState().status).toBe('retrying')
    await vi.advanceTimersByTimeAsync(1500)
    expect(engine.getState().status).toBe('saved')

    server.calls.length = 0
    backend.failNext(new CarouselServerError('invalid', 'The server rejected this carousel: slide 2 is broken', { status: 422 }))
    engine.notifyChange(snap(edit(doc, 'v2')))
    await vi.advanceTimersByTimeAsync(800)
    expect(engine.getState()).toMatchObject({ status: 'failed', unsaved: true })
    expect(engine.getState().error).toMatch(/rejected/)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(server.calls.filter(c => c.startsWith('update'))).toHaveLength(1)    // no retry storm
    engine.notifyChange(snap(edit(doc, 'v3')))                                   // the person edits again → one more try
    await vi.advanceTimersByTimeAsync(800)
    expect(engine.getState().status).toBe('saved')
  })

  it('a signed-out session stops saving, keeps the edits locally, and reports it', async () => {
    const { engine, backend, doc, buffer, server } = await open()
    backend.failNext(new CarouselServerError('auth', 'Your session has ended. Sign in again; your latest edits are kept in this browser until they are saved.', { status: 401 }))
    engine.notifyChange(snap(edit(doc, 'while signed out')))
    await vi.advanceTimersByTimeAsync(800)
    expect(engine.getState().status).toBe('auth')
    server.calls.length = 0
    engine.notifyChange(snap(edit(doc, 'still signed out')))
    await vi.advanceTimersByTimeAsync(30_000)
    expect(server.calls).toEqual([])
    expect(readUnsynced(buffer, doc.id)?.document.title).toBe('still signed out')
  })
})

describe('stale versions and conflicts', () => {
  it('detects a save from another device, stops, and keeps the local edit', async () => {
    const { engine, backend, doc, buffer } = await open()
    backend.editElsewhere(1, doc.id, d => edit(d, 'phone edit'))
    engine.notifyChange(snap(edit(doc, 'laptop edit')))
    await vi.advanceTimersByTimeAsync(800)
    expect(engine.getState()).toMatchObject({ status: 'conflict', conflictVersion: 2, unsaved: true })
    expect(backend.peek(1, doc.id)?.document.title).toBe('phone edit')          // NOT overwritten
    expect(readUnsynced(buffer, doc.id)?.document.title).toBe('laptop edit')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(backend.peek(1, doc.id)?.document.title).toBe('phone edit')          // and still not, however long we wait
  })

  it('"keep mine" overwrites the newer server version only when chosen, and continues from the new version', async () => {
    const { engine, backend, doc } = await open()
    backend.editElsewhere(1, doc.id, d => edit(d, 'phone edit'))
    engine.notifyChange(snap(edit(doc, 'laptop edit')))
    await vi.advanceTimersByTimeAsync(800)
    await engine.resolveConflict('keep-mine')
    expect(engine.getState()).toMatchObject({ status: 'saved', unsaved: false, version: 3 })
    expect(backend.peek(1, doc.id)?.document.title).toBe('laptop edit')
    engine.notifyChange(snap(edit(doc, 'laptop edit 2')))
    await vi.advanceTimersByTimeAsync(800)
    expect(engine.getState()).toMatchObject({ status: 'saved', version: 4 })     // normal (non-forced) saves work again
  })

  it('"use server\'s version" drops the local edits, adopts the server version and hands the editor that document', async () => {
    const backend = createFakeBackend()
    const server = backend.serverFor(1)
    const doc = fresh()
    await server.create(doc, { themeId: 'forest' })
    const buffer = memoryStorage()
    const onServerDocument = vi.fn()
    const engine = new SyncEngine({ server, docId: doc.id, initialVersion: 1, buffer, onServerDocument })
    backend.editElsewhere(1, doc.id, d => edit(d, 'phone edit'))
    engine.notifyChange(snap(edit(doc, 'laptop edit')))
    await vi.advanceTimersByTimeAsync(800)
    await engine.resolveConflict('use-server')
    expect(onServerDocument).toHaveBeenCalledTimes(1)
    expect(onServerDocument.mock.calls[0][0].document.title).toBe('phone edit')
    expect(engine.getState()).toMatchObject({ status: 'saved', version: 2, unsaved: false })
    expect(buffer.getItem(unsyncedKey(doc.id))).toBeNull()
    expect(backend.peek(1, doc.id)?.document.title).toBe('phone edit')
  })
})

describe('local safety copy', () => {
  it('holds the newest unsent document while a save is out and is removed once the server has everything', async () => {
    const { engine, backend, doc, buffer } = await open()
    const release = backend.hold('update')
    engine.notifyChange(snap(edit(doc, 'in flight')))
    await vi.advanceTimersByTimeAsync(800)
    expect(readUnsynced(buffer, doc.id)).toMatchObject({ baseVersion: 1 })
    release(); await flushMicrotasks()
    expect(buffer!.getItem(unsyncedKey(doc.id))).toBeNull()
  })

  it('never stores media tokens, auth tokens or other credentials in the local copy', async () => {
    const { engine, backend, doc, buffer } = await open()
    backend.setOffline(true)
    const c = ctx()
    const img = makeImage({ source: { kind: 'asset', assetId: 12, url: '/uploads/1/pic.png?mt=SECRET.TOKEN.VALUE' } as never }, c)
    engine.notifyChange(snap(addElement(doc, doc.pages[0].id, img, c)))
    await vi.advanceTimersByTimeAsync(800)
    const raw = buffer!.getItem(unsyncedKey(doc.id))!
    expect(raw).toContain('/uploads/1/pic.png')
    expect(raw).not.toContain('SECRET.TOKEN.VALUE')
    expect(raw).not.toMatch(/Bearer|authorization|password/i)
    expect(Object.keys(buffer!.dump())).toEqual([unsyncedKey(doc.id)])
    engine.dispose()
  })

  it('works without any local storage (blocked) — saving still happens', async () => {
    const { engine, backend, doc } = await open({ buffer: null })
    engine.notifyChange(snap(edit(doc, 'no buffer')))
    await vi.advanceTimersByTimeAsync(800)
    expect(engine.getState().status).toBe('saved')
    expect(backend.peek(1, doc.id)?.document.title).toBe('no buffer')
  })

  it('on reopen: nothing → none; identical to the server → already saved; different → offered, flagged when the server moved on; discard removes it', async () => {
    const { engine, backend, doc, buffer, server } = await open()
    const full = await server.get(doc.id)
    expect(planRecovery(buffer, full)).toEqual({ kind: 'none' })

    backend.setOffline(true)
    engine.notifyChange(snap(edit(doc, 'crashed before saving')))
    await vi.advanceTimersByTimeAsync(800)
    backend.setOffline(false)
    engine.dispose()                                                         // the tab "closes" with the edit only in the local copy
    const plan = planRecovery(buffer, await server.get(doc.id))
    expect(plan).toMatchObject({ kind: 'offer', serverNewer: false })
    if (plan.kind === 'offer') expect(plan.record.document.title).toBe('crashed before saving')

    backend.editElsewhere(1, doc.id, d => edit(d, 'phone edit'))
    expect(planRecovery(buffer, await server.get(doc.id))).toMatchObject({ kind: 'offer', serverNewer: true })

    discardUnsynced(buffer, doc.id)
    expect(planRecovery(buffer, await server.get(doc.id))).toEqual({ kind: 'none' })
  })

  it('a save that landed just before the tab closed is recognised as already saved (no false conflict)', async () => {
    const { engine, backend, doc, buffer, server } = await open()
    const release = backend.hold('update')
    engine.notifyChange(snap(edit(doc, 'landed')))
    await vi.advanceTimersByTimeAsync(800)
    release(); await flushMicrotasks()
    // simulate the acknowledgement being lost: put the buffer back as the engine wrote it before the request
    buffer!.setItem(unsyncedKey(doc.id), JSON.stringify({ recordVersion: 1, docId: doc.id, baseVersion: 1, bufferedAt: 'x', themeId: 'forest', document: edit(doc, 'landed') }))
    expect(planRecovery(buffer, await server.get(doc.id))).toEqual({ kind: 'already-saved' })
  })
})

describe('lifecycle', () => {
  it('dispose cancels timers and ignores later edits', async () => {
    const { engine, server, doc } = await open()
    server.calls.length = 0
    engine.notifyChange(snap(edit(doc, 'x')))
    engine.dispose()
    await vi.advanceTimersByTimeAsync(10_000)
    engine.notifyChange(snap(edit(doc, 'y')))
    await vi.advanceTimersByTimeAsync(10_000)
    expect(server.calls).toEqual([])
  })
})

describe('error mapping', () => {
  const http = (status: number | undefined, detail?: unknown) => toServerError(status === undefined ? { message: 'Network Error' } : { response: { status, data: { detail } } })
  it('classifies the backend responses', () => {
    expect(http(undefined).kind).toBe('network')
    expect(http(401).kind).toBe('auth')
    expect(http(404).kind).toBe('not_found')
    expect(http(409, { code: 'version_conflict', server_version: 7 })).toMatchObject({ kind: 'conflict', opts: { serverVersion: 7 } })
    expect(http(409, { code: 'exists' }).kind).toBe('exists')
    expect(http(409, { code: 'limit', message: 'full' }).kind).toBe('limit')
    expect(http(413).kind).toBe('too_large')
    expect(http(422, { code: 'invalid_document', errors: ['a', 'b'] })).toMatchObject({ kind: 'invalid', opts: { details: ['a', 'b'] } })
    expect(http(502).retryable).toBe(true)
    expect(http(422).retryable).toBe(false)
  })
})
