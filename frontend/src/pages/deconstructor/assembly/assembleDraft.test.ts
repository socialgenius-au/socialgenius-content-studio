// M1 / Stage 1 -- assembly engine tests: real VA5368 blueprint, scene boundaries, trimming, missing clips, invalid timing, repeatability,
// unsupported elements, provenance, draft compatibility, and "existing drafts are unaffected".
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import bpFixture from '../__fixtures__/va5368.c4-blueprint.json'
import { buildBlueprintPlan, buildDraftSnapshot, buildPlaceholderOverlays, type BlueprintPlan } from '../../video-studio-v2/blueprint/blueprintPlan'
import { computeEndTimeForSpeed } from '../../../components/studio/videoPreviewUtils'      // read-only import of the editor's own clip math, used as an oracle
import type { BlueprintResponse } from '../../../types/deconstructor'
import {
  ALL_ELEMENT_KINDS, ALLOWED_SPEEDS, ELEMENT_CLASSES, assembleDraft, classifyElement, suggestAssignments, summarizeIssues,
  type AssemblyInput, type AssemblyIssue, type ClipUse, type ElementKind, type FootageClip, type SceneAssignment,
} from './index'

const NOW = '2026-10-29T12:00:00.000Z'
const SRC = join(process.cwd(), 'src')
const FIXTURE_PATH = join(SRC, 'pages/deconstructor/assembly/__fixtures__/va5368.assembled.snapshot.json')

const realPlan = (): BlueprintPlan => buildBlueprintPlan(JSON.parse(JSON.stringify(bpFixture)) as BlueprintResponse, new Date('2026-09-25T10:00:00Z'))
const footage = (key: string, duration: number, assetId = key.charCodeAt(key.length - 1) + 1000): FootageClip => ({ key, assetId, url: `/uploads/${key}.mp4`, name: `${key}.mp4`, duration })
const make = (over: Partial<AssemblyInput> = {}): AssemblyInput => {
  const plan = over.plan ?? realPlan()
  const f = over.footage ?? plan.scenes.map((_, i) => footage(`f${i + 1}`, 20 + i))
  return { plan, footage: f, assignments: over.assignments ?? suggestAssignments(plan, f), createdAt: NOW, ...over }
}
const codes = (issues: AssemblyIssue[], severity?: string) => issues.filter(i => !severity || i.severity === severity).map(i => i.code)
const ok = (input: AssemblyInput) => {
  const r = assembleDraft(input)
  if (!r.ok) throw new Error('assembly failed: ' + JSON.stringify(r.issues))
  return r
}
const deepFreeze = <T,>(o: T): T => {
  if (o && typeof o === 'object') { Object.values(o as object).forEach(deepFreeze); Object.freeze(o) }
  return o
}

// ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

