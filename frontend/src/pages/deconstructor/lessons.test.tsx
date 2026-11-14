// M7: "Learning from Previous Videos" -- selection logic, the panel, and how a blueprint built with lessons is shown, planned and carried into Learn. Real reference-5131 blueprint as the base.
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import bpFx from './__fixtures__/ref5131.c4-blueprint.json'
import type { BlueprintLesson, BlueprintResponse } from '../../types/deconstructor'
import { emptyIntentForm } from './intentForm'
import { briefFromForm, briefKey, confidenceText, idsToSend, LESSONS_HEADING, prune, suggestedIds, toggle, type LessonCandidate } from './lessons'
import LessonsPanel from './LessonsPanel'
import { BlueprintStage } from './stages'
import { blueprintLessonCards, blueprintSectionCards } from './viewModel'
import { buildBlueprintPlan } from '../video-studio-v2/blueprint/blueprintPlan'
import LearnView from '../video-studio-v2/learn/LearnView'
import { assessProject, aiStructure, type AssessInput } from '../video-studio-v2/learn/assessment'
import { buildRecommendations } from '../video-studio-v2/learn/recommendations'
import draft from '../video-studio-v2/learn/__fixtures__/draft9.learn-input.json'

const TEXT = 'Give the text in scene 1 more time on screen, or shorten it.'
const cand = (over: Partial<LessonCandidate> = {}): LessonCandidate => ({
  lesson_id: 7, text: TEXT, basis: 'evidence', classification: 'measured_production_observation', classification_label: 'Measured production observation', qualifier_labels: ['Rule of thumb'],
  confidence: { level: 'medium', source: 'documented confidence of the learn-v1 rule (not stored on the record)' }, evidence: ['7 words in 2 s (3.5 words/second; the rule of thumb is about 3)'],
  caveat: "A rule of thumb, not your audience's behaviour.", user_note: null,
  source: { draft_id: 9, draft_name: 'Blueprint — SocialGenius (14 Nov)', blueprint_id: 'bp-old', platform: 'Instagram Reels', accepted_at: '2026-11-14T03:10:00Z' },
  relevance: { score: 0.85, relevant: true, reasons: ['Concerns on-screen text, which most short videos use.', 'Your earlier video was made for the same platform (Instagram Reels).'], conflicts: [] }, notice: 'x', ...over,
})
const cta = cand({ lesson_id: 8, text: 'Test a second wording of the call to action.', basis: 'hypothesis', classification: 'untested_hypothesis', classification_label: 'Untested hypothesis', qualifier_labels: [],
  confidence: { level: 'low', source: 'documented confidence of the learn-v1 rule (not stored on the record)' },
  relevance: { score: 0.2, relevant: false, reasons: [], conflicts: ['Your brief has no call to action, so a lesson about calls to action does not apply.'] } })

const panel = (over: Partial<Parameters<typeof LessonsPanel>[0]> = {}) => renderToStaticMarkup(<LessonsPanel status="ready" lessons={[cand(), cta]} useLessons selected={new Set()} onUseLessons={() => {}} onToggle={() => {}} onSelectSuggested={() => {}} onClear={() => {}} {...over} />)

describe('selection logic', () => {
  it('builds the ranking request from the brief and invents nothing', () => {
    expect(briefFromForm(emptyIntentForm())).toEqual({ product: null, audience: null, objective: null, platform: null, duration_seconds: null, cta: false, tone: [], mandatory: [], prohibited: [] })
    const b = briefFromForm({ ...emptyIntentForm(), product: ' A  tool ', platform: 'Instagram Reels', durationSeconds: '12', cta: 'Try it', prohibited: 'on-screen text\nPrices' })
    expect(b).toMatchObject({ product: 'A tool', platform: 'Instagram Reels', duration_seconds: 12, cta: true, prohibited: ['on-screen text', 'Prices'] })
    expect(briefFromForm({ ...emptyIntentForm(), durationSeconds: 'abc' }).duration_seconds).toBeNull()
    expect(briefKey(b)).toBe(briefKey({ ...b }))
  })
  it('suggests only relevant lessons that do not conflict, and never selects anything by itself', () => {
    expect(suggestedIds([cand(), cta, cand({ lesson_id: 9, relevance: { score: 0.5, relevant: true, reasons: [], conflicts: ['x'] } })])).toEqual([7])
    expect(idsToSend(true, new Set())).toEqual([])
  })
  it('toggles, prunes lessons that are no longer on offer, and sends nothing when lessons are switched off', () => {
    expect([...toggle(new Set([7]), 8)].sort()).toEqual([7, 8])
    expect([...toggle(new Set([7]), 7)]).toEqual([])
    expect([...prune(new Set([7, 99]), [cand()])]).toEqual([7])
    expect(idsToSend(true, new Set([8, 7]))).toEqual([7, 8])
    expect(idsToSend(false, new Set([7, 8]))).toEqual([])
  })
  it('states confidence honestly', () => {
    expect(confidenceText(cand().confidence)).toBe('confidence medium (from the rule, not measured)')
    expect(confidenceText({ level: 'unknown', source: 'not recorded' })).toBe('confidence not recorded')
  })
})

