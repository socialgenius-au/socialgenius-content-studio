// M2.2b -- shapes and lower thirds in the export request: the mapping, the defaults the editor uses, the wiring into the export button, and the fixture the
// backend test reads (so the backend checks exactly what this mapper really produces). Synthetic data only.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { LowerThird, Shape } from '../../../types'
import { DEFAULT_LOWER_THIRD_BOX, buildExportLowerThirds, buildExportShapes } from './layerExport'

const shape = (o: Partial<Shape> = {}): Shape => ({ id: 's', kind: 'rectangle', x: 10, y: 20, width: 30, height: 15, fillColor: '#ff8800', opacity: 0.8, startTime: 1, endTime: 5, ...o })
const lt = (o: Partial<LowerThird> = {}): LowerThird => ({ id: 'l', name: 'Ayub', title: 'Founder', animation: 'fade_in', duration: 4, positionY: 78, showLogo: false, startTime: 2, endTime: 6, ...o })

describe('shapes', () => {
  it('maps every field the backend schema takes, in the units the editor uses', () => {
    expect(buildExportShapes([shape({ borderWidth: 3, borderColor: '#112233', borderRadius: 12, order: 4 })])[0]).toEqual({
      kind: 'rectangle', start_time: 1, end_time: 5, x: 10, y: 20, width: 30, height: 15, fill_color: '#ff8800', opacity: 0.8, border_color: '#112233', border_width: 3, border_radius: 12, full_width: false, order: 4,
    })
  })
  it('draws a border only when it has a width, in black unless told otherwise (as the editor does)', () => {
    expect(buildExportShapes([shape({ borderColor: '#ffffff' })])[0]).toMatchObject({ border_color: null, border_width: 0 })
    expect(buildExportShapes([shape({ borderWidth: 2 })])[0]).toMatchObject({ border_color: '#000000', border_width: 2 })
  })
  it('keeps every kind, full width and order, and defaults the optional fields', () => {
    const out = buildExportShapes((['rectangle', 'circle', 'line', 'banner', 'highlight'] as const).map((kind, i) => shape({ id: kind, kind, fullWidth: kind === 'banner' ? true : undefined })))
    expect(out.map(s => s.kind)).toEqual(['rectangle', 'circle', 'line', 'banner', 'highlight'])
    expect(out.find(s => s.kind === 'banner')!.full_width).toBe(true); expect(out[0]).toMatchObject({ full_width: false, border_radius: 0, order: 0 })
  })
  it('clamps opacity to 0-1 and leaves out a shape that could never be seen', () => {
    expect(buildExportShapes([shape({ opacity: 3 })])[0].opacity).toBe(1); expect(buildExportShapes([shape({ opacity: -1 })])[0].opacity).toBe(0)
    expect(buildExportShapes([shape({ endTime: 1 }), shape({ width: 0 }), shape({ x: Number.NaN })])).toEqual([])
  })
  it('does not change the editor state it reads', () => {
    const s = [shape({ borderWidth: 2 })]; const before = JSON.stringify(s); buildExportShapes(s); expect(JSON.stringify(s)).toBe(before)
  })
})

describe('lower thirds', () => {
  it('uses the editor’s default box when a lower third has none, and its own box when it has one', () => {
    expect(buildExportLowerThirds([lt()])[0]).toMatchObject({ ...DEFAULT_LOWER_THIRD_BOX })
    expect(buildExportLowerThirds([lt({ x: 1, y: 2, width: 3, height: 4 })])[0]).toMatchObject({ x: 1, y: 2, width: 3, height: 4 })
  })
  it('maps the text, times, logo flag and order', () => {
    expect(buildExportLowerThirds([lt({ order: 7, showLogo: true })])[0]).toMatchObject({ name: 'Ayub', title: 'Founder', start_time: 2, end_time: 6, show_logo: true, order: 7 })
  })
  it('shows “Name” for an empty name, as the editor does, and an empty title as nothing', () => {
    expect(buildExportLowerThirds([lt({ name: '', title: '' })])[0]).toMatchObject({ name: 'Name', title: '' })
  })
  it('leaves out one the editor would not draw: no end time (a legacy lower third) or an empty span', () => {
    expect(buildExportLowerThirds([lt({ endTime: undefined }), lt({ endTime: 2 })])).toEqual([])
  })
})

describe('wiring', () => {
  const root = join(__dirname, '..')
  const review = readFileSync(join(root, 'components', 'ReviewTab.tsx'), 'utf8')
  it('the export button sends both, next to the text and picture layers it already sent', () => {
    expect(review).toContain('shapes: buildExportShapes(shapes),'); expect(review).toContain('lower_thirds: buildExportLowerThirds(lowerThirds),')
    expect(review).toContain('const { canvasFormat, videoClips, textOverlays, mediaOverlays, shapes, lowerThirds, audioTracks, timeline } = useStudio();')
    expect(review).toContain('text_overlays: buildExportTextOverlays(textOverlays),'); expect(review).toContain('media_overlays: mediaOverlays.map(o => ({'); expect(review).toContain('order: o.order ?? 0,')
  })
  it('the default lower-third box is the one the editor uses', () => {
    expect(readFileSync(join(root, 'components', 'CreateEditTab.tsx'), 'utf8')).toContain('const DEFAULT_LOWER_THIRD_BOX = { x: 5, y: 78, width: 55, height: 14 };')
  })
})

// The backend test (backend/tests/test_layer_export_request.py) feeds exactly this through the real request schema and the real renderer.
// Regenerate with UPDATE_LAYER_EXPORT_FIXTURE=1 after an intentional change; otherwise any drift fails here.
describe('the committed request fixture is what the mapper really produces', () => {
  const FIXTURE = join(__dirname, '__fixtures__', 'export_layers.json')
  it('matches', () => {
    const parts = {
      shapes: buildExportShapes([
        shape({ id: 'a', kind: 'rectangle', startTime: 0.5, endTime: 2.9, borderWidth: 4, borderColor: '#ffffff', borderRadius: 20, order: 2 }), shape({ id: 'b', kind: 'circle', startTime: 0.5, endTime: 2.9, x: 60, y: 50, width: 20, height: 12, fillColor: '#00aaff', opacity: 1, order: 3 }),
        shape({ id: 'c', kind: 'banner', startTime: 0.5, endTime: 2.9, y: 90, height: 6, fullWidth: true, fillColor: '#222222', opacity: 0.6, order: 1 }),
      ]),
      lower_thirds: buildExportLowerThirds([lt({ startTime: 0.5, endTime: 2.9, order: 4 }), lt({ id: 'm', name: 'Maya Rao', title: 'Head of Growth', x: 8, y: 60, width: 60, height: 12, startTime: 0.5, endTime: 2.9, order: 5 })]),
    }
    const text = JSON.stringify(parts, null, 1) + String.fromCharCode(10)
    if (process.env.UPDATE_LAYER_EXPORT_FIXTURE) { mkdirSync(dirname(FIXTURE), { recursive: true }); writeFileSync(FIXTURE, text) }
    expect(existsSync(FIXTURE)).toBe(true)
    expect(JSON.parse(readFileSync(FIXTURE, 'utf8'))).toEqual(JSON.parse(text))
  })
})