describe('the real VA5368 blueprint (7 scenes, 30s)', () => {
  const plan = realPlan()
  const f = plan.scenes.map((_, i) => footage(`f${i + 1}`, 20 + i, 9000 + i))
  const r = ok({ plan, footage: f.map(x => ({ ...x, asset: { id: x.assetId, job_id: null, user_id: 1, original_filename: x.name, stored_filename: x.name, file_path: x.url, file_type: 'video', mime_type: 'video/mp4', file_size: 1, created_at: NOW } })), assignments: suggestAssignments(plan, f), createdAt: NOW })
  const snap = r.snapshot

  it('lays out seven ordered scenes that add up to 30 seconds, one clip each', () => {
    expect(plan.scenes.map(s => s.duration)).toEqual([4, 5, 5, 6, 5, 2, 3])
    expect(snap.videoClips).toHaveLength(7)
    plan.scenes.forEach((s, i) => {
      const c = snap.videoClips[i]
      expect(c.startTime).toBe(s.startTime)                       // clip starts exactly at the scene start...
      expect(c.endTime).toBe(s.endTime)                           // ...and ends exactly at the scene end (the sources are long enough)
      expect(c.assetId).toBe(9000 + i)
      expect(c.trimIn).toBe(0)
    })
    expect(snap.timeline.duration).toBe(30)
    expect(snap.assembly.summary).toMatchObject({ scenes: 7, scenesWithMedia: 7, scenesWithoutMedia: 0, clipsPlaced: 7, plannedSeconds: 30, filledSeconds: 30, gapSeconds: 0 })
  })

  it('keeps the blueprint’s placeholders exactly as the existing builder makes them (editable text + the call to action)', () => {
    expect(snap.textOverlays).toEqual(buildPlaceholderOverlays(plan))
    expect(snap.textOverlays.length).toBe(8)                      // 7 text placeholders + 1 CTA placeholder (scene 7)
    expect(snap.textOverlays.filter(t => t.blueprint?.kind === 'cta')).toHaveLength(1)
    expect(snap.textOverlays.every(t => t.text.includes('PLACEHOLDER'))).toBe(true)
  })

  it('includes the media entries of the footage actually used, so the Media panel can list them', () => {
    expect(snap.mediaAssets.map(a => a.id).sort()).toEqual(f.map(x => x.assetId).sort())
  })

  it('matches the committed fixture (the same file the backend compatibility test posts to the drafts API)', () => {
    const json = JSON.parse(JSON.stringify({ name: r.name, snapshot: snap }))
    if (process.env.UPDATE_ASSEMBLY_FIXTURE === '1') writeFileSync(FIXTURE_PATH, JSON.stringify(json, null, 2) + '\n')
    expect(existsSync(FIXTURE_PATH)).toBe(true)
    expect(json).toEqual(JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')))
  })
})

const CASES = Number(process.env.ASSEMBLY_PROPERTY_CASES ?? 400)                // raise it (e.g. 20000) for a deeper one-off run

describe('scene boundaries, trimming and timing (property test across 400 generated assemblies)', () => {
  // deterministic pseudo-random generator: the same cases every run
  let seed = 123456789
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 }
  const pick = <T,>(a: readonly T[]) => a[Math.floor(rnd() * a.length)]

  it('never crosses a scene boundary, never reads outside the source, always agrees with the editor’s own clip math', () => {
    const plan = realPlan()
    let okCount = 0, failCount = 0
    for (let n = 0; n < CASES; n++) {
      const f = Array.from({ length: 6 }, (_, i) => footage(`g${i}`, Math.round((0.4 + rnd() * 30) * 100) / 100, 100 + i))
      const assignments: SceneAssignment[] = []
      for (const s of plan.scenes) {
        if (rnd() < 0.15) continue                                   // some scenes get nothing
        const k = 1 + Math.floor(rnd() * 3)
        const clips: ClipUse[] = Array.from({ length: k }, () => {
          const src = pick(f)
          const u: ClipUse = { footageKey: src.key, trimIn: rnd() < 0.5 ? Math.round(rnd() * src.duration * 0.9 * 100) / 100 : 0 }
          if (rnd() < 0.3) u.useDuration = Math.round((0.2 + rnd() * s.duration / k) * 100) / 100
          if (rnd() < 0.3) u.speed = pick(ALLOWED_SPEEDS)
          return u
        })
        assignments.push({ sceneNumber: s.sceneNumber, clips })
      }
      const res = assembleDraft({ plan, footage: f, assignments, createdAt: NOW, options: { underfilled: rnd() < 0.5 ? 'gap' : 'stretch' } })
      if (!res.ok) { failCount++; expect(codes(res.issues, 'error').every(c => ['scene_overflow', 'invalid_trim'].includes(c))).toBe(true); continue }
      okCount++
      const clips = res.snapshot.videoClips
      for (const c of clips) {
        const scene = plan.scenes.find(s => c.id.includes(`:s${s.sceneNumber}:`))!
        expect(c.startTime).toBeGreaterThanOrEqual(scene.startTime)
        expect(c.endTime).toBeLessThanOrEqual(scene.endTime)                   // scene boundary respected EXACTLY (no tolerance)
        expect(c.endTime).toBeGreaterThan(c.startTime)
        expect(ALLOWED_SPEEDS as readonly number[]).toContain(c.speed)
        const span = (c.endTime - c.startTime) * c.speed
        expect(c.trimIn).toBeGreaterThanOrEqual(0)
        expect(c.trimOut).toBeGreaterThanOrEqual(0)
        expect(c.trimIn + span).toBeLessThanOrEqual(c.duration + 0.002)         // exporter reads [trimIn, trimIn+span): inside the file
        expect(Math.abs(c.duration - c.trimIn - c.trimOut - span)).toBeLessThanOrEqual(0.00001)   // editor's trim bookkeeping is self-consistent
        expect(Math.abs(computeEndTimeForSpeed(c, c.speed) - c.endTime)).toBeLessThanOrEqual(0.0001)   // identical to the editor's own endTime formula
        for (const t of [c.startTime, c.endTime, c.trimIn]) expect(Math.abs(Math.round(t * 1000) / 1000 - t)).toBeLessThan(1e-9)
        expect(Math.abs(Math.round(c.trimOut * 1e6) / 1e6 - c.trimOut)).toBeLessThan(1e-9)
      }
      const sorted = [...clips].sort((a, b) => a.startTime - b.startTime)
      sorted.forEach((c, i) => { if (i > 0) expect(c.startTime).toBeGreaterThanOrEqual(sorted[i - 1].endTime - 0.001) })   // no overlaps anywhere on the timeline
      const { filledSeconds, gapSeconds, plannedSeconds } = res.snapshot.assembly.summary
      expect(Math.abs(filledSeconds + gapSeconds - plannedSeconds)).toBeLessThanOrEqual(0.002)
    }
    expect(okCount).toBeGreaterThan(CASES * 0.35)
    expect(failCount).toBeGreaterThan(CASES * 0.01)                                         // the generator really does produce invalid input too
  })

  it('trims a long source down to its scene and records the trim the way the editor reads it', () => {
    const plan = realPlan()
    const r = ok(make({ plan, footage: [footage('long', 60, 5)], assignments: [{ sceneNumber: 1, clips: [{ footageKey: 'long', trimIn: 10 }] }] }))
    const c = r.snapshot.videoClips[0]
    expect([c.startTime, c.endTime, c.trimIn, c.trimOut, c.duration, c.speed]).toEqual([0, 4, 10, 46, 60, 1])      // 4s scene: uses 10s..14s, trims 46s off the end
  })

  it('shares a scene between several clips back to back and fills it exactly', () => {
    const plan = realPlan()
    const r = ok(make({ plan, footage: [footage('a', 30, 1), footage('b', 30, 2), footage('c', 30, 3)], assignments: [{ sceneNumber: 4, clips: [{ footageKey: 'a' }, { footageKey: 'b' }, { footageKey: 'c' }] }] }))
    const cs = r.snapshot.videoClips
    expect(cs.map(c => [c.startTime, c.endTime])).toEqual([[14, 16], [16, 18], [18, 20]])           // scene 4 = 14s..20s (4+5+5 before it), three equal shares
    expect(r.snapshot.assembly.scenes[3].media.coverage).toEqual({ filledSeconds: 6, gapSeconds: 0, status: 'filled' })
  })

  it('honours explicit per-clip durations and shares the rest', () => {
    const plan = realPlan()
    const r = ok(make({ plan, footage: [footage('a', 30, 1), footage('b', 30, 2)], assignments: [{ sceneNumber: 4, clips: [{ footageKey: 'a', useDuration: 4 }, { footageKey: 'b' }] }] }))
    expect(r.snapshot.videoClips.map(c => [c.startTime, c.endTime])).toEqual([[14, 18], [18, 20]])
  })

  it('clamps to the scene boundary exactly, even when explicit durations overshoot by the tolerated millisecond', () => {
    const plan = realPlan()                                                  // scene 2 = 4s..9s; 2.5005 + 2.5 = 5.0005s is within the 1 ms tolerance
    const r = ok(make({ plan, footage: [footage('a', 30, 1), footage('b', 30, 2)], assignments: [{ sceneNumber: 2, clips: [{ footageKey: 'a', useDuration: 2.5005 }, { footageKey: 'b', useDuration: 2.5 }] }] }))
    const [c1, c2] = r.snapshot.videoClips
    expect(c2.endTime).toBe(9)                                               // exactly the scene's end, not 9.0005
    expect(c1.endTime).toBeLessThanOrEqual(c2.startTime)
    expect(r.snapshot.videoClips.every(c => c.endTime <= 9 && c.startTime >= 4)).toBe(true)
  })

  it('divides awkward durations without drift (the last share absorbs rounding)', () => {
    const plan = realPlan()                                                  // scene 2 is 5s: three clips -> 1.667, 1.667, 1.666
    const r = ok(make({ plan, footage: [footage('a', 30, 1), footage('b', 30, 2), footage('c', 30, 3)], assignments: [{ sceneNumber: 2, clips: [{ footageKey: 'a' }, { footageKey: 'b' }, { footageKey: 'c' }] }] }))
    const cs = r.snapshot.videoClips
    expect(cs[2].endTime).toBe(9)
    expect(cs.reduce((n, c) => n + (c.endTime - c.startTime), 0)).toBeCloseTo(5, 6)
  })
})

