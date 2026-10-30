// M2.1b -- the export mapper: compatibility with what the export button sent before, every supported property, and the CSS-vs-renderer translations.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import fixture from '../../deconstructor/textlayers/__fixtures__/textlayers.draft.parts.json'
import type { TextOverlay } from '../../../types'
import { EDITOR_DEFAULT_PADDING, buildExportTextOverlay, buildExportTextOverlays } from './textOverlayExport'

const base = (over: Partial<TextOverlay> = {}): TextOverlay => ({
  id: 't', text: 'Hello world', x: 12, y: 34, width: 60, startTime: 1, endTime: 5, fontFamily: 'Inter', fontSize: 48, bold: false, italic: false,
  color: '#ffffff', bgColor: 'transparent', bgOpacity: 0, animation: 'none', ...over,
})

describe('compatibility with the previous export request', () => {
  it('keeps the seven fields the old request carried, with the same values', () => {
    const t = base({ order: 3 })
    const m = buildExportTextOverlay(t)
    expect({ text: m.text, start_time: m.start_time, end_time: m.end_time, x: m.x, y: m.y, font_size: m.font_size, color: m.color, order: m.order })
      .toEqual({ text: 'Hello world', start_time: 1, end_time: 5, x: 12, y: 34, font_size: 48, color: '#ffffff', order: 3 })
  })
  it('defaults order to 0 like before', () => { expect(buildExportTextOverlay(base()).order).toBe(0) })
  it('adds no chip, stroke, shadow or gradient to a plain overlay (nothing new is drawn that the editor does not draw)', () => {
    const m = buildExportTextOverlay(base())
    for (const k of ['bg_color', 'bg_opacity', 'stroke_color', 'stroke_width', 'shadow_color', 'shadow_blur', 'gradient_from', 'gradient_to', 'bg_border_color'] as const) expect(m, k).not.toHaveProperty(k)
    expect(m.use_gradient).toBe(false)
  })
  it('uses the editor’s own box model (padding 2 vertically, 6 horizontally by default) so text sits and wraps where it does in the editor', () => {
    const m = buildExportTextOverlay(base())
    expect([m.bg_padding, m.bg_padding_x]).toEqual([EDITOR_DEFAULT_PADDING, EDITOR_DEFAULT_PADDING + 4])
    expect(EDITOR_DEFAULT_PADDING).toBe(2)
  })
  it('every M2.1a reconstruction layer maps with no chip and no stroke, at its own width', () => {
    const layers = (fixture.textOverlays as unknown as TextOverlay[])
    const out = buildExportTextOverlays(layers)
    expect(out).toHaveLength(layers.length)
    out.forEach((m, i) => {
      expect(m).not.toHaveProperty('bg_color'); expect(m).not.toHaveProperty('stroke_width'); expect(m.width_pct).toBe(layers[i].width)
      expect(m.x).toBe(layers[i].x); expect(m.font_size).toBe(Math.round(layers[i].fontSize)); expect(m.bg_padding).toBe(2)
    })
  })
})

describe('width, wrapping and alignment', () => {
  it('sends the box width so the exporter wraps where the editor does (it used to default to 90 %)', () => {
    expect(buildExportTextOverlay(base({ width: 40 })).width_pct).toBe(40)
    expect(buildExportTextOverlay(base({ width: 250 })).width_pct).toBe(100)
    expect(buildExportTextOverlay(base({ width: 0 }))).not.toHaveProperty('width_pct')
  })
  it('alignment follows the editor: left by default, centre for a full-width banner, and an explicit choice wins', () => {
    expect(buildExportTextOverlay(base()).align).toBe('left')
    expect(buildExportTextOverlay(base({ bgFullWidth: true })).align).toBe('center')
    expect(buildExportTextOverlay(base({ align: 'right', bgFullWidth: true })).align).toBe('right')
    expect(buildExportTextOverlay(base({ align: 'justify' as never })).align).toBe('left')
  })
  it('line spacing defaults to the editor’s 1.15', () => {
    expect(buildExportTextOverlay(base()).line_spacing).toBe(1.15)
    expect(buildExportTextOverlay(base({ lineSpacing: 1.6 })).line_spacing).toBe(1.6)
  })
})

