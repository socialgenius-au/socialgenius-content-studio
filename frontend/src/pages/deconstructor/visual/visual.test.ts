// M4 -- deterministic tests of the visual intelligence module on SYNTHETIC evidence shaped like the analysis's own API response. Numbers for the handle and caption cases are copied from the shapes VA5368 produced
// (a handle that hops between fixed spots; a caption word that slides along one line); the real-data check lives in real.local.test.ts and runs only when the evidence file is present.
import { describe, expect, it } from 'vitest'
import type { ReferenceVideo } from '../../../types'
import { applyCorrection, buildVisualElements, classifyTextTrack, movementOf, RULE_CAP, USER_ONLY_CLASSES, visibilityIntervals, type BarEvidence, type Track, type VisualElement } from '.'

const FW = 480, FH = 864
const frame = (id: number, t: number) => ({ id, order: 0, timestamp: t, extraction_method: 'x', width: FW, height: FH, measurements: {}, certainty: 'MEASURED', evidence_summary: null, produced_by_pass: null, asset_file_path: `/f/${id}.jpg` })
interface Obs { t: number; box: [number, number, number, number]; text: string; conf?: number; frameId: number }
const group = (id: number, obs: Obs[]) => ({
  id, text: obs[0].text, start_time: obs[0].t, end_time: obs[obs.length - 1].t, x: obs[0].box[0], y: obs[0].box[1], width: obs[0].box[2], height: obs[0].box[3], certainty: 'MEASURED', confidence_score: obs[0].conf ?? 0.9,
  category: null, style_details: null, evidence_summary: null, produced_by_pass: null, source_frame_asset_file_path: `/f/${obs[0].frameId}.jpg`,
  observations: obs.map((o, i) => ({ id: id * 100 + i, text: o.text, timestamp: o.t, x: o.box[0], y: o.box[1], width: o.box[2], height: o.box[3], confidence_score: o.conf ?? 0.9, evidence_summary: null, source_frame_asset_file_path: `/f/${o.frameId}.jpg` })),
})
interface Det { id: number; label?: string; frameId: number; box: [number, number, number, number]; conf?: number }
const det = (d: Det) => ({ id: d.id, label: d.label ?? 'laptop', category: (d.label ?? 'laptop') === 'person' ? 'person' : 'object', class_id: 1, x: d.box[0], y: d.box[1], width: d.box[2], height: d.box[3], start_time: 0, end_time: 0, certainty: 'MEASURED',
  confidence_score: d.conf ?? 0.9, evidence_summary: null, source: 'torchvision', produced_by_pass: 'x', source_frame_id: d.frameId, source_frame_asset_file_path: null })

interface ShotSpec { id: number; start: number; end: number; frames: [number, number][]; texts?: ReturnType<typeof group>[]; dets?: Det[]; persistent?: { id: number; members: number[] }[] }
function ref(shots: ShotSpec[], recurring: { id: number; members: number[] }[] = [], duration = 43): ReferenceVideo {
  return {
    id: 1, rights_status: 'unknown_third_party', technical_details: { container: { duration_seconds: duration }, video: { width: FW, height: FH, duration_seconds: duration } },
    shots: shots.map(s => ({ id: s.id, order: 0, start_time: s.start, end_time: s.end, certainty: 'MEASURED', evidence_summary: null, produced_by_pass: null, frames: s.frames.map(([i, t]) => frame(i, t)), text_elements: s.texts ?? [], visual_objects: (s.dets ?? []).map(det),
      persistent_visual_elements: (s.persistent ?? []).map(p => ({ id: p.id, member_visual_object_ids: p.members })) })),
    recurring_elements: recurring.map(r => ({ id: r.id, member_text_element_ids: r.members, start_time: 0, end_time: duration, certainty: 'INFERRED', confidence_score: 0.9, reasoning: null, evidence_summary: null, produced_by_pass: 'recurring_text_linkage_v1' })),
  } as unknown as ReferenceVideo
}
const build = (r: ReferenceVideo, extra: Partial<Parameters<typeof buildVisualElements>[1]> = {}) => buildVisualElements(r, { videoAnalysisId: 9, ...extra })
const byId = (els: VisualElement[], id: string) => els.find(e => e.id === id)!

