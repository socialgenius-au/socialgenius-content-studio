// M2.5a -- render smoke tests (server-side, no DOM) for the review panel, plus the page wiring: hidden by default, shown only with ?m2=transcript, no protected file touched.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { buildSpeechCandidates } from './candidates'
import { makeTimeMap, resolveSpeech, setAllIncluded, type SpeechCorrections } from './corrections'
import { planSpeech } from './materialize'
import { TranscriptReviewView, type TranscriptReviewViewProps } from './TranscriptReviewView'
import { CAST, SCENES, evidenceFor } from './testkit'

function props(over: Partial<TranscriptReviewViewProps> & { corrections?: SpeechCorrections; rights?: 'owned' | 'unknown_third_party'; refSeconds?: number } = {}): TranscriptReviewViewProps {
  const corrections = over.corrections ?? {}
  const ev = evidenceFor(CAST, over.rights ?? 'owned', over.refSeconds ?? 42.6)
  const candidates = buildSpeechCandidates(ev)
  const timeMap = makeTimeMap(over.refSeconds ?? 42.6, over.refSeconds ?? 42.6, 'identity')
  const plan = planSpeech(candidates, corrections, { referenceVideoId: 5127, videoAnalysisId: 5368, timeMap, scenes: SCENES, existingSubtitleIds: [], createdAt: '2026-10-30T00:00:00.000Z' })
  return { state: { kind: 'ready' }, rightsStatus: ev.rightsStatus, candidates, resolved: candidates.map(c => resolveSpeech(c, corrections[c.id], timeMap)), plan, timeMap, onCorrect: () => {}, onIncludeAll: () => {}, onTimeMode: () => {}, ...over }
}
const html = (p: TranscriptReviewViewProps) => renderToStaticMarkup(<TranscriptReviewView {...p} />)
const flat = (s: string) => s.replace(/<!-- -->/g, '')

describe('review panel', () => {
  const m = html(props())
  it('says plainly what it does not do: machine transcript, not verified, no voice, music or effects', () => {
    expect(m).toContain('data-testid="transcript-honesty"'); expect(m).toContain('This is a machine transcript'); expect(m).toContain('not checked against the audio')
    expect(m).toContain('The speaker’s voice, music and'); expect(m).not.toMatch(/transcript is (accurate|correct)|voice (was )?recovered/i)
  })
  it('shows one row per segment with when it was heard, the recogniser’s rating, and the words as transcribed (editable)', () => {
    for (const id of [11, 12, 13, 14, 15, 16, 17, 18, 19]) expect(m).toContain(`data-testid="speech-item-sp-${id}"`)
    expect(flat(m)).toContain('Heard at 0.0s–2.4s in the reference · language “en” · recogniser rating -0.30'); expect(m).toMatch(/data-testid="speech-text-sp-11"[^>]*value="Welcome to the show"|value="Welcome to the show"[^>]*data-testid="speech-text-sp-11"/)
    expect(m).toContain('(as transcribed — check it)')
  })
  it('flags poorly rated, looping and not-speech lines with the recogniser’s numbers, and an Arabic-script line the exporter cannot lay out', () => {
    expect(m).toMatch(/data-testid="speech-warning-low_quality-sp-13"/); expect(m).toContain('average log-probability -1.40'); expect(m).toContain('compression ratio 3.10'); expect(m).toContain('80 % no-speech')
    expect(m).toMatch(/data-testid="speech-warning-script_unsupported-sp-18"/); expect(m).toContain('Arabic script'); expect(m).toContain('the exported subtitle would be wrong')
  })
  it('counts what will happen, including the lines in a script the exporter cannot draw', () => {
    expect(flat(m)).toMatch(/<strong>9<\/strong> transcript segments · <strong>6<\/strong> will be added · 3 left out · <strong[^>]*>1 in a script the exporter cannot draw correctly yet<\/strong>/)
  })
  it('for a third party’s reference: warns whose words these are, leaves every line out, and offers “Include all” as the person’s own choice', () => {
    const t = html(props({ rights: 'unknown_third_party' }))
    expect(t).toContain('data-testid="transcript-rights"'); expect(t).toContain('someone else’s video (rights unknown)'); expect(t).toContain('Its words are left out by default')
    expect(flat(t)).toMatch(/<strong>0<\/strong> will be added · 9 left out/); expect(t).toContain('Left out by default: these are someone else’s words')
    expect(t).toContain('data-testid="transcript-include-all"'); expect(t).toContain('their words, so this is your choice'); expect(html(props())).not.toContain('data-testid="transcript-rights"')
  })
  it('shows a person’s rewording as theirs, with a way back, and the script by scene uses their wording', () => {
    const r = html(props({ corrections: { 'sp:11': { text: 'Hello and welcome' } } }))
    expect(r).toContain('(your edit)'); expect(r).toContain('Back to what was transcribed'); expect(r).toContain('Hello and welcome')
    expect(r).toContain('data-testid="script-scene-1"'); expect(r).toContain('data-testid="script-scene-3"')
  })
  it('says the script is empty when nothing is kept, and offers the two timing modes only when the lengths differ', () => {
    expect(html(props({ rights: 'unknown_third_party' }))).toContain('data-testid="transcript-script-empty"')
    expect(m).not.toContain('data-testid="transcript-timing-mode"')
    const stretched = props({ refSeconds: 42.6 }); const s = html({ ...stretched, timeMap: makeTimeMap(42.6, 30, 'fit') })
    expect(flat(s)).toContain('Fit to the blueprint length (42.6s → 30.0s)')
  })
  it('shows loading, error and none states without a list', () => {
    expect(html(props({ state: { kind: 'loading' } }))).toContain('Reading the analysis'); expect(html(props({ state: { kind: 'error', message: 'Boom.' } }))).toContain('data-testid="transcript-error"')
    expect(html(props({ state: { kind: 'none' } }))).toContain('no speech'); expect(html(props({ state: { kind: 'loading' } }))).not.toContain('data-candidate=')
  })
  it('lets include-all be a person’s explicit choice for every line', () => {
    const all = html(props({ rights: 'unknown_third_party', corrections: setAllIncluded({}, CAST.map(c => `sp:${c.id}`), true) }))
    expect(flat(all)).toMatch(/<strong>9<\/strong> transcript segments · <strong>9<\/strong> will be added/)
  })
})