describe('short sources (underfilled scenes)', () => {
  const plan = realPlan()
  it('"gap" policy (default): uses what exists and reports the uncovered seconds', () => {
    const r = ok(make({ plan, footage: [footage('short', 2.5, 1)], assignments: [{ sceneNumber: 2, clips: [{ footageKey: 'short' }] }] }))   // scene 2 wants 5s
    const c = r.snapshot.videoClips[0]
    expect([c.startTime, c.endTime, c.speed]).toEqual([4, 6.5, 1])
    expect(codes(r.issues, 'warning')).toContain('scene_underfilled')
    expect(r.snapshot.assembly.scenes[1].media.coverage).toEqual({ filledSeconds: 2.5, gapSeconds: 2.5, status: 'partial' })
  })

  it('"stretch" policy: slows the clip to the gentlest allowed speed that covers the scene', () => {
    const r = ok(make({ plan, footage: [footage('short', 4, 1)], assignments: [{ sceneNumber: 2, clips: [{ footageKey: 'short' }] }], options: { underfilled: 'stretch' } }))
    const c = r.snapshot.videoClips[0]                                       // want 5s from 4s: ratio 0.8 -> speed 0.75 -> uses 3.75s of source over 5s
    expect([c.startTime, c.endTime, c.speed]).toEqual([4, 9, 0.75])
    expect(c.trimOut).toBe(0.25)
    expect(codes(r.issues, 'warning')).not.toContain('scene_underfilled')
  })

  it('"stretch" cannot help when even the slowest speed is not enough: the gap is reported instead', () => {
    const r = ok(make({ plan, footage: [footage('tiny', 0.8, 1)], assignments: [{ sceneNumber: 2, clips: [{ footageKey: 'tiny' }] }], options: { underfilled: 'stretch' } }))
    expect(r.snapshot.videoClips[0].speed).toBe(1)
    expect(codes(r.issues, 'warning')).toContain('scene_underfilled')
  })

  it('an explicit speed is respected, never overridden by the policy', () => {
    const r = ok(make({ plan, footage: [footage('s', 30, 1)], assignments: [{ sceneNumber: 2, clips: [{ footageKey: 's', speed: 2 }] }], options: { underfilled: 'stretch' } }))
    const c = r.snapshot.videoClips[0]
    expect([c.speed, c.endTime - c.startTime, c.trimOut]).toEqual([2, 5, 20])     // 5s of timeline reads 10s of source
  })

  it('a sliver of source too short to be a clip is reported, not placed', () => {
    const r = ok(make({ plan, footage: [footage('sliver', 10, 1)], assignments: [{ sceneNumber: 2, clips: [{ footageKey: 'sliver', trimIn: 9.95 }] }] }))
    expect(r.snapshot.videoClips).toHaveLength(0)
    expect(codes(r.issues, 'warning')).toContain('clip_too_short')
  })
})