const FRAMES: [number, number][] = [[1, 3.1], [2, 10], [3, 18.4], [4, 24.9], [5, 33.7]]
const handleGroups = [
  group(11, [{ t: 3.1, box: [0.688, 0.282, 0.25, 0.028], text: 'GTANUCREATES_O', conf: 0.79, frameId: 1 }, { t: 18.4, box: [0.688, 0.282, 0.25, 0.028], text: 'GTANUGREATES_O', conf: 0.83, frameId: 3 }, { t: 33.7, box: [0.688, 0.282, 0.25, 0.028], text: 'GTANUGREATES_O', conf: 0.88, frameId: 5 }]),
  group(12, [{ t: 10, box: [0.11, 0.707, 0.246, 0.023], text: 'GTANUCREATESO', conf: 0.82, frameId: 2 }, { t: 24.9, box: [0.11, 0.707, 0.246, 0.023], text: 'GTANUCREATESO', conf: 0.77, frameId: 4 }]),
]
const captionGroups = [[1, 6.1, 0.107], [2, 10, 0.229], [3, 15, 0.679], [4, 18.4, 0.188], [5, 24.5, 0.111]].map(([f, t, x], i) => group(21 + i, [{ t, box: [x, 0.74, 0.12, 0.045], text: 'Aap', conf: 0.99, frameId: f }]))

describe('recurring text: a handle is a handle, a caption word is a caption, and neither is a logo', () => {
  const r = ref([{ id: 7, start: 0, end: 43, frames: [...FRAMES, [6, 6.1]].sort((a, b) => a[1] - b[1]) as [number, number][], texts: [...handleGroups, ...captionGroups] }], [{ id: 301, members: [11, 12] }, { id: 302, members: [21, 22, 23, 24, 25] }])
  const els = build(r)
  it('the creator handle that hops between fixed spots is TEXT_HANDLE, medium confidence at most, with reasons and evidence', () => {
    const e = byId(els, 'tt:rec:301')
    expect(e.classification.class).toBe('TEXT_HANDLE')
    expect(e.classification.confidence.level).not.toBe('high')                                   // OCR reads it differently each time
    expect(e.track.movement.kind).toBe('fixed_spots'); expect(e.track.movement.spots).toBe(2)
    expect(e.classification.explanation.join(' ')).toMatch(/handle or code/); expect(e.classification.explanation.join(' ')).toMatch(/hops|returns to the same 2 spots/)
    expect(e.classification.evidence.map(x => x.kind)).toEqual(expect.arrayContaining(['recurring_element', 'text_element']))
    expect(e.classification.evidence.find(x => x.kind === 'recurring_element')!.certainty).toBe('INFERRED')
    expect(e.readiness.state).toBe('native_text')
  })
  it('the sliding caption word is TEXT_CAPTION, never a handle or a graphic', () => {
    const e = byId(els, 'tt:rec:302')
    expect(e.classification.class).toBe('TEXT_CAPTION'); expect(e.track.movement.kind).toBe('slides')
    expect(e.classification.explanation.join(' ')).toMatch(/slides along one line/)
  })
  it('nothing recognised only by its text is ever a graphical class, whatever it does', () => {
    for (const e of els) expect(USER_ONLY_CLASSES).not.toContain(e.classification.class)
  })
  it('every classification has an explanation, evidence, a certainty from the analysis vocabulary and a capped confidence', () => {
    for (const e of els) {
      expect(e.classification.explanation.length).toBeGreaterThan(0)
      expect(['OBSERVED', 'MEASURED', 'INFERRED', 'RESEARCH_SUPPORTED', 'RECOMMENDED']).toContain(e.classification.certainty)
      expect(e.classification.confidence.score).toBeLessThanOrEqual(RULE_CAP)
      expect(e.claims).toEqual({ originalAssetRecovered: false, backgroundSeparated: false, exactStyleRecovered: false })
    }
  })
})

