// M2.3 -- render smoke tests (server-side, no DOM) for the review panel, plus the page wiring: hidden by default, shown only with ?m2=background, no protected file touched, no AI endpoint.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { buildPlateCandidates, planBackground, planComposition, PLATE_ORDER, setPlateCorrection, type BackgroundPlan, type PlateCorrections } from '.'
import { BackgroundReviewView, type BackgroundReviewViewProps } from './BackgroundReviewView'
import type { BackgroundEvidence } from './evidence'
import type { OrderPolicy } from './composition'

const evidence: BackgroundEvidence = {
  referenceVideoId: 1, videoAnalysisId: 9, frameSize: { width: 480, height: 864 }, durationSeconds: 20, frameCount: 4,
  scenes: [
    { sceneNumber: 1, startTime: 0, endTime: 10, framesMeasured: 2, framesUnreadable: 0, variance: 'solid', palette: [{ color: '#090909', share: 0.85 }], bars: [{ side: 'top', size: 0.189, color: '#080808', uniformity: 1, framesSeen: 2, frameIds: [1, 2] }] },
    { sceneNumber: 2, startTime: 10, endTime: 20, framesMeasured: 2, framesUnreadable: 1, variance: 'busy', palette: [{ color: '#1f1f1f', share: 0.4 }], bars: [] },
  ],
}
const canvas = { width: 1080, height: 1920 }
const ctx = { referenceVideoId: 1, videoAnalysisId: 9, planSeconds: 20, existingShapes: [], createdAt: '2026-10-30T00:00:00.000Z' }

function props(over: Partial<BackgroundReviewViewProps> & { corrections?: PlateCorrections; policy?: OrderPolicy } = {}): BackgroundReviewViewProps {
  const candidates = buildPlateCandidates(evidence, canvas)
  const corrections = over.corrections ?? {}
  const plan: BackgroundPlan = planBackground(candidates, corrections, ctx)
  const policy = over.policy ?? 'as_generated'
  return { state: { kind: 'ready' }, evidence, candidates, corrections, plan, policy, composition: planComposition({ shapes: plan.shapes, mediaOverlays: [], textOverlays: [], subtitles: [{ id: 'rs:9:a', order: -1 }] }, policy), onCorrect: () => {}, onPolicy: () => {}, ...over }
}
const html = (p: BackgroundReviewViewProps) => renderToStaticMarkup(<BackgroundReviewView {...p} />).replace(/<!-- -->/g, '')

describe('review panel', () => {
  const m = html(props())
  it('says plainly what it does not do', () => {
    expect(m).toContain('data-testid="background-honesty"'); expect(m).toContain('Nothing behind text, graphics or the picture itself is recovered'); expect(m).toContain('nothing is painted over or removed')
    expect(m).not.toMatch(/background (was|has been) recovered|inpaint(ed|ing) (was|is) done|removed the text/i)
  })
  it('shows one row per measured bar with its colour as measured and the evidence behind it', () => {
    expect(m).toContain('data-candidate="bg:1:top"'); expect(m).toContain('Scene 1: top bar, 18.9% of the height'); expect(m).toContain('<code>#080808</code>')
    expect(m).toContain('Measured on 2 of 2 stills'); expect(m).toContain('flatness 100%'); expect(m).toMatch(/data-testid="background-include"[^>]*checked/)
  })
  it('counts what will happen and says which scenes had no bar', () => {
    expect(m).toMatch(/<strong>1<\/strong> measured bar on 4 stills · <strong>1<\/strong> will be added · 0 left out · 1 stills could not be read/)
    expect(m).toContain('No flat bar measured in scene 2.')
  })
  it('shows a colour you chose as yours, and an excluded plate as left out', () => {
    const mine = html(props({ corrections: setPlateCorrection({}, 'bg:1:top', { color: '#336699' }) }))
    expect(mine).toContain('<code>#336699</code>'); expect(mine).toContain('Set by you'); expect(mine).toContain('Use the measured colour')
    const out = html(props({ corrections: setPlateCorrection({}, 'bg:1:top', { include: false }) }))
    expect(out).toContain('Left out by you.'); expect(out).toMatch(/<strong>0<\/strong> will be added · 1 left out/)
  })
  it('offers the two stacking policies and explains what the recommended one does', () => {
    expect(m).toContain('Leave each as generated'); expect(m).toContain('Recommended stacking'); expect(m).toContain('Nothing is reordered.')
    const rec = html(props({ policy: 'recommended' }))
    expect(rec).toContain('Transcript subtitles go on top'); expect(rec).toContain('Your own layers are never touched'); expect(rec).toMatch(/1 generated layer will get an explicit stacking position/)
    expect(PLATE_ORDER).toBeLessThan(-10000)
  })
  it('shows loading, error and no-stills states without a list', () => {
    expect(html(props({ state: { kind: 'loading' } }))).toContain('Reading the stills'); expect(html(props({ state: { kind: 'error', message: 'Boom.' } }))).toContain('data-testid="background-error"')
    expect(html(props({ state: { kind: 'no_frames' } }))).toContain('no stills for this reference'); expect(html(props({ state: { kind: 'loading' } }))).not.toContain('data-candidate=')
  })
  it('says so when no bar was measured anywhere, and offers nothing', () => {
    const none = props({ candidates: [], evidence: { ...evidence, scenes: evidence.scenes.map(s => ({ ...s, bars: [] })) } })
    expect(html(none)).toContain('No flat bar was measured in any scene'); expect(html(none)).not.toContain('data-candidate=')
  })
})

