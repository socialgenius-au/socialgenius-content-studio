// M2.4a -- render smoke tests (server-side, no DOM) for the review panel, plus the page wiring: hidden by default, shown only with ?m2=transitions, no protected file touched.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { buildTransitionCandidates } from './candidates'
import { makeTimeMap, resolveTransition, type TransitionCorrections } from './corrections'
import { planTransitions } from './materialize'
import { TransitionsReviewView, type TransitionsReviewViewProps } from './TransitionsReviewView'
import { DISSOLVE, FAST_MOTION, REAL_CUT, evidenceFor, joinsFor } from './testkit'

function props(over: Partial<TransitionsReviewViewProps> & { corrections?: TransitionCorrections; mode?: 'fit' | 'identity'; refSeconds?: number } = {}): TransitionsReviewViewProps {
  const corrections = over.corrections ?? {}
  const timeMap = makeTimeMap(over.refSeconds ?? 30, 30, over.mode)
  const candidates = buildTransitionCandidates(evidenceFor([{ ...DISSOLVE, id: 1, at: 8 }, { ...REAL_CUT, id: 2, at: 20 }, { ...FAST_MOTION, id: 3, at: 27 }]), joinsFor([8, 16, 24, 30]), timeMap)
  const plan = planTransitions(candidates, corrections, { referenceVideoId: 5127, videoAnalysisId: 5368, timeMap, createdAt: '2026-10-30T00:00:00.000Z' })
  return { state: { kind: 'ready' }, candidates, resolved: candidates.map(c => resolveTransition(c, corrections[c.id])), plan, timeMap, sceneCount: 4, onCorrect: () => {}, onTimeMode: () => {}, ...over }
}
const html = (p: TransitionsReviewViewProps) => renderToStaticMarkup(<TransitionsReviewView {...p} />)

describe('review panel', () => {
  const m = html(props())
  it('says plainly what it does not do', () => {
    expect(m).toContain('data-testid="transitions-honesty"'); expect(m).toContain('not the effect that was used'); expect(m).toContain('original effect and its settings are not recovered')
    expect(m).toContain('whip pan and zoom punch are never guessed'); expect(m).not.toMatch(/effect (was|has been) recovered|exact effect/i)
  })
  it('shows one row per measured cut with its estimate, confidence, reasons and the numbers behind them', () => {
    for (const id of ['tb-1', 'tb-2', 'tb-3']) expect(m).toContain(`data-testid="transition-item-${id}"`)
    expect(m).toMatch(/data-testid="transition-estimate-tb-1"[^>]*>Estimated: Dissolve · medium confidence/); expect(m).toMatch(/data-testid="transition-estimate-tb-2"[^>]*>Estimated: Hard cut · high confidence/)
    expect(m).toContain('0.155 against 0.007'); expect(m).toContain('Fast motion or a flash can look the same')
  })
  it('names the scene join each cut lines up with, or says there is none', () => {
    expect(m).toMatch(/data-testid="transition-join-tb-1"[^>]*>Closest scene join: <strong>scene 1 → 2<\/strong> at 8\.00s/)
    expect(m).toMatch(/data-testid="transition-join-tb-2"[^>]*><span[^>]*>No scene join in the blueprint is close enough/)
  })
  it('counts what will happen and leaves a no-signature cut out by default', () => {
    expect(m.replace(/<!-- -->/g, '')).toMatch(/<strong>3<\/strong> measured cuts · <strong>1<\/strong> will be applied · 1 with no scene join near it · 1 left out · the blueprint has 4 scenes/)
    expect(m).toMatch(/data-testid="transition-status-tb-3"[^>]*>Left out by default/); expect(m).toMatch(/data-testid="transition-status-tb-2"[^>]*>No scene join near it/)
  })
  it('offers all five editor transitions to choose from, and never pre-selects whip pan or zoom punch', () => {
    for (const label of ['Hard cut', 'Dissolve', 'Fade through black', 'Whip pan', 'Zoom punch']) expect(m).toContain(`>${label}</option>`)
    expect(m).not.toMatch(/Estimated: (Whip pan|Zoom punch)/)
  })
  it('shows a person’s own choice as theirs and disables the duration for a hard cut', () => {
    const mine = html(props({ corrections: { 'tb:1': { kind: 'whip_pan', duration: 0.8 } } }))
    expect(mine).toContain('Transition (your choice)'); expect(mine).toMatch(/Scene 1 → 2 will use a whip pan of 0\.8 s/)
    expect(html(props({ corrections: { 'tb:1': { kind: 'cut' } } }))).toMatch(/data-testid="transition-duration-tb-1"[^>]*disabled|disabled[^>]*data-testid="transition-duration-tb-1"/)
  })
  it('offers the two timing modes only when the lengths differ', () => {
    expect(m).not.toContain('data-testid="transitions-timing-mode"')
    expect(html(props({ refSeconds: 42.6 }))).toContain('Fit to the blueprint length (42.60s → 30.00s)')
  })
  it('shows loading, error and none states without a list', () => {
    expect(html(props({ state: { kind: 'loading' } }))).toContain('Reading the analysis'); expect(html(props({ state: { kind: 'error', message: 'Boom.' } }))).toContain('data-testid="transitions-error"')
    expect(html(props({ state: { kind: 'none' } }))).toContain('no measured cuts'); expect(html(props({ state: { kind: 'loading' } }))).not.toContain('data-candidate=')
  })
})

describe('page wiring: hidden unless asked for', () => {
  const dir = join(__dirname, '..')
  const read = (...p: string[]) => readFileSync(join(dir, ...p), 'utf8')
  const page = read('DeconstructorPage.tsx')
  it('renders the review only for ?m2=transitions, in the Create step with a usable plan; passes the plan on only when the flag is on', () => {
    expect(page).toContain("get('m2') === 'transitions'"); expect(page).toMatch(/step === 'create' && plan && transitionsOn && <TransitionsReview/); expect(page).toContain('transitionPlan={transitionsOn ? transitionPlan : null}')
  })
  it('leaves the other flags, the six steps and the existing panels in place', () => {
    for (const s of ["get('m2') === 'text-layers'", "get('m2') === 'image-layers'", 'textLayers={textLayersOn ? textLayers : null}', 'imageLayers={imageLayersOn ? imageLayers : null}', "id: 'create'"]) expect(page).toContain(s)
  })
  it('the draft save applies them after the layers, and the module never calls an analysis or AI endpoint', () => {
    expect(read('footage', 'assembledDraft.ts')).toContain('mergeTransitions(mergeImageLayers(mergeTextLayers(assembled.snapshot, input.textLayers), input.imageLayers), input.transitionPlan)')
    for (const f of ['TransitionsReview.tsx', 'loadEvidence.ts', 'materialize.ts', 'classify.ts']) expect(readFileSync(join(__dirname, f), 'utf8'), f).not.toMatch(/analyze-|transition-evidence'|deconstruct\(|mechanisms\.|anthropic|openai|\/generate\//i)
    expect(readFileSync(join(__dirname, 'TransitionsReview.tsx'), 'utf8')).toContain('referenceVideosApi.get(id)')
  })
  it('no protected editor file is part of this change', () => {
    const studio = join(__dirname, '..', '..', 'video-studio-v2')
    for (const f of ['components/CreateEditTab.tsx', 'components/ReviewTab.tsx']) expect(readFileSync(join(studio, f), 'utf8'), f).not.toMatch(/transitionReconstruction|mergeTransitions|TransitionPlan/)
  })
})
