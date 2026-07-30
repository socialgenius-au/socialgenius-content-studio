import { useEffect, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useStudio } from '../../contexts/StudioContext'
import { useTheme, type ThemeMode } from '../../contexts/ThemeContext'
import { brandsApi } from '../../api/client'
import type { Brand } from '../../types'

const THEME_MODES: { key: ThemeMode; icon: string; label: string }[] = [
  { key: 'light', icon: '☀️', label: 'Light' },
  { key: 'dark', icon: '🌙', label: 'Dark' },
  { key: 'auto', icon: '🖥️', label: 'Auto' },
]

function ThemeToggle() {
  const { mode, setMode } = useTheme()
  return (
    <div style={s.themeToggle} role="radiogroup" aria-label="Theme">
      {THEME_MODES.map(t => (
        <button
          key={t.key}
          style={{ ...s.themeBtn, ...(mode === t.key ? s.themeBtnActive : {}) }}
          onClick={() => setMode(t.key)}
          title={t.label}
          aria-label={t.label}
          aria-pressed={mode === t.key}
          role="radio"
          aria-checked={mode === t.key}
        >
          {t.icon}
        </button>
      ))}
    </div>
  )
}

const BRAND_COLORS: Record<string, string> = {
  'SocialGenius': '#1E3D2A',
  'Apni Dukaan': '#8B2FC9',
  'Smplee Packaging': '#1A6B8A',
  'Faith: A Lived Reality': '#8B4513',
}

export default function TopBar() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const { activeBrand, brands, setBrands, setActiveBrand, uploadProgress } = useStudio()

  useEffect(() => {
    brandsApi.list().then(r => {
      const data = r.data as Brand[]
      setBrands(data)
      if (data.length && !activeBrand) setActiveBrand(data[0])
    }).catch(() => {})
  }, [])

  const handleLogout = () => { logout(); navigate('/login') }

  const brandColor = activeBrand
    ? (BRAND_COLORS[activeBrand.name] ?? '#1E3D2A')
    : '#1E3D2A'

  return (
    <header style={s.bar}>
      {/* Logo */}
      <div style={s.logo}>
        <span style={s.logoName}>SocialGenius</span>
        <span style={s.logoSub}>Content Studio</span>
      </div>

      {/* Brand selector */}
      <div style={s.brandSelectorWrap}>
        <span style={{ ...s.brandDot, background: brandColor }} />
        <select
          style={s.brandSelect}
          value={activeBrand?.id ?? ''}
          onChange={e => {
            const b = brands.find(b => b.id === Number(e.target.value))
            setActiveBrand(b ?? null)
          }}
        >
          <option value="">No brand</option>
          {brands.map(b => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
      </div>

      {/* Upload progress bar */}
      {uploadProgress !== null && (
        <div style={s.uploadBar}>
          <div style={{ ...s.uploadFill, width: `${uploadProgress}%` }} />
          <span style={s.uploadLabel}>Uploading {uploadProgress}%</span>
        </div>
      )}

      <div style={{ flex: 1 }} />

      <ThemeToggle />

      {/* Actions */}
      <div style={s.actions}>
        <button style={s.saveBtn} onClick={() => alert('Draft saved')}>
          Save Draft
        </button>
        <div style={s.userBadge}>
          <span style={s.avatar}>{user?.username?.[0]?.toUpperCase()}</span>
          <span style={s.userName}>{user?.username}</span>
        </div>
        <button style={s.signOut} onClick={handleLogout}>Sign out</button>
      </div>
    </header>
  )
}

const s: Record<string, CSSProperties> = {
  bar: {
    height: 56,
    background: 'var(--brand-header)',
    display: 'flex',
    alignItems: 'center',
    padding: '0 var(--space-4)',
    gap: 'var(--space-4)',
    position: 'sticky',
    top: 0,
    zIndex: 200,
    boxShadow: '0 2px 12px rgba(0,0,0,0.35)',
    flexShrink: 0,
  },
  logo: { display: 'flex', flexDirection: 'column', lineHeight: 1.2, gap: 1, marginRight: 'var(--space-2)' },
  logoName: { color: 'var(--brand-header-text)', fontSize: 15, fontWeight: 800, letterSpacing: '-0.3px' },
  logoSub: { color: 'var(--brand-accent)', fontSize: 8, fontWeight: 700, letterSpacing: 2.5, textTransform: 'uppercase' },

  brandSelectorWrap: {
    display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
    background: 'rgba(255,255,255,0.1)', borderRadius: 8,
    padding: 'var(--space-1) var(--space-3)',
  },
  brandDot: { width: 10, height: 10, borderRadius: '50%', flexShrink: 0 },
  brandSelect: {
    background: 'transparent', border: 'none', color: 'var(--brand-header-text)',
    fontSize: 14, fontWeight: 600, cursor: 'pointer', outline: 'none',
    appearance: 'auto',
  },

  uploadBar: {
    position: 'relative', width: 140, height: 24, background: 'rgba(255,255,255,0.15)',
    borderRadius: 12, overflow: 'hidden', display: 'flex', alignItems: 'center',
  },
  uploadFill: {
    position: 'absolute', left: 0, top: 0, height: '100%',
    background: 'var(--brand-accent)', borderRadius: 12, transition: 'width 0.3s',
  },
  uploadLabel: {
    position: 'relative', zIndex: 1, fontSize: 11, fontWeight: 700,
    color: 'var(--brand-header)', width: '100%', textAlign: 'center',
  },

  themeToggle: {
    display: 'flex', alignItems: 'center', gap: 2,
    background: 'rgba(255,255,255,0.1)', borderRadius: 8, padding: 2,
  },
  themeBtn: {
    width: 28, height: 26, border: 'none', borderRadius: 6, background: 'transparent',
    fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
    opacity: 0.6, transition: 'all 0.15s',
  },
  themeBtnActive: { background: 'rgba(255,255,255,0.18)', opacity: 1 },

  actions: { display: 'flex', alignItems: 'center', gap: 'var(--space-3)' },
  saveBtn: {
    background: 'var(--brand-accent)', color: 'var(--brand-accent-text)', border: 'none',
    borderRadius: 6, padding: 'var(--space-2) var(--space-4)', fontSize: 13, fontWeight: 700,
    cursor: 'pointer',
  },
  userBadge: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)' },
  avatar: {
    width: 30, height: 30, borderRadius: '50%', background: 'rgba(200,154,46,0.3)',
    color: 'var(--brand-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 13, fontWeight: 800,
  },
  userName: { color: 'rgba(245,240,232,0.8)', fontSize: 13 },
  signOut: {
    background: 'transparent', border: '1px solid rgba(245,240,232,0.3)',
    color: 'rgba(245,240,232,0.7)', borderRadius: 6, padding: 'var(--space-1) var(--space-3)',
    fontSize: 12, cursor: 'pointer',
  },
}
