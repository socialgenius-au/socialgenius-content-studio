import { describe, expect, it, vi } from 'vitest'
import {
  NETWORK_MESSAGE, RATE_LIMIT_MESSAGE, checkNewPassword, confirmEmailVerification, confirmEmailVerificationOnce, confirmPasswordReset,
  failureMessage, readTokenFromHash, requestPasswordReset, resendEmailVerification, validateResetToken, type RecoveryApi,
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
