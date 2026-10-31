// M2.1b -- the preview-only text scale correction, pinned: the editor DRAWS canvas-pixel quantities at the canvas's displayed scale, and changes nothing else.
// (Behaviour in a real browser -- proportions at several window sizes, drag/resize/edit, save/reopen -- is covered by the browser test; this guards the code shape.)
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const src = readFileSync(join(__dirname, '..', 'components', 'CreateEditTab.tsx'), 'utf8')
const start = src.indexOf('const getTextRenderStyle = (t: TextOverlay): React.CSSProperties => {')
const end = src.indexOf('// Step 5 follow-up (Transitions)', start)
const fn = src.slice(start, end)

describe('getTextRenderStyle', () => {
  it('derives the scale from the fitted canvas box and the real canvas width (the zoom readout), guarding a zero width', () => {
    expect(start).toBeGreaterThan(0); expect(end).toBeGreaterThan(start)
    expect(fn).toContain('const k = rawW > 0 ? canvasBox.w / rawW : 1;')
  })
  it('scales every pixel quantity by k: font size, letter spacing, stroke, shadow offsets and blur, padding, radius, border', () => {
    for (const s of ['fontSize: t.fontSize * k', '`${t.letterSpacing * k}px`', '`${t.strokeWidth * k}px', '(t.shadowOffsetX ?? 0) * k', '(t.shadowOffsetY ?? 0) * k', 'Math.max(0, t.shadowBlur ?? 0) * k',
      '`${(t.bgPadding ?? 2) * k}px ${((t.bgPadding ?? 2) + 4) * k}px`', 'borderRadius: (t.bgBorderRadius ?? 3) * k', '`${t.bgBorderWidth * k}px solid']) expect(fn, s).toContain(s)
  })
  it('never scales percentages or ratios (position, width, opacity, line spacing) and never writes to the project', () => {
    for (const s of ['left: `${t.x}%`, top: `${t.y}%`, width: `${t.width}%`', 'lineHeight: t.lineSpacing ?? undefined', 'opacity: t.opacity ?? 1']) expect(fn, s).toContain(s)
    expect(fn).not.toMatch(/updateTextOverlay|rawUpdateTextOverlay|setTextOverlays/)
    expect(fn).not.toMatch(/(left|top|width|lineHeight|opacity)[^\n]*\* k/)
  })
  it('keeps the unscaled editor behaviour out: no leftover raw pixel value in the scaled properties', () => {
    for (const bad of ['fontSize: t.fontSize,', '`${t.letterSpacing}px`', '`${t.strokeWidth}px', 'borderRadius: t.bgBorderRadius ?? 3', '`${t.bgBorderWidth}px solid']) expect(fn, bad).not.toContain(bad)
  })
})

describe('what the correction must not touch', () => {
  it('drag and resize still work in percent / measured DOM size (scale-invariant)', () => {
    expect(src).toContain('const dxPct = ((e.clientX - s.startClientX) / s.boxW) * 100;')
    expect(src).toContain('rawUpdateTextOverlay(s.id, { x: nextX, width: Math.max(MIN_ELEMENT_SIZE_PCT, nextWidth) });')
    expect(src).toContain('rawUpdateTextOverlay(s.id, { x: nextX, y: nextY });')
  })
  it('the Properties font-size control still edits the stored value, and subtitles carry their own correction (lower thirds are sized from their own box)', () => {
    expect(src).toContain('onChange={e => updateTextOverlay(selectedText.id, { fontSize: Number(e.target.value) })}')
    expect(src).toContain('fontSize: style.fontSize * subtitleScale, textAlign: style.align,')                  // M2.2b: subtitles now have their own correction (subtitlePreviewScale.wiring.test.ts)
  })
  it('the export request is built from stored values with no scale', () => {
    const review = readFileSync(join(__dirname, '..', 'components', 'ReviewTab.tsx'), 'utf8')
    expect(review).toContain('text_overlays: buildExportTextOverlays(textOverlays),')
    expect(review).not.toMatch(/buildExportTextOverlays\(textOverlays,/)
  })
})
