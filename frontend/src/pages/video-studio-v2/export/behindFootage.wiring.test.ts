import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildExportShapes } from './layerExport'

describe('behind-footage shapes: export request and editor wiring', () => {
  const shape = { id: 's', kind: 'rectangle' as const, x: 0, y: 0, width: 100, height: 100, fillColor: '#ffff00', opacity: 1, startTime: 0, endTime: 3 }
  it('carries behind_footage only for a shape marked behind footage, so every other request is unchanged', () => {
    const [plain] = buildExportShapes([shape])
    const [behind] = buildExportShapes([{ ...shape, behindFootage: true } as typeof shape])
    expect('behind_footage' in plain).toBe(false)
    expect(behind.behind_footage).toBe(true)
  })

  const src = readFileSync(join(__dirname, '../components/CreateEditTab.tsx'), 'utf8').replace(/\r\n/g, '\n')
  it('draws behind shapes in their own layer directly below the V2 inserts (both preview branches), keeps them out of the ordinary stack, and offers one checkbox', () => {
    expect(src.match(/\{behindLayer\}\n\s+\{insertLayer\}\n\s+\{visualLayers\}/g)).toHaveLength(2)
    expect(src).toContain('...shapeEntries.filter(e => !e.behind), ...subtitleEntries]')
    expect(src).toContain('data-testid="shape-behind-footage"')
    expect(src).toContain('useVideoSizes(videoClips.map(c => c.url), shapes.some(isBehindFootage))')
  })
})