describe('ambiguous text versus logo', () => {
  it('a short capitalised word that stays in one corner for most of the video is TEXT_OTHER, flagged as worth checking, not a logo', () => {
    const g = group(31, [0, 8, 16, 24, 32, 40].map((t, i) => ({ t, box: [0.8, 0.05, 0.15, 0.04] as [number, number, number, number], text: 'BRAND', conf: 0.9, frameId: i + 1 })))
    const e = build(ref([{ id: 7, start: 0, end: 43, frames: [0, 8, 16, 24, 32, 40].map((t, i) => [i + 1, t] as [number, number]), texts: [g] }]))[0]
    expect(e.classification.class).toBe('TEXT_OTHER')
    expect(e.classification.explanation.join(' ')).toMatch(/worth checking, not a logo/)
    expect(e.readiness.state).toBe('native_text')
  })
  it('a person can say it IS a logo: the class becomes LOGO_MARK by their basis, and readiness then demands their image', () => {
    const g = group(31, [0, 8, 16].map((t, i) => ({ t, box: [0.8, 0.05, 0.15, 0.04] as [number, number, number, number], text: 'BRAND', frameId: i + 1 })))
    const r = ref([{ id: 7, start: 0, end: 43, frames: [0, 8, 16].map((t, i) => [i + 1, t] as [number, number]), texts: [g] }])
    const before = build(r)[0]
    const e = build(r, { corrections: { [before.id]: { class: 'LOGO_MARK' } } })[0]
    expect(e.classification).toMatchObject({ class: 'LOGO_MARK', basis: 'user', certainty: 'OBSERVED' })
    expect(e.classification.evidence.some(x => x.kind === 'user_correction')).toBe(true)
    expect(e.classification.alternatives[0].class).toBe(before.classification.class)
    expect(e.readiness.state).toBe('needs_user_asset'); expect(e.readiness.limitations.join(' ')).toMatch(/never rebuilt from its text/)
  })
})

describe('subtitle lines', () => {
  it('several short, different texts at one height in the lower part of the frame are TEXT_SUBTITLE, with the check against the transcript stated as not done', () => {
    const lines = ['Aap kaisi hain', 'Main theek hoon', 'Chalo chalte hain', 'Phir milenge'].map((text, i) => group(41 + i, [{ t: 2 + i * 3, box: [0.2, 0.84, 0.6, 0.05], text, conf: 0.9, frameId: i + 1 }]))
    const els = build(ref([{ id: 7, start: 0, end: 43, frames: [1, 2, 3, 4].map((i) => [i, 2 + (i - 1) * 3] as [number, number]), texts: lines }]))
    expect(els.every(e => e.classification.class === 'TEXT_SUBTITLE')).toBe(true)
    expect(els[0].classification.explanation.join(' ')).toMatch(/Not checked against the transcript/)
    expect(els[0].readiness.limitations.join(' ')).toMatch(/Transcript panel/)
  })
  it('two such lines are not enough to call a pattern: they stay plain text', () => {
    const two = ['Aap kaisi hain', 'Main theek hoon'].map((text, i) => group(41 + i, [{ t: 2 + i * 3, box: [0.2, 0.84, 0.6, 0.05], text, frameId: i + 1 }]))
    const els = build(ref([{ id: 7, start: 0, end: 43, frames: [[1, 2], [2, 5]], texts: two }]))
    expect(els.some(e => e.classification.class === 'TEXT_SUBTITLE')).toBe(false)
  })
})

