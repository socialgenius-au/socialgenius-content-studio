import { describe, expect, it } from 'vitest'
import type { TextOverlay, VideoClip } from '../../../types'
import { PLACEHOLDER_TEXT_PREFIX } from './blueprintPlan'
import { coveredSeconds, scenesWithoutFootage } from './coverage'
import { computeReadiness } from './readiness'
import { checkReconstructionExport } from './exportGuard'

const clip = (s: number, e: number) => ({ startTime: s, endTime: e }) as Pick<VideoClip, 'startTime' | 'endTime'>
const scenes = [{ sceneNumber: 1, startTime: 0, endTime: 4 }, { sceneNumber: 2, startTime: 4, endTime: 10 }, { sceneNumber: 3, startTime: 10, endTime: 14 }]
const tag = (n: number) => ({ blueprintId: 'bp', sectionNumber: n, kind: 'text' as const, mechanismIds: [], referenceVideoId: 1, c3AttemptId: null })
const ov = (text: string, n: number) => ({ text, blueprint: tag(n) }) as Pick<TextOverlay, 'text' | 'blueprint'>

describe('coverage', () => {
  it('counts overlap once, even when clips overlap each other', () => {
    expect(coveredSeconds(0, 10, [clip(0, 6), clip(4, 8)])).toBeCloseTo(8)
    expect(coveredSeconds(0, 10, [clip(-5, 3), clip(9, 40)])).toBeCloseTo(4)
    expect(coveredSeconds(0, 10, [])).toBe(0)
  })
  it('finds scenes with nothing under them', () => {
    expect(scenesWithoutFootage(scenes, [clip(0, 4)]).map(s => s.sceneNumber)).toEqual([2, 3])
    expect(scenesWithoutFootage(scenes, [clip(0, 14)])).toEqual([])
    expect(scenesWithoutFootage(scenes, [clip(3.95, 4.02)]).map(s => s.sceneNumber)).toEqual([1, 2, 3])   // a sliver of rounding is not footage
  })
})

describe('computeReadiness', () => {
  it('reports footage per scene as none / partial / full and counts the placeholders left', () => {
    const r = computeReadiness(scenes, [clip(0, 4), clip(4, 7)], [ov(PLACEHOLDER_TEXT_PREFIX + 'x', 1), ov('Real words', 2)], [])
    expect(r.scenes.map(s => s.footage)).toEqual(['full', 'partial', 'none'])
    expect(r.scenes[1].footageSeconds).toBeCloseTo(3)
    expect(r.scenes.map(s => s.placeholdersLeft)).toEqual([1, 0, 0])
    expect(r.scenesWithFootage).toBe(2)
    expect(r.placeholdersLeft).toBe(1)
    expect(r.ready).toBe(false)
  })
  it('is ready only when every scene has footage and no placeholder is left', () => {
    expect(computeReadiness(scenes, [clip(0, 14)], [ov('Done', 1)], []).ready).toBe(true)
    expect(computeReadiness(scenes, [clip(0, 14)], [ov(PLACEHOLDER_TEXT_PREFIX + 'x', 3)], []).ready).toBe(false)
    expect(computeReadiness([], [clip(0, 14)], [], []).ready).toBe(false)
  })
  it('notes a voice track under a scene', () => {
    const r = computeReadiness(scenes, [], [], [{ startTime: 4, endTime: 9 }])
    expect(r.scenes.map(s => s.hasVoice)).toEqual([false, true, false])
  })
})

describe('the checklist and the export guard agree', () => {
  const cases: [string, ReturnType<typeof clip>[], ReturnType<typeof ov>[]][] = [
    ['everything done', [clip(0, 14)], [ov('Done', 1)]],
    ['placeholder left', [clip(0, 14)], [ov(PLACEHOLDER_TEXT_PREFIX + 'x', 2)]],
    ['scene without footage', [clip(0, 4), clip(10, 14)], [ov('Done', 1)]],
    ['a gap inside a scene the footage only partly covers', [clip(0, 5), clip(7, 14)], [ov('Done', 1)]],
    ['no clips at all', [], [ov('Done', 1)]],
  ]
  for (const [name, clips, texts] of cases) {
    it(`${name}: ready === guard ok, blocker === guard message`, () => {
      const g = checkReconstructionExport(texts, clips, scenes)
      const r = computeReadiness(scenes, clips, texts, [])
      expect(r.ready).toBe(g.ok)
      expect(r.blocker).toBe(g.ok ? null : g.message)
    })
  }
  it('a missing voice-over never blocks', () => {
    expect(computeReadiness(scenes, [clip(0, 14)], [ov('Done', 1)], []).ready).toBe(true)
  })
})

describe('the export guard knows the planned scenes', () => {
  it('blocks, naming the scenes, when planned scenes have no footage, even after every placeholder was replaced', () => {
    const r = checkReconstructionExport([ov('Real words', 1)], [clip(0, 4)], scenes)
    expect(r.ok).toBe(false)
    if (!r.ok) { expect(r.code).toBe('footage'); expect(r.message).toContain('scene 2 (4s–10s)'); expect(r.message).toContain('scene 3'); expect(r.message).toMatch(/Add footage/) }
  })
  it('still reports unreplaced placeholders first', () => {
    const r = checkReconstructionExport([ov(PLACEHOLDER_TEXT_PREFIX + 'x', 1)], [clip(0, 4)], scenes)
    expect(!r.ok && r.code).toBe('placeholders')
  })
  it('lets a fully covered plan through, and a project with no plan and no tagged text is never touched', () => {
    expect(checkReconstructionExport([ov('Real words', 1)], [clip(0, 14)], scenes)).toEqual({ ok: true })
    expect(checkReconstructionExport([], [clip(0, 3)], [])).toEqual({ ok: true })
    expect(checkReconstructionExport([{ text: 'Hello' } as never], [clip(0, 3)])).toEqual({ ok: true })
  })
  it('summarises a long list of bare scenes', () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ sceneNumber: i + 1, startTime: i * 4, endTime: i * 4 + 4 }))
    const r = checkReconstructionExport([ov('x', 1)], [], many)
    expect(!r.ok && r.message).toContain('7 scenes have no footage yet')
    expect(!r.ok && r.message).toContain('and 3 more')
  })
})
