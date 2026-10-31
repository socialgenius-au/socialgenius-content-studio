import { describe, expect, it } from 'vitest'
import { createSingleFlight } from './singleFlight'

const deferred = <T = void>() => {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

describe('createSingleFlight (regression: a fast double-click sent the single-use link twice and turned a success into "expired")', () => {
  it('runs the first call and ignores calls made while it is still in flight', async () => {
    const run = createSingleFlight()
    const gate = deferred<string>()
    let started = 0
    const first = run(async () => { started++; return gate.promise })
    const second = run(async () => { started++; return 'second' })       // same tick, before anything has settled: the "double click"
    const third = run(async () => { started++; return 'third' })
    expect(await second).toEqual({ ran: false })
    expect(await third).toEqual({ ran: false })
    gate.resolve('first')
    expect(await first).toEqual({ ran: true, value: 'first' })
    expect(started).toBe(1)                                              // exactly one request was ever sent
  })

  it('is decided synchronously: no await is needed before the second call is refused', () => {
    const run = createSingleFlight()
    const gate = deferred()
    void run(() => gate.promise)
    let sync: unknown = 'unset'
    void run(async () => 'x').then((r) => { sync = r })
    return Promise.resolve().then(() => expect(sync).toEqual({ ran: false })).finally(() => gate.resolve())
  })

  it('allows the next action once the previous one has finished (so a retry after an error works)', async () => {
    const run = createSingleFlight()
    expect(await run(async () => 1)).toEqual({ ran: true, value: 1 })
    expect(await run(async () => 2)).toEqual({ ran: true, value: 2 })
  })

  it('releases even when the action fails', async () => {
    const run = createSingleFlight()
    await expect(run(async () => { throw new Error('boom') })).rejects.toThrow('boom')
    expect(await run(async () => 'again')).toEqual({ ran: true, value: 'again' })
  })

  it('keeps a legitimately undefined result distinguishable from "ignored"', async () => {
    const run = createSingleFlight()
    expect(await run(async () => undefined)).toEqual({ ran: true, value: undefined })
  })

  it('guards are independent per screen', async () => {
    const a = createSingleFlight()
    const b = createSingleFlight()
    const gate = deferred()
    void a(() => gate.promise)
    expect(await b(async () => 'ok')).toEqual({ ran: true, value: 'ok' })
    gate.resolve()
  })
})
