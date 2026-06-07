import type { ReactNode, CSSProperties } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export default function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const isActive = (path: string) => location.pathname === path

  return (
    <div style={s.root}>
      <nav style={s.nav}>
        <Link to="/dashboard" style={s.brand}>
          <span style={s.brandName}>SocialGenius</span>
          <span style={s.brandSub}>Content Studio</span>
        </Link>

        <div style={s.navLinks}>
          {([
            { to: '/dashboard', label: 'Dashboard' },
            { to: '/planner',   label: 'New Plan' },
          ]).map(({ to, label }) => (
            <Link key={to} to={to} style={{ ...s.navLink, ...(isActive(to) ? s.navLinkActive : {}) }}>
              {label}
            </Link>
          ))}
        </div>

        <div style={s.navRight}>
          <span style={s.badge}>{user?.username}</span>
          <button onClick={handleLogout} style={s.logoutBtn}>Sign out</button>
        </div>
      </nav>
      <main style={s.main}>{children}</main>
    </div>
  )
}

const s: Record<string, CSSProperties> = {
  root: { minHeight: '100vh', background: '#F5F0E8', fontFamily: "'Inter', system-ui, sans-serif" },
  nav: {
    display: 'flex',
    alignItems: 'center',
    background: '#1E3D2A',
    padding: '0 32px',
    height: 64,
    gap: 24,
    position: 'sticky',
    top: 0,
    zIndex: 100,
    boxShadow: '0 2px 12px rgba(0,0,0,0.25)',
  },
  brand: { display: 'flex', flexDirection: 'column', textDecoration: 'none', lineHeight: 1.2, gap: 1 },
  brandName: { color: '#F5F0E8', fontSize: 17, fontWeight: 800, letterSpacing: '-0.3px' },
  brandSub: { color: '#C89A2E', fontSize: 9, fontWeight: 700, letterSpacing: 2.5, textTransform: 'uppercase' },
  navLinks: { display: 'flex', gap: 4, flex: 1, marginLeft: 12 },
  navLink: {
    color: 'rgba(245,240,232,0.7)',
    textDecoration: 'none',
    padding: '8px 14px',
    borderRadius: 6,
    fontSize: 14,
    fontWeight: 500,
    transition: 'all 0.15s',
  },
  navLinkActive: { color: '#F5F0E8', background: 'rgba(245,240,232,0.1)' },
  navRight: { display: 'flex', alignItems: 'center', gap: 10, marginLeft: 'auto' },
  badge: {
    background: '#C89A2E',
    color: '#1E3D2A',
    padding: '4px 12px',
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 800,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  logoutBtn: {
    background: 'transparent',
    border: '1px solid rgba(245,240,232,0.35)',
    color: 'rgba(245,240,232,0.8)',
    padding: '6px 14px',
    borderRadius: 6,
    fontSize: 13,
    cursor: 'pointer',
    transition: 'all 0.15s',
  },
  main: { padding: '36px 32px', maxWidth: 1200, margin: '0 auto' },
}
