import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import AuthShell from '../../components/auth/AuthShell'
import PasswordField from '../../components/auth/PasswordField'
import { s } from '../../components/auth/authStyles'
import { useAuth } from '../../contexts/AuthContext'
import { checkNewPassword, clearUrlFragment, confirmPasswordReset, failureMessage, readTokenFromHash, validateResetToken } from '../../lib/authRecovery'

type Stage = 'form' | 'expired' | 'done'

export interface ResetPasswordViewProps {
  stage: Stage
  password?: string
  confirm?: string
  onPasswordChange?: (v: string) => void
  onConfirmChange?: (v: string) => void
  onSubmit?: (e: FormEvent) => void
  error?: string
  loading?: boolean
  shown?: boolean                      // tests only: render both Show/Hide controls in the revealed state
}

/** Screens 3 (set password, with 3b error line), 3c (link expired / used / invalid) and 4 (password updated). */
export function ResetPasswordView({ stage, password = '', confirm = '', onPasswordChange = () => {}, onConfirmChange = () => {}, onSubmit, error, loading, shown }: ResetPasswordViewProps) {
  if (stage === 'expired') {
    return (
      <AuthShell>
        <h2 style={s.title}>This link has expired</h2>
        <p style={s.body}>Reset links work once and expire after 30 minutes. Request a new one to continue.</p>
        <Link to="/forgot-password" style={s.btnLink}>Request a new link</Link>
        <Link to="/login" style={s.link}>Back to sign in</Link>
      </AuthShell>
    )
  }
  if (stage === 'done') {
    return (
      <AuthShell>
        <div style={s.badge} aria-hidden="true">&#10003;</div>
        <h2 style={s.title}>Password updated</h2>
        <p style={s.body}>You have been signed out on all devices. Sign in with your new password.</p>
        <Link to="/login" style={s.btnLink}>Back to sign in</Link>
      </AuthShell>
    )
  }
  return (
    <AuthShell>
      <h2 style={s.title}>Choose a new password</h2>
      <form onSubmit={onSubmit} style={s.form}>
        <PasswordField id="new-password" label="New password" value={password} onChange={onPasswordChange} autoComplete="new-password" autoFocus disabled={loading} initiallyShown={shown} />
        <PasswordField id="confirm-password" label="Confirm new password" value={confirm} onChange={onConfirmChange} autoComplete="new-password" disabled={loading} initiallyShown={shown} />
        {error ? <p style={s.error} role="alert">{error}</p> : <p style={s.note}>At least 12 characters.</p>}
        <button style={{ ...s.btn, ...s.btnFlush, opacity: loading ? 0.7 : 1 }} type="submit" disabled={loading}>
          {loading ? 'Updating…' : 'Update password'}
        </button>
      </form>
    </AuthShell>
  )
}

export default function ResetPassword() {
  const { logout } = useAuth()
  // Read (not clear) during render: React StrictMode renders twice before any effect runs, and both passes must see the fragment.
  const [token] = useState(() => (typeof window === 'undefined' ? null : readTokenFromHash(window.location.hash)))
  const [stage, setStage] = useState<Stage>(token ? 'form' : 'expired')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    clearUrlFragment()                                   // the token now lives only in memory
    if (!token) return
    let alive = true
    validateResetToken(token).then((r) => { if (alive && r === 'invalid') setStage('expired') })
    return () => { alive = false }
  }, [token])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (loading || !token) return
    const problem = checkNewPassword(password, confirm)
    if (problem) { setError(problem); return }
    setError('')
    setLoading(true)
    const result = await confirmPasswordReset(token, password)
    setLoading(false)
    if (result.ok) {
      logout()                                           // this browser's old session is dead on the server too; drop it locally
      setPassword(''); setConfirm('')
      setStage('done')
    } else if (result.reason === 'invalid_token') {
      setStage('expired')
    } else if (result.reason === 'weak_password') {
      setError(result.message)
    } else {
      setError(failureMessage(result.reason))
    }
  }

  return <ResetPasswordView stage={stage} password={password} confirm={confirm} onPasswordChange={setPassword} onConfirmChange={setConfirm} onSubmit={submit} error={error} loading={loading} />
}
