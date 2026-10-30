// Local only: runs the measurement on REAL reference stills when BG_STILLS_DIR points at a folder of raw RGBA dumps (<name>.rgba + index.json {name: [w, h]}). Skipped otherwise,
// so it never runs in CI and never needs private files in the repository. It asserts only what must always hold; the printed table is the finding.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { measureFrame } from '.'

const dir = process.env.BG_STILLS_DIR
describe.skipIf(!dir || !existsSync(join(dir, 'index.json')))('background measurement on real stills (local)', () => {
  it('measures every still without inventing a bar', () => {
    const index = JSON.parse(readFileSync(join(dir!, 'index.json'), 'utf8')) as Record<string, [number, number]>
    const rows: string[] = []
    for (const [name, [width, height]] of Object.entries(index)) {
      const data = new Uint8ClampedArray(readFileSync(join(dir!, `${name}.rgba`)))
      const m = measureFrame({ width, height, data })
      rows.push(`${name.slice(0, 8)} ${width}x${height} bars=[${m.bars.map(b => `${b.side}:${(b.size * 100).toFixed(1)}%:${b.color}:${b.uniformity}`).join(' ')}] variance=${m.variance} palette=${m.palette.map(p => `${p.color}(${(p.share * 100).toFixed(0)}%)`).join(',')}${m.uniformFrame ? ' BLANK' : ''}`)
      for (const b of m.bars) { expect(b.size).toBeGreaterThanOrEqual(0.02); expect(b.size).toBeLessThanOrEqual(0.45) }
    }
    console.log('\n' + rows.join('\n'))
    expect(rows.length).toBeGreaterThan(0)
  })
})