describe('type styling', () => {
  it('carries bold, underline, letter spacing and opacity', () => {
    const m = buildExportTextOverlay(base({ bold: true, underline: true, letterSpacing: 3, opacity: 0.4 }))
    expect([m.bold, m.underline, m.letter_spacing, m.opacity]).toEqual([true, true, 3, 0.4])
  })
  it('clamps opacity into 0..1 and ignores junk', () => {
    expect(buildExportTextOverlay(base({ opacity: 4 })).opacity).toBe(1)
    expect(buildExportTextOverlay(base({ opacity: -1 })).opacity).toBe(0)
    expect(buildExportTextOverlay(base({ opacity: Number.NaN })).opacity).toBe(1)
  })
  it('stroke: the CSS width is sent unchanged (the editor-box renderer draws it centred and over the fill, like the browser), never below 1 px', () => {
    expect(buildExportTextOverlay(base({ strokeWidth: 6, strokeColor: '#ff0000' }))).toMatchObject({ stroke_color: '#ff0000', stroke_width: 6 })
    expect(buildExportTextOverlay(base({ strokeWidth: 0.4 })).stroke_width).toBe(1)
    expect(buildExportTextOverlay(base({ strokeWidth: 4 }))).toMatchObject({ stroke_color: '#000000', stroke_width: 4 })        // the editor's own default stroke colour
    expect(buildExportTextOverlay(base({ strokeWidth: 0, strokeColor: '#ff0000' }))).not.toHaveProperty('stroke_width')
  })
  it('shadow: the CSS blur radius is a sigma of half its value; offsets pass through; nothing is sent when there is no shadow', () => {
    expect(buildExportTextOverlay(base({ shadowBlur: 10, shadowOffsetX: 3, shadowOffsetY: -2, shadowColor: '#112233' })))
      .toMatchObject({ shadow_color: '#112233', shadow_blur: 5, shadow_offset_x: 3, shadow_offset_y: -2 })
    expect(buildExportTextOverlay(base({ shadowOffsetX: 2 }))).toMatchObject({ shadow_color: '#000000', shadow_blur: 0, shadow_offset_x: 2 })
    expect(buildExportTextOverlay(base({ shadowColor: '#112233' }))).not.toHaveProperty('shadow_color')
    expect(buildExportTextOverlay(base({ shadowBlur: -4, shadowOffsetX: 1 })).shadow_blur).toBe(0)
  })
  it('gradient fill: both colours are needed, as in the editor', () => {
    expect(buildExportTextOverlay(base({ useGradient: true, gradientFrom: '#ff0000', gradientTo: '#0000ff' }))).toMatchObject({ use_gradient: true, gradient_from: '#ff0000', gradient_to: '#0000ff' })
    expect(buildExportTextOverlay(base({ useGradient: true, gradientFrom: '#ff0000' })).use_gradient).toBe(false)
  })
})

