import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { MemoryRouter } from 'react-router-dom'
import { matchesNarrow, NARROW_QUERY } from '@/hooks/useNarrowViewport'

vi.mock('@/contexts/ClientContext', () => ({ useClient: () => ({ client: null }) }))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { username: 'tester', role: 'admin' } }) }))

const store: Record<string, string> = {}
vi.stubGlobal('localStorage', { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v }, removeItem: (k: string) => { delete store[k] } })

import { Sidebar } from './Sidebar'

const html = (props: Parameters<typeof Sidebar>[0]) => renderToStaticMarkup(<MemoryRouter><Sidebar {...props} /></MemoryRouter>)

describe('app shell navigation on small screens', () => {
  it('on a narrow screen the navigation is closed by default, so the page gets the whole width', () => {
    expect(html({ narrow: true, open: false })).toBe('')
  })

  it('on a narrow screen an opened navigation is a drawer over the page with a backdrop and a close button, never a permanent column', () => {
    const h = html({ narrow: true, open: true, onClose: () => undefined })
    expect(h).toContain('aria-label="Main navigation"')
    expect(h).toContain('data-testid="nav-backdrop"')
    expect(h).toContain('aria-label="Close navigation"')
    expect(h).toMatch(/fixed inset-y-0 left-0 z-50 w-60/)
    expect(h).toContain('max-w-[85vw]')
    expect(h).toContain('Dashboard')                                   // the full labels, not the icon rail
    expect(h).not.toContain('Collapse')                                // the desktop rail toggle is not offered inside the drawer
  })

  it('a stored "collapsed" preference from desktop does not turn the phone drawer into an unlabelled icon rail', () => {
    store['sg.sidebarCollapsed'] = '1'
    expect(html({ narrow: true, open: true })).toContain('Dashboard')
    delete store['sg.sidebarCollapsed']
  })

  it('on desktop nothing changes: a permanent 240px column with the Collapse control and no backdrop', () => {
    const h = html({})
    expect(h).toContain('w-60')
    expect(h).toContain('Collapse')
    expect(h).toContain('Dashboard')
    expect(h).not.toContain('nav-backdrop')
    expect(h).not.toContain('fixed inset-y-0')
    expect(h).not.toContain('Close navigation')
  })

  it('on desktop the saved icon-rail preference still applies', () => {
    store['sg.sidebarCollapsed'] = '1'
    const h = html({})
    expect(h).toContain('w-[60px]')
    expect(h).not.toContain('>Dashboard<')
    delete store['sg.sidebarCollapsed']
  })
})

describe('narrow viewport detection', () => {
  it('uses the md breakpoint (under 768px) and fails safe to the desktop layout when matchMedia is unavailable', () => {
    expect(NARROW_QUERY).toBe('(max-width: 767px)')
    expect(matchesNarrow({ matchMedia: (q: string) => ({ matches: q === NARROW_QUERY }) } as unknown as Window)).toBe(true)
    expect(matchesNarrow({ matchMedia: () => ({ matches: false }) } as unknown as Window)).toBe(false)
    expect(matchesNarrow({} as unknown as Window)).toBe(false)
    expect(matchesNarrow(undefined)).toBe(false)
  })
})

describe('wiring', () => {
  const app = readFileSync(new URL('./AppShell.tsx', import.meta.url), 'utf8')
  const top = readFileSync(new URL('./TopBar.tsx', import.meta.url), 'utf8')
  it('the shell passes the narrow state to the navigation and a menu button to the top bar, and closes the drawer on navigation', () => {
    expect(app).toContain('useNarrowViewport()')
    expect(app).toContain('<Sidebar narrow={narrow} open={navOpen}')
    expect(app).toContain('<TopBar showMenuButton={narrow} onOpenMenu')
    expect(app).toMatch(/useEffect\(\(\) => \{ setNavOpen\(false\) \}, \[pathname, narrow\]\)/)
    expect(app).toContain('p-4 sm:p-6')                                   // less padding on phones
  })
  it('the top bar has an Open navigation button only when asked, and hides the breadcrumbs below the lg breakpoint so the header fits', () => {
    expect(top).toContain('aria-label="Open navigation"')
    expect(top).toContain('{showMenuButton && (')
    expect(top).toContain('<div className="hidden lg:block"><Breadcrumbs /></div>')
    expect(top).toContain('<span className="hidden lg:inline">AI Companion</span>')       // icon-only below lg, so the header fits a 768px tablet
    expect(top).toContain('className="h-8 w-36 pl-8 lg:w-48"')
    expect((top.match(/shrink-0/g) ?? []).length).toBeGreaterThanOrEqual(5)             // the icon buttons keep their tap size instead of being squashed
  })
})
