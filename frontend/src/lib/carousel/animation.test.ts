import { describe, expect, it } from 'vitest'
import { assertValidPostDocument, validatePostDocument, type PostDocument, type PostElement } from '../postDocument'
import { createCarouselDocument } from './document'
import { addElement, makeShape, makeText, type OpContext } from './ops'
import {
  DEFAULT_SLIDE_MS, REST, buildTimeline, defaultAnimation, ease, elementMotion, hasMotion, planFrame, sequenceOffsets, transitionLayers, withAnimation,
  ENTRANCE_KINDS, EMPHASIS_KINDS, EXIT_KINDS, TRANSITION_KINDS,
} from './animation'

function ids(): OpContext { let n = 0; return { newId: p => `${p}_${++n}`, now: () => new Date('2026-11-20T09:00:00Z') } }
const near = (a: number, b: number, d = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(d)

function doc(n = 3): PostDocument { return createCarouselDocument({ title: 'M', layouts: Array.from({ length: n }, () => 'statement' as const) }, ids()) }
const el = (d: PostDocument, pi = 0, ei = 0) => d.pages[pi].elements[ei]
function withEl(d: PostDocument, pi: number, ei: number, e: PostElement): PostDocument { return { ...d, pages: d.pages.map((p, i) => (i === pi ? { ...p, elements: p.elements.map((x, j) => (j === ei ? e : x)) } : p)) } }

describe('easing', () => {
  it('every easing starts at 0 and ends at 1', () => {
    for (const e of ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'back', 'bounce'] as const) { near(ease(e, 0), 0); near(ease(e, 1), 1) }
  })
  it('has the right shape: ease-in is slow first, ease-out slow last, back overshoots, bounce never leaves 0..1', () => {
    expect(ease('ease-in', 0.5)).toBeLessThan(0.5); expect(ease('ease-out', 0.5)).toBeGreaterThan(0.5)
    expect(Math.max(...Array.from({ length: 101 }, (_, i) => ease('back', i / 100)))).toBeGreaterThan(1.05)
    for (let i = 0; i <= 100; i++) { const v = ease('bounce', i / 100); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1.0001) }
    expect(ease('linear', -1)).toBe(0); expect(ease('linear', 5)).toBe(1)            // progress is clamped
  })
})

