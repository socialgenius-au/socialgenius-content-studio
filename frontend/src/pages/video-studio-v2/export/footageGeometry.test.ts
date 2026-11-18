import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import cases from './__fixtures__/footageGeometry.cases.json'
import { planBlendWindows, type BlendPolicy, type PlanClip } from './dissolveWindow'
import { buildExportShapes } from './layerExport'
import { clipSpans, footageRect, frameAt, isBehindFootage, outsideRectClipPath, rectsAtFrame, type GeoClip, type Rect } from './footageGeometry'

type RectCase = { canvas: [number, number]; source: [number, number]; fit: 'fit' | 'fill'; rect: number[] }
type OccCase = { name: string; policy: BlendPolicy; canvas: [number, number]; clips: { id: string; url: string; size: [number, number]; fit: 'fit' | 'fill'; transition: string; transitionDuration: number; startTime: number; endTime: number; trimIn: number; speed: number; duration: number | null }[]; expected: { frame: number; rects: number[][] }[] }
const data = cases as unknown as { rects: RectCase[]; occupancy: OccCase[] }

describe('footageGeometry follows the exporter (shared fixture generated from behind_footage.py)', () => {
  it('puts every picture exactly where the exporter draws it (fit and fill, many canvases and sources)', () => {
    for (const c of data.rects) expect({ c, got: [...footageRect(c.canvas[0], c.canvas[1], c.source[0], c.source[1], c.fit)] }).toEqual({ c, got: c.rect })
    expect(data.rects.length).toBeGreaterThan(100)
  })
  it('agrees on the footage on screen at every sampled frame of every generated project (main spans, blend windows, gaps, fades)', () => {
    let frames = 0, unions = 0, gaps = 0
    for (const c of data.occupancy) {
      const geo: GeoClip[] = c.clips.map(k => ({ id: k.id, startTime: k.startTime, endTime: k.endTime, fitMode: k.fit, sizeKey: k.url }))
      const sizes = new Map(c.clips.map(k => [k.url, k.size as readonly [number, number]]))
      const plan: PlanClip[] = c.clips.map(k => ({ id: k.id, transition: k.transition, transitionDuration: k.transitionDuration, startTime: k.startTime, endTime: k.endTime, trimIn: k.trimIn, speed: k.speed, duration: k.duration ?? undefined }))
      const windows = planBlendWindows(plan, c.policy)
      for (const e of c.expected) {
        const got = rectsAtFrame(geo, sizes, windows, c.canvas[0], c.canvas[1], e.frame).map(r => [...r]).sort((a, b) => a.join(',').localeCompare(b.join(',')))
        const want = [...e.rects].sort((a, b) => a.join(',').localeCompare(b.join(',')))
        expect({ name: c.name, frame: e.frame, got }).toEqual({ name: c.name, frame: e.frame, got: want })
        frames++; if (want.length > 1) unions++; if (!want.length) gaps++
      }
    }
    expect(frames).toBeGreaterThan(1000); expect(unions).toBeGreaterThan(20); expect(gaps).toBeGreaterThan(10)
  })
})

describe('the small helpers', () => {
  it('frameAt is the frame being shown, and the switch is read from an optional property only', () => {
    expect(frameAt(0)).toBe(0); expect(frameAt(1)).toBe(30); expect(frameAt(1 / 30 + 0.0001)).toBe(1)
    expect(isBehindFootage({ behindFootage: true })).toBe(true); expect(isBehindFootage({})).toBe(false); expect(isBehindFootage({ behindFootage: 'yes' })).toBe(false); expect(isBehindFootage(null)).toBe(false)
  })
  it('clipSpans splits runs at a gap and uses cumulative rounding', () => {
    const spans = clipSpans([{ id: 'b', startTime: 3, endTime: 4, sizeKey: 'b' }, { id: 'a', startTime: 0, endTime: 1.01, sizeKey: 'a' }])
    expect(spans).toEqual([{ id: 'a', f0: 0, f1: 30 }, { id: 'b', f0: 90, f1: 120 }])
  })
  it('the clip path keeps everything outside the rectangle (an even-odd polygon with the rectangle as a hole, in percent of the canvas)', () => {
    const r: Rect = [0, 108, 180, 100]
    expect(outsideRectClipPath(r, 180, 320)).toBe('polygon(evenodd, 0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%, 0.0000% 33.7500%, 100.0000% 33.7500%, 100.0000% 65.0000%, 0.0000% 65.0000%, 0.0000% 33.7500%)')
  })
})
