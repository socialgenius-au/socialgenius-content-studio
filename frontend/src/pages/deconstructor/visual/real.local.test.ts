// M4 -- REAL-DATA regression on VA5368. LOCAL ONLY: runs when M2_REAL_VISUAL_EVIDENCE points at the reference-video JSON (kept outside the repository because it describes a third-party video).
// It asserts what we CLAIM from the real data, not exact numbers.
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { ReferenceVideo } from '../../../types'
import { buildVisualElements, USER_ONLY_CLASSES } from '.'

const file = process.env.M2_REAL_VISUAL_EVIDENCE
const run = !!file && existsSync(file)
const d = run ? describe : describe.skip

d('real VA5368 visual elements (local only)', () => {
  const ref = run ? (JSON.parse(readFileSync(file!, 'utf8')) as ReferenceVideo) : (null as never)
  const analysisId = run ? (ref as unknown as { latest_analysis: { id: number } }).latest_analysis.id : 0
  const before = run ? JSON.stringify(ref) : ''
  const els = run ? buildVisualElements(ref, { videoAnalysisId: analysisId }) : []
  const count = (f: (e: (typeof els)[number]) => boolean) => els.filter(f).length

  it('does not touch the analysis and gives every element a stable, analysis-derived id', () => {
    expect(JSON.stringify(ref)).toBe(before)
    expect(new Set(els.map(e => e.id)).size).toBe(els.length)
    for (const e of els) expect(e.id).toMatch(/^(tt:(rec|grp):\d+|ot:(det|pve):\d+)$/)
  })
  it('the creator handle (recurring element 2202) is TEXT_HANDLE and the caption word (2203) is TEXT_CAPTION: OCR text is not promoted to a logo', () => {
    const h = els.find(e => e.id === 'tt:rec:2202'), c = els.find(e => e.id === 'tt:rec:2203')
    if (!h || !c) return                                                                         // an evidence file written without recurring elements
    expect(h.classification.class).toBe('TEXT_HANDLE'); expect(h.track.movement.kind).toBe('fixed_spots'); expect(h.track.linkage.crossesShotBoundary).toBe(true)
    expect(c.classification.class).toBe('TEXT_CAPTION'); expect(c.track.movement.kind).toBe('slides')
  })
  it('no element is a graphical class, and every confidence is capped', () => {
    for (const e of els) { expect(USER_ONLY_CLASSES).not.toContain(e.classification.class); expect(e.classification.confidence.score).toBeLessThanOrEqual(0.8) }
  })
  it('the nine detections are all people: UNKNOWN and not reliable, never an image slot', () => {
    const people = els.filter(e => e.detectorLabel === 'person')
    expect(people.length).toBeGreaterThanOrEqual(1)
    for (const e of people) { expect(e.classification.class).toBe('UNKNOWN'); expect(e.readiness.state).toBe('not_reliable') }
    expect(count(e => e.classification.class === 'IMAGE_REGION')).toBe(0)
  })
  it('every text element is either rebuilt as native text or reported as not reliable, and none claims more than it has', () => {
    for (const e of els.filter(x => x.track.kind === 'text')) {
      expect(['native_text', 'not_reliable']).toContain(e.readiness.state)
      expect(e.claims).toEqual({ originalAssetRecovered: false, backgroundSeparated: false, exactStyleRecovered: false })
    }
  })
})
