import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const css = readFileSync(join(__dirname, 'VideoStudioV2.css'), 'utf8')

describe('editor header on narrow phones', () => {
  it('stacks the stage title above the Light/Dark toggle below 520px so the absolutely positioned toggle cannot overlap the title', () => {
    const m = css.match(/@media \(max-width:520px\) \{([\s\S]*?)\n\}/)
    expect(m).not.toBeNull()
    const body = m![1].replace(/\s+/g, ' ')
    expect(body).toContain('.vsv2-header { flex-direction: column; gap: 10px; min-height: 0; }')
    expect(body).toContain('.vsv2-theme { position: static; }')
  })

  it('leaves the base (tablet and desktop) header rules exactly as they were: centred row with the toggle pinned right', () => {
    expect(css).toMatch(/\.vsv2-header\{position:relative;display:flex;align-items:center;justify-content:center;min-height:56px\}/)
    expect(css).toMatch(/\.vsv2-theme\{position:absolute;right:0;top:3px;/)
  })

  it('the narrow-phone block is the only place the header is restyled by a media query (no other breakpoint touches it)', () => {
    const rules = [...css.matchAll(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g)].map(x => x[0]).filter(r => /\.vsv2-header|\.vsv2-theme/.test(r))
    expect(rules).toHaveLength(1)
    expect(rules[0]).toContain('max-width:520px')
  })
})
