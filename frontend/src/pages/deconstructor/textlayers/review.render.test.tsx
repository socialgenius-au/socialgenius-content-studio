// M2.1a -- render smoke tests (server-side, no DOM) for the review panel, plus the page wiring: hidden by default, shown only with ?m2=text-layers.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import bpFx from '../__fixtures__/va5368.c4-blueprint.json'
import type { BlueprintResponse } from '../../../types/deconstructor'
import { buildBlueprintPlan, buildPlaceholderOverlays } from '../../video-studio-v2/blueprint/blueprintPlan'
import { makeTimeMap, resolveCandidate, type Corrections } from './corrections'
import { planTextLayers } from './materialize'
import { TextLayersReviewView, type TextLayersReviewViewProps } from './TextLayersReviewView'
import { candidatesFor } from './testkit'

const plan = buildBlueprintPlan(JSON.parse(JSON.stringify(bpFx)) as BlueprintResponse, new Date('2026-10-01T00:00:00Z'))
const { candidates } = candidatesFor()

function props(over: Partial<TextLayersReviewViewProps> & { corrections?: Corrections; mode?: 'fit' | 'identity' } = {}): TextLayersReviewViewProps {
  const corrections = over.corrections ?? {}
  const timeMap = makeTimeMap(42.6, plan.totalSeconds, over.mode)
  const layerPlan = planTextLayers(candidates, corrections, {
    referenceVideoId: plan.referenceVideoId, videoAnalysisId: plan.videoAnalysisId, timeMap, canvas: { width: 1080, height: 1920 },
    existingOverlays: buildPlaceholderOverlays(plan), createdAt: '2026-10-01T00:00:00.000Z',
  })
  return {
    state: { kind: 'ready' }, candidates, resolved: candidates.map(c => resolveCandidate(c, corrections[c.id], timeMap)), plan: layerPlan, corrections, timeMap,
    readingColours: false, placeholdersLeft: 8 - layerPlan.removePlaceholderIds.length, onCorrect: () => {}, onTimeMode: () => {}, onReplaceAllBlocked: () => {}, ...over,
  }
}
const html = (p: TextLayersReviewViewProps) => renderToStaticMarkup(<TextLayersReviewView {...p} />)

describe('review panel', () => {
  const m = html(props())
  it('says plainly what it does not do', () => {
    expect(m).toContain('data-testid="text-layers-honesty"')
    expect(m).toContain('The original text stays burned into the reference video')
    expect(m).toContain('Fonts, outlines and shadows are not recovered')
    expect(m).not.toMatch(/removed from the video|text has been removed|fonts recovered/i)
  })
  it('shows one row per detected text with its evidence, confidence and read times', () => {
    for (const c of candidates) expect(m).toContain(`data-testid="text-item-${c.group.id}"`)
    expect(m).toContain('Read by OCR (item 1) · 92% sure · seen 2× between 3.0s and 6.0s')
  })
  it('summarises how many were found, will be added, left out, and need a decision', () => {
    expect(m).toMatch(/<strong>7<\/strong> text items found/)
    expect(m).toContain('need a decision')
  })
  it('marks the excluded-by-default items and says why (branding, low confidence, fragment), but still lets a person include them', () => {
    expect(m).toContain('data-testid="text-status-6"'); expect(m).toMatch(/data-testid="text-item-6" data-status="excluded_default"/)
    expect(m).toContain('Branding'); expect(m).toContain('Low confidence'); expect(m).toContain('Fragment')
    expect(m).toMatch(/data-testid="text-include-6"[^>]*/); expect(m).not.toMatch(/data-testid="text-include-6"[^>]*disabled/)
  })
  it('offers a replace-the-placeholder decision for an item that lands on one, and shows it as a conflict', () => {
    expect(m).toMatch(/data-testid="text-item-1" data-status="blocked_conflict"/)
    expect(m).toContain('data-testid="text-conflict-1"'); expect(m).toContain('data-testid="text-replace-1"'); expect(m).toContain('text placeholder for scene 1')
  })
  it('offers one button to replace every overlapped placeholder, and drops it when nothing is waiting', () => {
    expect(m).toContain('data-testid="text-replace-all-button"'); expect(m).toContain('where a blueprint placeholder is')
    const all: Corrections = Object.fromEntries(candidates.map(c => [c.id, { replacePlaceholder: true }]))
    expect(html(props({ corrections: all }))).not.toContain('data-testid="text-replace-all"')
  })
  it('shows the replacement once chosen, and the remaining placeholders', () => {
    const p = html(props({ corrections: { 'text:1': { replacePlaceholder: true } } }))
    expect(p).toMatch(/data-testid="text-item-1" data-status="included"/); expect(p).toContain('data-testid="text-replaces-1"'); expect(p).not.toContain('data-testid="text-conflict-1"')
    expect(p).toMatch(/placeholders? will be replaced/)
  })
  it('offers other readings as one-click choices and shows a user’s own wording as theirs', () => {
    expect(m).toContain('data-testid="text-alternatives-3"'); expect(m).toContain('Ki Duniya Badal')
    const e = html(props({ corrections: { 'text:7': { text: 'My own words' } } }))
    expect(e).toContain('(your edit)'); expect(e).toContain('value="My own words"')
  })
  it('states the timing doubt and offers the two timing modes only when the lengths differ', () => {
    expect(m).toMatch(/could be off by up to about 1\.5 s/)
    expect(m).toContain('data-testid="text-timing-mode"'); expect(m).toContain('Fit to the blueprint length (42.6s → 30.0s)')
    const same = html(props({ timeMap: makeTimeMap(30, 30) }))
    expect(same).not.toContain('data-testid="text-timing-mode"')
  })
  it('shows loading, error and empty states without a list', () => {
    expect(html(props({ state: { kind: 'loading' } }))).toContain('Reading the analysis')
    expect(html(props({ state: { kind: 'error', message: 'Boom.' } }))).toContain('data-testid="text-layers-error"')
    expect(html(props({ state: { kind: 'empty' } }))).toContain('no on-screen text')
    expect(html(props({ state: { kind: 'loading' } }))).not.toContain('data-testid="text-item-')
  })
  it('says colours are still being read while the frames are sampled', () => {
    expect(html(props({ readingColours: true }))).toContain('reading colours from the frames')
  })
})

describe('page wiring: hidden unless asked for', () => {
  const src = readFileSync(join(__dirname, '..', 'DeconstructorPage.tsx'), 'utf8')
  it('renders the review only for ?m2=text-layers, and only in the Create step with a usable plan', () => {
    expect(src).toContain("get('m2') === 'text-layers'")
    expect(src).toMatch(/step === 'create' && plan && textLayersOn && <TextLayersReview/)
  })
  it('passes layers to the footage panel only when the flag is on, so the default page saves exactly what it saved before', () => {
    expect(src).toContain('textLayers={textLayersOn ? textLayers : null}')
  })
  it('leaves the six steps and the existing panels in place', () => {
    for (const s of ["id: 'reference'", "id: 'anatomy'", "id: 'mechanisms'", "id: 'intent'", "id: 'blueprint'", "id: 'create'"]) expect(src).toContain(s)
    expect(src).toContain('<FootageAssignment key={`${routeId}:${plan.blueprintId}`} resp={d.blueprint.data} plan={plan} references={d.references.data}')
  })
})
