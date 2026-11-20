import { describe, expect, it } from 'vitest'
import { assertValidPostDocument } from '../postDocument'
import { createCarouselDocument } from './document'
import { animateAllEntrances, clearSlideAnimations, setElementAnimation, setSlideMotion, setTransitionForAll, type OpContext } from './ops'
import { buildTimeline, defaultAnimation } from './animation'
import { createHttpVideoSink, packFrames } from './videoSink'
import { editorReducer, initialState, type EditorAction } from '../../pages/carousel-creator/editorState'

function ids(): OpContext { let n = 0; return { newId: p => `${p}_${++n}`, now: () => new Date('2026-11-20T09:00:00Z') } }
const doc = (n = 3) => createCarouselDocument({ title: 'M', layouts: Array.from({ length: n }, () => 'title_body' as const) }, ids())

describe('motion editing operations', () => {
  it('sets and clears a slide\'s transition, hold time and sequencing without touching anything else', () => {
    const d = doc()
    const p1 = d.pages[1].id
    const a = setSlideMotion(d, p1, { transition: { kind: 'push', durationMs: 700, easing: 'ease-in-out', direction: 'left' }, durationMs: 4000, sequence: { mode: 'stagger', staggerMs: 200 } }, ids())
    expect(a.pages[1]).toMatchObject({ transition: { kind: 'push' }, durationMs: 4000, sequence: { mode: 'stagger' } })
    expect(a.pages[0].transition).toBeUndefined(); expect(a.pages[1].elements).toEqual(d.pages[1].elements)
    assertValidPostDocument(a)
    const b = setSlideMotion(a, p1, { transition: null, sequence: null }, ids())
    expect(b.pages[1].transition).toBeUndefined(); expect(b.pages[1].sequence).toBeUndefined(); expect(b.pages[1].durationMs).toBe(4000)
    expect('transition' in b.pages[1]).toBe(false)
    expect(() => setSlideMotion(d, 'nope', {}, ids())).toThrow(/does not exist/)
  })

  it('applies one transition to every slide except the first', () => {
    const d = doc(4)
    const t = { kind: 'wipe' as const, durationMs: 500, easing: 'linear' as const, direction: 'right' as const }
    const all = setTransitionForAll(d, t, ids())
    expect(all.pages.map(p => p.transition?.kind)).toEqual([undefined, 'wipe', 'wipe', 'wipe'])
    expect(buildTimeline(all).totalMs).toBe(4 * 3000 - 3 * 500)
    expect(setTransitionForAll(all, null, ids()).pages.every(p => p.transition === undefined)).toBe(true)
  })

  it('sets, replaces and removes one animation phase at a time', () => {
    const d = doc(1)
    const page = d.pages[0].id, el = d.pages[0].elements[0].id
    const e1 = setElementAnimation(d, page, el, 'entrance', defaultAnimation('entrance', 'pop', 'a1'), ids())
    const e2 = setElementAnimation(e1, page, el, 'emphasis', defaultAnimation('emphasis', 'pulse', 'a2'), ids())
    expect(e2.pages[0].elements[0].animations?.map(a => a.phase)).toEqual(['entrance', 'emphasis'])
    const e3 = setElementAnimation(e2, page, el, 'entrance', defaultAnimation('entrance', 'zoom', 'a3'), ids())
    expect(e3.pages[0].elements[0].animations?.map(a => `${a.phase}:${a.kind}`).sort()).toEqual(['emphasis:pulse', 'entrance:zoom'])
    const e4 = setElementAnimation(setElementAnimation(e3, page, el, 'entrance', null, ids()), page, el, 'emphasis', null, ids())
    expect(e4.pages[0].elements[0].animations).toBeUndefined()
    assertValidPostDocument(e3)
  })

  it('animate-all gives every visible unlocked element a staggered entrance, and clear removes all motion from the slide', () => {
    const d = doc(1)
    const page = d.pages[0].id
    const locked = { ...d, pages: [{ ...d.pages[0], elements: d.pages[0].elements.map((e, i) => (i === 0 ? { ...e, locked: true } : i === 1 ? { ...e, visible: false } : e)) }] }
    const a = animateAllEntrances(locked, page, 'fade', { staggerMs: 120 }, ids())
    const els = a.pages[0].elements
    expect(els[0].animations).toBeUndefined(); expect(els[1].animations).toBeUndefined()                 // locked and hidden elements are skipped
    for (const e of els.slice(2)) expect(e.animations?.[0]).toMatchObject({ phase: 'entrance', kind: 'fade' })
    expect(new Set(els.flatMap(e => e.animations?.map(x => x.id) ?? [])).size).toBe(els.length - 2)       // each animation has its own id
    expect(a.pages[0].sequence).toEqual({ mode: 'stagger', staggerMs: 120 })
    assertValidPostDocument(a)
    const cleared = clearSlideAnimations(a, page, ids())
    expect(cleared.pages[0].elements.every(e => e.animations === undefined)).toBe(true)
  })

  it('animation settings survive a JSON round trip (they are stored with the slide and element)', () => {
    const d = animateAllEntrances(setSlideMotion(doc(2), doc(2).pages[0].id, {}, ids()), doc(2).pages[0].id, 'x', {}, ids())
    expect(d).toBeTruthy()
    const base = doc(2)
    const m = setElementAnimation(setSlideMotion(base, base.pages[1].id, { transition: { kind: 'flip', durationMs: 900, easing: 'back', direction: 'up' } }, ids()), base.pages[0].id, base.pages[0].elements[0].id, 'entrance', defaultAnimation('entrance', 'typewriter', 'z'), ids())
    const back = JSON.parse(JSON.stringify(m))
    expect(back).toEqual(m); assertValidPostDocument(back)
  })
})