describe('missing clips', () => {
  const plan = realPlan()
  it('scenes without footage stay as empty scenes with their placeholders, and are reported', () => {
    const r = ok(make({ plan, footage: [footage('only', 30, 1)], assignments: [{ sceneNumber: 3, clips: [{ footageKey: 'only' }] }] }))
    expect(r.snapshot.videoClips).toHaveLength(1)
    expect(codes(r.issues, 'warning').filter(c => c === 'scene_unassigned')).toHaveLength(6)
    expect(r.snapshot.textOverlays).toHaveLength(8)                              // every scene still has its editable text placeholder
    const empty = r.snapshot.assembly.scenes.filter(s => s.media.origin === 'none')
    expect(empty).toHaveLength(6)
    expect(empty.every(s => s.media.coverage.status === 'empty' && s.media.clips.length === 0)).toBe(true)
  })

  it('no footage at all still yields an openable draft, with a clear "cannot export yet" warning', () => {
    const r = ok(make({ plan, footage: [], assignments: [] }))
    expect(r.snapshot.videoClips).toEqual([])
    expect(codes(r.issues, 'warning')).toContain('no_video_clips')
    const base = buildDraftSnapshot(plan)
    expect({ ...r.snapshot, assembly: undefined }).toEqual({ ...base, assembly: undefined })    // identical to the existing blueprint draft, plus the record
  })

  it('requireAllScenes turns an empty scene into an error', () => {
    const r = assembleDraft(make({ plan, footage: [footage('only', 30, 1)], assignments: [{ sceneNumber: 1, clips: [{ footageKey: 'only' }] }], options: { requireAllScenes: true } }))
    expect(r.ok).toBe(false)
    expect(codes(r.issues, 'error')).toContain('missing_clips')
  })

  it('refers to footage that was never supplied: refused', () => {
    const r = assembleDraft(make({ plan, footage: [footage('a', 30, 1)], assignments: [{ sceneNumber: 1, clips: [{ footageKey: 'ghost' }] }] }))
    expect(r.ok).toBe(false)
    expect(codes(r.issues, 'error')).toContain('missing_footage')
  })

  it('an assignment to a scene that does not exist, or the same scene twice: refused', () => {
    const f = [footage('a', 30, 1)]
    expect(codes(assembleDraft(make({ plan, footage: f, assignments: [{ sceneNumber: 99, clips: [{ footageKey: 'a' }] }] })).issues, 'error')).toContain('unknown_scene')
    expect(codes(assembleDraft(make({ plan, footage: f, assignments: [{ sceneNumber: 1, clips: [{ footageKey: 'a' }] }, { sceneNumber: 1, clips: [{ footageKey: 'a' }] }] })).issues, 'error')).toContain('duplicate_assignment')
  })

  it('footage that was supplied but not used, or used twice, is noted', () => {
    const r = ok(make({ plan, footage: [footage('a', 30, 1), footage('b', 30, 2), footage('spare', 30, 3)], assignments: [{ sceneNumber: 1, clips: [{ footageKey: 'a' }] }, { sceneNumber: 2, clips: [{ footageKey: 'a', trimIn: 5 }] }, { sceneNumber: 3, clips: [{ footageKey: 'b' }] }] }))
    expect(codes(r.issues, 'note')).toEqual(expect.arrayContaining(['footage_reused', 'footage_unused']))
  })
})

