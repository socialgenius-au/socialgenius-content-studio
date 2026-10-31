// Integration of the reconstruction families (text M2.1a, images M2.2a, transitions M2.4a, speech M2.5a): all four optional plans can be saved into one draft, each changes only its own
// part of the snapshot, none clobbers another's record, and the page and footage panel carry all four flags. Synthetic data, merged into the real VA5368 assembled draft.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import assembledFx from './assembly/__fixtures__/va5368.assembled.snapshot.json'
import { mergeImageLayers, planImageLayers } from './imagelayers'
import { candidatesFor as imageCandidates, uploaded } from './imagelayers/testkit'
import { makeTimeMap } from './textlayers'
import { buildTransitionCandidates, mergeTransitions, planTransitions } from './transitions'
import { DISSOLVE, evidenceFor as transitionEvidence, joinsFor } from './transitions/testkit'
import { buildSpeechCandidates, mergeSpeech, planSpeech, setAllIncluded } from './transcript'
import { evidenceFor as speechEvidence } from './transcript/testkit'
import { mergeTextLayers, planTextLayers } from './textlayers'
import { candidatesFor as textCandidates } from './textlayers/testkit'
import { buildPlaceholderOverlays } from '../video-studio-v2/blueprint/blueprintPlan'
import bpFx from './__fixtures__/va5368.c4-blueprint.json'
import { buildBlueprintPlan } from '../video-studio-v2/blueprint/blueprintPlan'
import type { BlueprintResponse } from '../../types/deconstructor'

const plan = buildBlueprintPlan(JSON.parse(JSON.stringify(bpFx)) as BlueprintResponse, new Date('2026-10-01T00:00:00Z'))
const snap = () => JSON.parse(JSON.stringify(assembledFx.snapshot)) as { videoClips: { startTime: number; endTime: number; transition: string; transitionDuration: number }[]; textOverlays: { id: string }[]; mediaOverlays: { id: string }[]; subtitles: { id: string }[] }

function allPlans() {
  const map = makeTimeMap(42.6, plan.totalSeconds)
  const text = planTextLayers(textCandidates().candidates, { 'text:1': { replacePlaceholder: true } }, { referenceVideoId: plan.referenceVideoId, videoAnalysisId: plan.videoAnalysisId, timeMap: map, canvas: { width: 1080, height: 1920 }, existingOverlays: buildPlaceholderOverlays(plan), createdAt: '2026-10-30T00:00:00.000Z' })
  const ic = imageCandidates({}, [{ id: 'user:1:1', frameId: 1, region: { x: 0.6, y: 0.04, w: 0.3, h: 0.08 } }])
  const image = planImageLayers(ic.candidates, {}, { 'user:1:1': uploaded() }, { referenceVideoId: 5127, videoAnalysisId: 5368, timeMap: map, canvas: { width: 1080, height: 1920 }, referenceRightsStatus: 'owned', existingOverlays: [], createdAt: '2026-10-30T00:00:00.000Z' })
  const joins = joinsFor(plan.scenes.map(s => s.endTime))
  const transition = planTransitions(buildTransitionCandidates(transitionEvidence([{ ...DISSOLVE, id: 1, at: joins[2].time }]), joins, makeTimeMap(plan.totalSeconds, plan.totalSeconds)), {}, { referenceVideoId: 5127, videoAnalysisId: 5368, timeMap: makeTimeMap(plan.totalSeconds, plan.totalSeconds), createdAt: '2026-10-30T00:00:00.000Z' })
  const sc = buildSpeechCandidates(speechEvidence())
  const speech = planSpeech(sc, setAllIncluded({}, sc.map(c => c.id), true), { referenceVideoId: 5127, videoAnalysisId: 5368, timeMap: map, scenes: plan.scenes.map(s => ({ sceneNumber: s.sceneNumber, startTime: s.startTime, endTime: s.endTime })), existingSubtitleIds: [], createdAt: '2026-10-30T00:00:00.000Z' })
  return { text, image, transition, speech }
}

