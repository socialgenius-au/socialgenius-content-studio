import { describe, expect, it, vi } from 'vitest'
import {
  NETWORK_MESSAGE, RATE_LIMIT_MESSAGE, checkNewPassword, confirmEmailVerification, confirmEmailVerificationOnce, confirmPasswordReset,
  failureMessage, initialUrlTokenState, nextUrlTokenState, readTokenFromHash, requestPasswordReset, resendEmailVerification, validateResetToken, watchUrlHash,
  type HashWindow, type RecoveryApi,
} from './authRecovery'

const TOKEN = 'abcdefghijklmnopqrstuvwxyz0123456789_-ABCDE'           // 43 chars, URL-safe, same shape as the server's tokens
const httpError = (status: number, data?: unknown) => Object.assign(new Error('request failed'), { response: { status, data } })
const apiWith = (over: Partial<Record<keyof RecoveryApi, (...a: never[]) => unknown>>): RecoveryApi => {
  const reject = () => Promise.reject(new Error('unexpected call'))
  return {
    requestPasswordReset: reject, validateResetToken: reject, confirmPasswordReset: reject, confirmEmailVerification: reject, resendEmailVerification: reject, ...over,
  } as unknown as RecoveryApi
}

describe('readTokenFromHash', () => {
  it('reads a well-formed fragment', () => expect(readTokenFromHash(`#token=${TOKEN}`)).toBe(TOKEN))
  it('works without the leading #', () => expect(readTokenFromHash(`token=${TOKEN}`)).toBe(TOKEN))
  it.each(['', '#', '#token=', '#token=short', '#other=' + TOKEN, '#token=' + 'a'.repeat(201), '#token=has spaces in it and more padding', '#token=<script>alert(1)</script>aaaa'])(
    'rejects %j', (hash) => expect(readTokenFromHash(hash)).toBeNull())
  it('never reads the token from a query string', () => expect(readTokenFromHash(`?token=${TOKEN}`)).toBeNull())
})

const TOKEN_B = 'ZYXWVUTSRQPONMLKJIHGFEDCBA9876543210-_zyxwvu'            // a second, different, well-formed token

// A page that is already open can be pointed at a different link (the person pastes a second email link into the same tab). The browser then
// changes only the #fragment: nothing reloads, a `hashchange` event fires. The token state must follow it. (Regression for: "navigating to a
// different reset token on an already-open reset-password page does not refresh the token state".)
describe('following a different link on an already-open page', () => {
  /** The few pieces of `window` the watcher uses, with the browser's rule: assigning a new fragment fires `hashchange`. */
  const fakeWindow = (initialHash = ''): HashWindow & { navigate(hash: string): void; listeners: number } => {
    const listeners = new Set<() => void>()
    const w = {
      location: { hash: initialHash },
      addEventListener: (_t: 'hashchange', l: () => void) => { listeners.add(l) },
      removeEventListener: (_t: 'hashchange', l: () => void) => { listeners.delete(l) },
      navigate(hash: string) { w.location.hash = hash; [...listeners].forEach((l) => l()) },
      get listeners() { return listeners.size },
    }
    return w
  }

  it('a new valid token replaces the old one and bumps the version (so the screen restarts)', () => {
    const a = initialUrlTokenState(`#token=${TOKEN}`)
    expect(a).toEqual({ token: TOKEN, version: 0 })
    const b = nextUrlTokenState(a, `#token=${TOKEN_B}`)
    expect(b).toEqual({ token: TOKEN_B, version: 1 })
    expect(nextUrlTokenState(b, `#token=${TOKEN}`)).toEqual({ token: TOKEN, version: 2 })
  })

  it('the SAME link opened again also restarts the screen (it may have been used in the meantime)', () => {
    const a = initialUrlTokenState(`#token=${TOKEN}`)
    expect(nextUrlTokenState(a, `#token=${TOKEN}`)).toEqual({ token: TOKEN, version: 1 })
  })

  it('an expired/no-link page picks up a valid link that is opened later', () => {
    const none = initialUrlTokenState('')
    expect(none).toEqual({ token: null, version: 0 })
    expect(nextUrlTokenState(none, `#token=${TOKEN}`)).toEqual({ token: TOKEN, version: 1 })
  })

  it.each(['', '#', '#section', '#token=', '#token=short', `#other=${TOKEN}`, '#token=<script>alert(1)</script>aaaaaaaa'])('ignores a fragment that is not a token: %j', (hash) => {
    const a = initialUrlTokenState(`#token=${TOKEN}`)
    expect(nextUrlTokenState(a, hash)).toBe(a)                    // identical object: nothing re-renders, the current link keeps working
  })

  it('watchUrlHash: a hashchange for a second token reaches the state, exactly like the browser event does', () => {
    const win = fakeWindow(`#token=${TOKEN}`)
    let state = initialUrlTokenState(win.location.hash)
    const stop = watchUrlHash(win, (hash) => { state = nextUrlTokenState(state, hash) })
    expect(state.token).toBe(TOKEN)
    win.navigate(`#token=${TOKEN_B}`)
    expect(state).toEqual({ token: TOKEN_B, version: 1 })           // refreshed, no reload involved
    win.navigate('#token=nope')                                     // garbage: current state is kept
    expect(state).toEqual({ token: TOKEN_B, version: 1 })
    win.navigate(`#token=${TOKEN}`)
    expect(state).toEqual({ token: TOKEN, version: 2 })
    stop()
  })

  it('stops listening when the page goes away (no leaked listener, no update after unmount)', () => {
    const win = fakeWindow()
    const seen: string[] = []
    const stop = watchUrlHash(win, (h) => seen.push(h))
    expect(win.listeners).toBe(1)
    stop()
    expect(win.listeners).toBe(0)
    win.navigate(`#token=${TOKEN}`)
    expect(seen).toEqual([])
  })

  it('removing the fragment from the address bar (replaceState) does not fire hashchange, so clearing never loops', () => {
    const win = fakeWindow(`#token=${TOKEN}`)
    let calls = 0
    watchUrlHash(win, () => { calls++ })
    win.location.hash = ''                                           // what clearUrlFragment() effectively does: no event is dispatched
    expect(calls).toBe(0)
  })
})

