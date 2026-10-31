// M2.2b -- the preview-only subtitle scale correction, pinned: a subtitle's pixel quantities are drawn at the canvas's displayed scale, and nothing else changes.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const src = readFileSync(join(__dirname, '..', 'components', 'CreateEditTab.tsx'), 'utf8')
const start = src.indexOf('const subtitleScale = rawW > 0 ? canvasBox.w / rawW : 1;')
const end = src.indexOf('const visualLayers = [', start)
const block = src.slice(start, end)

describe('subtitle preview scale', () => {
  it('derives the displayed scale from the fitted canvas box and the real canvas width, guarding a zero width', () => {
    expect(start).toBeGreaterThan(0); expect(end).toBeGreaterThan(start)
  })
  it('scales font size, padding, corner radius, outline width and shadow blur', () => {
    for (const s of ['fontSize: style.fontSize * subtitleScale', '`${4 * subtitleScale}px ${10 * subtitleScale}px`', 'borderRadius: 4 * subtitleScale', '`${style.outlineWidth * subtitleScale}px', '`0px 0px ${style.shadowBlur * subtitleScale}px']) expect(block, s).toContain(s)
  })
  it('never scales percentages, colours, alignment or the saved data, and keeps the existing drag and resize hooks', () => {
    for (const s of ['left: `${s.x}%`, top: `${s.y}%`, width: `${s.width}%`', 'textAlign: style.align', 'composeTextBgColor(style.bgColor, style.bgOpacity)', 'onMouseDown={beginSubtitleDrag(s.id)}', 'beginSubtitleResize(s.id, corner)']) expect(block, s).toContain(s)
    expect(block).not.toMatch(/updateSubtitle|rawUpdateSubtitle|setSubtitles/); for (const bad of ['${s.x * subtitleScale', '${s.y * subtitleScale', '${s.width * subtitleScale', 'style.color * subtitleScale', 'composeTextBgColor(style.bgColor, style.bgOpacity * subtitleScale']) expect(block, bad).not.toContain(bad)
  })
  it('the export request is built from stored values with no scale', () => {
    expect(readFileSync(join(__dirname, '..', 'components', 'ReviewTab.tsx'), 'utf8')).toContain('subtitles: buildExportSubtitles(subtitles),')
  })
})
