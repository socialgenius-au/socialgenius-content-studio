// M2.2a -- render smoke tests (server-side, no DOM) for the review panel, plus the page wiring: hidden by default, shown only with ?m2=image-layers,
// nothing in any protected editor file changed, and the existing steps and panels left as they were.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { buildImageCandidates } from './candidates'
import { makeTimeMap, resolveImageCandidate, type ImageCorrections } from './corrections'
import { ImageLayersReviewView, type ImageLayersReviewViewProps } from './ImageLayersReviewView'
import type { PickedImage } from './imageFiles'
import { planImageLayers, type ImageRefs } from './materialize'
import { evidenceFor, uploaded } from './testkit'

const evidence = evidenceFor()
const candidates = buildImageCandidates(evidence, [{ id: 'user:1:1', frameId: 1, region: { x: 0.6, y: 0.04, w: 0.3, h: 0.08 } }])
const pick = (over: Partial<PickedImage> = {}): PickedImage => ({ token: 't', source: 'user_upload', blob: new Blob(), fileName: 'logo.png', width: 600, height: 300, hasAlpha: true, previewUrl: 'blob:x', ...over })

function props(over: Partial<ImageLayersReviewViewProps> & { corrections?: ImageCorrections; images?: ImageRefs; mode?: 'fit' | 'identity' } = {}): ImageLayersReviewViewProps {
  const corrections = over.corrections ?? {}
  const timeMap = makeTimeMap(42.6, 30, over.mode)
  const layerPlan = planImageLayers(candidates, corrections, over.images ?? {}, {
    referenceVideoId: 5127, videoAnalysisId: 5368, timeMap, canvas: { width: 1080, height: 1920 }, referenceRightsStatus: 'unknown_third_party', existingOverlays: [], createdAt: '2026-10-30T00:00:00.000Z',
  })
  return {
    state: { kind: 'ready' }, evidence, candidates, resolved: candidates.map(c => resolveImageCandidate(c, corrections[c.id], timeMap)), plan: layerPlan, corrections, picks: {}, timeMap,
    busy: false, message: null, frameId: null, frameUrl: p => `/frames${p}`, onCorrect: () => {}, onTimeMode: () => {}, onAddRegion: () => {}, onRemoveRegion: () => {}, onPickFrame: () => {},
    onChooseFile: () => {}, onCrop: () => {}, onClearImage: () => {}, onApply: () => {}, ...over,
  }
}
const html = (p: ImageLayersReviewViewProps) => renderToStaticMarkup(<ImageLayersReviewView {...p} />)
/** The opening tag of the element with this test id (attribute order in the markup is not something the tests should depend on). */
const tagOf = (markup: string, testId: string) => markup.match(new RegExp(`<[a-z]+[^>]*data-testid="${testId}"[^>]*>`))?.[0] ?? ''
const isDisabled = (markup: string, testId: string) => /\sdisabled(=|\s|>)/.test(tagOf(markup, testId))

