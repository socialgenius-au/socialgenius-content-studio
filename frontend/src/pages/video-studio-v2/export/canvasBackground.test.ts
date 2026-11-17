// The canvas background colour: optional, "#rrggbb" only, survives the draft/local-copy round trip (it is part of canvasFormat), and an old copy without it means black.
import { describe, expect, it } from 'vitest'
import { parsePersistedProject } from '../projectPersistence'
import { validCanvasBackground } from './canvasBackground'

const FORMAT = { platformKey: 'instagram', placementKey: 'reel_story', label: 'Instagram - Reel / Story', ratio: '9:16', width: 1080, height: 1920 }

describe('canvas background colour', () => {
  it('accepts #rrggbb (any case, returned lower case) and nothing else', () => {
    expect(validCanvasBackground('#CC2244')).toBe('#cc2244'); expect(validCanvasBackground('#cc2244')).toBe('#cc2244')
    for (const bad of [undefined, null, '', 'red', '#abc', 'cc2244', '#gg2244', '#cc2244 ', '#cc2244; x', 42, {}]) expect(validCanvasBackground(bad), String(bad)).toBeUndefined()
  })
  it('survives the local working copy: a current copy keeps it, an older copy without it restores as black', () => {
    const current = parsePersistedProject(JSON.stringify({ canvasFormat: { ...FORMAT, background: '#cc2244' }, videoClips: [] }))!
    expect(validCanvasBackground(current.canvasFormat?.background)).toBe('#cc2244')
    const older = parsePersistedProject(JSON.stringify({ canvasFormat: FORMAT, videoClips: [] }))!
    expect(older.canvasFormat).toEqual(FORMAT); expect(validCanvasBackground(older.canvasFormat?.background)).toBeUndefined()
  })
  it('a malformed stored colour is ignored, not exported and not drawn', () => {
    const odd = parsePersistedProject(JSON.stringify({ canvasFormat: { ...FORMAT, background: 'javascript:alert(1)' } }))!
    expect(validCanvasBackground(odd.canvasFormat?.background)).toBeUndefined()
  })
})
