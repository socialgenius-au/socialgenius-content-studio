// The browser-local working copy: copies written by older versions still restore, the five newer kinds round-trip, bad data is dropped field by field, and the restore never touches
// a saved draft or which draft is open.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PROJECT_STORAGE_KEY, parsePersistedProject } from './projectPersistence'

// exactly the shape the editor wrote BEFORE this change (measured from a real browser): no shapes, lower thirds, subtitles, inserts or subtitle style
const OLD_COPY = { videoClips: [{ id: 'c1' }], textOverlays: [{ id: 't1' }], mediaOverlays: [{ id: 'm1' }], audioTracks: [{ id: 'a1' }], mediaAssets: [{ id: 9 }], canvasFormat: { label: 'x' }, timeline: { currentTime: 3 }, canvasItemPositions: { t1: { x: 1, y: 2 } } }
const NEW_COPY = { ...OLD_COPY, shapes: [{ id: 's1' }, { id: 's2' }], lowerThirds: [{ id: 'l1' }], subtitles: [{ id: 'u1' }, { id: 'u2' }], additionalVideoClips: [{ id: 'in1' }], subtitleStyle: { fontSize: 36 } }

describe('parsePersistedProject', () => {
  it('"no copy" for nothing, for text that is not JSON and for JSON that is not an object', () => {
    for (const raw of [null, '', 'not json {', '[]', '42', '"x"', 'null']) expect(parsePersistedProject(raw), String(raw)).toBeNull()
  })
  it('a copy written by an older version restores exactly as before: the five newer kinds are simply absent', () => {
    const saved = parsePersistedProject(JSON.stringify(OLD_COPY))!
    expect(saved.videoClips).toEqual(OLD_COPY.videoClips); expect(saved.canvasItemPositions).toEqual(OLD_COPY.canvasItemPositions); expect(saved.timeline).toEqual(OLD_COPY.timeline)
    for (const k of ['shapes', 'lowerThirds', 'subtitles', 'additionalVideoClips', 'subtitleStyle'] as const) expect(saved[k], k).toBeUndefined()
    expect((saved.shapes ?? []).length + (saved.lowerThirds ?? []).length + (saved.subtitles ?? []).length + (saved.additionalVideoClips ?? []).length).toBe(0)
  })
  it('a current copy round-trips every kind', () => {
    const saved = parsePersistedProject(JSON.stringify(NEW_COPY))!
    expect(saved).toEqual(NEW_COPY)
  })
  it('a field of the wrong type is dropped on its own; the rest of the copy still restores', () => {
    const saved = parsePersistedProject(JSON.stringify({ ...NEW_COPY, shapes: 'oops', lowerThirds: { a: 1 }, subtitleStyle: [1], canvasItemPositions: 5 }))!
    expect(saved.shapes).toBeUndefined(); expect(saved.lowerThirds).toBeUndefined(); expect(saved.subtitleStyle).toBeUndefined(); expect(saved.canvasItemPositions).toBeUndefined()
    expect(saved.subtitles).toEqual(NEW_COPY.subtitles); expect(saved.videoClips).toEqual(NEW_COPY.videoClips); expect(saved.additionalVideoClips).toEqual(NEW_COPY.additionalVideoClips)
  })
  it('keeps the storage key the editor and the blueprint hand-off already use', () => {
    expect(PROJECT_STORAGE_KEY).toBe('sg-video-studio-v2-project')
  })
})

describe('the editor wiring', () => {
  const src = readFileSync(join(__dirname, 'VideoStudioV2.tsx'), 'utf8')
  it('restores and saves each newer kind through the existing add / set actions, once on mount', () => {
    for (const s of ['(saved.shapes ?? []).forEach(sh => addShape(sh))', '(saved.lowerThirds ?? []).forEach(l => addLowerThird(l))', '(saved.subtitles ?? []).forEach(sg => addSubtitle(sg))',
      '(saved.additionalVideoClips ?? []).forEach(c => addAdditionalVideoClip(c))', 'if (saved.subtitleStyle) setSubtitleStyle(saved.subtitleStyle)', 'shapes, lowerThirds, subtitles, additionalVideoClips, subtitleStyle,']) expect(src).toContain(s)
    expect(src).toContain('const saved = parsePersistedProject(localStorage.getItem(PROJECT_STORAGE_KEY))')
  })
  it('does not touch saved drafts or which draft is open: no drafts API, no draft id, in the persistence', () => {
    const persistence = src.slice(src.indexOf('function ProjectPersistence'), src.indexOf('const stageComponent'))
    expect(persistence).not.toMatch(/videoStudioDraftsApi|draftId|setDraftId|\.update\(|\.create\(/)
  })
})