describe('invalid timing and invalid input never produce a draft', () => {
  const plan = realPlan()
  const f = [footage('a', 30, 1), footage('b', 10, 2)]
  const fails = (input: AssemblyInput, code: string) => {
    const r = assembleDraft(input)
    expect(r.ok, JSON.stringify(r.issues)).toBe(false)
    expect(codes(r.issues, 'error')).toContain(code)
    expect('snapshot' in r).toBe(false)
  }
  const one = (u: ClipUse, extra: Partial<AssemblyInput> = {}) => make({ plan, footage: f, assignments: [{ sceneNumber: 1, clips: [u] }], ...extra })

  it.each([
    ['negative trim start', { footageKey: 'a', trimIn: -1 }, 'invalid_trim'],
    ['trim start at the end of the file', { footageKey: 'b', trimIn: 10 }, 'invalid_trim'],
    ['trim start beyond the file', { footageKey: 'b', trimIn: 11 }, 'invalid_trim'],
    ['NaN trim', { footageKey: 'a', trimIn: Number.NaN }, 'invalid_trim'],
    ['zero duration', { footageKey: 'a', useDuration: 0 }, 'invalid_duration'],
    ['negative duration', { footageKey: 'a', useDuration: -2 }, 'invalid_duration'],
    ['non-finite duration', { footageKey: 'a', useDuration: Infinity }, 'invalid_duration'],
    ['a speed the editor does not have', { footageKey: 'a', speed: 3 as never }, 'invalid_speed'],
    ['volume above 1', { footageKey: 'a', volume: 1.5 }, 'invalid_option'],
    ['a clip longer than its scene', { footageKey: 'a', useDuration: 4.5 }, 'scene_overflow'],
  ] as [string, ClipUse, string][])('%s', (_name, use, code) => fails(one(use), code))

  it('clips that together overrun the scene', () => fails(make({ plan, footage: f, assignments: [{ sceneNumber: 1, clips: [{ footageKey: 'a', useDuration: 3 }, { footageKey: 'a', useDuration: 3 }] }] }), 'scene_overflow'))

  it('a plan whose scene timing does not add up', () => {
    const bad = realPlan(); bad.scenes[2].startTime += 0.5
    fails(make({ plan: bad, footage: f, assignments: [] }), 'inconsistent_scene_timing')
    const bad2 = realPlan(); bad2.totalSeconds = 31
    fails(make({ plan: bad2, footage: f, assignments: [] }), 'inconsistent_scene_timing')
  })

  it('a plan with a zero or non-numeric scene duration, a duplicate scene number, or no scenes', () => {
    const z = realPlan(); z.scenes[1].duration = 0
    fails(make({ plan: z, footage: f, assignments: [] }), 'invalid_duration')
    const d = realPlan(); d.scenes[1].sceneNumber = d.scenes[0].sceneNumber
    fails(make({ plan: d, footage: f, assignments: [] }), 'invalid_plan')
    const e = realPlan(); e.scenes = []
    fails(make({ plan: e, footage: f, assignments: [] }), 'invalid_plan')
    fails(make({ plan: { schema: 'nope' } as never, footage: f, assignments: [] }), 'invalid_plan')
  })

  it('footage with no duration, no playable URL, no asset id, or a repeated key', () => {
    fails(make({ plan, footage: [{ ...footage('a', 0, 1) }], assignments: [] }), 'invalid_footage')
    fails(make({ plan, footage: [{ ...footage('a', 5, 1), url: '' }], assignments: [] }), 'invalid_footage')
    fails(make({ plan, footage: [{ ...footage('a', 5, 1), assetId: undefined as never }], assignments: [] }), 'footage_missing_asset')
    fails(make({ plan, footage: [footage('a', 5, 1), footage('a', 6, 2)], assignments: [] }), 'duplicate_footage_key')
  })

  it('a missing or invalid creation time (the engine never reads a clock)', () => {
    fails({ ...make({ plan, footage: f }), createdAt: '' }, 'invalid_option')
    fails({ ...make({ plan, footage: f }), createdAt: 'not a date' }, 'invalid_option')
  })

  it('an unknown policy or element kind', () => {
    fails(make({ plan, footage: f, options: { underfilled: 'loop' as never } }), 'invalid_option')
    fails(make({ plan, footage: f, options: { requestedElements: ['hologram' as never] } }), 'invalid_option')
  })

  it('the reference video’s own media can never be used as replacement media', () => {
    fails(make({ plan, footage: [footage('ref', 30, 5127)], assignments: [{ sceneNumber: 1, clips: [{ footageKey: 'ref' }] }], options: { referenceAssetIds: [5127] } }), 'reference_media_not_allowed')
  })
})