describe('page wiring: hidden unless asked for', () => {
  const dir = join(__dirname, '..')
  const read = (...p: string[]) => readFileSync(join(dir, ...p), 'utf8')
  const page = read('DeconstructorPage.tsx')
  it('renders the review only for ?m2=background, in the Create step with a usable plan; passes the plan and policy on only when the flag is on', () => {
    expect(page).toContain("m2Has('background')"); expect(page).toMatch(/step === 'create' && plan && backgroundOn && <BackgroundReview/)
    expect(page).toContain('backgroundPlan={backgroundOn ? backgroundPlan : null}'); expect(page).toContain('compositionPolicy={backgroundOn ? compositionPolicy : null}')
  })
  it('leaves the other flags and panels in place; the draft save applies plates then stacking last', () => {
    for (const s of ["m2Has('text-layers')", "m2Has('transitions')", "m2Has('transcript')", "id: 'create'"]) expect(page).toContain(s)
    expect(read('footage', 'assembledDraft.ts')).toMatch(/applyComposition\(mergeBackground\(mergeSpeech\(/)
  })
  it('the module never calls an analysis or AI endpoint and reads only through the existing reference-video GET', () => {
    for (const f of ['BackgroundReview.tsx', 'loadEvidence.ts', 'measure.ts', 'materialize.ts', 'composition.ts']) expect(readFileSync(join(__dirname, f), 'utf8'), f).not.toMatch(/analyze-|deconstruct\(|mechanisms\.|anthropic|openai|\/generate\//i)
    expect(readFileSync(join(__dirname, 'BackgroundReview.tsx'), 'utf8')).toContain('referenceVideosApi.get(id)')
  })
  it('the panel reloads only when the reference or analysis changes, never because the page re-rendered (assigning footage must not reset it)', () => {
    const src = readFileSync(join(__dirname, 'BackgroundReview.tsx'), 'utf8')
    expect(src).toContain('[deps, key]'); expect(src).toContain('const key = evidenceKey(plan)'); expect(src).not.toMatch(/\[deps, plan\]/)
  })
  it('no protected editor file is part of this change', () => {
    const studio = join(__dirname, '..', '..', 'video-studio-v2')
    for (const f of ['components/CreateEditTab.tsx', 'components/ReviewTab.tsx', 'StudioContext.tsx', 'videoPreviewUtils.ts']) {
      try { expect(readFileSync(join(studio, f), 'utf8'), f).not.toMatch(/backgroundReconstruction|mergeBackground|BackgroundPlan|applyComposition/) } catch (e) { if ((e as { code?: string }).code !== 'ENOENT') throw e }
    }
  })
})