describe('the four reconstruction families in one saved draft', () => {
  const { text, image, transition, speech } = allPlans()
  // the merges are generic over the part of the snapshot each touches; this stand-in snapshot has only that part, so the chain is typed loosely here (the real chain in assembledDraft.ts is typed by the assembled snapshot)
  const L = (x: unknown) => x as never
  const apply = (s: ReturnType<typeof snap>) => mergeSpeech(L(mergeTransitions(L(mergeImageLayers(L(mergeTextLayers(L(s), text)), image)), transition)), speech) as unknown as Record<string, unknown> & ReturnType<typeof snap>
  const out = apply(snap())
  it('every family produced something to save', () => {
    expect(text.overlays.length).toBeGreaterThan(0); expect(image.overlays.length).toBe(1); expect(transition.changes.length).toBe(1); expect(speech.subtitles.length).toBeGreaterThan(0)
  })
  it('each changes only its own part of the snapshot', () => {
    const base = snap()
    expect(out.mediaOverlays.map(o => o.id)).toEqual([...base.mediaOverlays.map(o => o.id), ...image.overlays.map(o => o.id)])
    expect(out.subtitles.map(s => s.id)).toEqual([...base.subtitles.map(s => s.id), ...speech.subtitles.map(s => s.id)])
    expect(out.textOverlays.filter(o => o.id.startsWith('rc:')).length).toBe(text.overlays.length)
    expect(out.videoClips.map(c => [c.startTime, c.endTime])).toEqual(base.videoClips.map(c => [c.startTime, c.endTime]))
    expect(out.videoClips.filter((c, i) => c.transition !== base.videoClips[i].transition)).toHaveLength(1)
  })
  it('no family clobbers another’s record', () => {
    for (const key of ['reconstruction', 'imageReconstruction', 'transitionReconstruction', 'speechReconstruction']) expect(out[key], key).toBeDefined()
    expect((out.reconstruction as { kind: string }).kind).toBe('text'); expect((out.imageReconstruction as { kind: string }).kind).toBe('image')
    expect((out.transitionReconstruction as { kind: string }).kind).toBe('transition'); expect((out.speechReconstruction as { kind: string }).kind).toBe('speech')
  })
  it('the order the merges run in does not matter for the result', () => {
    const other = mergeTextLayers(L(mergeImageLayers(L(mergeSpeech(L(mergeTransitions(L(snap()), transition)), speech)), image)), text) as unknown as Record<string, unknown>
    expect(JSON.stringify(other, Object.keys(other).sort())).toBe(JSON.stringify(out, Object.keys(out).sort()))
  })
  it('is idempotent: merging everything again changes nothing', () => {
    const twice = apply(out as unknown as ReturnType<typeof snap>)
    expect(twice.mediaOverlays).toHaveLength(out.mediaOverlays.length); expect(twice.subtitles).toHaveLength(out.subtitles.length); expect(twice.textOverlays).toHaveLength(out.textOverlays.length)
  })
})

describe('the page and the footage panel carry all four flags', () => {
  const read = (...p: string[]) => readFileSync(join(__dirname, ...p), 'utf8')
  it('every flag is its own address parameter, and every plan reaches the footage panel only when its flag is on', () => {
    const page = read('DeconstructorPage.tsx')
    for (const f of ['text-layers', 'image-layers', 'transitions', 'transcript', 'background']) expect(page).toContain(`m2Has('${f}')`)
    for (const p of ['textLayers={textLayersOn ? textLayers : null}', 'imageLayers={imageLayersOn ? imageLayers : null}', 'transitionPlan={transitionsOn ? transitionPlan : null}', 'speechPlan={transcriptOn ? speechPlan : null}', 'backgroundPlan={backgroundOn ? backgroundPlan : null}', 'compositionPolicy={backgroundOn ? compositionPolicy : null}']) expect(page).toContain(p)
  })
  it('the draft save and the saved-vs-edited signature include all four', () => {
    expect(read('footage', 'assembledDraft.ts')).toContain('applyComposition(mergeBackground(mergeSpeech(mergeTransitions(mergeImageLayers(mergeTextLayers(assembled.snapshot, input.textLayers), input.imageLayers), input.transitionPlan), input.speechPlan), input.backgroundPlan), input.compositionPolicy)')
    const fa = read('footage', 'FootageAssignment.tsx')
    for (const s of ['textLayers, imageLayers, transitionPlan, speechPlan,', 'transitionPlan || speechPlan', '`tr:${transitionPlan.signature}`', '`sp:${speechPlan.signature}`', '`img:${imageLayers.signature}`', '`bg:${backgroundPlan.signature}`', 'backgroundPlan, compositionPolicy,']) expect(fa).toContain(s)
  })
})
