import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import AuthShell from '../../components/auth/AuthShell'
import { s } from '../../components/auth/authStyles'
import { failureMessage, requestPasswordReset } from '../../lib/authRecovery'
import { useSingleFlight } from '../../lib/singleFlight'

export interface ForgotPasswordViewProps {
  stage: 'form' | 'sent'
  identifier?: string
  onIdentifierChange?: (value: string) => void
  onSubmit?: (e: FormEvent) => void
  error?: string
  loading?: boolean
}

/** Screens 2 (request) and 2b (after sending). The "sent" screen is the same for every input: it never says whether an account matched. */
export function ForgotPasswordView({ stage, identifier = '', onIdentifierChange = () => {}, onSubmit, error, loading }: ForgotPasswordViewProps) {
  if (stage === 'sent') {
    return (
      <AuthShell>
        <div style={s.badge} aria-hidden="true">&#9993;</div>
        <h2 style={s.title}>Check your email</h2>
        <p style={s.body}>If an account matches, a reset link is on its way. It expires in 30 minutes.</p>
        <Link to="/login" style={s.btnLink}>Back to sign in</Link>
      </AuthShell>
    )
  }
  return (
    <AuthShell>
      <h2 style={s.title}>Reset your password</h2>
      <p style={s.body}>Enter your username or email. If an account matches, we will send a reset link.</p>
      <form onSubmit={onSubmit} style={s.form}>
        <input
          style={s.input}
          type="text"
          placeholder="Username or email"
          aria-label="Username or email"
          value={identifier}
          onChange={(e) => onIdentifierChange(e.target.value)}
          required
          autoFocus
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
        />
        {error && <p style={s.error} role="alert">{error}</p>}
        <button style={{ ...s.btn, opacity: loading ? 0.7 : 1 }} type="submit" disabled={loading}>
          {loading ? 'Sending…' : 'Send reset link'}
        </button>
      </form>
      <Link to="/login" style={s.link}>Back to sign in</Link>
    </AuthShell>
  )
}

export default function ForgotPassword() {
  const [identifier, setIdentifier] = useState('')
  const [stage, setStage] = useState<'form' | 'sent'>('form')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const once = useSingleFlight()

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const out = await once(async () => {
      setError('')
      setLoading(true)
      const r = await requestPasswordReset(identifier)
      setLoading(false)
      return r
    })
    if (!out.ran) return
    const result = out.value
    if (result.ok) setStage('sent')
    else setError(failureMessage(result.reason))
  }

  return <ForgotPasswordView stage={stage} identifier={identifier} onIdentifierChange={setIdentifier} onSubmit={submit} error={error} loading={loading} />
}