describe('repeated assembly is deterministic and never mutates its inputs', () => {
  it('the same input gives byte-identical output and the same digest, every time', () => {
    const input = make()
    const a = ok(input), b = ok(make()), c = ok(input)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    expect(JSON.stringify(a)).toBe(JSON.stringify(c))
    expect(a.snapshot.assembly.inputDigest).toBe(b.snapshot.assembly.inputDigest)
  })

  it('does not mutate anything it is given (deeply frozen inputs assemble fine)', () => {
    const frozen = deepFreeze(make())
    expect(() => assembleDraft(frozen)).not.toThrow()
    expect(assembleDraft(frozen).ok).toBe(true)
  })

  it('footage order and assignment order do not change the result', () => {
    const plan = realPlan()
    const fs = plan.scenes.map((_, i) => footage(`f${i + 1}`, 20 + i, 9000 + i).key).map((k, i) => footage(k, 20 + i, 9000 + i))
    const asg = suggestAssignments(plan, fs)
    const a = ok({ plan, footage: fs, assignments: asg, createdAt: NOW })
    const b = ok({ plan, footage: [...fs].reverse(), assignments: [...asg].reverse(), createdAt: NOW })
    expect(JSON.stringify(a.snapshot)).toBe(JSON.stringify(b.snapshot))
  })

  it('a different creation time changes only the timestamps, not the structure', () => {
    const a = ok(make()), b = ok({ ...make(), createdAt: '2027-01-01T00:00:00.000Z' })
    expect(a.snapshot.assembly.inputDigest).toBe(b.snapshot.assembly.inputDigest)
    expect(a.snapshot.videoClips).toEqual(b.snapshot.videoClips)
    expect(a.snapshot.assembly.createdAt).not.toBe(b.snapshot.assembly.createdAt)
  })

  it('any change to the footage, assignments or policy changes the digest', () => {
    const base = ok(make()).snapshot.assembly.inputDigest
    const plan = realPlan()
    const f = plan.scenes.map((_, i) => footage(`f${i + 1}`, 20 + i))
    const variants = [
      make({ plan, footage: f.map((x, i) => (i === 0 ? { ...x, duration: x.duration + 1 } : x)), assignments: suggestAssignments(plan, f) }),
      make({ plan, footage: f, assignments: suggestAssignments(plan, f).slice(1) }),
      make({ plan, footage: f, assignments: suggestAssignments(plan, f), options: { underfilled: 'stretch' } }),
    ]
    for (const v of variants) expect(ok(v).snapshot.assembly.inputDigest).not.toBe(base)
  })
})

describe('unsupported and partial elements are classified honestly, and never faked', () => {
  it('has a class for every element kind, with the reference’s flattened content unsupported', () => {
    expect(ALL_ELEMENT_KINDS).toHaveLength(ELEMENT_CLASSES.length)
    const by = (k: ElementKind) => classifyElement(k).editability
    for (const k of ['scene_structure', 'clip_placement', 'clip_trim', 'clip_speed', 'text_placeholder', 'cta_placeholder'] as ElementKind[]) expect(by(k)).toBe('automatic')
    for (const k of ['transition', 'voiceover', 'music', 'captions', 'lower_third', 'shape'] as ElementKind[]) expect(by(k)).toBe('partial')
    for (const k of ['reference_footage', 'reference_burned_in_text', 'reference_graphics', 'reference_color_grade', 'reference_effects', 'reference_audio_mix'] as ElementKind[]) expect(by(k)).toBe('unsupported')
    expect(ELEMENT_CLASSES.every(c => c.reason.length > 20)).toBe(true)
  })

  it('asking for flattened reference content yields a warning and nothing in the draft', () => {
    const r = ok(make({ options: { requestedElements: ['reference_burned_in_text', 'reference_footage', 'reference_effects'] } }))
    expect(codes(r.issues, 'warning').filter(c => c === 'unsupported_element')).toHaveLength(3)
    expect(r.snapshot.assembly.unsupported.map(u => u.kind).sort()).toEqual(['reference_burned_in_text', 'reference_effects', 'reference_footage'])
    expect(r.snapshot.textOverlays.every(t => t.text.startsWith('TEXT PLACEHOLDER') || t.text.startsWith('CTA PLACEHOLDER'))).toBe(true)   // no re-created reference text
  })

  it('asking for partly-supported elements yields a note, and still creates nothing automatically', () => {
    const r = ok(make({ options: { requestedElements: ['voiceover', 'transition', 'lower_third', 'music'] } }))
    expect(codes(r.issues, 'note').filter(c => c === 'partial_element')).toHaveLength(4)
    const s = r.snapshot
    expect([s.lowerThirds, s.shapes, s.subtitles, s.mediaOverlays, s.audioTracks, s.additionalVideoClips].every(a => a.length === 0)).toBe(true)
    expect(s.videoClips.every(c => c.transition === 'cut')).toBe(true)                    // transitions are never guessed from plain-language direction
  })

  it('the classification table travels with the draft', () => {
    expect(ok(make()).snapshot.assembly.elementClasses).toEqual(ELEMENT_CLASSES.map(c => ({ ...c })))
  })

  it('always warns that placeholder text is real text that would be rendered into an export', () => {
    expect(ok(make()).issues.find(i => i.code === 'placeholder_text_present')?.message).toMatch(/replace or delete them before exporting/)
  })
})

