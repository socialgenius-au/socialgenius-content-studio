// The Anatomy step shows the extra readings (AI visual reading, second speech reading, reconciliation) in plain business language, labelled as inferred / unverified,
// and only offers the actions; nothing here calls the network.
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import anatomyFx from './__fixtures__/va5368.c2-anatomy.redacted.json'
import type { Anatomy } from '../../types/deconstructor'
import { AnatomyStage } from './stages'
import { anatomyCard, anatomyOverview } from './viewModel'

const L = <T,>(data: T | null) => ({ data, loading: false, error: null, missing: false })
const base = () => JSON.parse(JSON.stringify(anatomyFx)) as Anatomy
const noop = () => {}

function withReadings(): Anatomy {
  const a = base()
  a.sections[0].creative = {
    basis: 'ai_vision', certainty: 'INFERRED',
    shot_reads: [{ shot_order: 0, focal_subject: 'A jar with a hand on the lid', framing: 'Vertical close-up', notes: null }],
    findings: [{ id: 15929, kind: 'hook_visual', confidence: 'medium', statement: 'The opening appears designed to establish the product straight away.', mechanism_hint: 'hook_curiosity', candidate_principle: 'Open on the product.' }],
  }
  a.sections[0].speech_reading = { text: 'शुद, बिना पानी, बिना केमिकल', model: 'small', quotable: false, status: 'machine_transcript_unverified' }
  a.video.creative = { summary: 'A product ad.', limitations: ['Some label text is garbled.'], certainty: 'INFERRED', finding_count: 3, model: 'claude-sonnet-5-5', frames_shown: 11 }
  a.video.reconciliation = {
    items: [{ id: 'rc-1', topic: 'object identity', status: 'partly_corroborated', note: 'Shot 2: the picture shows a jar, not a bowl.', sections: [2] },
            { id: 'rc-2', topic: 'object identity', status: 'established', note: 'ok', sections: [1] }],
    audience_effects: 'not established: there is no viewer data', unverified_speech_ids: [721, 722], low_confidence_text_ids: [],
  }
  const q = { plausible: false, reasons: ['low engine log-probability (-0.68)'], mean_avg_logprob: -0.68 }
  a.video.transcript = {
    original: { model: 'base', quality: q }, preferred_run_id: 'small|auto', policy: 'x',
    alternatives: [{ run_id: 'small|auto', model: 'small', status: 'machine_transcript_unverified', quotable: false, quality: { plausible: true, reasons: [], mean_avg_logprob: -0.27 }, agreement_with_original: { value: null, comparable: false, reason: 'different scripts' } }],
  }
  return a
}

describe('Anatomy readings', () => {
  it('without extra readings the cards and notes are unchanged and nothing is offered unless wired', () => {
    const html = renderToStaticMarkup(<AnatomyStage anatomy={L(base())} />)
    expect(html).not.toContain('anatomy-readings')
    expect(html).not.toContain('anatomy-reading-notes')
    expect(html).not.toContain('Seen by AI')
    expect(anatomyCard(base().sections[0]).seen).toEqual([])
    expect(anatomyOverview(base()).readingNotes).toEqual([])
  })

  it('offers the free speech re-read and the paid visual reading, with the cost stated', () => {
    const html = renderToStaticMarkup(<AnatomyStage anatomy={L(base())} onReadFrames={noop} onRereadSpeech={noop} />)
    expect(html).toContain('Re-read speech (free)')
    expect(html).toContain('Add AI visual reading')
    expect(html).toContain('may incur usage cost')
  })

  it('shows what the AI saw as an inference, the second speech reading as unverified, and how far to trust each', () => {
    const html = renderToStaticMarkup(<AnatomyStage anatomy={L(withReadings())} onReadFrames={noop} onRereadSpeech={noop} />)
    expect(html).toContain('Seen by AI (inferred)')
    expect(html).toContain('The opening appears designed to establish the product straight away.')
    expect(html).toContain('Second reading')
    expect(html).toContain('शुद, बिना पानी, बिना केमिकल')
    expect(html).toContain('unverified, not a quotation')
    expect(html).toContain('How far to trust what is shown')
    expect(html).toContain('This is an inference from the pictures, not a measurement.')
    expect(html).toContain('neither is a verified quotation')
    expect(html).toContain('Audience effects: not established')
    expect(html).toContain('Object identity (partly corroborated)')        // the disputed / partly corroborated item is shown...
    expect(html).not.toContain('Object identity (established)')            // ...an established one needs no warning
    expect(html).toContain('Refresh AI visual reading')
    expect(html).toContain('Re-read speech again')
  })

  it('a busy state disables both actions', () => {
    const html = renderToStaticMarkup(<AnatomyStage anatomy={L(withReadings())} busy="frames" onReadFrames={noop} onRereadSpeech={noop} />)
    expect((html.match(/disabled=""/g) ?? []).length).toBeGreaterThanOrEqual(2)
  })
})
