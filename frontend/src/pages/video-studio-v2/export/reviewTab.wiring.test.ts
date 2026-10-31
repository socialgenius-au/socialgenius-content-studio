// M2.1b -- the narrow ReviewTab change, pinned: the export request uses the mapper for text, and nothing else about the request or the M1 guards moved.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const src = readFileSync(join(__dirname, '..', 'components', 'ReviewTab.tsx'), 'utf8')
const idx = (s: string) => src.indexOf(s)

describe('ReviewTab export request', () => {
  it('imports the mapper and builds text_overlays with it (no inline seven-field map is left)', () => {
    expect(src).toContain('import { buildExportTextOverlays } from "../export/textOverlayExport";')
    expect(src).toContain('text_overlays: buildExportTextOverlays(textOverlays),')
    expect(src).not.toContain('font_size: t.fontSize, color: t.color, order: t.order ?? 0')
  })
  it('keeps the M1 guards ahead of the request: placeholders and gaps are still checked before anything is sent', () => {
    expect(idx('checkReconstructionExport(textOverlays, videoClips)')).toBeGreaterThan(0)
    expect(idx('checkReconstructionExport(textOverlays, videoClips)')).toBeLessThan(idx('setExportState("exporting")'))
    expect(idx('setExportState("exporting")')).toBeLessThan(idx('buildExportTextOverlays(textOverlays)'))
    expect(idx('buildExportTextOverlays(textOverlays)')).toBeLessThan(idx('videoExportApi.exportProject(body)'))
  })
  it('leaves the other parts of the request exactly as they were', () => {
    for (const s of ['canvas_width: canvasFormat.width,', 'canvas_height: canvasFormat.height,', 'video_clips: videoClips.map(c => ({', 'media_overlays: mediaOverlays.map(o => ({', 'audio_tracks: audioTracks',
      'fit_mode: c.fitMode ?? "fit", crop_x: c.cropOffsetX ?? 50, crop_y: c.cropOffsetY ?? 50,', 'muted: c.muted ?? false, volume: c.volume ?? 1,']) expect(src, s).toContain(s)
  })
  it('does not scale sizes yet: the mapper is called with no pxScale (the scale decision is pending approval)', () => {
    expect(src).not.toMatch(/buildExportTextOverlays\(textOverlays,/)
  })
})