describe('checkNewPassword (mirrors the server rules)', () => {
  it('accepts a good password', () => expect(checkNewPassword('A-brand-new-Passphrase-77', 'A-brand-new-Passphrase-77')).toBeNull())
  it('refuses fewer than 12 characters', () => expect(checkNewPassword('short-pw-1', 'short-pw-1')).toBe('Use at least 12 characters.'))
  it('counts 12 characters as enough, 11 as too few', () => {
    expect(checkNewPassword('a'.repeat(12), 'a'.repeat(12))).toBeNull()
    expect(checkNewPassword('a'.repeat(11), 'a'.repeat(11))).not.toBeNull()
  })
  it('enforces bcrypt\'s 72-BYTE limit, not 72 characters', () => {
    expect(checkNewPassword('é'.repeat(36), 'é'.repeat(36))).toBeNull()                 // 72 bytes exactly
    expect(checkNewPassword('é'.repeat(37), 'é'.repeat(37))).toMatch(/at most 72 bytes/)
    expect(checkNewPassword('a'.repeat(73), 'a'.repeat(73))).toMatch(/at most 72 bytes/)
  })
  it('refuses leading or trailing spaces', () => {
    expect(checkNewPassword(' leading-space-pw-123', ' leading-space-pw-123')).toMatch(/spaces/)
    expect(checkNewPassword('trailing-space-pw-123 ', 'trailing-space-pw-123 ')).toMatch(/spaces/)
  })
  it('refuses a confirmation that does not match', () => expect(checkNewPassword('A-brand-new-Passphrase-77', 'A-brand-new-Passphrase-78')).toBe("Passwords don't match."))
})

describe('requestPasswordReset', () => {
  it('trims the identifier and reports ok for any 2xx, whatever the account', async () => {
    const fn = vi.fn().mockResolvedValue({ status: 202 })
    expect(await requestPasswordReset('  ayub  ', apiWith({ requestPasswordReset: fn }))).toEqual({ ok: true })
    expect(fn).toHaveBeenCalledWith('ayub')
  })
  it('maps 429 and every other failure without leaking details', async () => {
    expect(await requestPasswordReset('x', apiWith({ requestPasswordReset: () => Promise.reject(httpError(429)) }))).toEqual({ ok: false, reason: 'rate_limited' })
    expect(await requestPasswordReset('x', apiWith({ requestPasswordReset: () => Promise.reject(httpError(500)) }))).toEqual({ ok: false, reason: 'network' })
    expect(await requestPasswordReset('x', apiWith({ requestPasswordReset: () => Promise.reject(new Error('Network Error')) }))).toEqual({ ok: false, reason: 'network' })
  })
})