describe('Learning from Previous Videos panel', () => {
  it('shows each lesson with its classification, confidence, source, evidence, reasons and the not-a-performance-result notice', () => {
    const h = panel()
    expect(h).toContain(LESSONS_HEADING)
    expect(h).toContain('not verified performance improvements')
    expect(h).toContain(TEXT)
    expect(h).toContain('Measured production observation')
    expect(h).toContain('Rule of thumb')
    expect(h).toContain('confidence medium (from the rule, not measured)')
    expect(h).toContain('From “Blueprint — SocialGenius (14 Nov)”, accepted 2026-11-14.')
    expect(h).toContain('7 words in 2 s')
    expect(h).toContain('Your earlier video was made for the same platform')
    expect(h).toContain('Suggested for this brief')
  })
  it('lists relevant lessons first, keeps others in a disclosure, and explains a conflict instead of hiding it', () => {
    const h = panel()
    expect(h).toContain('Relevant to this brief (1)')
    expect(h).toContain('Other accepted lessons (1)')
    expect(h).toContain('Conflicts with this brief: Your brief has no call to action')
    expect(h).toContain('the blueprint will explain why it was not applied')
  })
  it('selects nothing by default, shows the selection, and the master switch disables every choice', () => {
    expect(panel()).toContain('No lessons will be used.')
    expect(panel({ selected: new Set([7]) })).toContain('1 lesson will be used as guidance.')
    const sel = panel({ selected: new Set([7]) })
    const inputFor = (h: string, label: string) => (h.match(new RegExp(`<input[^>]*aria-label="Include lesson: ${label}[^>]*>`)) ?? [''])[0]
    expect(inputFor(sel, 'Give the text')).toContain('checked=""')
    expect(inputFor(sel, 'Test a second')).not.toContain('checked=""')
    const off = panel({ useLessons: false, selected: new Set([7]) })
    expect(off).toContain('No lessons will be used.')
    expect((off.match(/disabled=""/g) ?? []).length).toBeGreaterThanOrEqual(2)
  })
  it('handles loading, error (the blueprint can still be built) and no lessons yet', () => {
    expect(panel({ status: 'loading', lessons: [] })).toContain('Looking for your accepted lessons')
    expect(panel({ status: 'error', lessons: [], error: 'Could not load your lessons.' })).toContain('You can still build the blueprint without them.')
    expect(panel({ lessons: [] })).toContain('data-testid="lessons-empty"')
  })
})

// ── a blueprint built with lessons ──
const lessonOn = (over: Partial<BlueprintLesson> = {}): BlueprintLesson => ({
  lesson_id: 7, text: TEXT, classification: 'measured_production_observation', classification_label: 'Measured production observation', qualifiers: ['Rule of thumb'],
  confidence: { level: 'medium', source: 'documented' }, source: { draft_id: 9, draft_name: 'Blueprint — SocialGenius (14 Nov)', blueprint_id: 'bp-old', reference_video_id: 5131, platform: 'Instagram Reels', accepted_at: '2026-11-14T03:10:00Z' },
  evidence: ['7 words in 2 s (3.5 words/second; the rule of thumb is about 3)'], caveat: 'A rule of thumb.', user_note: null, relevance: { score: 0.85, relevant: true, reasons: [], conflicts: [] },
  decision: 'APPLIED', applied_in_sections: [1], how_or_why: 'Scene 1 keeps its opening text short enough to read in its two seconds.', notice: 'Lessons are guidance, not verified performance improvements.', ...over,
})
function withLessons(): BlueprintResponse {
  const r = JSON.parse(JSON.stringify(bpFx)) as BlueprintResponse
  const bp = r.blueprint!
  bp.lessons = [lessonOn(), lessonOn({ lesson_id: 8, text: 'Test a second wording of the call to action.', decision: 'NOT_APPLIED', applied_in_sections: [], how_or_why: 'This brief has no call to action, so this lesson does not apply.',
    classification: 'untested_hypothesis', classification_label: 'Untested hypothesis', qualifiers: [], confidence: { level: 'low', source: 'documented' },
    relevance: { score: 0.2, relevant: false, reasons: [], conflicts: ['Your brief has no call to action.'] } })]
  bp.sections[0].lessons_applied = [7]
  return r
}

