// Server-side render tests (no DOM): every approved screen and state renders with the approved copy, links, Show/Hide controls, and the
// sign-in card's responsive container. Interactive flows are covered end to end in a real browser (see the review notes), not here.
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import PasswordField from '../../components/auth/PasswordField'
import { ForgotPasswordView } from './ForgotPassword'
import { ResetPasswordView } from './ResetPassword'
import { VerifyEmailView } from './VerifyEmail'

const html = (node: ReactNode) => renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>)
const count = (haystack: string, needle: RegExp) => (haystack.match(needle) ?? []).length
const inputTypes = (h: string) => [...h.matchAll(/<input[^>]*type="([^"]+)"/g)].map((m) => m[1])

describe('every screen shares the sign-in card', () => {
  const screens: Record<string, string> = {
    'request': html(<ForgotPasswordView stage="form" />),
    'sent': html(<ForgotPasswordView stage="sent" />),
    'reset form': html(<ResetPasswordView stage="form" />),
    'reset expired': html(<ResetPasswordView stage="expired" />),
    'reset done': html(<ResetPasswordView stage="done" />),
    'verify working': html(<VerifyEmailView stage="working" />),
    'verify ok': html(<VerifyEmailView stage="verified" />),
    'verify failed': html(<VerifyEmailView stage="failed" />),
    'verify resent': html(<VerifyEmailView stage="resent" />),
  }
  it.each(Object.entries(screens))('%s: logo, cream card, gradient page, responsive width', (_n, h) => {
    expect(h).toContain('SocialGenius')
    expect(h).toContain('Content Studio')
    expect(h).toContain('background:#F5F0E8')                                           // the approved cream card
    expect(h).toContain('linear-gradient(135deg, #1E3D2A 0%, #0f2016 100%)')            // the approved page background
    expect(h).toContain('width:100%;max-width:420px')                                   // same fluid container as Login: phones unchanged
    expect(h).toContain('padding:52px 44px')
  })
  it.each(Object.entries(screens))('%s: no review outline, no dashed border', (_n, h) => {
    expect(h).not.toMatch(/dashed|outline:\s*2px/)
  })
})

describe('request reset', () => {
  it('form: field, button and the way back', () => {
    const h = html(<ForgotPasswordView stage="form" />)
    expect(h).toContain('Reset your password')
    expect(h).toContain('Enter your username or email. If an account matches, we will send a reset link.')
    expect(h).toContain('placeholder="Username or email"')
    expect(h).toContain('Send reset link')
    expect(h).toMatch(/<a [^>]*href="\/login"[^>]*>Back to sign in<\/a>/)
    expect(h).not.toContain('role="alert"')
  })
  it('shows an error line and a busy button', () => {
    const h = html(<ForgotPasswordView stage="form" error="Too many requests. Try again later." loading />)
    expect(h).toMatch(/<p [^>]*role="alert"[^>]*>Too many requests\. Try again later\.<\/p>/)
    expect(h).toContain('Sending…')
    expect(h).toMatch(/<button[^>]*disabled/)
  })
  it('sent: identical wording whatever was typed (it does not even receive the identifier)', () => {
    const a = html(<ForgotPasswordView stage="sent" identifier="ayub" />)
    const b = html(<ForgotPasswordView stage="sent" identifier="nobody@nowhere.test" />)
    expect(a).toBe(b)
    expect(a).toContain('Check your email')
    expect(a).toContain('If an account matches, a reset link is on its way. It expires in 30 minutes.')
    expect(a).toMatch(/<a [^>]*href="\/login"[^>]*>Back to sign in<\/a>/)
  })
})

