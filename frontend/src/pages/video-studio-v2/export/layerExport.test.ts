// M2.2b -- shapes and lower thirds in the export request: the mapping, the defaults the editor uses, the wiring into the export button, and the fixture the
// backend test reads (so the backend checks exactly what this mapper really produces). Synthetic data only.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { LowerThird, Shape, SubtitleSegment, SubtitleStyle, VideoClip } from '../../../types'
import { DEFAULT_INSERT_BOX, DEFAULT_LOWER_THIRD_BOX, buildExportInserts, buildExportLowerThirds, buildExportShapes, buildExportSubtitleStyle, buildExportSubtitles, exportNotices, missingInsertSources } from './layerExport'

const shape = (o: Partial<Shape> = {}): Shape => ({ id: 's', kind: 'rectangle', x: 10, y: 20, width: 30, height: 15, fillColor: '#ff8800', opacity: 0.8, startTime: 1, endTime: 5, ...o })
const sub = (o: Partial<SubtitleSegment> = {}): SubtitleSegment => ({ id: 'u', text: 'Hello there', startTime: 1, endTime: 3, x: 10, y: 82, width: 80, ...o })
const style = (o: Partial<SubtitleStyle> = {}): SubtitleStyle => ({ fontFamily: 'Inter', fontSize: 36, color: '#FFFFFF', bgColor: '#000000', bgOpacity: 0.6, align: 'center', outlineColor: '#000000', outlineWidth: 0, shadowColor: '#000000', shadowBlur: 0, ...o })
const insert = (o: Partial<VideoClip> = {}): VideoClip => ({
  id: 'i', assetId: 7, url: 'u', name: 'broll', duration: 6, startTime: 2, endTime: 6, trimIn: 1.5, trimOut: 0, colorGrade: 'warm', speed: 1, brightness: 5, contrast: -3, saturation: 10,
  transition: 'cut', transitionDuration: 0.5, ...o,
})
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

describe('subtitles', () => {
  it('maps the segment as the editor has it, with a shared order', () => {
    expect(buildExportSubtitles([sub({ order: 3 })])[0]).toEqual({ text: 'Hello there', start_time: 1, end_time: 3, x: 10, y: 82, width: 80, style_override: {}, order: 3 })
  })
  it('turns the editor’s style into the snake_case style the exporter merges, with CSS blur as a standard deviation (half) and no outline without a width', () => {
    expect(buildExportSubtitleStyle(style({ fontSize: 40, outlineWidth: 2, shadowBlur: 8, align: 'left' }))).toEqual({
      font_size: 40, color: '#FFFFFF', bg_color: '#000000', bg_opacity: 0.6, align: 'left', outline_color: '#000000', outline_width: 2, shadow_color: '#000000', shadow_blur: 4,
    })
    expect(buildExportSubtitleStyle(style())).toMatchObject({ outline_width: 0, shadow_blur: 0 })
  })
  it('converts a per-segment override key by key and leaves out the font family, which the exporter cannot take', () => {
    const out = buildExportSubtitles([sub({ styleOverride: { fontFamily: 'Georgia', fontSize: 52, bgColor: '#112233', bgOpacity: 4, shadowBlur: 10, outlineWidth: -1, align: 'right' } })])[0]
    expect(out.style_override).toEqual({ font_size: 52, bg_color: '#112233', bg_opacity: 1, shadow_blur: 5, outline_width: 0, align: 'right' })
    expect(out.style_override).not.toHaveProperty('fontFamily'); expect(out.style_override).not.toHaveProperty('font_family')
  })
  it('leaves out a segment that has no words or no time on screen', () => {
    expect(buildExportSubtitles([sub({ text: '  ' }), sub({ endTime: 1 }), sub({ startTime: Number.NaN })])).toEqual([])
  })
  it('does not change the editor state it reads', () => {
    const s = [sub({ styleOverride: { fontSize: 50 } })]; const before = JSON.stringify(s); buildExportSubtitles(s); expect(JSON.stringify(s)).toBe(before)
  })
})

describe('inserts / B-roll', () => {
  it('maps every field the exporter takes, turning the editor’s 0-100 opacity into 0-1', () => {
    expect(buildExportInserts([insert({ insertX: 10, insertY: 20, insertWidth: 30, insertHeight: 25, opacity: 80, fitMode: 'fill', cropOffsetX: 30, cropOffsetY: 70 })])[0]).toEqual({
      asset_id: 7, start_time: 2, end_time: 6, trim_in: 1.5, color_grade: 'warm', brightness: 5, contrast: -3, saturation: 10, fit_mode: 'fill', crop_x: 30, crop_y: 70,
      insert_x: 10, insert_y: 20, insert_width: 30, insert_height: 25, opacity: 0.8, order: 0,
    })
  })
  it('uses the editor’s default box, fit mode, crop position and full opacity when a clip has none of its own', () => {
    expect(buildExportInserts([insert()])[0]).toMatchObject({ insert_x: 56, insert_y: 56, insert_width: 38, insert_height: 38, fit_mode: 'fit', crop_x: 50, crop_y: 50, opacity: 1 })
    expect(DEFAULT_INSERT_BOX).toEqual({ insertX: 56, insertY: 56, insertWidth: 38, insertHeight: 38 })
  })
  it('sends only inserts that have an uploaded source and a time on screen, and counts the ones that do not', () => {
    const list = [insert(), insert({ id: 'n', assetId: undefined }), insert({ id: 'z', endTime: 2 })]
    expect(buildExportInserts(list)).toHaveLength(1); expect(missingInsertSources(list)).toBe(1)
  })
  it('says plainly what the exporter cannot do: B-roll speed', () => {
    expect(exportNotices({ inserts: [insert()] })).toEqual([])
    expect(exportNotices({ inserts: [insert({ speed: 2 })] })[0]).toMatch(/B-roll speed is not applied in the export/)
  })
})

