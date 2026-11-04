// M2.6 -- the manifest gathers what every panel produced into one read-only list: by scene, with how each element was found, never claiming more than the evidence, never changing a plan.
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildTransitionCandidates } from '../transitions/candidates'
import { makeTimeMap as trTimeMap } from '../transitions/corrections'
import { planTransitions } from '../transitions/materialize'
import { DISSOLVE, FADE_BLACK, evidenceFor as trEvidence, joinsFor } from '../transitions/testkit'
import { buildSpeechCandidates } from '../transcript/candidates'
import { makeTimeMap as spTimeMap } from '../transcript/corrections'
import { planSpeech } from '../transcript/materialize'
import { CAST, SCENES, evidenceFor as spEvidence } from '../transcript/testkit'
import { planComposition } from '../background/composition'
import { buildManifest, manifestText, NEVER_CLAIMED } from './manifest'
import { ManifestView } from './ManifestView'

const speech = planSpeech(buildSpeechCandidates(spEvidence(CAST, 'owned')), {}, { referenceVideoId: 5127, videoAnalysisId: 5368, timeMap: spTimeMap(42.6, 30), scenes: SCENES, existingSubtitleIds: [], createdAt: '2026-10-30T00:00:00.000Z' })
const trCands = buildTransitionCandidates(trEvidence([{ ...DISSOLVE, at: 10 }, { ...FADE_BLACK, at: 20 }]), joinsFor([10, 20, 30]), trTimeMap(30, 30))
const transitions = planTransitions(trCands, {}, { referenceVideoId: 5127, videoAnalysisId: 5368, timeMap: trTimeMap(30, 30), createdAt: '2026-10-30T00:00:00.000Z' })
const measuredProps = { x: { basis: 'measured' }, y: { basis: 'measured' } }
const text = { overlays: [{ id: 'rt:1:a', text: 'Big   headline here', startTime: 1, endTime: 4, reconstruction: { properties: { ...measuredProps, text: { basis: 'measured' }, color: { basis: 'inferred' } } } },
  { id: 'rt:1:b', text: 'Edited by you', startTime: 12, endTime: 14, reconstruction: { properties: { text: { basis: 'user' } } } }],
  record: { claims: { burnedInTextRemoved: false, originalFontsRecovered: false, originalLayersRecovered: false, backgroundPixelsRecovered: false } } } as never
const images = { overlays: [{ id: 'ri:1:a', startTime: 21, endTime: 25, reconstruction: { properties: { x: { basis: 'measured' } } } }], record: { claims: { originalImageFileRecovered: false } } } as never
const bars = { shapes: [{ id: 'rb:1:top', fillColor: '#112233', startTime: 0, endTime: 10, reconstruction: { sceneNumber: 1, side: 'top', evidence: { framesSeen: 3 }, properties: { size: { basis: 'measured' }, color: { basis: 'measured' } }, claims: { backgroundRecovered: false, contentBehindOverlaysRecovered: false, inpainted: false } } }] } as never

const input = { scenes: SCENES, textLayers: text, imageLayers: images, backgroundPlan: bars, speechPlan: speech, transitionPlan: transitions }

