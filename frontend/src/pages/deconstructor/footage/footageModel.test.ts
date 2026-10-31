// M1 / Stage 2 -- the Footage Assignment model, exercised against the REAL VA5368 blueprint (7 scenes: 4, 5, 5, 6, 5, 2, 3 s = 30 s).
// The engine's own behaviour is covered by assembly/assembleDraft.test.ts; these tests prove the workspace model hands it the right input, shows its answer
// faithfully, and does not re-implement it.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import bpFx from '../__fixtures__/va5368.c4-blueprint.json'
import type { Asset } from '../../../types'
import type { BlueprintResponse } from '../../../types/deconstructor'
import { buildBlueprintPlan } from '../../video-studio-v2/blueprint/blueprintPlan'
import { assembleDraft } from '../assembly'
import {
  REQUESTED_ELEMENTS, addClip, buildAssignments, canOpenSaved, canUseAsFootage, clearScene, coverageHeadline, footageKeyFor, isVideoAsset, moveClip, newClipEdit, parseClipEdit, pickerOrder,
  readyEntry, referenceAssetIdsOf, removeClip, runAssembly, updateClip, type ClipEdit, type LibraryEntry, type SceneEdits,
} from './footageModel'

const plan = buildBlueprintPlan(JSON.parse(JSON.stringify(bpFx)) as BlueprintResponse, new Date('2026-10-01T00:00:00Z'))
const STAMP = '2026-10-01T00:00:00.000Z'
const asset = (id: number, name = `v${id}.mp4`, file_type = 'video'): Asset => ({ id, job_id: null, user_id: 1, original_filename: name, stored_filename: `s${id}.mp4`, file_path: `uploads/1/s${id}.mp4`, file_type, mime_type: 'video/mp4', file_size: 1000, created_at: '2026-10-01T00:00:00Z' })
const url = (p: string) => `/uploads/${p.replace(/^uploads\//, '')}`
const lib = (...entries: LibraryEntry[]) => new Map(entries.map(e => [e.key, e] as const))
const ready = (id: number, duration: number) => readyEntry(asset(id), duration, url)
let n = 0
const clip = (assetId: number, over: Partial<ClipEdit> = {}): ClipEdit => ({ ...newClipEdit(`u${++n}`, footageKeyFor(assetId)), ...over })
const run = (edits: SceneEdits, library: ReadonlyMap<string, LibraryEntry>, extra: { referenceAssetIds?: number[]; underfilled?: 'gap' | 'stretch' } = {}) =>
  runAssembly({ plan, library, edits, referenceAssetIds: extra.referenceAssetIds ?? [], underfilled: extra.underfilled ?? 'gap', createdAt: STAMP })
const row = (v: ReturnType<typeof run>, scene: number) => v.rows.find(r => r.sceneNumber === scene)!

describe('footage library entries', () => {
  it('a ready entry carries the real length and the URL the editor will load', () => {
    const e = readyEntry(asset(7, 'shop.mp4'), 12.5, url)
    expect(e).toMatchObject({ state: 'ready', key: 'a7', assetId: 7, name: 'shop.mp4' })
    if (e.state === 'ready') expect(e.clip).toMatchObject({ key: 'a7', assetId: 7, url: '/uploads/1/s7.mp4', duration: 12.5 })
  })
  it('an unreadable length is a failure -- never a guessed one', () => {
    for (const bad of [0, -3, NaN, Infinity, undefined as unknown as number, '5' as unknown as number]) {
      const e = readyEntry(asset(7), bad, url)
      expect(e.state).toBe('failed')
    }
  })
  it('keeps only videos, newest first, with reference videos last', () => {
    const list = [asset(1), asset(5), asset(3, 'pic.png', 'image'), asset(9), asset(2, 'a.mp3', 'audio')]
    expect(isVideoAsset(asset(3, 'x', 'image'))).toBe(false)
    expect(pickerOrder(list, [9]).map(a => a.id)).toEqual([5, 1, 9])
    expect(referenceAssetIdsOf([{ asset_id: 9 }, { asset_id: 4 }, { asset_id: 9 }])).toEqual([4, 9])
    expect(referenceAssetIdsOf(null)).toEqual([])
  })
})