describe('element animations', () => {
  const base = () => { const d = doc(1); return { d, page: d.pages[0], e: el(d) } }
  const anim = (e: PostElement, kind: string, over: Record<string, unknown> = {}, phase: 'entrance' | 'exit' | 'emphasis' = 'entrance'): PostElement => withAnimation(e, phase, { ...defaultAnimation(phase, kind, 'a1'), easing: 'linear', ...over } as never)

  it('an element with no animation is always at rest', () => {
    const { page, e } = base()
    for (const t of [0, 500, 3000]) expect(elementMotion(page, e, t)).toEqual(REST)
  })

  it('every entrance starts hidden/away and ends exactly at rest', () => {
    for (const kind of ENTRANCE_KINDS) {
      const { d, e } = base()
      const a = anim(e, kind, { durationMs: 1000, delayMs: 200 })
      const page = withEl(d, 0, 0, a).pages[0]
      const before = elementMotion(page, a, 0)
      expect(before === REST).toBe(false)                                         // held in its starting state during the delay
      expect(elementMotion(page, a, 1200)).toEqual(REST)                          // finished
      expect(elementMotion(page, a, 2500)).toEqual(REST)                          // and stays at rest
      const mid = elementMotion(page, a, 700)
      expect(JSON.stringify(mid)).not.toBe(JSON.stringify(before))                // in motion in between
    }
  })

  it('fade changes opacity, slide moves from the chosen side, pop/zoom scale, rotate turns, bounce drops in', () => {
    const { d, e } = base()
    const at = (kind: string, p: number, over: Record<string, unknown> = {}) => { const a = anim(e, kind, { durationMs: 1000, delayMs: 0, ...over }); return elementMotion(withEl(d, 0, 0, a).pages[0], a, p * 1000) }
    near(at('fade', 0.25).opacity, 0.25)
    expect(at('slide', 0.5, { direction: 'left' }).dx).toBeLessThan(0); expect(at('slide', 0.5, { direction: 'right' }).dx).toBeGreaterThan(0)
    expect(at('slide', 0.5, { direction: 'up' }).dy).toBeLessThan(0); expect(at('slide', 0.5, { direction: 'down' }).dy).toBeGreaterThan(0)
    near(at('pop', 0.5).scale, 0.75); near(at('zoom', 0.5).scale, 0.6)
    expect(at('rotate', 0.5).rotation).toBeCloseTo(-45, 5)
    expect(at('bounce', 0.5).dy).toBeLessThan(0)
  })

  it('typewriter reveals characters on text and falls back to a fade on anything else', () => {
    const c = ids()
    const text = makeText(doc().format, { content: 'Hello' }, c)
    const shape = makeShape({}, c)
    const d = doc(1)
    const page = d.pages[0]
    const t = anim(text, 'typewriter', { durationMs: 1000, delayMs: 0 })
    near(elementMotion(page, t, 500).reveal!, 0.5)
    expect(elementMotion(page, t, 500).opacity).toBe(1)
    const s = anim(shape, 'typewriter', { durationMs: 1000, delayMs: 0 })
    expect(elementMotion(page, s, 500).reveal).toBeNull(); near(elementMotion(page, s, 500).opacity, 0.5)
  })

  it('exit plays at the END of the slide (delay = finish earlier) and leaves the element gone', () => {
    const { d, e } = base()
    const a = anim(e, 'fade', { durationMs: 500, delayMs: 0 }, 'exit')
    const page = withEl(d, 0, 0, a).pages[0]
    expect(elementMotion(page, a, 2000)).toEqual(REST)                                       // before the exit window (3000 - 500 = 2500)
    near(elementMotion(page, a, 2750).opacity, 0.5)
    near(elementMotion(page, a, 3000).opacity, 0)
    const early = anim(e, 'fade', { durationMs: 500, delayMs: 1000 }, 'exit')                // finish 1s before the end
    near(elementMotion(withEl(d, 0, 0, early).pages[0], early, 1750).opacity, 0.5)
    near(elementMotion(withEl(d, 0, 0, early).pages[0], early, 2000).opacity, 0)                // gone a second before the slide ends
  })

  it('emphasis plays between its delay and its repeats, and returns to rest', () => {
    const { d, e } = base()
    for (const kind of EMPHASIS_KINDS) {
      const a = anim(e, kind, { durationMs: 1000, delayMs: 500, repeat: 2 }, 'emphasis')
      const page = withEl(d, 0, 0, a).pages[0]
      expect(elementMotion(page, a, 100)).toEqual(REST)
      expect(JSON.stringify(elementMotion(page, a, 750))).not.toBe(JSON.stringify(REST))
      expect(elementMotion(page, a, 2600)).toEqual(REST)                                   // 500 + 2*1000 = 2500: finished
    }
    const pulse = anim(e, 'pulse', { durationMs: 1000, delayMs: 0, repeat: 2 }, 'emphasis')
    const pg = withEl(d, 0, 0, pulse).pages[0]
    near(elementMotion(pg, pulse, 500).scale, elementMotion(pg, pulse, 1500).scale)         // the second cycle repeats the first
  })

  it('entrance, exit and emphasis combine on one element', () => {
    const { d, e } = base()
    let a = anim(e, 'fade', { durationMs: 500, delayMs: 0 })
    a = anim(a, 'fade', { durationMs: 500, delayMs: 0 }, 'exit')
    a = anim(a, 'pulse', { durationMs: 1000, delayMs: 1000, repeat: 1 }, 'emphasis')
    const page = withEl(d, 0, 0, a).pages[0]
    expect(a.animations).toHaveLength(3)
    expect(elementMotion(page, a, 1500).scale).toBeGreaterThan(1)
    near(elementMotion(page, a, 250).opacity, 0.5); near(elementMotion(page, a, 2750).opacity, 0.5)
    expect(withAnimation(a, 'exit', null).animations).toHaveLength(2)
    expect(withAnimation(withAnimation(withAnimation(a, 'exit', null), 'entrance', null), 'emphasis', null).animations).toBeUndefined()
  })

  it('has the kinds the product promises', () => {
    expect([...ENTRANCE_KINDS].sort()).toEqual(['bounce', 'fade', 'pop', 'rotate', 'slide', 'typewriter', 'zoom'])
    expect([...EMPHASIS_KINDS].sort()).toEqual(['bounce', 'fade', 'pulse', 'rotate', 'zoom'])
    expect(EXIT_KINDS).not.toContain('typewriter')
    expect(TRANSITION_KINDS.map(t => t.id).sort()).toEqual(['dissolve', 'fade', 'flip', 'none', 'push', 'slide', 'wipe', 'zoom'])
  })
})