describe('low confidence and missing evidence stay uncertain', () => {
  it('very unsure OCR is UNKNOWN, not a guess', () => {
    const e = build(ref([{ id: 7, start: 0, end: 43, frames: [[1, 3]], texts: [group(51, [{ t: 3, box: [0.3, 0.3, 0.2, 0.05], text: 'Hello', conf: 0.2, frameId: 1 }])] }]))[0]
    expect(e.classification.class).toBe('UNKNOWN'); expect(e.classification.explanation[0]).toMatch(/only 20% sure/); expect(e.readiness.state).toBe('not_reliable')
  })
  it('a single sighting never earns high confidence and says it is a first impression', () => {
    const e = build(ref([{ id: 7, start: 0, end: 43, frames: [[1, 3]], texts: [group(52, [{ t: 3, box: [0.3, 0.3, 0.3, 0.05], text: '@someone', conf: 0.95, frameId: 1 }])] }]))[0]
    expect(e.classification.confidence.level).toBe('low'); expect(e.classification.explanation.join(' ')).toMatch(/Seen only once/)
    expect(e.readiness.limitations.join(' ')).toMatch(/Seen once/)
  })
  it('numbers alone are other text, not a handle', () => {
    const e = build(ref([{ id: 7, start: 0, end: 43, frames: [[1, 3]], texts: [group(53, [{ t: 3, box: [0.3, 0.3, 0.1, 0.05], text: '40', conf: 0.9, frameId: 1 }])] }]))[0]
    expect(e.classification.class).toBe('TEXT_OTHER')
  })
  it('an analysis with no text and no objects yields no elements, and never throws', () => {
    expect(build(ref([{ id: 7, start: 0, end: 43, frames: [[1, 3]] }]))).toEqual([])
    expect(() => build({ id: 1, shots: [] } as unknown as ReferenceVideo)).not.toThrow()
    expect(() => build({ id: 1, shots: [{ id: 1, text_elements: [{ id: 5, text: '', x: 0, y: 0, width: 0, height: 0 }], visual_objects: [{ id: 2, label: 'x' }] }] } as unknown as ReferenceVideo)).not.toThrow()
  })
})

describe('objects: tracking, identity and shot boundaries', () => {
  const frames: [number, number][] = [[1, 0.15], [2, 5], [3, 10], [4, 15], [5, 40.2]]
  it('an object that enters and leaves is one track with an interval strictly inside the sampled range', () => {
    const els = build(ref([{ id: 9, start: 0, end: 40, frames: frames.slice(0, 4), dets: [{ id: 101, frameId: 2, box: [0.6, 0.1, 0.3, 0.12] }, { id: 102, frameId: 3, box: [0.61, 0.1, 0.3, 0.12] }], persistent: [{ id: 700, members: [101, 102] }] }]))
    expect(els).toHaveLength(1)
    const e = els[0]
    expect(e.id).toBe('ot:pve:700'); expect(e.track.linkage).toMatchObject({ by: 'persistent_visual_element', crossesShotBoundary: false })
    expect(e.track.intervals).toEqual([{ start: 5, end: 10, observed: [5, 10], kind: 'span_between_sightings', shotId: 9 }])
    expect(e.first).toBe(5); expect(e.last).toBe(10)
    expect(e.classification.class).toBe('IMAGE_REGION'); expect(e.classification.confidence.level).not.toBe('high')
    expect(e.classification.explanation.join(' ')).toMatch(/not a logo/); expect(e.readiness.state).toBe('needs_user_asset')
  })
  it('an object missing at a sampled instant is split into two visibility intervals (occluded or gone), not one continuous span', () => {
    const els = build(ref([{ id: 9, start: 0, end: 40, frames: frames.slice(0, 4), dets: [{ id: 101, frameId: 2, box: [0.6, 0.1, 0.3, 0.12] }, { id: 102, frameId: 4, box: [0.6, 0.1, 0.3, 0.12] }], persistent: [{ id: 701, members: [101, 102] }] }]))
    expect(els[0].track.intervals.map(i => [i.start, i.end, i.kind])).toEqual([[5, 5, 'single_instant'], [15, 15, 'single_instant']])
  })
  it('two objects with the same label in different places on one frame stay two identities', () => {
    const els = build(ref([{ id: 9, start: 0, end: 40, frames: frames.slice(0, 3), dets: [{ id: 101, frameId: 2, box: [0.1, 0.1, 0.2, 0.1] }, { id: 102, frameId: 2, box: [0.7, 0.6, 0.2, 0.1] }] }]))
    expect(els.map(e => e.id).sort()).toEqual(['ot:det:101', 'ot:det:102'])
  })
  it('similar positions across a shot boundary are NOT merged, and a persistent element is never extended across one', () => {
    const els = build(ref([
      { id: 9, start: 0, end: 20, frames: frames.slice(0, 4), dets: [{ id: 101, frameId: 2, box: [0.6, 0.1, 0.3, 0.12] }, { id: 102, frameId: 3, box: [0.6, 0.1, 0.3, 0.12] }], persistent: [{ id: 702, members: [101, 102] }] },
      { id: 10, start: 20, end: 43, frames: [frames[4]], dets: [{ id: 103, frameId: 5, box: [0.6, 0.1, 0.3, 0.12] }], persistent: [{ id: 703, members: [101, 103] }] },        // a corrupt link across shots
    ]))
    expect(els.map(e => e.id).sort()).toEqual(['ot:det:103', 'ot:pve:702'])
    expect(byId(els, 'ot:det:103').track.shotIds).toEqual([10])
  })
  it('a person is the reference’s own footage: UNKNOWN, not reliable, never an image slot', () => {
    const e = build(ref([{ id: 9, start: 0, end: 40, frames: frames.slice(0, 2), dets: [{ id: 101, label: 'person', frameId: 2, box: [0.08, 0.11, 0.88, 0.71] }] }]))[0]
    expect(e.classification.class).toBe('UNKNOWN'); expect(e.readiness.state).toBe('not_reliable')
  })
})