describe('validateResetToken', () => {
  it('valid / invalid / unknown', async () => {
    expect(await validateResetToken(TOKEN, apiWith({ validateResetToken: () => Promise.resolve({ data: { valid: true } }) }))).toBe('valid')
    expect(await validateResetToken(TOKEN, apiWith({ validateResetToken: () => Promise.resolve({ data: { valid: false } }) }))).toBe('invalid')
    expect(await validateResetToken(TOKEN, apiWith({ validateResetToken: () => Promise.reject(new Error('offline')) }))).toBe('unknown')
  })
})

describe('confirmPasswordReset', () => {
  const confirm = (err: unknown) => confirmPasswordReset(TOKEN, 'A-brand-new-Passphrase-77', apiWith({ confirmPasswordReset: () => Promise.reject(err) }))
  it('ok', async () => expect(await confirmPasswordReset(TOKEN, 'pw', apiWith({ confirmPasswordReset: () => Promise.resolve({}) }))).toEqual({ ok: true }))
  it('an invalid, used or expired link', async () => {
    expect(await confirm(httpError(400, { detail: { code: 'invalid_token', message: 'This link is invalid or has expired.' } }))).toEqual({ ok: false, reason: 'invalid_token' })
  })
  it('a weak password carries the server\'s message and keeps the link usable', async () => {
    expect(await confirm(httpError(400, { detail: { code: 'weak_password', message: 'Use at least 12 characters.', errors: ['Use at least 12 characters.'] } })))
      .toEqual({ ok: false, reason: 'weak_password', message: 'Use at least 12 characters.' })
  })
  it('rate limit and network failure', async () => {
    expect(await confirm(httpError(429))).toEqual({ ok: false, reason: 'rate_limited' })
    expect(await confirm(new Error('Network Error'))).toEqual({ ok: false, reason: 'network' })
    expect(await confirm(httpError(500))).toEqual({ ok: false, reason: 'network' })
  })
})

describe('email verification', () => {
  it('maps the confirm outcomes', async () => {
    const run = (e: unknown) => confirmEmailVerification(TOKEN, apiWith({ confirmEmailVerification: () => (e ? Promise.reject(e) : Promise.resolve({})) }))
    expect(await run(null)).toBe('verified')
    expect(await run(httpError(400, { detail: { code: 'invalid_token' } }))).toBe('invalid')
    expect(await run(httpError(429))).toBe('rate_limited')
    expect(await run(new Error('offline'))).toBe('network')
  })

  it('the single-use link is only ever submitted once per token, even if the page effect runs twice (StrictMode)', async () => {
    const fn = vi.fn().mockResolvedValue({})
    const api = apiWith({ confirmEmailVerification: fn })
    const token = 'once-' + TOKEN
    const [a, b] = await Promise.all([confirmEmailVerificationOnce(token, api), confirmEmailVerificationOnce(token, api)])
    expect([a, b]).toEqual(['verified', 'verified'])
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('...but a later, deliberate second visit to the same link reaches the server and is told it is used', async () => {
    const fn = vi.fn().mockResolvedValueOnce({}).mockRejectedValueOnce(httpError(400, { detail: { code: 'invalid_token' } }))
    const api = apiWith({ confirmEmailVerification: fn })
    const token = 'revisit-' + TOKEN
    expect(await confirmEmailVerificationOnce(token, api)).toBe('verified')
    expect(await confirmEmailVerificationOnce(token, api)).toBe('invalid')      // not the cached 'verified'
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('resend maps ok / rate limit / network', async () => {
    expect(await resendEmailVerification(TOKEN, apiWith({ resendEmailVerification: () => Promise.resolve({}) }))).toEqual({ ok: true })
    expect(await resendEmailVerification(TOKEN, apiWith({ resendEmailVerification: () => Promise.reject(httpError(429)) }))).toEqual({ ok: false, reason: 'rate_limited' })
    expect(await resendEmailVerification(TOKEN, apiWith({ resendEmailVerification: () => Promise.reject(httpError(500)) }))).toEqual({ ok: false, reason: 'network' })
  })
})

describe('messages', () => {
  it('uses the sign-in page\'s own wording for connectivity problems', () => {
    expect(failureMessage('network')).toBe(NETWORK_MESSAGE)
    expect(NETWORK_MESSAGE).toBe('Could not reach the server — please try again in a moment')
    expect(failureMessage('rate_limited')).toBe(RATE_LIMIT_MESSAGE)
  })
})
