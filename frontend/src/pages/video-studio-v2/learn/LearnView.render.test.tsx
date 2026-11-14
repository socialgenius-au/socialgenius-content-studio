// What the person actually SEES on the Learn screen, rendered from the real draft 9 data. The old screen showed invented reach/engagement figures, a trend chart for dates in August, and canned
// insights about another company; none of that may come back.
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import draft from './__fixtures__/draft9.learn-input.json'
import bpFx from '../../deconstructor/__fixtures__/ref5131.c4-blueprint.json'
import type { BlueprintResponse } from '../../../types/deconstructor'
import { buildBlueprintPlan } from '../blueprint/blueprintPlan'
import { aiStructure, assessProject, type AssessInput } from './assessment'
import { buildRecommendations } from './recommendations'
import { PERFORMANCE_NOT_AVAILABLE, parseVerifiedPerformance } from './performance'
import LearnView, { type LearnViewProps } from './LearnView'

const plan = buildBlueprintPlan(JSON.parse(JSON.stringify(bpFx)) as BlueprintResponse, new Date('2026-11-14T00:00:00Z'))
const input = { ...(JSON.parse(JSON.stringify(draft)) as Omit<AssessInput, 'plan'>), plan } as AssessInput
const assessment = assessProject(input)

function props(over: Partial<LearnViewProps> = {}): LearnViewProps {
  return {
    identity: { client: 'SocialGenius', campaign: 'SocialGenius Content Studio' }, performance: null, assessment, ai: aiStructure(plan), recommendations: buildRecommendations(assessment),
    decisions: {}, canRecord: false, busyKey: null, error: null, lessons: [], onDecide: () => {}, ...over,
  }
}
const html = (over: Partial<LearnViewProps> = {}) => renderToStaticMarkup(<LearnView {...props(over)} />)

describe('Learn screen', () => {
  it('shows the exact "Not available" sentence and no performance figure when nothing was measured', () => {
    const h = html()
    expect(h).toContain(PERFORMANCE_NOT_AVAILABLE)
    expect(h).toContain('data-testid="performance-not-available"')
    expect(h).not.toMatch(/28\.4K|4\.2K|1\.3K|12\.6K|\+24%|\+18%|\+32%|\+20%/)                   // the old invented figures
    expect(h).not.toMatch(/14 Aug|20 Aug|Performance Over Time|trend-chart/)                      // the old invented chart and dates
    expect(h).not.toMatch(/dropped off|performed best|Visit our showroom|Stock Availability|Add testimonial/)   // the old canned insights
    expect(h).not.toContain('Create New Video')                                                   // the old button that did nothing
  })

  it('labels the AI assessment exactly as specified and keeps it apart from the measured checks and from performance', () => {
    const h = html()
    expect(h).toContain('AI Content Assessment — Not Actual Audience Performance.')
    const ai = h.indexOf('learn-ai-assessment'), perf = h.indexOf('learn-performance'), recs = h.indexOf('learn-recommendations')
    expect(perf).toBeLessThan(ai)
    expect(ai).toBeLessThan(recs)
    expect(h).toContain('Not AI, and not audience data.')
    expect(h).toMatch(/AI-inferred · confidence/)
    expect(h).toContain('Limits stated by the AI')
  })

  it('shows each project check with its confidence and, behind a disclosure, its evidence and reasoning', () => {
    const h = html()
    for (const t of ['Length and pacing', 'Text reading speed', 'Text size on a phone', 'Text contrast', 'Footage variety']) expect(h).toContain(t)
    expect(h).toMatch(/Rule of thumb · confidence low/)
    expect(h).toContain('Evidence and reasoning')
  })

  it('separates measured recommendations from hypotheses, labels both, and says what cannot be concluded', () => {
    const h = html()
    expect(h).toContain('Supported by measurements in this project')
    expect(h).toContain('Hypotheses to test (no audience data behind them)')
    expect(h).toContain('Not enough evidence to say')
    expect(h).toContain('Measured in this project')
    expect(h).toContain('Hypothesis — needs testing')
    expect(h).toContain('7 words in 2 s (3.5 words/second')
    expect(h).toContain('No viewer data exists for this video yet')
  })

  it('cannot record a decision until the video is saved as a draft, and says so', () => {
    const h = html({ canRecord: false })
    expect(h).toContain('data-testid="learn-save-hint"')
    expect((h.match(/disabled=""/g) ?? []).length).toBeGreaterThanOrEqual(3 * 6)                 // 3 buttons + the note field on each of 6 recommendations
    const saved = html({ canRecord: true })
    expect(saved).not.toContain('data-testid="learn-save-hint"')
  })

  it('shows a recorded decision and the lessons kept from earlier videos with their origin', () => {
    const h = html({ canRecord: true, decisions: { 'reading-speed-s1': { status: 'accepted', note: 'Will hold it longer' } },
      lessons: [{ id: 1, text: 'Give the text more time on screen.', basis: 'evidence', draftName: 'Earlier video', evidence: ['x'], caveat: null, note: 'Worked for me', updatedAt: '2026-11-10T00:00:00Z' }] })
    expect(h).toContain('data-status="accepted"')
    expect(h).toContain('Will hold it longer')
    expect(h).toContain('From “Earlier video”, accepted 2026-11-10.')
    expect(h).toContain('Your note: Worked for me')
  })

  it('shows verified figures only with their source and measurement period', () => {
    const perf = parseVerifiedPerformance({ metrics: [{ key: 'views', value: 1200, source: 'Instagram Insights', periodStart: '2026-11-15', periodEnd: '2026-11-21' }] })
    const h = html({ performance: perf })
    expect(h).toContain('Instagram Insights')
    expect(h).toContain('2026-11-15 to 2026-11-21')
    expect(h).not.toContain(PERFORMANCE_NOT_AVAILABLE)
  })

  it('names the project it is about', () => {
    expect(html()).toContain('<strong>SocialGenius</strong> — SocialGenius Content Studio')
    expect(html()).not.toContain('ABC Tiles')
  })
})

describe('the Learn tab source', () => {
  const src = readFileSync(new URL('../components/LearnTab.tsx', import.meta.url), 'utf8')
  it('no longer contains the demonstration data', () => {
    for (const bad of ['28.4K', 'SERIES', 'TOP_INSIGHTS', 'WHAT_TO_TRY', 'Visit our showroom', '14 Aug', 'setCreateClicked']) expect(src, bad).not.toContain(bad)
  })
  it('reads real project state and passes no performance source (none is connected)', () => {
    expect(src).toContain('useStudio()')
    expect(src).toContain('parseVerifiedPerformance(null)')
  })
})
