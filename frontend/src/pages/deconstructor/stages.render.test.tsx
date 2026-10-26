// Render smoke tests (server-side render, no DOM): the real VA5368 payloads must render in every stage without throwing, in business language.
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import anatomyFx from './__fixtures__/va5368.c2-anatomy.redacted.json'
import mechFx from './__fixtures__/va5368.c3-mechanisms.json'
import bpFx from './__fixtures__/va5368.c4-blueprint.json'
import type { Anatomy, BlueprintResponse, MechanismSet } from '../../types/deconstructor'
import type { ReferenceVideo } from '../../types'
import { AnatomyStage, BlueprintStage, CreateStage, IntentStage, MechanismsStage, ReferenceStage } from './stages'
import { emptyIntentForm } from './intentForm'
import { summarizeDeconStatus } from './viewModel'
import { buildBlueprintPlan } from '../video-studio-v2/blueprint/blueprintPlan'
import { BlueprintPlanView } from '../video-studio-v2/blueprint/BlueprintPlanPanel'

const L = <T,>(data: T | null, extra: Partial<{ loading: boolean; error: string | null; missing: boolean }> = {}) => ({ data, loading: false, error: null, missing: false, ...extra })
const clone = <T,>(x: unknown) => JSON.parse(JSON.stringify(x)) as T
const anatomy = () => clone<Anatomy>(anatomyFx)
const mech = () => clone<MechanismSet>(mechFx)
const bp = () => clone<BlueprintResponse>(bpFx)
const noop = () => {}