describe('a blueprint built with lessons', () => {
  const L = (data: BlueprintResponse | null) => ({ data, loading: false, error: null, missing: false })
  const stage = (r: BlueprintResponse) => renderToStaticMarkup(<BlueprintStage blueprint={L(r)} busy={null} onUse={() => {}} onNew={() => {}} useMessage={null} />)

  it('shows which lessons influenced the plan, where, how, and why one was not applied, with each lesson\'s source, classification and confidence', () => {
    const h = stage(withLessons())
    expect(h).toContain('Learning from previous videos')
    expect(h).toContain('Applied in scene 1')
    expect(h).toContain('Scene 1 keeps its opening text short enough')
    expect(h).toContain('Not applied')
    expect(h).toContain('Why not: ')
    expect(h).toContain('This brief has no call to action')
    expect(h).toContain('Conflict with this brief: Your brief has no call to action.')
    expect(h).toContain('Measured production observation · Rule of thumb · confidence medium')
    expect(h).toContain('from “Blueprint — SocialGenius (14 Nov)”, accepted 2026-11-14')
    expect(h).toContain('not verified performance improvements')
  })
  it('marks only the scenes a lesson shaped', () => {
    const h = stage(withLessons())
    expect(h).toContain('data-testid="section-1-lesson"')
    for (const n of [2, 3, 4]) expect(h).not.toContain(`data-testid="section-${n}-lesson"`)
    expect(blueprintSectionCards(withLessons().blueprint!).map(c => c.lessons.map(l => l.id))).toEqual([[7], [], [], []])
    expect(blueprintLessonCards(withLessons().blueprint!).map(c => [c.id, c.applied])).toEqual([[7, true], [8, false]])
  })
  it('a blueprint made without lessons looks exactly as before', () => {
    const h = stage(JSON.parse(JSON.stringify(bpFx)) as BlueprintResponse)
    expect(h).not.toContain('Learning from previous videos')
    expect(h).not.toContain('Shaped by a lesson')
  })
  it('the lessons travel into the plan that becomes the editable Video Studio draft, per scene and overall', () => {
    const plan = buildBlueprintPlan(withLessons(), new Date('2026-11-15T00:00:00Z'))
    expect(plan.lessons?.map(l => [l.id, l.decision])).toEqual([[7, 'APPLIED'], [8, 'NOT_APPLIED']])
    expect(plan.scenes[0].lessons?.[0]).toMatchObject({ id: 7, sourceDraftName: 'Blueprint — SocialGenius (14 Nov)', classification: 'Measured production observation', confidence: 'medium', sourceBlueprintId: 'bp-old' })
    expect(plan.scenes.slice(1).every(s => s.lessons === undefined)).toBe(true)
    const none = buildBlueprintPlan(JSON.parse(JSON.stringify(bpFx)) as BlueprintResponse, new Date('2026-11-15T00:00:00Z'))
    expect(none.lessons).toBeUndefined()
    expect(none.scenes.every(s => s.lessons === undefined)).toBe(true)
    expect(plan.scenes.map(s => [s.sceneNumber, s.duration])).toEqual(none.scenes.map(s => [s.sceneNumber, s.duration]))      // lessons change guidance, not the editable structure
  })
  it('the Learn screen of the resulting video says what it was built with', () => {
    const plan = buildBlueprintPlan(withLessons(), new Date('2026-11-15T00:00:00Z'))
    const input = { ...(JSON.parse(JSON.stringify(draft)) as Omit<AssessInput, 'plan'>), plan } as AssessInput
    const assessment = assessProject(input)
    const h = renderToStaticMarkup(<LearnView identity={{ client: 'SocialGenius', campaign: 'x' }} performance={null} assessment={assessment} ai={aiStructure(plan)} recommendations={buildRecommendations(assessment)}
      decisions={{}} canRecord={false} busyKey={null} error={null} lessons={[]} broughtLessons={plan.lessons} onDecide={() => {}} />)
    expect(h).toContain('Lessons this video was built with')
    expect(h).toContain('Applied in scene 1')
    expect(h).toContain('Not applied')
    expect(h).toContain('not verified performance improvements')
  })
})

describe('wiring', () => {
  const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8')
  it('the page ranks lessons from the brief, sends only selected ids and tells the person before anything is sent', () => {
    const page = read('./DeconstructorPage.tsx'), hook = read('./useDeconstructor.ts')
    expect(page).toContain('learningApi.relevant(briefFromForm(form))')
    expect(page).toContain('idsToSend(useLessons, selectedLessons)')
    expect(page).toContain('d.buildBlueprint(v.intent, lessonIds)')
    expect(page).toContain('not verified performance results')
    expect(hook).toContain('...(lessonIds.length ? { lesson_ids: lessonIds } : {})')
  })
})
