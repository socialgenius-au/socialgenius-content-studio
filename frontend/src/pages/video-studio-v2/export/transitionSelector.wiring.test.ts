// D3 -- the editor's Transition selector shows a stored value it has no option for (dissolve, whip pan, zoom punch) as itself, and only an explicit pick changes it.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const src = readFileSync(join(__dirname, '..', 'components', 'CreateEditTab.tsx'), 'utf8')
const start = src.indexOf('<label className="stack-field"><span>Transition</span>')
const end = src.indexOf('Step 7 (Original Video Audio controls)', start)
const block = src.slice(start, end)

describe('transition selector', () => {
  it('finds the selector block', () => { expect(start).toBeGreaterThan(0); expect(end).toBeGreaterThan(start) })
  it('shows the stored value: None and Fade stay as they were; any other stored type gets its own selected option, labelled as exported-only', () => {
    expect(block).toContain('selectedClip.transition !== "cut" && selectedClip.transition !== "fade_black" && (')
    expect(block).toContain('{{ dissolve: "Dissolve", whip_pan: "Whip pan", zoom_punch: "Zoom punch" }[selectedClip.transition]} (exported, not previewed)')
    expect(block).toContain('<option value="cut">None</option><option value="fade_black">Fade</option>')
  })
  it('changes the clip only from an explicit pick: the single write is the select\'s onChange, nothing runs on render, focus or blur', () => {
    expect((block.match(/updateVideoClip\(/g) ?? []).length).toBe(2)           // the type select's onChange and the duration select's onChange, as before
    expect(block).not.toMatch(/onFocus|onBlur|onClick|useEffect/)
    expect(block).toContain('onChange={e => updateVideoClip(selectedClip.id, { transition: e.target.value as VideoClip["transition"] })}')
  })
  it('shows the duration for any non-cut type, not only Fade', () => {
    expect(block).toContain('{selectedClip.transition !== "cut" && (')
    expect(block).not.toContain('selectedClip.transition === "fade_black" && (')
  })
  it('the export request still sends the stored value', () => {
    expect(readFileSync(join(__dirname, '..', 'components', 'ReviewTab.tsx'), 'utf8')).toContain('transition: c.transition, transition_duration: c.transitionDuration,')
  })
})