describe('editing the assignment', () => {
  it('adds, updates, moves and removes clips without mutating the previous state', () => {
    const a = clip(1), b = clip(2)
    const e0: SceneEdits = {}
    const e1 = addClip(addClip(e0, 3, a), 3, b)
    expect(e0).toEqual({}) ; expect(e1[3].map(c => c.uid)).toEqual([a.uid, b.uid])
    const e2 = updateClip(e1, 3, a.uid, { trimIn: '2' })
    expect(e1[3][0].trimIn).toBe('') ; expect(e2[3][0].trimIn).toBe('2')
    expect(moveClip(e2, 3, b.uid, -1)[3].map(c => c.uid)).toEqual([b.uid, a.uid])
    expect(moveClip(e2, 3, a.uid, -1)).toBe(e2)                                          // already first: unchanged
    expect(moveClip(e2, 3, b.uid, 1)).toBe(e2)                                           // already last: unchanged
    expect(removeClip(e2, 3, a.uid)[3].map(c => c.uid)).toEqual([b.uid])
    expect(removeClip(removeClip(e2, 3, a.uid), 3, b.uid)).toEqual({})                   // an emptied scene disappears
    expect(clearScene(e2, 3)).toEqual({})
  })
})

describe('reading what was typed (syntax only -- sense is the engine’s call)', () => {
  it('blank means "use the default"', () => {
    expect(parseClipEdit(1, clip(1))).toEqual({ use: { footageKey: 'a1' }, problems: [] })
  })
  it('parses seconds and the allowed speeds', () => {
    expect(parseClipEdit(1, clip(1, { trimIn: ' 2.5 ', useDuration: '3', speed: '0.5' })).use).toEqual({ footageKey: 'a1', trimIn: 2.5, useDuration: 3, speed: 0.5 })
  })
  it('rejects text that is not a number of seconds, and speeds the editor does not have', () => {
    for (const bad of ['abc', '-1', '1e3', '0x10', '1,5', '2 s', '.5', 'NaN', 'Infinity']) {
      const r = parseClipEdit(4, clip(1, { trimIn: bad }))
      expect(r.problems, bad).toHaveLength(1)
      expect(r.problems[0]).toMatchObject({ sceneNumber: 4, field: 'trimIn' })
      expect(r.use.trimIn).toBeUndefined()
    }
    expect(parseClipEdit(1, clip(1, { useDuration: 'x' })).problems[0].field).toBe('useDuration')
    expect(parseClipEdit(1, clip(1, { speed: '3' })).problems[0].field).toBe('speed')
    expect(parseClipEdit(1, clip(1, { speed: '1.1' })).problems).toHaveLength(1)
  })
})