describe('text tracks across shots', () => {
  it('a recurring element that spans two shots is one identity and says it crosses a boundary', () => {
    const a = group(61, [{ t: 3, box: [0.1, 0.7, 0.3, 0.03], text: '@creator_x', frameId: 1 }]), b = group(62, [{ t: 30, box: [0.1, 0.7, 0.3, 0.03], text: '@creator_x', frameId: 2 }])
    const els = build(ref([{ id: 9, start: 0, end: 20, frames: [[1, 3]], texts: [a] }, { id: 10, start: 20, end: 43, frames: [[2, 30]], texts: [b] }], [{ id: 400, members: [61, 62] }]))
    expect(els).toHaveLength(1)
    expect(els[0].track).toMatchObject({ id: 'tt:rec:400', shotIds: [9, 10], linkage: { by: 'recurring_element', ids: [61, 62], crossesShotBoundary: true } })
    expect(els[0].track.intervals.map(i => i.shotId)).toEqual([9, 10])                           // one interval per shot: nothing is claimed between them
  })
  it('a recurring element with fewer than two readable groups falls back to single groups', () => {
    const a = group(61, [{ t: 3, box: [0.1, 0.7, 0.3, 0.03], text: '@creator_x', frameId: 1 }])
    const els = build(ref([{ id: 9, start: 0, end: 20, frames: [[1, 3]], texts: [a] }], [{ id: 400, members: [61, 999] }]))
    expect(els.map(e => e.id)).toEqual(['tt:grp:61'])
  })
})

describe('background bars', () => {
  const bar = (over: Partial<BarEvidence> = {}): BarEvidence => ({ sceneNumber: 1, side: 'top', size: 0.12, color: '#080808', uniformity: 1, framesSeen: 2, framesMeasured: 2, flat: true, startTime: 0, endTime: 10, frameIds: [1], ...over })
  it('a flat band is a BACKGROUND_ELEMENT that can be rebuilt as a native shape, with its measurement as evidence', () => {
    const e = build(ref([{ id: 9, start: 0, end: 10, frames: [[1, 1]] }]), { background: [bar()] })[0]
    expect(e.classification.class).toBe('BACKGROUND_ELEMENT'); expect(e.readiness.state).toBe('native_shape'); expect(e.classification.evidence[0]).toMatchObject({ kind: 'background_measurement', certainty: 'MEASURED' })
    expect(e.box).toEqual({ x: 0, y: 0, w: 1, h: 0.12 })
  })
  it('a gradient or busy border is a low-confidence background element that needs restoration we do not do', () => {
    const e = build(ref([{ id: 9, start: 0, end: 10, frames: [[1, 1]] }]), { background: [bar({ flat: false, uniformity: 0.5 })] })[0]
    expect(e.classification.confidence.level).toBe('low'); expect(e.readiness.state).toBe('needs_background_restoration'); expect(e.readiness.limitations.join(' ')).toMatch(/separately approved design/)
  })
})