describe('sequencing', () => {
  function threeEntrances(mode: 'together' | 'stagger' | 'one-by-one') {
    const c = ids()
    let d = doc(1)
    d = { ...d, pages: [{ ...d.pages[0], elements: [] }] }
    const els = [0, 1, 2].map(i => withAnimation(makeShape({ name: `S${i}` }, c), 'entrance', { ...defaultAnimation('entrance', 'fade', `a${i}`), durationMs: 400, delayMs: 100, easing: 'linear' }))
    for (const e of els) d = addElement(d, d.pages[0].id, e, c)
    d = { ...d, pages: [{ ...d.pages[0], sequence: { mode, staggerMs: 250 } }] }
    return { page: d.pages[0], els: d.pages[0].elements }
  }
  it('together: every entrance uses only its own delay; stagger adds a step per layer; one-by-one waits for the previous to finish', () => {
    const t = threeEntrances('together'); expect([...sequenceOffsets(t.page).values()]).toEqual([0, 0, 0])
    const s = threeEntrances('stagger'); expect([...sequenceOffsets(s.page).values()]).toEqual([0, 250, 500])
    const o = threeEntrances('one-by-one'); expect([...sequenceOffsets(o.page).values()]).toEqual([0, 500, 1000])
  })
  it('the staggered element starts later, so at the same moment it is further from finished', () => {
    const { page, els } = threeEntrances('stagger')
    const at = (i: number) => elementMotion(page, els[i], 400).opacity
    expect(at(0)).toBeGreaterThan(at(1)); expect(at(1)).toBeGreaterThan(at(2))
  })
})

describe('timeline', () => {
  const withMotion = (d: PostDocument, durations: number[], trans: ({ kind: 'fade' | 'none' | 'push'; durationMs: number } | undefined)[]): PostDocument => ({
    ...d, pages: d.pages.map((p, i) => ({ ...p, durationMs: durations[i], transition: trans[i] ? { ...trans[i]!, easing: 'linear' as const } : undefined })),
  })
  it('defaults to 3 seconds per slide and cuts (no overlap) between them', () => {
    const tl = buildTimeline(doc(4))
    expect(tl.slides.map(s => s.start)).toEqual([0, 3000, 6000, 9000]); expect(tl.totalMs).toBe(4 * DEFAULT_SLIDE_MS)
  })
  it('a transition overlaps the end of the previous slide, shortening the total by its length', () => {
    const tl = buildTimeline(withMotion(doc(3), [3000, 2000, 4000], [undefined, { kind: 'fade', durationMs: 500 }, { kind: 'push', durationMs: 800 }]))
    expect(tl.slides.map(s => s.start)).toEqual([0, 2500, 3700]); expect(tl.totalMs).toBe(7700)
    expect(tl.slides[1].transition).toMatchObject({ kind: 'fade', durationMs: 500 })
  })
  it('caps a transition at half of the shorter neighbouring slide, and ignores the first slide\'s transition', () => {
    const tl = buildTimeline(withMotion(doc(2), [1000, 1000], [{ kind: 'fade', durationMs: 5000 }, { kind: 'fade', durationMs: 5000 }]))
    expect(tl.slides[0].transition.durationMs).toBe(0); expect(tl.slides[1].transition.durationMs).toBe(500); expect(tl.slides[1].start).toBe(500)
  })
  it('plans each frame: a slide alone, or two slides with the eased progress of the transition', () => {
    const tl = buildTimeline(withMotion(doc(2), [3000, 3000], [undefined, { kind: 'fade', durationMs: 1000 }]))        // slide 2 starts at 2000
    expect(planFrame(tl, 100)).toEqual({ solo: { index: 0, localMs: 100 } })
    const mid = planFrame(tl, 2500)
    expect(mid.transition).toMatchObject({ out: { index: 0, localMs: 2500 }, in: { index: 1, localMs: 500 }, kind: 'fade' }); near(mid.transition!.p, 0.5)
    expect(planFrame(tl, 3500)).toEqual({ solo: { index: 1, localMs: 1500 } })
    expect(planFrame(tl, 99999).solo?.index).toBe(1)                                                                     // past the end repeats the last frame
  })
  it('hasMotion is false for a plain carousel and true with a transition or any element animation', () => {
    expect(hasMotion(doc())).toBe(false)
    expect(hasMotion(withMotion(doc(2), [3000, 3000], [undefined, { kind: 'none', durationMs: 500 }]))).toBe(false)
    expect(hasMotion(withMotion(doc(2), [3000, 3000], [undefined, { kind: 'fade', durationMs: 500 }]))).toBe(true)
    const d = doc(1)
    expect(hasMotion(withEl(d, 0, 0, withAnimation(el(d), 'entrance', defaultAnimation('entrance', 'pop', 'x'))))).toBe(true)
  })
})

