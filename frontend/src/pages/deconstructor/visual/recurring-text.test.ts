// M4 -- recurrence is evidence that something is the SAME thing across shots. It is never evidence that the thing is branding. These tests pin that down on evidence shaped like the analysis's own API
// response (the same synthetic builders as visual.test.ts), and pin down the other half of the rule: a graphic with no text, and an object the detector merely found in a corner, stay explicitly undetected
// as a logo unless a person says so.
import { describe, expect, it } from 'vitest'
import type { ReferenceVideo } from '../../../types'
import { buildVisualElements, RULE_CAP, USER_ONLY_CLASSES } from '.'

const FW = 480, FH = 864
const frame = (id: number, t: number) => ({ id, order: 0, timestamp: t, extraction_method: 'x', width: FW, height: FH, measurements: {}, certainty: 'MEASURED', evidence_summary: null, produced_by_pass: null, asset_file_path: `/f/${id}.jpg` })
type Box = [number, number, number, number]
const group = (id: number, text: string, times: number[], box: Box, conf = 0.9) => ({
  id, text, start_time: times[0], end_time: times[times.length - 1], x: box[0], y: box[1], width: box[2], height: box[3], certainty: 'MEASURED', confidence_score: conf, category: null, style_details: null, evidence_summary: null, produced_by_pass: null, source_frame_asset_file_path: '/f/1.jpg',
  observations: times.map((t, i) => ({ id: id * 100 + i, text, timestamp: t, x: box[0], y: box[1], width: box[2], height: box[3], confidence_score: conf, evidence_summary: null, source_frame_asset_file_path: `/f/${i + 1}.jpg`, frame_id: i + 1 })),
})
const TIMES = [2, 9, 16, 23, 30, 37]
const shots = (texts: ReturnType<typeof group>[], extra: Record<string, unknown> = {}) => TIMES.map((t, i) => ({
  id: 10 + i, order: i, start_time: t - 1.5, end_time: t + 5.5, certainty: 'MEASURED', evidence_summary: null, produced_by_pass: null, frames: [frame(i + 1, t)],
  text_elements: i === 0 ? texts : [], visual_objects: [], persistent_visual_elements: [], ...(i === 0 ? extra : {}),
}))
const ref = (texts: ReturnType<typeof group>[], recurring: number[][], extra: Record<string, unknown> = {}): ReferenceVideo => ({
  id: 1, rights_status: 'unknown_third_party', technical_details: { container: { duration_seconds: 43 }, video: { width: FW, height: FH, duration_seconds: 43 } },
  shots: shots(texts, extra),
  recurring_elements: recurring.map((m, i) => ({ id: 300 + i, member_text_element_ids: m, start_time: 0, end_time: 43, certainty: 'INFERRED', confidence_score: 0.9, reasoning: null, evidence_summary: null, produced_by_pass: null })),
} as unknown as ReferenceVideo)
const build = (r: ReferenceVideo) => buildVisualElements(r, { videoAnalysisId: 9 })
const twoGroups = (text: string, box: Box) => [group(11, text, [2, 16, 30], box), group(12, text, [9, 23, 37], box)]

describe('recurring text is not branding', () => {
  const phrases: [string, Box][] = [['SPONSORED BY ACME', [0.1, 0.9, 0.5, 0.03]], ['Follow for more tips', [0.2, 0.05, 0.6, 0.04]], ['Part 2 coming soon', [0.25, 0.5, 0.5, 0.05]], ['Terms apply', [0.1, 0.95, 0.3, 0.02]]]
  for (const [text, box] of phrases) {
    it(`"${text}" recurring at a fixed spot in every shot is plain text: not a handle, not a logo, and the explanation does not call it branding`, () => {
      const e = build(ref(twoGroups(text, box), [[11, 12]]))[0]
      expect(e.track.linkage.by).toBe('recurring_element')
      expect(['TEXT_OTHER', 'TEXT_CAPTION']).toContain(e.classification.class)
      expect(USER_ONLY_CLASSES).not.toContain(e.classification.class)
      const said = e.classification.explanation.join(' ')
      expect(said.replace(/not a logo/gi, '')).not.toMatch(/brand|watermark|logo/i)
      expect(e.classification.confidence.score).toBeLessThanOrEqual(RULE_CAP); expect(e.classification.confidence.level).not.toBe('high')
      expect(e.readiness.state).toBe('native_text')                                                    // rebuilt as editable text, never as an image of a brand
    })
  }
  it('recurrence raises confidence that it is the same text, but only up to the rule cap, and never changes the class on its own', () => {
    const lone = build(ref([group(11, 'Terms apply', [2], [0.1, 0.95, 0.3, 0.02])], []))[0]
    const recurring = build(ref(twoGroups('Terms apply', [0.1, 0.95, 0.3, 0.02]), [[11, 12]]))[0]
    expect(recurring.classification.class).toBe(lone.classification.class)
    expect(recurring.classification.confidence.score).toBeGreaterThanOrEqual(lone.classification.confidence.score)
    expect(recurring.classification.confidence.score).toBeLessThanOrEqual(RULE_CAP)
  })
  it('a corner word that stays all video long is flagged as worth checking, and the user is the only one who can make it a logo', () => {
    const r = ref(twoGroups('Acme Studio', [0.72, 0.04, 0.24, 0.035]), [[11, 12]])
    const e = build(r)[0]
    expect(e.classification.class).not.toBe('LOGO_MARK')
    const asLogo = buildVisualElements(r, { videoAnalysisId: 9, corrections: { [e.id]: { class: 'LOGO_MARK' } } })[0]
    expect(asLogo.classification).toMatchObject({ class: 'LOGO_MARK', basis: 'user' })
    expect(asLogo.readiness.state).toBe('needs_user_asset')
  })
})

describe('text-free graphics stay undetected', () => {
  it('with no text and no detector hit there is no element at all: a logo emblem is not invented', () => {
    expect(build(ref([], []))).toEqual([])
  })
  it('an object the detector found in a corner on every shot is an object track, never a logo, icon or shape', () => {
    const det = (id: number, f: number) => ({ id, label: 'laptop', category: 'object', class_id: 73, x: 0.82, y: 0.04, width: 0.14, height: 0.08, start_time: 0, end_time: 43, confidence_score: 0.7, evidence_summary: null, source: 'torchvision', produced_by_pass: 'x', source_frame_id: f, source_frame_asset_file_path: null })
    const r = ref([], [])
    r.shots = r.shots.map((s, i) => ({ ...s, visual_objects: [det(500 + i, i + 1)], persistent_visual_elements: i === 0 ? [{ id: 900, member_visual_object_ids: [500, 501, 502, 503, 504, 505] }] : [] })) as never
    const els = build(r)
    expect(els.length).toBeGreaterThan(0)
    for (const e of els) { expect(USER_ONLY_CLASSES).not.toContain(e.classification.class); expect(e.classification.class).not.toBe('LOGO_MARK') }
  })
})