describe('signals', () => {
  it('movement kinds', () => {
    const box = (x: number, y: number) => ({ x, y, w: 0.1, h: 0.05 })
    expect(movementOf([box(0.1, 0.1)]).kind).toBe('single_sighting')
    expect(movementOf([box(0.1, 0.1), box(0.1, 0.1)]).kind).toBe('static')
    expect(movementOf([box(0.1, 0.7), box(0.5, 0.7), box(0.8, 0.7)]).kind).toBe('slides')
    expect(movementOf([box(0.1, 0.1), box(0.6, 0.5), box(0.1, 0.1), box(0.6, 0.5)]).kind).toBe('fixed_spots')
    expect(movementOf([box(0.1, 0.1), box(0.5, 0.5), box(0.8, 0.3)]).kind).toBe('moves')
  })
  it('visibility intervals split only where the analysis looked and did not see it', () => {
    expect(visibilityIntervals([5, 15], [0.15, 5, 10, 15], 1).length).toBe(2)
    expect(visibilityIntervals([5, 15], [], 1)).toEqual([{ start: 5, end: 15, observed: [5, 15], kind: 'span_between_sightings', shotId: 1 }])
    expect(visibilityIntervals([], [1, 2], 1)).toEqual([])
  })
})

describe('determinism and safety', () => {
  const r = ref([{ id: 7, start: 0, end: 43, frames: [...FRAMES, [6, 6.1]].sort((a, b) => a[1] - b[1]) as [number, number][], texts: [...handleGroups, ...captionGroups], dets: [{ id: 101, frameId: 2, box: [0.6, 0.1, 0.3, 0.12] }] }], [{ id: 301, members: [11, 12] }])
  it('is deterministic, derives ids from the analysis only, and does not mutate its input', () => {
    const before = JSON.stringify(r)
    const a = build(r), b = build(JSON.parse(JSON.stringify(r)))
    expect(JSON.stringify(a)).toBe(JSON.stringify(b)); expect(JSON.stringify(r)).toBe(before)
    for (const e of a) expect(e.id).toMatch(/^(tt:(rec|grp):\d+|ot:(det|pve):\d+|bt:\d+:\w+)$/)
  })
  it('property: over random text tracks no rule ever returns a user-only class or a score above the cap', () => {
    let seed = 12345
    const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296 }
    const pool = ['@a_b', 'Hello', 'BRAND', '40', 'GTANUCREATES_O', 'Kabhi Wapas Laut Kar', 'www.x.com', 'Aap', 'ABCDEFGHIJ', '']
    for (let k = 0; k < 400; k++) {
      const n = 1 + Math.floor(rnd() * 6)
      const obs = Array.from({ length: n }, (_, i) => ({ time: i * 4, frameId: i, shotId: 1, ocrConfidence: rnd() < 0.2 ? null : rnd(), text: pool[Math.floor(rnd() * pool.length)], box: { x: rnd() * 0.8, y: rnd() * 0.9, w: 0.05 + rnd() * 0.2, h: 0.02 + rnd() * 0.05 },
        evidence: { kind: 'text_observation' as const, id: i, certainty: 'MEASURED' as const, note: '' } }))
      const t: Track = { id: `tt:grp:${k}`, kind: 'text', shotIds: [1], observations: obs, intervals: visibilityIntervals(obs.map(o => o.time), [], 1), movement: movementOf(obs.map(o => o.box)), linkage: { by: n > 1 ? 'occurrence_group' : 'single', ids: [k], crossesShotBoundary: false } }
      const c = classifyTextTrack(t, { videoSeconds: rnd() < 0.2 ? null : 43, subtitleTrackIds: new Set() })
      expect(USER_ONLY_CLASSES).not.toContain(c.class)
      expect(c.confidence.score).toBeLessThanOrEqual(RULE_CAP); expect(c.confidence.score).toBeGreaterThanOrEqual(0)
      expect(c.explanation.length).toBeGreaterThan(0)
      if (c.class === 'UNKNOWN') expect(c.confidence.level).toBe('low')
      expect(applyCorrection(c, undefined)).toBe(c)
    }
  })
})
