import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EDITOR_DEFAULT_CANVAS_FORMAT, EDITOR_DEFAULT_SUBTITLE_STYLE } from './projectDefaults'

const studio = readFileSync(join(__dirname, '../../../contexts/StudioContext.tsx'), 'utf8').replace(/\r\n/g, '\n')

/** The object literal assigned to `const <name>` in StudioContext, evaluated. */
function literal(name: string): unknown {
  const start = studio.indexOf(`const ${name}`)
  expect(start, `${name} not found in StudioContext`).toBeGreaterThan(-1)
  const open = studio.indexOf('{', studio.indexOf('=', start))
  const close = studio.indexOf('\n}', open)
  return new Function(`return (${studio.slice(open, close + 2)})`)()
}

describe('the editor\'s own starting values, mirrored for the reconstruction hand-off', () => {
  it('equal StudioContext\'s (that file is protected; this fails if either side changes)', () => {
    expect(EDITOR_DEFAULT_CANVAS_FORMAT).toEqual(literal('DEFAULT_CANVAS_FORMAT'))
    expect(EDITOR_DEFAULT_SUBTITLE_STYLE).toEqual(literal('DEFAULT_SUBTITLE_STYLE'))
  })
})

describe('the ABC Tiles demo canvas is hidden for a blueprint draft only', () => {
  const css = readFileSync(join(__dirname, 'blueprintCanvas.css'), 'utf8')
  const panel = readFileSync(join(__dirname, 'BlueprintPlanPanel.tsx'), 'utf8').replace(/\r\n/g, '\n')
  it('the stylesheet hides exactly the five demo elements, only inside the no-footage preview and only while the attribute is set', () => {
    for (const c of ['preview-brand', 'preview-copy', 'preview-badge', 'preview-icons', 'preview-cta']) expect(css).toContain(`html[data-sg-blueprint-draft] .video-preview:not(.real) .${c}`)
    expect(css).toMatch(/display:\s*none/)
    expect(css).not.toMatch(/canvas-text-item|real-video-el|canvas-shape-item/)       // never footage, text layers or shapes
  })
  it('the panel sets the attribute only while a blueprint plan is active and removes it afterwards', () => {
    expect(panel).toContain("import './blueprintCanvas.css'")
    expect(panel).toContain("document.documentElement.setAttribute('data-sg-blueprint-draft', '')")
    expect(panel).toContain("return () => document.documentElement.removeAttribute('data-sg-blueprint-draft')")
    expect(panel).toMatch(/if \(!active\) return/)
  })
})
