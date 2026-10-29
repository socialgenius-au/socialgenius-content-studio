// M1 / Stage 3 -- the guard is wired into the one export path, and runs before anything is sent. (Behaviour is covered by exportGuard.test.ts and the browser run.)
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const src = readFileSync(join(__dirname, '..', 'components', 'ReviewTab.tsx'), 'utf8').replace(/\r\n/g, '\n')
const handler = src.slice(src.indexOf('const handleExportVideo'), src.indexOf('return (\n    <div className="stage-page review-page">'))

describe('ReviewTab export wiring', () => {
  it('imports the guard from the blueprint folder', () => {
    expect(src).toContain('import { checkReconstructionExport } from "../blueprint/exportGuard";')
  })
  it('runs the guard on the live overlays and clips, after the existing checks and before the exporting state, the request body and the network call', () => {
    const at = (needle: string) => handler.indexOf(needle)
    const guard = at('checkReconstructionExport(textOverlays, videoClips)')
    expect(guard).toBeGreaterThan(-1)
    expect(guard).toBeGreaterThan(at('clipsWithoutAsset.length > 0'))               // existing checks keep their precedence
    expect(guard).toBeLessThan(at('setExportState("exporting")'))
    expect(guard).toBeLessThan(at('const body = {'))
    expect(guard).toBeLessThan(at('videoExportApi.exportProject'))
  })
  it('a blocked check shows the message in the existing error slot and returns without exporting', () => {
    const block = handler.slice(handler.indexOf('const blocked'), handler.indexOf('setExportState("exporting")'))
    expect(block).toContain('setExportState("error")')
    expect(block).toContain('setExportError(blocked.message)')
    expect(block).toContain('return;')
  })
  it('the export request body is unchanged: the guard adds no field and filters nothing', () => {
    expect(handler).toContain('text_overlays: textOverlays.map(t => ({')
    expect(handler).toContain('video_clips: videoClips.map(c => ({')
    expect(handler.match(/checkReconstructionExport/g)).toHaveLength(1)
  })
})