describe('review panel', () => {
  const m = html(props())
  it('says plainly what it does not do', () => {
    expect(m).toContain('data-testid="image-layers-honesty"')
    expect(m).toContain('nothing is cut out, isolated or removed')
    expect(m).toContain('not a logo finder')
    expect(m).toContain('People detected in the reference are left out')
    expect(m).not.toMatch(/has been (extracted|isolated|removed)|logo (was )?found|background removed/i)
  })
  it('shows one row per candidate with its evidence, and a person left out by default', () => {
    for (const c of candidates) expect(m).toContain(`data-candidate="${c.id}"`)
    expect(m).toMatch(/data-testid="image-status-det-101"[^>]*>Left out by default/)
    expect(m).toContain('Detector label “person” (item 101)'); expect(m).toContain('91% sure')
    expect(m).toContain('A region you marked on the frame at 0.15s')
  })
  it('tells the person that only a rectangle is known', () => {
    expect(m).toContain('Only a rectangle is known. Nothing in the reference has been cut out')
  })
  it('lets the person mark a region on any sampled frame, with the frames listed by time', () => {
    expect(m).toContain('data-testid="image-mark-region"'); expect(m).toContain('data-testid="image-frame-select"')
    for (const t of ['0.15s', '5.0s', '10.0s', '40.2s']) expect(m).toContain(`>${t}</option>`)
    expect(m).toContain('/frames/data/uploads/1/frame-1.jpg')
  })
  it('summarises counts and says nothing is uploaded until images are added', () => {
    expect(m).toMatch(/<strong>4<\/strong> detected regions/); expect(m).toMatch(/<strong>1<\/strong> marked by you/)
    expect(m).toContain('Nothing is uploaded until you add images here.')
    expect(isDisabled(m, 'image-apply')).toBe(true)
  })
  it('offers your own image first and the reference crop only behind a rights confirmation that must be ticked', () => {
    expect(m).toContain('Choose your image'); expect(m).toContain('PNG (transparent works), JPG or WebP')
    expect(m).toContain('I have the right to use this part of the reference video.')
    expect(m).toContain('The reference is someone else’s video (rights unknown).')
    expect(m).toContain('not a cleaned-up or isolated image'); expect(m).toContain('it will look soft')
    expect(isDisabled(m, 'image-crop-user-1-1')).toBe(true)                                          // not ticked yet -> cannot crop
    const ticked = html(props({ corrections: { 'user:1:1': { rightsAcknowledged: true } } }))
    expect(isDisabled(ticked, 'image-crop-user-1-1')).toBe(false)
  })
  it('shows a chosen picture with its size and transparency, and what it will be drawn at', () => {
    const images = { 'user:1:1': { source: 'user_upload' as const, width: 600, height: 300, fileName: 'logo.png', hasAlpha: true } }
    const r = html(props({ images, picks: { 'user:1:1': pick() } }))
    expect(r).toContain('600×300px · your image · has transparency'); expect(r).toMatch(/data-testid="image-status-user-1-1"[^>]*>Ready to add/)
    expect(r).toMatch(/not in your library yet and will <strong>not<\/strong> be in the saved draft/)
    expect(isDisabled(r, 'image-apply')).toBe(false)
  })
  it('after the images are added it says the layers are saved with “Save draft”', () => {
    const images = { 'user:1:1': { source: 'user_upload' as const, width: 600, height: 300, fileName: 'logo.png', hasAlpha: true, assetId: 5, url: '/u' } }
    const r = html(props({ images, picks: { 'user:1:1': pick() } }))
    expect(r).toMatch(/data-testid="image-status-user-1-1"[^>]*>Will be added/); expect(r).toContain('saved into the draft when you use “Save draft” below')
  })
  it('flags a crop that needs the confirmation, and a stale one', () => {
    const crop = { source: 'reference_frame_crop' as const, width: 144, height: 38, fileName: 'c.png', hasAlpha: false, cropRegion: { x: 0.6, y: 0.04, w: 0.3, h: 0.08 }, assetId: 5, url: '/u' }
    const need = html(props({ images: { 'user:1:1': crop }, picks: { 'user:1:1': pick({ source: 'reference_frame_crop', hasAlpha: false }) } }))
    expect(need).toContain('Needs your confirmation'); expect(need).toContain('Confirm you may use this part of the reference video')
    const stale = html(props({ images: { 'user:1:1': { ...crop, cropRegion: { x: 0.1, y: 0.1, w: 0.3, h: 0.08 } } }, corrections: { 'user:1:1': { rightsAcknowledged: true } } }))
    expect(stale).toContain('Crop out of date')
  })
  it('states the timing doubt and offers the two timing modes only when the lengths differ', () => {
    expect(m).toMatch(/could be off by up to about \d\.\d s, and one sighting does not say how long it stayed/)
    expect(m).toContain('data-testid="image-timing-mode"'); expect(m).toContain('Fit to the blueprint length (42.6s → 30.0s)')
    expect(html(props({ timeMap: makeTimeMap(30, 30) }))).not.toContain('data-testid="image-timing-mode"')
  })
  it('offers “whole scene” and removal of a drawn region only', () => {
    expect(m).toContain('Show for the whole scene')
    expect(m).toContain('data-testid="image-remove-region-user-1-1"'); expect(m).not.toContain('data-testid="image-remove-region-det-102"')
  })
  it('shows loading, error and empty states without a list', () => {
    expect(html(props({ state: { kind: 'loading' } }))).toContain('Reading the analysis')
    expect(html(props({ state: { kind: 'error', message: 'Boom.' } }))).toContain('data-testid="image-layers-error"')
    expect(html(props({ state: { kind: 'no_frames' } }))).toContain('no sampled frames')
    expect(html(props({ state: { kind: 'loading' } }))).not.toContain('data-candidate=')
  })
  it('says what to do when nothing was detected', () => {
    const none = buildImageCandidates(evidenceFor({ detections: [] }), [])
    const p = props({ evidence: evidenceFor({ detections: [] }), candidates: none, resolved: [] })
    expect(html(p)).toContain('Nothing was detected here. Drag on a frame above')
  })
  it('shows a busy state and a message', () => {
    const r = html(props({ busy: true, message: 'Could not add logo.png. Nothing was changed for it: try again.' }))
    expect(r).toContain('Adding…'); expect(r).toContain('Could not add logo.png')
  })
})