describe('source evidence, inferred structure and supplied media stay distinct', () => {
  const plan = realPlan()
  const f = [footage('a', 30, 1), footage('b', 30, 2)]
  const r = ok(make({ plan, footage: f, assignments: [{ sceneNumber: 1, clips: [{ footageKey: 'a' }] }, { sceneNumber: 2, clips: [{ footageKey: 'b', trimIn: 3 }] }] }))
  const [s1, s2, s3, , , , s7] = r.snapshot.assembly.scenes

  it('every scene carries three differently-labelled parts', () => {
    for (const s of r.snapshot.assembly.scenes) {
      expect(s.evidence.origin).toBe('reference_evidence')
      expect(s.structure.origin).toBe('inferred_structure')
      expect(['user_supplied', 'none']).toContain(s.media.origin)
      expect(s.text.origin).toBe('placeholder')
    }
  })

  it('evidence is traceability to the reference only; it holds no media and no instructions', () => {
    expect(s1.evidence).toMatchObject({ referenceVideoId: 5127, videoAnalysisId: 5368 })
    expect(Object.keys(s1.evidence).sort()).toEqual(['anatomySections', 'confidence', 'limitations', 'origin', 'referenceVideoId', 'videoAnalysisId'])
    expect(JSON.stringify(s1.evidence)).not.toMatch(/uploads|\.mp4/)
  })

  it('structure is what the blueprint inferred (instructions and mechanisms), not content', () => {
    expect(s1.structure.mechanismIds).toEqual(['M01'])
    expect(s7.structure.instructions.cta).toBeTruthy()
    expect(s1.structure.instructions.visual.length).toBeGreaterThan(0)
  })

  it('supplied media is labelled as the user’s and records exactly what was placed', () => {
    expect(s1.media.origin).toBe('user_supplied')
    expect(s2.media.clips[0]).toMatchObject({ footageKey: 'b', assetId: 2, trimIn: 3, timelineStart: 4, timelineEnd: 9 })
    expect(s3.media.origin).toBe('none')                                                   // nothing supplied: never invented
  })

  it('text placeholders point at the real overlay ids, and are marked as not replaced', () => {
    expect(s7.text).toMatchObject({ origin: 'placeholder', replaced: false, editability: 'automatic' })
    expect(r.snapshot.textOverlays.map(t => t.id)).toContain(s7.text.textElementId)
    expect(r.snapshot.textOverlays.map(t => t.id)).toContain(s7.text.ctaElementId)
    expect(s1.text.ctaElementId).toBeNull()
  })
})

describe('suggestAssignments', () => {
  const plan = realPlan()
  it('assigns footage in scene order, one clip per scene, without reuse by default', () => {
    const a = suggestAssignments(plan, [footage('x', 5, 1), footage('y', 5, 2), footage('z', 5, 3)])
    expect(a.map(s => [s.sceneNumber, s.clips[0].footageKey])).toEqual([[1, 'x'], [2, 'y'], [3, 'z']])       // scenes 4-7 stay empty rather than reusing footage
  })
  it('can cycle footage when reuse is asked for', () => {
    const a = suggestAssignments(plan, [footage('x', 5, 1), footage('y', 5, 2)], { reuse: true })
    expect(a).toHaveLength(7)
    expect(a.map(s => s.clips[0].footageKey)).toEqual(['x', 'y', 'x', 'y', 'x', 'y', 'x'])
  })
  it('returns nothing for no footage, and the result always assembles', () => {
    expect(suggestAssignments(plan, [])).toEqual([])
    const f = [footage('x', 30, 1)]
    expect(assembleDraft(make({ plan, footage: f, assignments: suggestAssignments(plan, f) })).ok).toBe(true)
  })
})

