import { useState, type FormEvent, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(username, password)
      navigate('/studio')
    } catch {
      setError('Invalid username or password')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={s.page}>
      <div style={s.card}>
        <div style={s.logoWrap}>
          <h1 style={s.logoName}>SocialGenius</h1>
          <p style={s.logoSub}>Content Studio</p>
        </div>

        <form onSubmit={handleSubmit} style={s.form}>
          <input
            style={s.input}
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            autoFocus
            autoComplete="username"
          />
          <input
            style={s.input}
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
          {error && <p style={s.error}>{error}</p>}
          <button style={{ ...s.btn, opacity: loading ? 0.7 : 1 }} type="submit" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <p style={s.hint}>ayub · priya · iqra  /  username + username123</p>
      </div>
    </div>
  )
}

const s: Record<string, CSSProperties> = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(135deg, #1E3D2A 0%, #0f2016 100%)',
  },
  card: {
    background: '#F5F0E8',
    borderRadius: 16,
    padding: '52px 44px',
    width: '100%',
    maxWidth: 420,
    boxShadow: '0 24px 80px rgba(0,0,0,0.4)',
  },
  logoWrap: { textAlign: 'center', marginBottom: 36 },
  logoName: { margin: 0, color: '#1E3D2A', fontSize: 30, fontWeight: 800, letterSpacing: '-0.5px' },
  logoSub: { margin: '6px 0 0', color: '#C89A2E', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 3 },
  form: { display: 'flex', flexDirection: 'column', gap: 14 },
  input: {
    padding: '13px 16px',
    border: '2px solid #e0dbd0',
    borderRadius: 8,
    fontSize: 15,
    outline: 'none',
    background: '#fff',
    color: '#1a1a1a',
    transition: 'border-color 0.2s',
  },
  error: { margin: 0, color: '#c0392b', fontSize: 13 },
  btn: {
    marginTop: 6,
    padding: '14px',
    background: '#1E3D2A',
    color: '#F5F0E8',
    border: 'none',
    borderRadius: 8,
    fontSize: 15,
    fontWeight: 700,
    cursor: 'pointer',
    transition: 'background 0.2s',
  },
  hint: { marginTop: 24, textAlign: 'center', color: '#aaa', fontSize: 12 },
}
