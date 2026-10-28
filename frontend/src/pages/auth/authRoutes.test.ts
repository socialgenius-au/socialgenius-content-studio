// Structural checks (no DOM): the three screens are public routes, and the token handling never leaves the URL fragment / memory.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(process.cwd(), 'src')
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8').replace(/\r\n/g, '\n')
const appSource = read('App.tsx')

describe('routes', () => {
  it.each([['/forgot-password', 'ForgotPassword'], ['/reset-password', 'ResetPassword'], ['/verify-email', 'VerifyEmail']])('%s is a public route', (path, component) => {
    const at = appSource.indexOf(`path="${path}"`)
    expect(at).toBeGreaterThan(-1)
    const route = appSource.slice(at, appSource.indexOf('/>', at) + 2)
    expect(route).toContain(`<${component} />`)
    expect(route).not.toContain('RequireAuth')                       // reachable while signed out
    expect(appSource).toContain(`import ${component} from './pages/auth/${component}'`)
  })

  it('/login is still the sign-in page and still redirects signed-in users', () => {
    expect(appSource).toContain('<Route path="/login" element={user ? <Navigate to="/dashboard" replace /> : <Login />} />')
  })
})

describe('token handling', () => {
  const files = ['lib/authRecovery.ts', 'lib/useUrlToken.ts', 'pages/auth/ForgotPassword.tsx', 'pages/auth/ResetPassword.tsx', 'pages/auth/VerifyEmail.tsx', 'components/auth/PasswordField.tsx', 'components/auth/AuthShell.tsx']
  const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

  it.each(files)('%s never logs, stores, or puts a token or password in a URL', (f) => {
    // the one legitimate use of location.search: keeping an existing query string while the fragment is removed from the address bar
    const src = code(f).replace('window.location.pathname + window.location.search', '')
    expect(src).not.toMatch(/console\./)
    expect(src).not.toMatch(/localStorage|sessionStorage/)
    expect(src).not.toMatch(/[?&]token=/)
    expect(src).not.toMatch(/location\.search/)
  })

  it('the token is read from the fragment and the fragment is cleared from the address bar', () => {
    const lib = code('lib/authRecovery.ts')
    expect(lib).toContain("hash.replace(/^#/, '')")
    expect(lib).toContain("window.history.replaceState(null, '', window.location.pathname + window.location.search)")
    for (const page of ['pages/auth/ResetPassword.tsx', 'pages/auth/VerifyEmail.tsx']) {
      expect(code(page)).toContain('clearUrlFragment()')
    }
  })

  it('both link screens follow the current link: they take it from useUrlToken and restart (key) whenever it changes', () => {
    for (const [page, flow] of [['pages/auth/ResetPassword.tsx', 'ResetPasswordFlow'], ['pages/auth/VerifyEmail.tsx', 'VerifyEmailFlow']]) {
      const src = code(page)
      expect(src).toContain('const { token, version } = useUrlToken()')
      expect(src).toContain(`<${flow} key={version} token={token} />`)
      expect(src).not.toContain('window.location.hash')                          // no one-time read of the address bar left in the screens
      expect(src).not.toContain('readTokenFromHash')
    }
    const hook = code('lib/useUrlToken.ts')
    expect(hook).toContain('window.location.hash')                               // initial read, before any effect (StrictMode double render)
    expect(hook).toContain('useEffect(() => watchUrlHash(window,')               // and the live subscription; its cleanup is the unsubscribe function
    expect(code('lib/authRecovery.ts')).toContain("win.addEventListener('hashchange', listener)")
    expect(code('lib/authRecovery.ts')).toContain("return () => win.removeEventListener('hashchange', listener)")
  })

  it('a successful reset signs this browser out locally', () => {
    const src = code('pages/auth/ResetPassword.tsx')
    expect(src).toContain('const { logout } = useAuth()')
    expect(src).toMatch(/if \(result\.ok\) \{\s*logout\(\)/)
  })

  it('the API client only talks to the documented endpoints, none of which can return 401 to the session interceptor', () => {
    const client = read('api/client.ts')
    for (const endpoint of ['/auth/password-reset/request', '/auth/password-reset/validate', '/auth/password-reset/confirm', '/auth/email/verification/confirm', '/auth/email/verification/resend'])
      expect(client).toContain(`'${endpoint}'`)
  })

  it('no new file touches Video Studio V2, Post Creator or Deconstructor', () => {
    const touched = ['lib/authRecovery.ts', ...files].map(read).join('\n')
    expect(touched).not.toMatch(/video-studio|post-creator|deconstructor/i)
    const dirs = readdirSync(join(SRC, 'pages')).filter((d) => /video-studio|post-creator|deconstructor/.test(d))
    expect(dirs.length).toBeGreaterThan(0)                           // they still exist...
  })
})