describe('draft compatibility with the existing Video Studio V2 draft path', () => {
  const plan = realPlan()
  const f = plan.scenes.map((_, i) => footage(`f${i + 1}`, 20 + i, 9000 + i))
  const r = ok(make({ plan, footage: f }))
  const snap = r.snapshot as unknown as Record<string, unknown>
  const editorSource = readFileSync(join(SRC, 'pages/video-studio-v2/components/CreateEditTab.tsx'), 'utf8').replace(/\r\n/g, '\n')

  it('has every key the editor’s own open-draft path reads', () => {
    const open = editorSource.slice(editorSource.indexOf('(snap.videoClips ?? [])'), editorSource.indexOf('// Requirement 9'))
    const read = new Set([...open.matchAll(/snap\.([A-Za-z]+)/g)].map(m => m[1]))
    expect(read.size).toBeGreaterThan(10)
    const optionalInEditor = new Set(['subtitleStyle', 'canvasFormat'])                           // the editor treats these as optional
    for (const key of read) if (!optionalInEditor.has(key)) expect(Object.keys(snap), `missing ${key}`).toContain(key)
  })

  it('adds only one extra key (`assembly`), which the editor never reads, and keeps every key the blueprint draft already had', () => {
    expect(editorSource).not.toMatch(/\bassembly\b/i)
    const base = Object.keys(buildDraftSnapshot(plan))
    expect(Object.keys(snap).filter(k => !base.includes(k))).toEqual(['assembly'])
    for (const k of base) expect(Object.keys(snap)).toContain(k)
  })

  it('is plain JSON: it survives a round trip through the drafts API unchanged', () => {
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap)
    expect(JSON.stringify(snap)).not.toMatch(/undefined|NaN|Infinity/)
    expect(JSON.stringify(snap).length).toBeLessThan(200_000)
  })

  it('has a draft name that fits the drafts table (255 characters)', () => {
    expect(r.name.length).toBeLessThanOrEqual(255)
    expect(r.name).toMatch(/^Blueprint — /)
  })

  it('every clip is a complete VideoClip: unique ids, valid enums, finite numbers, a real asset id', () => {
    const ids = r.snapshot.videoClips.map(c => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const c of r.snapshot.videoClips) {
      expect(Number.isInteger(c.assetId)).toBe(true)
      expect(c.colorGrade).toBe('none')
      expect(['cut', 'dissolve', 'whip_pan', 'fade_black', 'zoom_punch']).toContain(c.transition)
      for (const k of ['duration', 'startTime', 'endTime', 'trimIn', 'trimOut', 'speed', 'brightness', 'contrast', 'saturation', 'transitionDuration'] as const) expect(Number.isFinite(c[k])).toBe(true)
    }
    expect(r.snapshot.videoClips.every(c => c.id.startsWith(`asm:${plan.blueprintId}:`))).toBe(true)     // reproducible ids, no random UUIDs
  })

  it('uses the same defaults the editor’s own timeline uses when you drop a clip on it', () => {
    const c = r.snapshot.videoClips[0]
    expect([c.colorGrade, c.speed, c.brightness, c.contrast, c.saturation, c.transition, c.transitionDuration]).toEqual(['none', 1, 0, 0, 0, 'cut', 0.5])
  })

  it('a draft saved before this feature (no `assembly` key) is unaffected: the editor reads each key defensively', () => {
    const open = editorSource.slice(editorSource.indexOf('(snap.videoClips ?? [])'), editorSource.indexOf('// Requirement 9'))
    expect((open.match(/\?\? \[\]/g) ?? []).length).toBeGreaterThanOrEqual(8)                 // every array key falls back to []
    expect(open).toContain('isBlueprintPlan(snap.blueprintPlan)')
  })
})

describe('purity: the engine cannot touch drafts, storage, the network, clocks or randomness', () => {
  const files = ['assembleDraft.ts', 'elementClasses.ts', 'types.ts', 'index.ts']
  const code = (f: string) => readFileSync(join(SRC, 'pages/deconstructor/assembly', f), 'utf8').replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  it.each(files)('%s has no I/O, clock or randomness', f => {
    const src = code(f)
    for (const banned of [/\bfetch\(/, /axios/, /localStorage/, /sessionStorage/, /\bDate\.now\(/, /new Date\(\)/, /Math\.random/, /crypto\.randomUUID/, /console\./, /XMLHttpRequest/, /videoStudioDraftsApi/, /\bwindow\b/, /\bdocument\b/]) expect(src).not.toMatch(banned)
  })
  it('imports only types, the existing blueprint builders, and its own files', () => {
    const imports = files.flatMap(f => [...code(f).matchAll(/from '([^']+)'/g)].map(m => m[1]))
    for (const i of imports) expect(i).toMatch(/^(\.\/|\.\.\/\.\.\/\.\.\/types$|\.\.\/\.\.\/video-studio-v2\/blueprint\/blueprintPlan$)/)
  })
  it('summarizeIssues counts by severity', () => {
    expect(summarizeIssues([{ severity: 'error', code: 'invalid_plan', message: '' }, { severity: 'note', code: 'footage_unused', message: '' }, { severity: 'note', code: 'footage_reused', message: '' }])).toEqual({ errors: 1, warnings: 0, notes: 2 })
  })
})
