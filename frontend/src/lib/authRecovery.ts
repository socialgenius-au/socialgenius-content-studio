// Logic behind the Forgot Password / email-verification screens, kept free of React so it can be unit-tested without a DOM.
import { authApi } from '../api/client'

export const MIN_PASSWORD_LENGTH = 12
export const MAX_PASSWORD_BYTES = 72                     // bcrypt only uses the first 72 bytes; the server refuses longer input
export const NETWORK_MESSAGE = 'Could not reach the server — please try again in a moment'     // same wording as the sign-in page
export const RATE_LIMIT_MESSAGE = 'Too many requests. Try again later.'

// ── the token travels in the URL fragment (#token=…), which browsers never send to a server ──────────────────────────────────────

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{20,200}$/

/** '#token=abc…' -> 'abc…', or null when absent or not shaped like one of our tokens. */
export function readTokenFromHash(hash: string): string | null {
  if (hash.startsWith('?')) return null                  // a query string is never a valid source for a token
  const value = new URLSearchParams(hash.replace(/^#/, '')).get('token')
  return value && TOKEN_SHAPE.test(value) ? value : null
}

/** Remove the fragment from the address bar (and history entry) so the token is not left visible or bookmarkable. Idempotent. */
export function clearUrlFragment(): void {
  if (typeof window === 'undefined' || !window.location.hash) return
  window.history.replaceState(null, '', window.location.pathname + window.location.search)
}

// ── client-side checks: a convenience that mirrors the server's rules (the server is the authority) ──────────────────────────────

export function checkNewPassword(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`
  if (new TextEncoder().encode(password).length > MAX_PASSWORD_BYTES) return `Use at most ${MAX_PASSWORD_BYTES} bytes (long passwords with many accented or non-English characters can exceed this).`
  if (password !== password.trim()) return 'Remove any spaces at the start or end.'
  if (password !== confirm) return "Passwords don't match."
  return null
}

// ── API calls → small result values the screens can switch on ─────────────────────────────────────────────────────────────────────

export type RecoveryApi = Pick<typeof authApi, 'requestPasswordReset' | 'validateResetToken' | 'confirmPasswordReset' | 'confirmEmailVerification' | 'resendEmailVerification'>

type HttpError = { response?: { status?: number; data?: { detail?: unknown } } }
const statusOf = (err: unknown) => (err as HttpError)?.response?.status
const detailOf = (err: unknown): { code?: string; message?: string; errors?: string[] } => {
  const d = (err as HttpError)?.response?.data?.detail
  return d && typeof d === 'object' ? (d as { code?: string; message?: string; errors?: string[] }) : {}
}

export type SimpleResult = { ok: true } | { ok: false; reason: 'rate_limited' | 'network' }
const simpleFailure = (err: unknown): SimpleResult => ({ ok: false, reason: statusOf(err) === 429 ? 'rate_limited' : 'network' })

export async function requestPasswordReset(identifier: string, api: RecoveryApi = authApi): Promise<SimpleResult> {
  try {
    await api.requestPasswordReset(identifier.trim())
    return { ok: true }                                   // 202 for every input: nothing here can reveal whether an account exists
  } catch (err) {
    return simpleFailure(err)
  }
}

export async function validateResetToken(token: string, api: RecoveryApi = authApi): Promise<'valid' | 'invalid' | 'unknown'> {
  try {
    const { data } = await api.validateResetToken(token)
    return data?.valid ? 'valid' : 'invalid'
  } catch {
    return 'unknown'                                      // could not check; the form is still shown and the server decides on submit
  }
}

export type ConfirmResult =
  | { ok: true }
  | { ok: false; reason: 'invalid_token' | 'rate_limited' | 'network' }
  | { ok: false; reason: 'weak_password'; message: string }

export async function confirmPasswordReset(token: string, newPassword: string, api: RecoveryApi = authApi): Promise<ConfirmResult> {
  try {
    await api.confirmPasswordReset(token, newPassword)
    return { ok: true }
  } catch (err) {
    const status = statusOf(err)
    if (status === 429) return { ok: false, reason: 'rate_limited' }
    if (status === 400) {
      const d = detailOf(err)
      if (d.code === 'weak_password') return { ok: false, reason: 'weak_password', message: d.message || d.errors?.[0] || 'Choose a stronger password.' }
      return { ok: false, reason: 'invalid_token' }
    }
    return { ok: false, reason: 'network' }
  }
}

export type VerifyResult = 'verified' | 'invalid' | 'rate_limited' | 'network'

export async function confirmEmailVerification(token: string, api: RecoveryApi = authApi): Promise<VerifyResult> {
  try {
    await api.confirmEmailVerification(token)
    return 'verified'
  } catch (err) {
    const status = statusOf(err)
    if (status === 429) return 'rate_limited'
    return status === 400 ? 'invalid' : 'network'
  }
}

// The verification link is single-use, and React StrictMode runs effects twice in development. Sharing one in-flight request per token
// stops the second run from "using the link again" and wrongly reporting it as already used.
const inFlight = new Map<string, Promise<VerifyResult>>()
export function confirmEmailVerificationOnce(token: string, api: RecoveryApi = authApi): Promise<VerifyResult> {
  let p = inFlight.get(token)
  if (!p) {
    p = confirmEmailVerification(token, api)
    inFlight.set(token, p)
  }
  return p
}

export async function resendEmailVerification(token: string, api: RecoveryApi = authApi): Promise<SimpleResult> {
  try {
    await api.resendEmailVerification(token)
    return { ok: true }
  } catch (err) {
    return simpleFailure(err)
  }
}

export const failureMessage = (reason: 'rate_limited' | 'network') => (reason === 'rate_limited' ? RATE_LIMIT_MESSAGE : NETWORK_MESSAGE)
