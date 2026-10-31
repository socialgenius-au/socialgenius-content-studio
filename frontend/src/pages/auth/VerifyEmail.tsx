import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import AuthShell from '../../components/auth/AuthShell'
import { s } from '../../components/auth/authStyles'
import { clearUrlFragment, confirmEmailVerification, failureMessage, resendEmailVerification, validateEmailToken } from '../../lib/authRecovery'
import { useSingleFlight } from '../../lib/singleFlight'
import { useUrlToken } from '../../lib/useUrlToken'

type Stage = 'ready' | 'verified' | 'failed' | 'resent'

export interface VerifyEmailViewProps {
  stage: Stage
  canResend?: boolean                  // false when the page was opened without a link at all
  onConfirm?: () => void
  onResend?: () => void
  error?: string
  loading?: boolean
}

/**
 * The verify-email screens. Opening the link only ever shows "ready" (a read-only check ran); the address is verified ONLY when the person
 * presses "Confirm email address". That keeps link previews, URL scanners and JavaScript-running sandboxes, which open pages but do not
 * press buttons, from using the single-use link up.
 */
export function VerifyEmailView({ stage, canResend = true, onConfirm, onResend, error, loading }: VerifyEmailViewProps) {
  if (stage === 'ready') {
    return (
      <AuthShell>
        <h2 style={s.title}>Confirm your email</h2>
        <p style={s.body}>Confirm that this address is yours so we can use it to send you password-reset links.</p>
        {error && <p style={{ ...s.error, textAlign: 'center', marginBottom: 14 }} role="alert">{error}</p>}
        <button style={{ ...s.btn, ...s.btnFlush, width: '100%', opacity: loading ? 0.7 : 1 }} type="button" onClick={onConfirm} disabled={loading}>
          {loading ? 'Confirming…' : 'Confirm email address'}
        </button>
        <Link to="/login" style={s.link}>Back to sign in</Link>
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
  // `version` changes whenever a different link is opened while this page is already showing, which restarts the whole flow for that link.
  const { token, version } = useUrlToken()
  return <VerifyEmailFlow key={version} token={token} />
}

function VerifyEmailFlow({ token }: { token: string | null }) {
  const [stage, setStage] = useState<Stage>(token ? 'ready' : 'failed')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const once = useSingleFlight()

  // On open: forget the fragment, and run the READ-ONLY check. Nothing here can verify the address.
  useEffect(() => {
    clearUrlFragment()
    if (!token) return
    let alive = true
    validateEmailToken(token).then((r) => { if (alive && r === 'invalid') setStage('failed') })
    return () => { alive = false }
  }, [token])

  // The only place the address can be verified: the person pressed the button.
  const confirm = async () => {
    if (!token) return
    const out = await once(async () => {                  // a second click while the first is in flight is ignored, not sent
      setError('')
      setLoading(true)
      const r = await confirmEmailVerification(token)
      setLoading(false)
      return r
    })
    if (!out.ran) return
    const result = out.value
    if (result === 'verified') setStage('verified')
    else if (result === 'invalid') setStage('failed')
    else setError(failureMessage(result))               // rate limit / connection problem: the link was not used, the button stays
  }

  const resend = async () => {
    if (!token) return
    const out = await once(async () => {
      setError('')
      setLoading(true)
      const r = await resendEmailVerification(token)
      setLoading(false)
      return r
    })
    if (!out.ran) return
    const result = out.value
    if (result.ok) setStage('resent')
    else setError(failureMessage(result.reason))
  }

  return <VerifyEmailView stage={stage} canResend={!!token} onConfirm={confirm} onResend={resend} error={error} loading={loading} />
}
