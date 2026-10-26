// Routing regression: the old video-editor URLs must lead to the approved Video Studio V2, and nothing in the app may link to the legacy editor
// as if it were "the" Video Studio. Route objects are inspected with react-router's own matchRoutes; where behaviour lives in JSX that cannot be
// rendered in this DOM-less test environment (App.tsx, Login.tsx), the source is checked structurally instead.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { isValidElement } from 'react'
import { describe, expect, it } from 'vitest'
import { Navigate, createRoutesFromElements, matchRoutes } from 'react-router-dom'
import { LEGACY_STUDIO_REDIRECT_PATHS, LEGACY_STUDIO_ROUTE, VIDEO_STUDIO_ROUTE } from '../config/studioRoutes'
import { NAV_GROUPS, resolveNavPath } from '../config/navigation'
import { legacyStudioRedirectRoutes } from './studioRedirects'

const SRC = join(process.cwd(), 'src')
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8').replace(/\r\n/g, '\n')
const appSource = read('App.tsx')

describe('the route constants', () => {
  it('name Video Studio V2 as the editor and keep the legacy editor on an explicit legacy path', () => {
    expect(VIDEO_STUDIO_ROUTE).toBe('/video-studio-v2')
    expect(LEGACY_STUDIO_ROUTE).toBe('/legacy/studio')
    expect([...LEGACY_STUDIO_REDIRECT_PATHS]).toEqual(['/studio', '/clients/:clientId/studio'])
    expect(LEGACY_STUDIO_ROUTE).not.toBe(VIDEO_STUDIO_ROUTE)
  })
})

describe('/studio and /clients/:clientId/studio redirect to Video Studio V2', () => {
  const routes = createRoutesFromElements(legacyStudioRedirectRoutes)

  it.each(['/studio', '/studio/', '/clients/abc-motors/studio', '/clients/42/studio/'])('%s matches a redirect route', pathname => {
    const matches = matchRoutes(routes, pathname)
    expect(matches, pathname).not.toBeNull()
    const element = matches![0].route.element
    expect(isValidElement(element)).toBe(true)
    if (!isValidElement(element)) return
    expect(element.type).toBe(Navigate)
    expect((element.props as { to: string }).to).toBe('/video-studio-v2')
    expect((element.props as { replace?: boolean }).replace).toBe(true)      // replace: the Back button must not bounce through the old URL
  })

  it('does not capture Video Studio V2 itself, the legacy path, or look-alike URLs', () => {
    for (const p of ['/video-studio-v2', '/legacy/studio', '/studios', '/clients/abc/studio/extra', '/post-creator-v2']) {
      expect(matchRoutes(routes, p), p).toBeNull()
    }
  })
})

describe('App.tsx route table', () => {
  const pathBefore = (idx: number) => {
    let last: string | undefined
    for (const m of appSource.slice(0, idx).matchAll(/path=(?:"([^"]+)"|\{([A-Za-z_]+)\})/g)) last = m[1] ?? (m[2] === 'LEGACY_STUDIO_ROUTE' ? LEGACY_STUDIO_ROUTE : m[2])
    return last
  }

  it('renders the legacy StudioPage ONLY at the explicit legacy path', () => {
    const uses = [...appSource.matchAll(/<StudioPage\b/g)].map(m => pathBefore(m.index!))
    expect(uses.length).toBeGreaterThan(0)                                     // the old component is preserved and still routed
    for (const p of uses) expect(p).toBe(LEGACY_STUDIO_ROUTE)
  })

  it('no longer declares /studio or /clients/:clientId/studio itself — the redirect routes own them', () => {
    expect(appSource).not.toMatch(/path="\/studio"/)
    expect(appSource).not.toMatch(/path="\/clients\/:clientId\/studio"/)
    expect(appSource).toContain('{legacyStudioRedirectRoutes}')
  })

  it('/video-studio-v2 still loads VideoStudioV2, behind login', () => {
    const at = appSource.indexOf('path="/video-studio-v2"')
    expect(at).toBeGreaterThan(-1)
    const block = appSource.slice(at, at + 400)
    expect(block).toContain('<RequireAuth>')
    expect(block).toContain('<VideoStudioV2 />')
    expect(block).not.toContain('StudioPage')
    expect(appSource).toContain("lazy(() => import('./pages/video-studio-v2/VideoStudioV2'))")
  })

  it('keeps the other full-screen/legacy routes it had', () => {
    for (const p of ['/post-creator-v2', '/positioning', '/legacy/jobs-dashboard', '/dashboard']) expect(appSource, p).toContain(`path="${p}"`)
  })

  it('the preserved legacy editor component is still on disk', () => {
    expect(existsSync(join(SRC, 'components/studio/StudioPage.tsx'))).toBe(true)
    expect(appSource).toContain("import StudioPage from './components/studio/StudioPage'")
  })
})

describe('navigation and login point at Video Studio V2', () => {
  const items = NAV_GROUPS.flatMap(g => g.items)

  it('the sidebar "Video Studio" item opens /video-studio-v2 for every user, with or without an active client', () => {
    const studio = items.find(i => i.id === 'studio')!
    expect(studio.label).toBe('Video Studio')
    expect(studio.path).toBe('/video-studio-v2')
    expect(studio.clientScoped).toBe(false)
    expect(resolveNavPath(studio, 'abc-motors')).toBe('/video-studio-v2')
    expect(resolveNavPath(studio, null)).toBe('/video-studio-v2')
    expect(studio.roles).toEqual(['admin', 'content_creator'])                 // visibility unchanged
  })

  it('no navigation item points at a legacy editor URL', () => {
    for (const i of items) expect(i.path, i.id).not.toMatch(/(^|\/)studio$/)
  })

  it('after login the user is sent to Video Studio V2, not /studio', () => {
    const login = read('components/Login.tsx')
    expect(login).toContain('navigate(VIDEO_STUDIO_ROUTE)')
    expect(login).not.toMatch(/navigate\(\s*['"`]\/studio/)
  })

  it('Create Hub "Send to Video Studio" opens Video Studio V2', () => {
    const hub = read('pages/CreateHubPage.tsx')
    expect(hub).toContain('navigate(VIDEO_STUDIO_ROUTE)')
    expect(hub).toContain('Send to Video Studio')
  })
})

describe('repo-wide guard: no code links to the legacy editor URLs', () => {
  const files: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push(full)
    }
  }
  walk(SRC)

  it('only config/studioRoutes.ts may contain a quoted /studio or /clients/.../studio route', () => {
    const offenders: string[] = []
    for (const f of files) {
      const rel = relative(SRC, f).split(sep).join('/')
      if (rel === 'config/studioRoutes.ts') continue
      // code only: comments may legitimately mention the legacy /studio (e.g. "Legacy `/studio` Platform keys")
      const text = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
      if (/["'`]\/studio["'`/?]/.test(text) || /["'`]\/clients\/[^"'`\n]*\/studio["'`/?]/.test(text)) offenders.push(rel)
    }
    expect(offenders).toEqual([])
  })
})