describe('page wiring: hidden unless asked for', () => {
  const dir = join(__dirname, '..')
  const read = (...p: string[]) => readFileSync(join(dir, ...p), 'utf8')
  const page = read('DeconstructorPage.tsx')
  it('renders the review only for ?m2=transcript, in the Create step with a usable plan; passes the plan on only when the flag is on', () => {
    expect(page).toContain("m2Has('transcript')"); expect(page).toMatch(/step === 'create' && plan && transcriptOn && <TranscriptReview/); expect(page).toContain('speechPlan={transcriptOn ? speechPlan : null}')
  })
  it('leaves the other flags and the existing panels in place; the draft save adds subtitles after the layers', () => {
    for (const s of ["m2Has('text-layers')", "m2Has('image-layers')", 'textLayers={textLayersOn ? textLayers : null}', "id: 'create'"]) expect(page).toContain(s)
    expect(read('footage', 'assembledDraft.ts')).toContain('mergeSpeech(mergeTransitions(mergeImageLayers(mergeTextLayers(assembled.snapshot, input.textLayers), input.imageLayers), input.transitionPlan), input.speechPlan)')
  })
  it('the default subtitle box is the editor’s own, and the module never starts speech recognition or calls an AI endpoint', () => {
    expect(readFileSync(join(dir, '..', 'video-studio-v2', 'components', 'CreateEditTab.tsx'), 'utf8')).toContain('const DEFAULT_SUBTITLE_BOX = { x: 10, y: 82, width: 80 };')
    for (const f of ['TranscriptReview.tsx', 'loadEvidence.ts', 'materialize.ts', 'candidates.ts']) expect(readFileSync(join(__dirname, f), 'utf8'), f).not.toMatch(/analyze-speech|analyze-|deconstruct\(|mechanisms\.|anthropic|openai|whisper|\/generate\//i)
    expect(readFileSync(join(__dirname, 'TranscriptReview.tsx'), 'utf8')).toContain('referenceVideosApi.get(id)')
  })
  it('no protected editor file is part of this change beyond what the export-parity branch already carries', () => {
    const studio = join(dir, '..', 'video-studio-v2')
    for (const f of ['components/CreateEditTab.tsx', 'components/ReviewTab.tsx']) expect(readFileSync(join(studio, f), 'utf8'), f).not.toMatch(/speechReconstruction|mergeSpeech|SpeechPlan|SpeechReconstructionProvenance/)
  })
})