describe('the manifest', () => {
  const m = buildManifest(input)
  it('lists every element from every kind, once, with the kind that made it', () => {
    expect(m.total).toBe(2 + 1 + 1 + speech.subtitles.length + transitions.changes.length)
    expect(new Set(m.entries.map(e => e.family))).toEqual(new Set(['text', 'picture', 'plate', 'subtitle', 'transition']))
    expect(new Set(m.entries.map(e => e.family + e.id)).size).toBe(m.total)
    expect(m.summary.reduce((n, s) => n + s.total, 0)).toBe(m.total)
  })
  it('puts each element in its scene: a bar by its own scene, text and pictures by their time, a transition on the scene it follows', () => {
    const by = (id: string) => m.entries.find(e => e.id === id)!
    expect(by('rb:1:top').scene).toBe(1); expect(by('rt:1:a').scene).toBe(1); expect(by('rt:1:b').scene).toBe(2); expect(by('ri:1:a').scene).toBe(3)
    expect(m.entries.filter(e => e.family === 'transition').map(e => e.scene)).toEqual(transitions.changes.map(c => c.sceneNumber).sort((a, b) => a - b))
  })
  it('is ordered by scene, then time', () => {
    const keys = m.entries.map(e => [e.scene ?? 1e9, e.startTime ?? -1]); expect(keys).toEqual([...keys].sort((a, b) => a[0] - b[0] || a[1] - b[1]))
  })
  it('says how each was found: measured only when everything about it was measured, set by you when you changed anything, otherwise estimated', () => {
    const b = (id: string) => m.entries.find(e => e.id === id)!.bucket
    expect(b('rb:1:top')).toBe('recovered'); expect(b('rt:1:a')).toBe('inferred'); expect(b('rt:1:b')).toBe('manual')
    expect(m.entries.filter(e => e.family === 'transition').every(e => e.bucket === 'inferred')).toBe(true)
  })
  it('claims nothing: every claim on every entry is false, and the whole-project claims are false', () => {
    for (const e of m.entries) for (const v of Object.values(e.claims)) expect(v).toBe(false)
    expect(m.claims).toEqual({ originalProjectRecovered: false, originalAssetsRecovered: false }); expect(m.limitations).toBe(NEVER_CLAIMED)
  })
  it('does not change any plan it reads', () => {
    const before = JSON.stringify(input); buildManifest(input); expect(JSON.stringify(input)).toBe(before)
  })
  it('adds the stacking order only when a policy actually moved something', () => {
    const generated = { shapes: [], mediaOverlays: [], textOverlays: [], subtitles: speech.subtitles }
    expect(buildManifest({ ...input, composition: { plan: planComposition(generated, 'as_generated'), policy: 'as_generated' } }).entries.some(e => e.family === 'stacking')).toBe(false)
    const rec = buildManifest({ ...input, composition: { plan: planComposition(generated, 'recommended'), policy: 'recommended' } })
    expect(rec.entries.filter(e => e.family === 'stacking')).toHaveLength(1); expect(rec.entries.find(e => e.family === 'stacking')!.claims).toEqual({ originalLayerStructureRecovered: false })
  })
  it('is empty and says so when nothing is approved', () => {
    const e = buildManifest({ scenes: SCENES }); expect(e.total).toBe(0)
    const h = renderToStaticMarkup(<ManifestView manifest={e} />); expect(h).toContain('manifest-empty'); expect(h).toContain('manifest-not-recovered')
  })
  it('renders by scene with counts and the plain-words limits, and exports as readable text', () => {
    const h = renderToStaticMarkup(<ManifestView manifest={m} />).replace(/<!-- -->/g, '')
    expect(h).toContain('data-testid="manifest-scene-1"'); expect(h).toContain('data-testid="manifest-count-subtitle"'); expect(h).toContain('The original editing project, its layers, fonts and effects are not recovered')
    expect(h).toContain('Measured'); expect(h).toContain('Set by you'); expect(h).not.toMatch(/recovered (the|your) original|original (project|layers) (were|was|is|are) recovered/i)
    const t = manifestText(m); expect(t).toContain('Reconstruction manifest:'); expect(t).toContain('Scene 1'); expect(t).toContain('Not recovered:')
  })
})

describe('wiring', () => {
  const page = readFileSync(join(__dirname, '..', 'DeconstructorPage.tsx'), 'utf8')
  it('shows the manifest only with the manifest or all preview flag, leaving the approved path alone', () => {
    expect(page).toContain("const manifestOn = m2Has('manifest')"); expect(page).toContain("step === 'create' && plan && manifestOn"); expect(page).toContain("flags.includes('all')")
  })
  it('reads only: the manifest module imports no api client and calls no network function', () => {
    for (const f of ['manifest.ts', 'ManifestView.tsx', 'ReconstructionManifest.tsx']) {
      const src = readFileSync(join(__dirname, f), 'utf8'); expect(src).not.toMatch(/api\/client|fetch\(|axios|XMLHttpRequest/)
    }
  })
})