describe('scene assignment', () => {
  it('assigns footage to individual scenes; untouched scenes stay empty and are reported, not faked', () => {
    const v = run({ 1: [clip(1)], 3: [clip(2)] }, lib(ready(1, 20), ready(2, 20)))
    expect(v.result.ok).toBe(true)
    expect(v.rows.map(r => r.status)).toEqual(['filled', 'empty', 'filled', 'empty', 'empty', 'empty', 'empty'])
    expect(v.clipCount).toBe(2)
    expect(coverageHeadline(v)).toBe('2 of 7 scenes have footage')
    expect(v.canSave).toBe(true)
    if (v.result.ok) {
      const [c1, c2] = v.result.snapshot.videoClips
      expect([c1.assetId, c1.startTime, c1.endTime]).toEqual([1, 0, 4])
      expect([c2.assetId, c2.startTime, c2.endTime]).toEqual([2, 9, 14])               // scene 3 starts at 9 s
    }
  })
  it('every scene covered -> the whole 30 s timeline is covered and the draft is saveable', () => {
    const edits: SceneEdits = {}; const entries: LibraryEntry[] = []
    plan.scenes.forEach((s, i) => { edits[s.sceneNumber] = [clip(100 + i)]; entries.push(ready(100 + i, 30)) })
    const v = run(edits, lib(...entries))
    expect(v.rows.every(r => r.status === 'filled')).toBe(true)
    expect(coverageHeadline(v)).toBe('7 of 7 scenes have footage')
    if (v.result.ok) expect(v.result.snapshot.assembly.summary).toMatchObject({ plannedSeconds: 30, filledSeconds: 30, gapSeconds: 0 })
    expect(v.canSave).toBe(true)
  })
  it('several clips in one scene play back to back inside it', () => {
    const v = run({ 2: [clip(1), clip(2)] }, lib(ready(1, 20), ready(2, 20)))
    expect(row(v, 2).placed.map(p => [p.timelineStart, p.timelineEnd])).toEqual([[4, 6.5], [6.5, 9]])
  })
  it('only footage actually used is handed to the engine (no "unused footage" noise)', () => {
    const v = run({ 1: [clip(1)] }, lib(ready(1, 20), ready(2, 20), ready(3, 20)))
    expect(v.footage.map(f => f.key)).toEqual(['a1'])
    expect(v.notes.some(x => x.code === 'footage_unused')).toBe(false)
  })
  it('trim start and explicit length / speed are applied by the engine, and shown as placed', () => {
    const v = run({ 1: [clip(1, { trimIn: '5', useDuration: '2', speed: '2' })] }, lib(ready(1, 20)))
    const p = row(v, 1).placed[0]
    expect(p).toMatchObject({ trimIn: 5, speed: 2, timelineStart: 0, timelineEnd: 2, sourceDuration: 20 })
    expect(p.trimOut).toBeCloseTo(20 - 5 - 2 * 2, 6)
    expect(row(v, 1)).toMatchObject({ gapSeconds: 2, filledSeconds: 2, status: 'partial' })
  })
})

describe('missing media', () => {
  it('footage that is still being read blocks saving and says why', () => {
    const v = run({ 1: [clip(1)] }, lib({ state: 'probing', key: 'a1', assetId: 1, name: 'v1.mp4' }))
    expect(v.canSave).toBe(false)
    expect(row(v, 1).status).toBe('invalid')
    expect(v.blockers.join(' ')).toMatch(/Scene 1.*v1\.mp4.*Still reading/)
  })
  it('footage whose length could not be read blocks saving with that reason', () => {
    const v = run({ 1: [clip(1)] }, lib({ state: 'failed', key: 'a1', assetId: 1, name: 'broken.mp4', reason: 'This file could not be opened as a video.' }))
    expect(v.canSave).toBe(false)
    expect(v.blockers.join(' ')).toContain('This file could not be opened as a video.')
  })
  it('footage no longer in the library blocks saving', () => {
    const v = run({ 5: [clip(42)] }, lib())
    expect(v.canSave).toBe(false) ; expect(row(v, 5).status).toBe('invalid')
    expect(v.blockers.join(' ')).toContain('no longer available')
  })
  it('no footage at all: nothing to save, and it explains why', () => {
    const v = run({}, lib())
    expect(v.canSave).toBe(false)
    expect(v.rows.every(r => r.status === 'empty')).toBe(true)
    expect(v.blockers).toEqual(['Assign footage to at least one scene first — a draft with no clips cannot be exported from Video Studio.'])
  })
  it('a problem in one scene does not hide a valid scene’s own result as broken', () => {
    const v = run({ 1: [clip(1)], 2: [clip(9)] }, lib(ready(1, 20)))
    expect(row(v, 2).status).toBe('invalid')
    expect(v.canSave).toBe(false)
    expect(v.rows.filter(r => r.status === 'invalid')).toHaveLength(1)
  })
})