describe('editor reducer: motion', () => {
  const run = (s: ReturnType<typeof initialState>, ...actions: EditorAction[]) => actions.reduce((st, a) => editorReducer(st, a, ids()), s)
  it('motion edits are single, undoable document changes that mark the carousel as changed', () => {
    const d = doc(2)
    let s = initialState(d, 'forest')
    s = run(s, { type: 'slideMotion', id: d.pages[1].id, patch: { transition: { kind: 'zoom', durationMs: 600, easing: 'ease-out' } } })
    expect(s.dirty).toBe(true); expect(s.doc.pages[1].transition?.kind).toBe('zoom'); expect(s.past).toHaveLength(1)
    const el = d.pages[0].elements[0].id
    s = run(s, { type: 'elementAnimation', id: el, phase: 'entrance', anim: defaultAnimation('entrance', 'slide', 'a') })
    expect(s.doc.pages[0].elements[0].animations?.[0].kind).toBe('slide')
    s = run(s, { type: 'animateAll', kind: 'pop' }, { type: 'transitionForAll', transition: null }, { type: 'clearAnimations' })
    expect(s.doc.pages[1].transition).toBeUndefined(); expect(s.doc.pages[0].elements.every(e => !e.animations)).toBe(true)
    s = run(s, { type: 'undo' }, { type: 'undo' }, { type: 'undo' })
    expect(s.doc.pages[0].elements[0].animations?.[0].kind).toBe('slide')
    s = run(s, { type: 'undo' })
    expect(s.doc.pages[1].transition?.kind).toBe('zoom'); expect(s.doc.pages[0].elements[0].animations).toBeUndefined()
    s = run(s, { type: 'undo' })
    expect(s.doc.pages[1].transition).toBeUndefined()
  })
})

describe('HTTP video sink', () => {
  it('packs frames as length-prefixed JPEGs the server can read back', () => {
    const buf = packFrames([new Uint8Array([0xff, 0xd8, 0xff, 1]), new Uint8Array([0xff, 0xd8, 0xff, 2, 3])])
    const v = new DataView(buf)
    expect(buf.byteLength).toBe(4 + 4 + 4 + 5)
    expect(v.getUint32(0, false)).toBe(4); expect(new Uint8Array(buf, 4, 4)[3]).toBe(1)
    expect(v.getUint32(8, false)).toBe(5); expect(new Uint8Array(buf, 12, 5)[4]).toBe(3)
  })

  it('creates a job, sends frames in order, renders, downloads and discards; errors become plain sentences', async () => {
    const calls: string[] = []
    const sink = createHttpVideoSink({
      createJob: async b => { calls.push(`create ${JSON.stringify(b)}`); return { data: { job_id: 'j1' } } },
      putFrames: async (id, start, data) => { calls.push(`put ${id} ${start} ${data.byteLength}`); return {} },
      render: async id => { calls.push(`render ${id}`); return {} },
      download: async id => { calls.push(`download ${id}`); return { data: new Uint8Array([9, 9]).buffer } },
      delete: async id => { calls.push(`delete ${id}`); return {} },
    })
    const id = await sink.start({ fps: 24, width: 540, height: 676, frames: 48, format: 'gif' })
    await sink.sendFrames(id, 0, [new Uint8Array([0xff, 0xd8, 0xff])])
    await sink.render(id)
    const file = await sink.download(id)
    await sink.discard(id)
    expect(calls).toEqual(['create {"fps":24,"width":540,"height":676,"frames":48,"format":"gif"}', 'put j1 0 7', 'render j1', 'download j1', 'delete j1'])
    expect(file).toMatchObject({ name: 'carousel.gif', mime: 'image/gif' }); expect(Array.from(file.bytes)).toEqual([9, 9])

    const failing = (status: number | undefined, detail?: unknown) => createHttpVideoSink({
      createJob: async () => { throw status === undefined ? { message: 'Network Error' } : { response: { status, data: { detail } } } },
      putFrames: async () => ({}), render: async () => ({}), download: async () => ({ data: new ArrayBuffer(0) }), delete: async () => { throw new Error('gone') },
    })
    const meta = { fps: 12, width: 64, height: 64, frames: 1, format: 'mp4' as const }
    await expect(failing(undefined).start(meta)).rejects.toThrow(/Could not reach the server/)
    await expect(failing(401).start(meta)).rejects.toThrow(/session has ended/)
    await expect(failing(503, 'Video encoding is not available on this server.').start(meta)).rejects.toThrow(/not available/)
    await expect(failing(409, { code: 'busy', message: 'You already have video exports in progress.' }).start(meta)).rejects.toThrow(/in progress/)
    await expect(failing(500).start(meta)).rejects.toBeInstanceOf(Error)
    await expect(failing(401).discard('x')).resolves.toBeUndefined()                      // discarding never throws
  })
})