describe('lower-third preview rule', () => {
  const css = readFileSync(join(__dirname, '..', 'VideoStudioV2.css'), 'utf8')
  const backend = readFileSync(join(__dirname, '..', '..', '..', '..', '..', 'backend', 'app', 'services', 'canvas_render_svc.py'), 'utf8')
  const rule = (sel: string) => css.split('\n').find(l => l.startsWith(sel)) ?? ''
  it('sizes the preview text and bar from the lower third’s own box, with the proportions the exporter draws', () => {
    expect(rule('.canvas-lowerthird-item{')).toContain('container-type:size')
    expect(rule('.lowerthird-bar{')).toContain('width:max(2px,1.2cqw)')
    expect(rule('.lowerthird-text b{')).toContain('font-size:32cqh'); expect(rule('.lowerthird-text small{')).toContain('font-size:22cqh')
    expect(rule('.lowerthird-text{')).toContain('padding:0 3cqw 0 6cqw'); expect(rule('.lowerthird-text{')).toContain('gap:4cqh')
    expect(css).not.toMatch(/\.lowerthird-text (b|small)\{[^}]*font-size:\d+px/)
  })
  it('those proportions are the exporter’s own (pinned to canvas_render_svc.render_lower_third_png so neither side can drift alone)', () => {
    expect(backend).toContain('bar_w = max(2, round(box_w * 0.012))'); expect(backend).toContain('_load_font(round(box_h * 0.32), bold=True, arabic=has_arabic_script(name))'); expect(backend).toContain('_load_font(round(box_h * 0.22), bold=False, arabic=has_arabic_script(title))')       // same proportions; the extra argument only picks the Arabic-script font
    expect(backend).toContain('pad_x = round(box_w * 0.03)'); expect(backend).toContain('round(box_h * 0.04)')
  })
})

describe('wiring', () => {
  const root = join(__dirname, '..')
  const review = readFileSync(join(root, 'components', 'ReviewTab.tsx'), 'utf8')
  it('the export button sends both, next to the text and picture layers it already sent', () => {
    expect(review).toContain('shapes: buildExportShapes(shapes),'); expect(review).toContain('lower_thirds: buildExportLowerThirds(lowerThirds),')
    expect(review).toContain('const { canvasFormat, videoClips, additionalVideoClips, textOverlays, mediaOverlays, shapes, lowerThirds, subtitles, subtitleStyle, audioTracks, timeline } = useStudio();')
    expect(review).toContain('additional_video_clips: buildExportInserts(additionalVideoClips),'); expect(review).toContain('subtitles: buildExportSubtitles(subtitles),'); expect(review).toContain('subtitle_style: buildExportSubtitleStyle(subtitleStyle),')
    expect(review).toContain('missingInsertSources(additionalVideoClips) > 0'); expect(review).toContain('exportNotices({ inserts: additionalVideoClips })')
    expect(review).toContain('text_overlays: buildExportTextOverlays(textOverlays),'); expect(review).toContain('media_overlays: mediaOverlays.map(o => ({'); expect(review).toContain('order: o.order ?? 0,')
  })
  it('the default lower-third box is the one the editor uses', () => {
    expect(readFileSync(join(root, 'components', 'CreateEditTab.tsx'), 'utf8')).toContain('const DEFAULT_LOWER_THIRD_BOX = { x: 5, y: 78, width: 55, height: 14 };')
    expect(readFileSync(join(root, 'components', 'CreateEditTab.tsx'), 'utf8')).toContain('const DEFAULT_INSERT_BOX = { insertX: 56, insertY: 56, insertWidth: 38, insertHeight: 38 };')
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
      subtitles: buildExportSubtitles([sub({ startTime: 0.5, endTime: 2.9, order: 6 }), sub({ id: 'v', text: 'Second line', startTime: 0.5, endTime: 2.9, y: 70, styleOverride: { fontSize: 24, bgColor: '#0033aa', align: 'left' }, order: 7 })]),
      subtitle_style: buildExportSubtitleStyle(style({ fontSize: 30 })),
      lower_thirds: buildExportLowerThirds([lt({ startTime: 0.5, endTime: 2.9, order: 4 }), lt({ id: 'm', name: 'Maya Rao', title: 'Head of Growth', x: 8, y: 60, width: 60, height: 12, startTime: 0.5, endTime: 2.9, order: 5 })]),
    }
    ;(parts as Record<string, unknown>).additional_video_clips = buildExportInserts([insert({ startTime: 0.5, endTime: 2.9, trimIn: 0, insertX: 56, insertY: 56, insertWidth: 38, insertHeight: 38, opacity: 100, colorGrade: 'none', brightness: 0, contrast: 0, saturation: 0 })])
    const text = JSON.stringify(parts, null, 1) + String.fromCharCode(10)
    if (process.env.UPDATE_LAYER_EXPORT_FIXTURE) { mkdirSync(dirname(FIXTURE), { recursive: true }); writeFileSync(FIXTURE, text) }
    expect(existsSync(FIXTURE)).toBe(true)
    expect(JSON.parse(readFileSync(FIXTURE, 'utf8'))).toEqual(JSON.parse(text))
  })
})