describe('source duration, trims and timing', () => {
  it('a start point at or beyond the end of the file is refused by the engine', () => {
    for (const trim of ['20', '25']) {
      const v = run({ 1: [clip(1, { trimIn: trim })] }, lib(ready(1, 20)))
      expect(v.canSave, trim).toBe(false) ; expect(row(v, 1).status).toBe('invalid')
      expect(v.result.ok).toBe(false)
    }
  })
  it('a length of zero is refused', () => {
    expect(run({ 1: [clip(1, { useDuration: '0' })] }, lib(ready(1, 20))).canSave).toBe(false)
  })
  it('lengths that overflow the scene are refused (a clip may not cross its scene boundary)', () => {
    const v = run({ 6: [clip(1, { useDuration: '1.5' }), clip(2, { useDuration: '1.5' })] }, lib(ready(1, 20), ready(2, 20)))   // scene 6 is 2 s long
    expect(v.canSave).toBe(false)
    expect(v.result.ok).toBe(false)
    if (!v.result.ok) expect(v.result.issues.some(i => i.code === 'scene_overflow' && i.sceneNumber === 6)).toBe(true)
  })
  it('unreadable numbers never reach the engine and block saving, naming the scene', () => {
    const v = run({ 2: [clip(1, { trimIn: 'abc' })] }, lib(ready(1, 20)))
    expect(v.canSave).toBe(false)
    expect(row(v, 2).problems).toEqual(['Start point must be a number of seconds, 0 or more.'])
    expect(v.blockers).toContain('Scene 2: Start point must be a number of seconds, 0 or more.')
  })
  it('the exact boundary: a length equal to the scene is accepted, a hair over the tolerance is not', () => {
    expect(run({ 6: [clip(1, { useDuration: '2' })] }, lib(ready(1, 20))).canSave).toBe(true)
    expect(run({ 6: [clip(1, { useDuration: '2.01' })] }, lib(ready(1, 20))).canSave).toBe(false)
  })
})

describe('coverage and short footage', () => {
  it('footage shorter than its scene leaves a reported gap by default', () => {
    const v = run({ 2: [clip(1)] }, lib(ready(1, 3)))                                 // scene 2 is 5 s, the file is 3 s
    expect(row(v, 2)).toMatchObject({ status: 'partial', filledSeconds: 3, gapSeconds: 2 })
    expect(v.warnings.some(w => w.code === 'scene_underfilled' && w.sceneNumber === 2)).toBe(true)
    expect(v.canSave).toBe(true)                                                      // a warning, not a blocker
  })
  it('"slow it down" fills the scene when an allowed speed makes the file long enough', () => {
    const v = run({ 2: [clip(1)] }, lib(ready(1, 3)), { underfilled: 'stretch' })      // 5 s at 0.5x needs 2.5 s of source
    expect(row(v, 2)).toMatchObject({ status: 'filled', gapSeconds: 0 })
    expect(row(v, 2).placed[0].speed).toBe(0.5)
  })
  it('stretching cannot invent footage: a file that is too short even slowed still shows the gap', () => {
    const v = run({ 2: [clip(1)] }, lib(ready(1, 0.5)), { underfilled: 'stretch' })
    expect(row(v, 2).status).toBe('partial') ; expect(row(v, 2).gapSeconds).toBeGreaterThan(0)
  })
})

describe('reference-video exclusion', () => {
  it('the engine refuses a reference asset even if the picker was bypassed', () => {
    const v = run({ 1: [clip(9)] }, lib(ready(9, 20)), { referenceAssetIds: [9] })
    expect(v.canSave).toBe(false)
    expect(v.result.ok).toBe(false)
    if (!v.result.ok) expect(v.result.issues.some(i => i.code === 'reference_media_not_allowed')).toBe(true)
    expect(v.blockers.join(' ')).toMatch(/reference/i)
  })
  it('other footage is unaffected by the exclusion list', () => {
    expect(run({ 1: [clip(1)] }, lib(ready(1, 20)), { referenceAssetIds: [9] }).canSave).toBe(true)
  })
})

