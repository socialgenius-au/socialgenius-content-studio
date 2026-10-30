// M2.2b -- the preview-only shape scale correction, pinned: border width and corner radius are drawn at the canvas's displayed scale, nothing else changes.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const src = readFileSync(join(__dirname, '..', 'components', 'CreateEditTab.tsx'), 'utf8')
const start = src.indexOf('const shapeScale = rawW > 0 ? canvasBox.w / rawW : 1;')
const end = src.indexOf('// Phase 5 (Video Studio V2 — Subtitles / Transcript) — Requirement (SUBTITLES AS REAL CANVAS', start)
const block = src.slice(start, end)

describe('shape preview scale', () => {
  it('derives the displayed scale from the fitted canvas box and the real canvas width, guarding a zero width', () => {
    expect(start).toBeGreaterThan(0); expect(end).toBeGreaterThan(start)
  })
  it('scales border width and corner radius, and nothing in the saved data', () => {
    expect(block).toContain('(sh.borderRadius ?? 0) * shapeScale'); expect(block).toContain('`${sh.borderWidth * shapeScale}px solid ${sh.borderColor ?? "#000000"}`')
    expect(block).not.toMatch(/updateShape|rawUpdateShape|setShapes/)
  })
  it('leaves position, size, fill, opacity, the circle rule and full width alone', () => {
    for (const s of ['left: `${sh.x}%`, top: `${sh.y}%`, width: `${sh.width}%`, height: `${sh.height}%`', 'background: composeHexAlpha(sh.fillColor, sh.opacity)', 'sh.kind === "circle" ? "50%"', '...(sh.fullWidth ? { left: "0%", width: "100%" } : {})']) expect(block, s).toContain(s)
    expect(block).not.toMatch(/(left|top|width|height|background)[^\n]*shapeScale/)
  })
})