describe('set new password: Show / Hide', () => {
  it('both fields start hidden, each with its own labelled toggle', () => {
    const h = html(<ResetPasswordView stage="form" />)
    expect(inputTypes(h)).toEqual(['password', 'password'])
    expect(count(h, /type="button"/g)).toBe(2)
    expect(h).toContain('aria-label="Show new password"')
    expect(h).toContain('aria-label="Show confirm new password"')
    expect(count(h, /aria-pressed="false"/g)).toBe(2)
    expect(count(h, />Show<\/button>/g)).toBe(2)
    expect(h).toContain('aria-controls="new-password"')
    expect(h).toContain('aria-controls="confirm-password"')
    expect(count(h, /autocomplete="new-password"/gi)).toBe(2)
  })
  it('a revealed field is plain text and offers Hide', () => {
    const h = html(<ResetPasswordView stage="form" shown />)
    expect(inputTypes(h)).toEqual(['text', 'text'])
    expect(count(h, />Hide<\/button>/g)).toBe(2)
    expect(count(h, /aria-pressed="true"/g)).toBe(2)
    expect(h).toContain('aria-label="Hide new password"')
  })
  it('the two toggles are independent components', () => {
    expect(inputTypes(html(<PasswordField id="a" label="New password" value="" onChange={() => {}} />))).toEqual(['password'])
    expect(inputTypes(html(<PasswordField id="b" label="Confirm" value="" onChange={() => {}} initiallyShown />))).toEqual(['text'])
  })
  it('toggle is a non-submitting button, reachable by keyboard', () => {
    const h = html(<PasswordField id="x" label="New password" value="" onChange={() => {}} />)
    expect(h).toMatch(/<button[^>]*type="button"/)
    expect(h).not.toContain('tabindex="-1"')
  })
  it('hint line, or the error line in its place', () => {
    expect(html(<ResetPasswordView stage="form" />)).toContain('At least 12 characters.')
    const e = html(<ResetPasswordView stage="form" error="Use at least 12 characters." />)
    expect(e).toContain('Use at least 12 characters.')
    expect(e).toContain('role="alert"')
    expect(e).not.toContain('At least 12 characters.')
  })
  it('button wording', () => {
    expect(html(<ResetPasswordView stage="form" />)).toContain('Update password')
    expect(html(<ResetPasswordView stage="form" loading />)).toContain('Updating…')
  })
})

describe('reset link states', () => {
  it('expired / used / invalid: explains, and offers a new link', () => {
    const h = html(<ResetPasswordView stage="expired" />)
    expect(h).toContain('This link has expired')
    expect(h).toContain('Reset links work once and expire after 30 minutes. Request a new one to continue.')
    expect(h).toMatch(/<a [^>]*href="\/forgot-password"[^>]*>Request a new link<\/a>/)
    expect(h).toMatch(/<a [^>]*href="\/login"[^>]*>Back to sign in<\/a>/)
    expect(inputTypes(h)).toEqual([])                                                    // no password fields on a dead link
  })
  it('done: says every device was signed out', () => {
    const h = html(<ResetPasswordView stage="done" />)
    expect(h).toContain('Password updated')
    expect(h).toContain('You have been signed out on all devices. Sign in with your new password.')
    expect(h).toMatch(/<a [^>]*href="\/login"[^>]*>Back to sign in<\/a>/)
  })
})

describe('email verification screens', () => {
  it('confirmed', () => {
    const h = html(<VerifyEmailView stage="verified" />)
    expect(h).toContain('Email confirmed')
    expect(h).toContain('You can now use this address to reset your password.')
    expect(h).toMatch(/<a [^>]*href="\/login"[^>]*>Back to sign in<\/a>/)
  })
  it('expired link: a working way to get a new confirmation email', () => {
    const h = html(<VerifyEmailView stage="failed" canResend />)
    expect(h).toContain('This link has expired')
    expect(h).toContain('Confirmation links work once and expire after 24 hours. Request a new one to continue.')
    expect(h).toMatch(/<button[^>]*type="button"[^>]*>Send a new confirmation email<\/button>/)
    expect(h).toMatch(/<a [^>]*href="\/login"[^>]*>Back to sign in<\/a>/)
  })
  it('opened without any link: nothing to resend from, so no resend button', () => {
    const h = html(<VerifyEmailView stage="failed" canResend={false} />)
    expect(h).not.toContain('Send a new confirmation email')
    expect(h).not.toContain('Request a new one to continue.')
    expect(h).toContain('Back to sign in')
  })
  it('resend busy and error states', () => {
    const h = html(<VerifyEmailView stage="failed" canResend loading error="Too many requests. Try again later." />)
    expect(h).toContain('Sending…')
    expect(h).toMatch(/<p [^>]*role="alert"[^>]*>Too many requests\. Try again later\.<\/p>/)
  })
  it('after resending: the same neutral wording as the reset flow', () => {
    const h = html(<VerifyEmailView stage="resent" />)
    expect(h).toContain('Check your email')
    expect(h).toContain('If that link was valid, a new confirmation email is on its way. It expires in 24 hours.')
  })
  it('while confirming', () => {
    expect(html(<VerifyEmailView stage="working" />)).toContain('Confirming your email…')
  })
})