describe('stages render the real VA5368 data', () => {
  it('Anatomy: one card per anatomy section, no raw JSON keys', () => {
    const html = renderToStaticMarkup(<AnatomyStage anatomy={L(anatomy())} />)
    for (const s of anatomy().sections) expect(html).toContain(`data-testid="anatomy-section-${s.number}"`)
    expect(html).toContain('What the reference did')
    expect(html).not.toMatch(/&quot;|"section_number"|mechanism_id/)
  })
  it('Anatomy: loading / error / not deconstructed do not crash', () => {
    expect(renderToStaticMarkup(<AnatomyStage anatomy={L<Anatomy>(null, { loading: true })} />)).toBeTruthy()
    expect(renderToStaticMarkup(<AnatomyStage anatomy={L<Anatomy>(null, { error: 'boom' })} />)).toContain('boom')
    expect(renderToStaticMarkup(<AnatomyStage anatomy={L<Anatomy>(null, { missing: true })} />)).toContain('Not deconstructed yet')
  })
  it('Mechanisms: cards for M01-M04 with principle / must-not-copy / confidence and a visible AI notice', () => {
    const html = renderToStaticMarkup(<MechanismsStage mechanisms={L(mech())} anatomyAvailable busy={null} onDerive={noop} />)
    for (const id of ['M01', 'M02', 'M03', 'M04']) expect(html).toContain(`data-testid="mechanism-${id}"`)
    expect(html).toContain('What must not be copied')
    expect(html).toContain('Medium confidence')
    expect(html).toContain('uses AI and may incur usage cost')
    expect(html).toContain('Derive again')
  })
  it('Mechanisms: none -> DERIVE MECHANISMS with the AI notice', () => {
    const html = renderToStaticMarkup(<MechanismsStage mechanisms={L<MechanismSet>(null, { missing: true })} anatomyAvailable busy={null} onDerive={noop} />)
    expect(html).toContain('Derive mechanisms')
    expect(html).toContain('uses AI and may incur usage cost')
  })
  it('Intent form: required fields, AI notice, build action', () => {
    const html = renderToStaticMarkup(<IntentStage form={emptyIntentForm()} errors={{ product: 'Product, service or topic is required' }} set={noop} mechanismsReady busy={null} onBuild={noop} hasExistingBlueprint />)
    expect(html).toContain('Product, service or topic')
    expect(html).toContain('Target audience')
    expect(html).toContain('Objective')
    expect(html).toContain('is required')
    expect(html).toContain('Build reconstruction blueprint')
    expect(html).toContain('uses AI and may incur usage cost')
    expect(html).toContain('NEW blueprint')
  })
  it('Blueprint: 7 ordered section cards, summary, USE BLUEPRINT enabled, methodology behind a disclosure', () => {
    const html = renderToStaticMarkup(<BlueprintStage blueprint={L(bp())} busy={null} onUse={noop} onNew={noop} useMessage={null} />)
    let last = -1
    for (let n = 1; n <= 7; n++) { const i = html.indexOf(`data-testid="blueprint-section-${n}"`); expect(i).toBeGreaterThan(last); last = i }
    expect(html).toContain('data-testid="blueprint-summary"')
    expect(html).toContain('Use blueprint')
    expect(html).toContain('View evidence / methodology')
    expect(html).toContain('bp-008f30518f8d64f6')
    expect(html).not.toMatch(/Stage\s*\d/)
    const btn = html.match(/<button[^>]*data-testid="use-blueprint-button"[^>]*>/)?.[0] ?? ''
    expect(btn).not.toContain('disabled=""')
  })
  it('Blueprint: a stale blueprint shows a warning and USE BLUEPRINT is disabled, without crashing', () => {
    const s = bp(); s.status = 'stale'; s.input_pin.current_anatomy_fingerprint = 'changed'
    const html = renderToStaticMarkup(<BlueprintStage blueprint={L(s)} busy={null} onUse={noop} onNew={noop} useMessage={null} />)
    expect(html).toContain('out of date')
    const btn = html.match(/<button[^>]*data-testid="use-blueprint-button"[^>]*>/)?.[0] ?? ''
    expect(btn).toContain('disabled=""')
    expect(html).toContain('data-testid="blueprint-section-7"')
  })
  it('Blueprint: none yet -> empty state pointing to New content', () => {
    expect(renderToStaticMarkup(<BlueprintStage blueprint={L<BlueprintResponse>(null, { missing: true })} busy={null} onUse={noop} onNew={noop} useMessage={null} />)).toContain('No blueprint yet')
  })
  it('Create: scene summary for the real blueprint; blocked when stale', () => {
    const plan = buildBlueprintPlan(bp())
    const ok = renderToStaticMarkup(<CreateStage blueprint={L(bp())} busy={null} onUse={noop} sceneSummary={{ n: plan.scenes.length, seconds: plan.totalSeconds }} useMessage={null} />)
    expect(ok).toContain('<b>7</b> scenes')
    const s = bp(); s.status = 'stale'
    expect(renderToStaticMarkup(<CreateStage blueprint={L(s)} busy={null} onUse={noop} sceneSummary={null} useMessage={null} />)).toContain('out of date')
  })
  it('Reference: card, status, DECONSTRUCT action and AI notice; no stage numbers', () => {
    const v = { id: 5127, original_filename: 'VA5368 clip.mp4', created_at: '2026-01-01', shots: [], technical_details: { container: { duration_seconds: 30 } }, latest_analysis: { status: 'complete' } } as unknown as ReferenceVideo
    const html = renderToStaticMarkup(
      <ReferenceStage references={L([v])} selectedId={5127} onSelect={noop} progress={summarizeDeconStatus(null)} busy={null} anatomyAvailable={false} onDeconstruct={noop} onAdd={noop} onRetry={noop} />,
    )
    expect(html).toContain('VA5368 clip.mp4')
    expect(html).toContain('30s')
    expect(html).toContain('Analysed')
    expect(html).toMatch(/data-testid="deconstruct-button"[^>]*>[^<]*Deconstruct/)
    expect(html).toContain('uses AI and may incur usage cost')
    expect(html).not.toMatch(/Stage\s*\d/)
  })
})

describe('Video Studio V2 blueprint scenes panel', () => {
  it('shows all 7 scenes in order with CTA on scene 7', () => {
    const plan = buildBlueprintPlan(bp())
    const html = renderToStaticMarkup(<BlueprintPlanView plan={plan} />)
    let last = -1
    for (let n = 1; n <= 7; n++) { const i = html.indexOf(`data-testid="blueprint-scene-${n}"`); expect(i).toBeGreaterThan(last); last = i }
    expect(html).toContain('7 scenes')
    expect(html).toContain('creation instructions')
    expect(html.slice(html.indexOf('data-testid="blueprint-scene-7"'))).toContain('CTA')
  })
})
