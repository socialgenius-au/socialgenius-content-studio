// Guards the "preserve the approved Login identity" requirement: Login.tsx's own style values are pinned to the approved snapshot, the new
// screens' shared styles must equal them, and the only change allowed in Login.tsx is the one plain text link.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { s as authStyles } from './authStyles'

const read = (rel: string) => readFileSync(join(process.cwd(), 'src', rel), 'utf8').replace(/\r\n/g, '\n')
const loginSource = read('components/Login.tsx')

// The approved values, copied from Login.tsx before this feature touched it.
const APPROVED = {
  page: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #1E3D2A 0%, #0f2016 100%)' },
  card: { background: '#F5F0E8', borderRadius: 16, padding: '52px 44px', width: '100%', maxWidth: 420, boxShadow: '0 24px 80px rgba(0,0,0,0.4)' },
  logoWrap: { textAlign: 'center', marginBottom: 36 },
  logoName: { margin: 0, color: '#1E3D2A', fontSize: 30, fontWeight: 800, letterSpacing: '-0.5px' },
  logoSub: { margin: '6px 0 0', color: '#C89A2E', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 3 },
  form: { display: 'flex', flexDirection: 'column', gap: 14 },
  input: { padding: '13px 16px', border: '2px solid #e0dbd0', borderRadius: 8, fontSize: 15, outline: 'none', background: '#fff', color: '#1a1a1a', transition: 'border-color 0.2s' },
  error: { margin: 0, color: '#c0392b', fontSize: 13 },
  btn: { marginTop: 6, padding: '14px', background: '#1E3D2A', color: '#F5F0E8', border: 'none', borderRadius: 8, fontSize: 15, fontWeight: 700, cursor: 'pointer', transition: 'background 0.2s' },
  hint: { marginTop: 24, textAlign: 'center', color: '#aaa', fontSize: 12 },
}

/** Evaluate Login.tsx's `const s: Record<string, CSSProperties> = { ... }` object literal. */
function loginStyles(): Record<string, Record<string, unknown>> {
  const start = loginSource.indexOf('const s: Record<string, CSSProperties> = {')
  expect(start).toBeGreaterThan(-1)
  const literal = loginSource.slice(loginSource.indexOf('{', start)).trimEnd()
  return new Function(`return (${literal})`)()
}

describe('Login.tsx visual identity', () => {
  it('every approved style value is unchanged', () => {
    const live = loginStyles()
    for (const [key, value] of Object.entries(APPROVED)) expect(live[key], key).toEqual(value)
  })

  it('the only addition is the plain text link: underlined, no outline, no border, no background', () => {
    const live = loginStyles()
    expect(Object.keys(live).sort()).toEqual([...Object.keys(APPROVED), 'forgot'].sort())
    const forgot = live.forgot
    expect(forgot.textDecoration).toBe('underline')
    for (const banned of ['outline', 'border', 'background', 'borderRadius', 'boxShadow']) expect(forgot, banned).not.toHaveProperty(banned)
    expect(loginSource).toMatch(/<Link to="\/forgot-password" style=\{s\.forgot\}>Forgot password\?<\/Link>/)
    expect(loginSource).not.toMatch(/dashed|outline:\s*['"]?2px/)
  })

  it('the markup structure is unchanged: same fields, same button, same hint, one added link after the form', () => {
    expect(loginSource).toContain('placeholder="Username"')
    expect(loginSource).toContain('placeholder="Password"')
    expect(loginSource).toContain("{loading ? 'Signing in…' : 'Sign In'}")
    expect(loginSource).toContain('</form>\n\n        <Link to="/forgot-password"')
    expect(loginSource).toContain('{import.meta.env.DEV && <p style={s.hint}>')
  })
})

describe('the new screens reuse those exact values', () => {
  it.each(Object.keys(APPROVED).filter((k) => k !== 'hint'))('%s', (key) => {
    expect((authStyles as Record<string, unknown>)[key]).toEqual((APPROVED as Record<string, unknown>)[key])
  })

  it('and add only what the approved mockups introduced', () => {
    const added = Object.keys(authStyles).filter((k) => !(k in APPROVED))
    expect(added.sort()).toEqual(['badge', 'body', 'btnFlush', 'btnLink', 'fieldWrap', 'inputWithToggle', 'link', 'note', 'title', 'toggle'])
    expect(authStyles.link.textDecoration).toBe('underline')
    for (const style of Object.values(authStyles)) expect(JSON.stringify(style)).not.toMatch(/dashed/)
  })
})