describe('background chip', () => {
  const chip = { bgColor: '#111827', bgOpacity: 0.78 }
  it('is sent when the editor would draw one, with its opacity', () => {
    expect(buildExportTextOverlay(base(chip))).toMatchObject({ bg_color: '#111827', bg_opacity: 0.78 })
  })
  it('is NOT sent for transparent, zero opacity, or a gradient fill (the editor draws none in those cases)', () => {
    expect(buildExportTextOverlay(base({ bgColor: 'transparent', bgOpacity: 1 }))).not.toHaveProperty('bg_color')
    expect(buildExportTextOverlay(base({ bgColor: '#000000', bgOpacity: 0 }))).not.toHaveProperty('bg_color')
    expect(buildExportTextOverlay(base({ ...chip, useGradient: true, gradientFrom: '#fff', gradientTo: '#000' }))).not.toHaveProperty('bg_color')
    expect(buildExportTextOverlay(base({ bgColor: '' }))).not.toHaveProperty('bg_color')
  })
  it('opacity defaults to 1 when unset, like the editor', () => {
    expect(buildExportTextOverlay(base({ bgColor: '#111827', bgOpacity: undefined as never })).bg_opacity).toBe(1)
  })
  it('padding: an explicit value wins (horizontal is always 4 more, like the editor); with none set it is the editor default, chip or not', () => {
    expect(buildExportTextOverlay(base({ ...chip, bgPadding: 14 }))).toMatchObject({ bg_padding: 14, bg_padding_x: 18 })
    expect(buildExportTextOverlay(base(chip))).toMatchObject({ bg_padding: 2, bg_padding_x: 6 })
    expect(buildExportTextOverlay(base())).toMatchObject({ bg_padding: 2, bg_padding_x: 6 })
  })
  it('a border with no fill still draws in the editor, so it is sent as a fully transparent chip carrying the border', () => {
    expect(buildExportTextOverlay(base({ bgBorderWidth: 3, bgBorderColor: '#ffffff' }))).toMatchObject({ bg_color: '#000000', bg_opacity: 0, bg_border_width: 3, bg_border_color: '#ffffff' })
    expect(buildExportTextOverlay(base({ useGradient: true, gradientFrom: '#fff', gradientTo: '#000', bgColor: '#123456', bgOpacity: 1, bgBorderWidth: 2 }))).toMatchObject({ bg_color: '#000000', bg_opacity: 0 })
  })
  it('radius, border and the banner/blur switches pass through (radius defaults to the editor’s 3)', () => {
    expect(buildExportTextOverlay(base({ ...chip, bgBorderRadius: 20, bgBorderWidth: 2, bgBorderColor: '#ffffff', bgBlur: true, bgFullWidth: true })))
      .toMatchObject({ bg_border_radius: 20, bg_border_width: 2, bg_border_color: '#ffffff', bg_blur: true, bg_full_width: true })
    expect(buildExportTextOverlay(base(chip)).bg_border_radius).toBe(3)
    expect(buildExportTextOverlay(base({ ...chip, bgBorderWidth: 2 })).bg_border_color).toBe('#000000')
  })
})

describe('size scale (one parameter, 1 today)', () => {
  const styled = base({ fontSize: 40, letterSpacing: 2, strokeWidth: 6, shadowBlur: 8, shadowOffsetX: 4, shadowOffsetY: 4, bgColor: '#000000', bgOpacity: 0.5, bgPadding: 10, bgBorderRadius: 6, bgBorderWidth: 2 })
  it('defaults to 1: pixel values are exactly the editor values (only the shadow blur radius is converted to a sigma)', () => {
    expect(buildExportTextOverlay(styled)).toMatchObject({ font_size: 40, letter_spacing: 2, stroke_width: 6, shadow_blur: 4, shadow_offset_x: 4, bg_padding: 10, bg_padding_x: 14, bg_border_radius: 6, bg_border_width: 2 })
  })
  it('scales EVERY pixel quantity together and nothing else (so a future canvas-width/1080 rule is one argument)', () => {
    const m = buildExportTextOverlay(styled, { pxScale: 2 })
    expect(m).toMatchObject({ font_size: 80, letter_spacing: 4, stroke_width: 12, shadow_blur: 8, shadow_offset_x: 8, shadow_offset_y: 8, bg_padding: 20, bg_padding_x: 28, bg_border_radius: 12, bg_border_width: 4 })
    expect([m.x, m.y, m.width_pct, m.opacity, m.line_spacing, m.bg_opacity]).toEqual([12, 34, 60, 1, 1.15, 0.5])              // percentages and ratios never scale
  })
  it('ignores a nonsensical scale', () => {
    expect(buildExportTextOverlay(styled, { pxScale: 0 }).font_size).toBe(40)
    expect(buildExportTextOverlay(styled, { pxScale: -3 }).font_size).toBe(40)
    expect(buildExportTextOverlay(styled, { pxScale: Number.NaN }).font_size).toBe(40)
  })
})

