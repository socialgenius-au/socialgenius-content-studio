// The login page must not advertise the dev-seeded credentials in a production build. Behaviour lives in JSX that cannot be rendered in this
// DOM-less test environment, so the source is checked structurally (same approach as routes/studioRouting.test.tsx).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const login = readFileSync(join(process.cwd(), 'src/components/Login.tsx'), 'utf8').replace(/\r\n/g, '\n')

describe('Login page credential hint', () => {
  it('is rendered only under import.meta.env.DEV (stripped from production builds)', () => {
    const lines = login.split('\n').filter(l => /username123/.test(l))
    expect(lines.length).toBe(1)
    expect(lines[0]).toMatch(/import\.meta\.env\.DEV\s*&&/)
  })
})
