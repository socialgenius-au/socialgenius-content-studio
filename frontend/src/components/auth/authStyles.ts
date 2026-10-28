import type { CSSProperties } from 'react'

// Visual identity of the sign-in family. The first block is a verbatim copy of the style object in components/Login.tsx (the approved look);
// authStyles.parity.test.ts fails if any of these values ever drift from Login's. The second block holds the few elements the new screens add:
// a heading, a line of body text, a text link, a round badge, a hint line, and the Show/Hide control.
export const s: Record<string, CSSProperties> = {
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

  // ── additions for the Forgot Password screens ──
  title: { margin: '0 0 8px', color: '#1E3D2A', fontSize: 22, fontWeight: 800, letterSpacing: '-0.3px', textAlign: 'center' },
  body: { margin: '0 0 22px', color: '#555', fontSize: 14, lineHeight: 1.55, textAlign: 'center' },
  note: { margin: 0, color: '#888', fontSize: 12.5 },
  link: { display: 'block', marginTop: 18, textAlign: 'center', color: '#1E3D2A', fontSize: 13, fontWeight: 600, textDecoration: 'underline', cursor: 'pointer' },
  badge: {
    width: 52, height: 52, borderRadius: '50%', background: '#1E3D2A', color: '#F5F0E8',
    display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 18px', fontSize: 26, fontWeight: 700,
  },
  // A button that is really a navigation link: same look as `btn`, without the top margin used inside forms.
  btnLink: {
    display: 'block', boxSizing: 'border-box', width: '100%', textAlign: 'center', textDecoration: 'none',
    padding: '14px', background: '#1E3D2A', color: '#F5F0E8', border: 'none', borderRadius: 8, fontSize: 15, fontWeight: 700, cursor: 'pointer',
  },
  btnFlush: { marginTop: 0 },
  fieldWrap: { position: 'relative' },
  inputWithToggle: { paddingRight: 68, width: '100%', boxSizing: 'border-box' },
  toggle: {
    position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none',
    color: '#1E3D2A', fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: '8px', fontFamily: 'inherit',
  },
}