describe('unsupported and partial elements are reported with the draft', () => {
  it('every non-automatic element is requested, so each draft records what was not recreated', () => {
    const v = run({ 1: [clip(1)] }, lib(ready(1, 20)))
    expect(REQUESTED_ELEMENTS).toHaveLength(12)
    if (v.result.ok) {
      expect(v.result.snapshot.assembly.unsupported.map(u => u.kind).sort()).toEqual(REQUESTED_ELEMENTS.filter(k => k.startsWith('reference_')).sort())
      expect(v.result.snapshot.assembly.elementClasses.some(c => c.editability === 'unsupported')).toBe(true)
    }
  })
})

describe('guards behind the buttons', () => {
  it('a reference video (or a non-video) can never be used as footage', () => {
    const refs = new Set([9])
    expect(canUseAsFootage(asset(1), refs)).toBe(true)
    expect(canUseAsFootage(asset(9), refs)).toBe(false)
    expect(canUseAsFootage(asset(2, 'p.png', 'image'), refs)).toBe(false)
  })
  it('Open is offered only for a saved draft that matches the current assignment', () => {
    expect(canOpenSaved(null, 'a')).toBe(false)
    expect(canOpenSaved({ signature: 'a' }, 'b')).toBe(false)
    expect(canOpenSaved({ signature: 'a' }, 'a')).toBe(true)
  })
  it('a clip with an unreadable number is never handed on for saving', () => {
    const v = run({ 2: [clip(1, { trimIn: 'abc' }), clip(1)] }, lib(ready(1, 20)))
    expect(v.assignments).toEqual([{ sceneNumber: 2, clips: [{ footageKey: 'a1' }] }])    // only the clean clip; the bad one blocks saving and is not guessed at
    expect(v.canSave).toBe(false)
  })
})

describe('the workspace uses the engine -- it does not duplicate it', () => {
  it('its answer is exactly assembleDraft’s answer for the same input', () => {
    const edits: SceneEdits = { 1: [clip(1, { trimIn: '1' })], 4: [clip(2), clip(1)] }
    const library = lib(ready(1, 20), ready(2, 20))
    const v = run(edits, library)
    const { assignments, footage } = buildAssignments(plan, library, edits)
    const direct = assembleDraft({ plan, footage, assignments, createdAt: STAMP, options: { underfilled: 'gap', referenceAssetIds: [], requestedElements: REQUESTED_ELEMENTS } })
    expect(v.result).toEqual(direct)
  })
  it('repeating the same form gives the identical result', () => {
    const edits: SceneEdits = { 1: [clip(1)], 2: [clip(2)] }
    const library = lib(ready(1, 20), ready(2, 8))
    expect(run(edits, library)).toEqual(run(edits, library))
  })
  it('the workspace sources contain no timing arithmetic of their own', () => {
    for (const f of ['footageModel.ts', 'footageLibrary.ts', 'assembledDraft.ts', 'FootageAssignment.tsx', 'FootageAssignmentView.tsx']) {
      const src = readFileSync(join(__dirname, f), 'utf8')
      expect(src, f).not.toMatch(/trimOut\s*[:=]|Math\.(floor|ceil|round|min|max)\(|\b(startTime|endTime|duration|trimIn|timelineStart|timelineEnd)\s*[-+*/]\s*[\w(]/)
    }
  })
  it('the saved draft is the engine’s draft: real clips, text placeholders and the original blueprint plan', () => {
    const v = run({ 1: [clip(1)], 2: [clip(2)] }, lib(ready(1, 20), ready(2, 20)))
    expect(v.result.ok).toBe(true)
    if (v.result.ok) {
      const s = v.result.snapshot
      expect(s.videoClips).toHaveLength(2)
      expect(s.textOverlays.length).toBeGreaterThanOrEqual(8)                          // 7 scene placeholders + the call to action
      expect(s.textOverlays.every(t => t.text.includes('PLACEHOLDER'))).toBe(true)
      expect(s.blueprintPlan.blueprintId).toBe(plan.blueprintId)
      expect(s.mediaAssets.map(a => a.id).sort()).toEqual([1, 2])
    }
  })
})