describe('robustness', () => {
  it('never produces a non-integer font size (the API takes an integer) or NaN', () => {
    const m = buildExportTextOverlay(base({ fontSize: 33.6 }))
    expect(Number.isInteger(m.font_size)).toBe(true); expect(m.font_size).toBe(34)
    expect(buildExportTextOverlay(base({ fontSize: Number.NaN as never })).font_size).toBe(42)
    expect(buildExportTextOverlay(base({ fontSize: 0 })).font_size).toBe(1)
  })
  it('does not mutate its input and tolerates null / empty lists', () => {
    const t = Object.freeze(base({ strokeWidth: 4 }))
    expect(() => buildExportTextOverlay(t)).not.toThrow()
    expect(buildExportTextOverlays(null)).toEqual([]); expect(buildExportTextOverlays(undefined)).toEqual([]); expect(buildExportTextOverlays([])).toEqual([])
  })
  it('keeps the list order and every provenance-carrying layer (the reconstruction field is not sent to the exporter)', () => {
    const a = base({ id: 'a', text: 'A' }), b = base({ id: 'b', text: 'B', reconstruction: { schema: 'reconstruction-v1' } as never })
    const out = buildExportTextOverlays([a, b])
    expect(out.map(o => o.text)).toEqual(['A', 'B']); expect(JSON.stringify(out)).not.toContain('reconstruction')
  })
})

// The backend test (backend/tests/test_text_overlay_render_fidelity.py) validates exactly these items against the real ExportTextOverlay schema and renders each one,
// so the two sides cannot drift apart. Regenerate with UPDATE_EXPORT_FIXTURE=1 after an intentional change. Synthetic data only.
describe('the committed export-item fixture is what the mapper really produces', () => {
  const FIXTURE = join(__dirname, '__fixtures__', 'export_text_items.json')
  const LONG = 'A much longer line of caption wording that has to wrap onto several lines inside its box'
  const overlays: TextOverlay[] = [
    base({ id: 'plain', text: 'Plain' }),
    base({ id: 'layer', text: 'Reconstructed layer', x: 10.5, y: 71.2, width: 74, fontSize: 60, color: '#d0d0d0', order: 2 }),
    base({ id: 'wrap', text: LONG, width: 55, fontSize: 40, lineSpacing: 1.4, align: 'center' }),
    base({ id: 'styled', text: 'Styled headline', bold: true, underline: true, letterSpacing: 2, opacity: 0.8, strokeWidth: 6, strokeColor: '#000000', shadowBlur: 10, shadowOffsetX: 3, shadowOffsetY: 3, shadowColor: '#222222', align: 'right', order: 5 }),
    base({ id: 'chip', text: 'On a chip', bgColor: '#111827', bgOpacity: 0.78, bgPadding: 12, bgBorderRadius: 20, bgBorderWidth: 2, bgBorderColor: '#ffffff', fontSize: 44 }),
    base({ id: 'banner', text: 'Full width banner', bgColor: '#b91c1c', bgOpacity: 0.9, bgFullWidth: true, fontSize: 52, width: 100, x: 0 }),
    base({ id: 'gradient', text: 'Gradient fill', useGradient: true, gradientFrom: '#ff512f', gradientTo: '#dd2476', fontSize: 70, bold: true }),
  ]
  it('matches the mapper output for a rich set of overlays', () => {
    const text = JSON.stringify(buildExportTextOverlays(overlays), null, 1) + String.fromCharCode(10)
    if (process.env.UPDATE_EXPORT_FIXTURE) { mkdirSync(dirname(FIXTURE), { recursive: true }); writeFileSync(FIXTURE, text) }
    expect(existsSync(FIXTURE)).toBe(true)
    expect(JSON.parse(readFileSync(FIXTURE, 'utf8'))).toEqual(JSON.parse(text))
  })
})