describe('slide transitions', () => {
  it('every transition starts on the outgoing slide and ends on the incoming one', () => {
    for (const t of TRANSITION_KINDS) {
      for (const dir of ['left', 'right', 'up', 'down'] as const) {
        const start = transitionLayers(t.id, 0.0001, dir); const end = transitionLayers(t.id, 1, dir)
        expect(start.out.opacity).toBeGreaterThan(0.9)                                // the old slide is what you see first
        expect(end.in.opacity).toBe(1); expect(end.in.dx).toBeCloseTo(0, 9); expect(end.in.dy).toBeCloseTo(0, 9); expect(end.in.scaleX).toBeCloseTo(1, 6); expect(end.in.scaleY).toBeCloseTo(1, 6)   // and the new one lands in place
        if (t.id !== 'wipe') expect(end.out.opacity === 0 || t.id === 'slide' || t.id === 'push').toBe(true)
      }
    }
  })
  it('dissolve crossfades; fade dips through black; slide covers; push moves both; wipe clips from the chosen side', () => {
    const d = transitionLayers('dissolve', 0.25); near(d.out.opacity, 0.75); near(d.in.opacity, 0.25)
    const f1 = transitionLayers('fade', 0.25); near(f1.out.opacity, 0.5); expect(f1.in.opacity).toBe(0)
    const f2 = transitionLayers('fade', 0.75); expect(f2.out.opacity).toBe(0); near(f2.in.opacity, 0.5)
    const s = transitionLayers('slide', 0.5, 'right'); near(s.in.dx, 0.5); expect(s.out.dx).toBe(0)
    const p = transitionLayers('push', 0.5, 'left'); near(p.in.dx, -0.5); near(p.out.dx, 0.5)
    expect(transitionLayers('wipe', 0.4, 'left').in.clip).toEqual({ x0: 0, y0: 0, x1: 0.4, y1: 1 })
    near(transitionLayers('wipe', 0.4, 'right').in.clip!.x0, 0.6); near(transitionLayers('wipe', 0.4, 'down').in.clip!.y0, 0.6)
    const z = transitionLayers('zoom', 0.5); expect(z.out.scaleX).toBeGreaterThan(1); expect(z.in.scaleX).toBeLessThan(1)
    const fl = transitionLayers('flip', 0.25, 'left'); near(fl.out.scaleX, 0.5); expect(fl.in.opacity).toBe(0)
    expect(transitionLayers('flip', 0.25, 'up').out.scaleY).toBeCloseTo(0.5, 6)
  })
})

describe('motion is stored with the document and validated', () => {
  it('slide and element settings round-trip through the validator; bad values are refused with a path', () => {
    let d = doc(2)
    d = withEl(d, 0, 0, withAnimation(el(d), 'entrance', defaultAnimation('entrance', 'slide', 'a1')))
    d = { ...d, pages: d.pages.map((p, i) => (i === 1 ? { ...p, durationMs: 4000, transition: { kind: 'push' as const, durationMs: 700, easing: 'ease-in-out' as const, direction: 'left' as const }, sequence: { mode: 'stagger' as const, staggerMs: 200 } } : p)) }
    assertValidPostDocument(d)
    const bad = (mut: (x: PostDocument) => PostDocument) => validatePostDocument(mut(JSON.parse(JSON.stringify(d)))).errors.join(' | ')
    expect(bad(x => { x.pages[1].transition = { kind: 'warp' as never, durationMs: 1, easing: 'linear' }; return x })).toMatch(/transition\.kind/)
    expect(bad(x => { x.pages[1].durationMs = 5; return x })).toMatch(/durationMs/)
    expect(bad(x => { x.pages[0].elements[0].animations![0].kind = 'typewriter'; x.pages[0].elements[0].animations![0].phase = 'exit'; return x })).toMatch(/not available for exit/)
    expect(bad(x => { x.pages[0].elements[0].animations!.push({ ...x.pages[0].elements[0].animations![0], id: 'dup' }); return x })).toMatch(/only one entrance/)
    expect(bad(x => { x.pages[0].elements[0].animations![0].durationMs = 99999999; return x })).toMatch(/durationMs/)
    expect(bad(x => { x.pages[1].sequence = { mode: 'chaos' as never, staggerMs: 1 }; return x })).toMatch(/sequence/)
  })
})
