import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import AuthShell from '../../components/auth/AuthShell'
import { s } from '../../components/auth/authStyles'
import { clearUrlFragment, confirmEmailVerificationOnce, failureMessage, readTokenFromHash, resendEmailVerification } from '../../lib/authRecovery'

type Stage = 'working' | 'verified' | 'failed' | 'resent'

export interface VerifyEmailViewProps {
  stage: Stage
  canResend?: boolean                  // false when the page was opened without a link at all
  onResend?: () => void
  error?: string
  loading?: boolean
}

/** Screens 5a (email confirmed), 5b (link expired or used, with a way to get a new one) and the "new email sent" follow-up. */
export function VerifyEmailView({ stage, canResend = true, onResend, error, loading }: VerifyEmailViewProps) {
  if (stage === 'working') {
    return (
      <AuthShell>
        <h2 style={s.title}>Confirming your email…</h2>
      </AuthShell>
    )
  }
  if (stage === 'verified') {
    return (
      <AuthShell>
        <div style={s.badge} aria-hidden="true">&#10003;</div>
        <h2 style={s.title}>Email confirmed</h2>
        <p style={s.body}>You can now use this address to reset your password.</p>
        <Link to="/login" style={s.btnLink}>Back to sign in</Link>
      </AuthShell>
    )
  }
  if (stage === 'resent') {
    return (
      <AuthShell>
        <div style={s.badge} aria-hidden="true">&#9993;</div>
        <h2 style={s.title}>Check your email</h2>
        <p style={s.body}>If that link was valid, a new confirmation email is on its way. It expires in 24 hours.</p>
        <Link to="/login" style={s.btnLink}>Back to sign in</Link>
      </AuthShell>
    )
  }
  return (
    <AuthShell>
      <h2 style={s.title}>This link has expired</h2>
      <p style={s.body}>Confirmation links work once and expire after 24 hours.{canResend ? ' Request a new one to continue.' : ''}</p>
      {error && <p style={{ ...s.error, textAlign: 'center', marginBottom: 14 }} role="alert">{error}</p>}
      {canResend && (
        <button style={{ ...s.btn, ...s.btnFlush, width: '100%', opacity: loading ? 0.7 : 1 }} type="button" onClick={onResend} disabled={loading}>
          {loading ? 'Sending…' : 'Send a new confirmation email'}
        </button>
      )}
      <Link to="/login" style={s.link}>Back to sign in</Link>
    </AuthShell>
  )
}

export default function VerifyEmail() {
  // Read (not clear) during render so React StrictMode's double render sees the fragment both times; the effect clears it.
  const [token] = useState(() => (typeof window === 'undefined' ? null : readTokenFromHash(window.location.hash)))
  const [stage, setStage] = useState<Stage>(token ? 'working' : 'failed')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    clearUrlFragment()
    if (!token) return
    let alive = true
    confirmEmailVerificationOnce(token).then((result) => {
      if (!alive) return
      if (result === 'verified') setStage('verified')
      else {
        setStage('failed')
        if (result === 'rate_limited' || result === 'network') setError(failureMessage(result))
      }
    })
    return () => { alive = false }
  }, [token])

  const resend = async () => {
    if (!token || loading) return
    setError('')
    setLoading(true)
    const result = await resendEmailVerification(token)
    setLoading(false)
    if (result.ok) setStage('resent')
    else setError(failureMessage(result.reason))
  }

  return <VerifyEmailView stage={stage} canResend={!!token} onResend={resend} error={error} loading={loading} />
}