describe('page wiring: hidden unless asked for', () => {
  const dir = join(__dirname, '..')
  const read = (...p: string[]) => readFileSync(join(dir, ...p), 'utf8')
  const page = read('DeconstructorPage.tsx')
  it('renders the review only for ?m2=image-layers, and only in the Create step with a usable plan', () => {
    expect(page).toContain("get('m2') === 'image-layers'")
    expect(page).toMatch(/step === 'create' && plan && imageLayersOn && <ImageLayersReview/)
  })
  it('passes image layers to the footage panel only when the flag is on', () => {
    expect(page).toContain('imageLayers={imageLayersOn ? imageLayers : null}')
  })
  it('leaves the M2.1a text flag, the six steps and the existing panels in place', () => {
    expect(page).toContain("get('m2') === 'text-layers'"); expect(page).toContain('textLayers={textLayersOn ? textLayers : null}')
    for (const s of ["id: 'reference'", "id: 'anatomy'", "id: 'mechanisms'", "id: 'intent'", "id: 'blueprint'", "id: 'create'"]) expect(page).toContain(s)
    expect(page).toContain('<FootageAssignment key={`${routeId}:${plan.blueprintId}`} resp={d.blueprint.data} plan={plan} references={d.references.data}')
  })
  it('the footage panel and the draft save take the layers as an optional extra and merge them after the text layers', () => {
    expect(read('footage', 'assembledDraft.ts')).toContain('mergeImageLayers(mergeTextLayers(assembled.snapshot, input.textLayers), input.imageLayers)')
    expect(read('footage', 'FootageAssignment.tsx')).toContain('textLayers, imageLayers,')
  })
  it('the image folder never calls the detector, an AI provider or the analysis endpoints', () => {
    const files = ['ImageLayersReview.tsx', 'imageFiles.ts', 'loadEvidence.ts', 'materialize.ts', 'candidates.ts']
    for (const f of files) {
      const src = readFileSync(join(__dirname, f), 'utf8')
      expect(src, f).not.toMatch(/analyze-visual|analyze-text|analyze-frames|deconstruct\(|mechanisms\.|anthropic|openai|\/generate\//i)
    }
    expect(readFileSync(join(__dirname, 'ImageLayersReview.tsx'), 'utf8')).toContain('referenceVideosApi.get(id)')
  })
})

describe('no protected editor file is part of this change', () => {
  const src = (p: string) => readFileSync(join(__dirname, '..', '..', 'video-studio-v2', p), 'utf8')
  it('the editor still treats an image layer as an ordinary overlay: contain-fit preview, merge-patch edits, no reconstruction-specific code', () => {
    const edit = src('components/CreateEditTab.tsx'), rev = src('components/ReviewTab.tsx'), ctx = readFileSync(join(__dirname, '..', '..', '..', 'contexts', 'StudioContext.tsx'), 'utf8')
    for (const s of [edit, rev, ctx]) expect(s).not.toMatch(/ImageReconstruction|imageReconstruction|ri:\$\{/)
    expect(rev).toContain('media_overlays: mediaOverlays.map(o => ({')
  })
})
