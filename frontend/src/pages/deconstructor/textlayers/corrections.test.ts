// M2.1a -- a person's corrections: kept separate from evidence, labelled as theirs, validated, and time-mapped.
import { describe, expect, it } from 'vitest'
import { makeTimeMap, mapTime, replaceAllBlocked, resolveCandidate, setCorrection, type Corrections } from './corrections'
import { candidatesFor } from './testkit'

const { candidates, evidence } = candidatesFor()
const c1 = candidates.find(c => c.id === 'text:1')!
const identity = makeTimeMap(30, 30)

describe('time mapping', () => {
  it('uses the reference timing as it is when the lengths match (within 1%)', () => {
    expect(makeTimeMap(30, 30)).toMatchObject({ mode: 'identity', factor: 1 })
    expect(makeTimeMap(30.2, 30)).toMatchObject({ mode: 'identity', factor: 1 })
  })
  it('fits the reference onto the blueprint length when they differ, unless told to keep reference seconds', () => {
    const fit = makeTimeMap(42.6, 30)
    expect(fit.mode).toBe('fit'); expect(fit.factor).toBeCloseTo(30 / 42.6, 6)
    expect(mapTime(fit, 42.6)).toBeCloseTo(30, 2)
    expect(makeTimeMap(42.6, 30, 'identity')).toMatchObject({ mode: 'identity', factor: 1 })
  })
  it('does not invent a factor when the reference length is unknown', () => {
    expect(makeTimeMap(null, 30, 'fit').factor).toBe(1)
  })
})

describe('corrections never touch the evidence', () => {
  it('setCorrection returns new objects and leaves the previous ones alone', () => {
    const a: Corrections = {}
    const b = setCorrection(a, 'text:1', { text: 'New words' })
    const c = setCorrection(b, 'text:1', { start: 2 })
    expect(a).toEqual({}); expect(b).toEqual({ 'text:1': { text: 'New words' } }); expect(c).toEqual({ 'text:1': { text: 'New words', start: 2 } })
  })
  it('clears a field with undefined and drops an entry that becomes empty', () => {
    const b = setCorrection({}, 'text:1', { text: 'x' })
    expect(setCorrection(b, 'text:1', { text: undefined })).toEqual({})
  })
  it('resolving leaves the candidate and its evidence exactly as they were', () => {
    const before = JSON.stringify([c1, evidence])
    resolveCandidate(c1, { text: 'Rewritten', start: 1, end: 3, x: 10, y: 20, width: 50, fontSize: 40, color: '#ff0000', include: false }, identity)
    expect(JSON.stringify([c1, evidence])).toBe(before)
    expect(Object.isFrozen(evidence.groups[0])).toBe(true)
  })
})

describe('resolving a candidate', () => {
  it('with no corrections keeps the engine’s own labels', () => {
    const r = resolveCandidate(c1, undefined, identity)
    expect(r.corrected).toEqual([])
    expect(r.text).toMatchObject({ value: 'Welcome to the show', basis: 'measured' })
    expect(r.start.basis).toBe('inferred'); expect(r.fontSize.basis).toBe('inferred'); expect(r.color.basis).toBe('default')
    expect(r.include).toBe(true)
  })
  it('labels exactly what a person changed as theirs, and lists it', () => {
    const r = resolveCandidate(c1, { text: 'Brand new wording', color: '#112233', fontSize: 55 }, identity)
    expect(r.text).toMatchObject({ value: 'Brand new wording', basis: 'user' })
    expect(r.color).toMatchObject({ value: '#112233', basis: 'user' })
    expect(r.fontSize).toMatchObject({ value: 55, basis: 'user' })
    expect(r.x.basis).toBe('inferred')
    expect(r.corrected.sort()).toEqual(['color', 'fontSize', 'text'])
  })
  it('does not call re-typing the same wording a correction', () => {
    const r = resolveCandidate(c1, { text: '  Welcome   to the show ' }, identity)
    expect(r.corrected).toEqual([]); expect(r.text.basis).toBe('measured')
  })
  it('lets a person include what was excluded by default, and exclude what was included', () => {
    const handle = candidates.find(c => c.id === 'text:6')!
    expect(resolveCandidate(handle, undefined, identity).include).toBe(false)
    expect(resolveCandidate(handle, { include: true }, identity).include).toBe(true)
    expect(resolveCandidate(c1, { include: false }, identity).include).toBe(false)
  })
  it('ignores malformed or out-of-range corrections and reports them, instead of breaking', () => {
    const r = resolveCandidate(c1, { start: Number.NaN, end: -3, color: 'red', width: 0, x: Number.POSITIVE_INFINITY, fontSize: 0 }, identity)
    expect(r.corrected).toEqual([]); expect(r.ignored.sort()).toEqual(['color', 'endTime', 'fontSize', 'startTime', 'width', 'x'])
  })
  it('clamps positions into the canvas and keeps a layer at least the minimum visible time', () => {
    const r = resolveCandidate(c1, { x: 250, y: -5, start: 4, end: 4.1 }, identity)
    expect(r.x.value).toBe(100); expect(r.y.value).toBe(0)
    expect(r.end.value - r.start.value).toBeGreaterThanOrEqual(0.5 - 1e-9)
  })
  it('reports empty wording instead of making an empty layer', () => {
    expect(resolveCandidate(c1, { text: '   ' }, identity).invalid).toBe('empty_text')
  })
  it('maps inferred times onto the draft timeline, but takes a person’s times as already being on it', () => {
    const fit = makeTimeMap(42.6, 30)
    const r = resolveCandidate(c1, undefined, fit)
    expect(r.start.value).toBeCloseTo(c1.timing.start * fit.factor, 2)
    expect(r.start.note).toMatch(/Stretched to fit/)
    expect(resolveCandidate(c1, { start: 2, end: 6 }, fit)).toMatchObject({ start: { value: 2, basis: 'user' }, end: { value: 6, basis: 'user' } })
  })
})

describe('replacing every blocked placeholder at once', () => {
  it('asks for the replacement on each blocked item, keeps other corrections, and never mutates', () => {
    const start: Corrections = { 'text:1': { text: 'Mine' }, 'text:2': { replacePlaceholder: true } }
    const next = replaceAllBlocked(start, ['text:1', 'text:2', 'text:3'])
    expect(next).toEqual({ 'text:1': { text: 'Mine', replacePlaceholder: true }, 'text:2': { replacePlaceholder: true }, 'text:3': { replacePlaceholder: true } })
    expect(start).toEqual({ 'text:1': { text: 'Mine' }, 'text:2': { replacePlaceholder: true } })
    expect(replaceAllBlocked(start, [])).toBe(start)
  })
})
