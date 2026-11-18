// M2.5 -- subtitle layout controls: where the subtitles sit, how big the text is, how long a line may be. The defaults must change nothing; every choice ends up as an ordinary editable
// property of each native subtitle (box position, style override, line breaks in the text) with its provenance; the words are never altered.
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { buildSpeechCandidates } from './candidates'
import { DEFAULT_SUBTITLE_BOX } from './contract'
import { makeTimeMap, resolveSpeech } from './corrections'
import { DEFAULT_LAYOUT, FONT_SIZES, MAX_CHARS_RANGE, POSITION_Y, breakLines, isDefaultLayout, normaliseLayout } from './layout'
import { planSpeech, type SpeechContext } from './materialize'
import { TranscriptReviewView } from './TranscriptReviewView'
import { CAST, SCENES, evidenceFor } from './testkit'

const ctx = (over: Partial<SpeechContext> = {}): SpeechContext => ({ referenceVideoId: 5127, videoAnalysisId: 5368, timeMap: makeTimeMap(42.6, 30), scenes: SCENES, existingSubtitleIds: [], createdAt: '2026-10-30T00:00:00.000Z', ...over })
const candidates = buildSpeechCandidates(evidenceFor(CAST, 'owned'))

describe('breakLines', () => {
  it('leaves text alone when the limit is off, the line is short enough, or there are no spaces to break at', () => {
    expect(breakLines('Welcome to the show', 0)).toBe('Welcome to the show'); expect(breakLines('Welcome to the show', 40)).toBe('Welcome to the show'); expect(breakLines('你好你好你好你好你好你好', 4)).toBe('你好你好你好你好你好你好')
  })
  it('wraps greedily on spaces, never splits a word, and keeps existing breaks', () => {
    expect(breakLines('A very long explanation that the recogniser kept', 20)).toBe('A very long\nexplanation that the\nrecogniser kept')
    expect(breakLines('extraordinarily short', 5)).toBe('extraordinarily\nshort')
    expect(breakLines('one two\nthree four five', 9)).toBe('one two\nthree\nfour five')
  })
  it('only moves spaces to line breaks: the words are the same and in the same order', () => {
    const text = 'A very long explanation that the recogniser kept as a single segment'
    expect(breakLines(text, 18).replace(/\n/g, ' ')).toBe(text)
  })
  it('counts characters, not UTF-16 units, so an emoji or Urdu letters do not shorten a line', () => {
    expect(breakLines('😀😀 😀😀 😀😀', 5)).toBe('😀😀 😀😀\n😀😀')
    expect(breakLines('مرحبا بكم في الفيديو', 10)).toBe('مرحبا بكم\nفي الفيديو')
  })
})

describe('normaliseLayout', () => {
  it('falls back to the editor’s defaults for anything unknown', () => {
    expect(normaliseLayout(undefined)).toEqual(DEFAULT_LAYOUT); expect(normaliseLayout({ position: 'left' as never, fontSize: 37, maxChars: Number.NaN })).toEqual(DEFAULT_LAYOUT)
    expect(isDefaultLayout(DEFAULT_LAYOUT)).toBe(true); expect(DEFAULT_LAYOUT.position).toBe('bottom'); expect(POSITION_Y.bottom).toBe(DEFAULT_SUBTITLE_BOX.y)
  })
  it('accepts the known sizes and positions, and clamps the line length into range (0 = off)', () => {
    expect(normaliseLayout({ position: 'top', fontSize: FONT_SIZES[2], maxChars: 28 })).toEqual({ position: 'top', fontSize: FONT_SIZES[2], maxChars: 28 })
    expect(normaliseLayout({ maxChars: 3 }).maxChars).toBe(MAX_CHARS_RANGE.min); expect(normaliseLayout({ maxChars: 500 }).maxChars).toBe(MAX_CHARS_RANGE.max); expect(normaliseLayout({ maxChars: -4 }).maxChars).toBe(0)
  })
})

describe('the plan with a layout', () => {
  it('is byte-for-byte what it was without one when the layout is the default', () => {
    const a = planSpeech(candidates, {}, ctx()), b = planSpeech(candidates, {}, ctx({ layout: DEFAULT_LAYOUT }))
    expect(b.subtitles.map(s => ({ ...s, reconstruction: undefined }))).toEqual(a.subtitles.map(s => ({ ...s, reconstruction: undefined })))
    expect(b.subtitles.every(s => s.y === DEFAULT_SUBTITLE_BOX.y && s.styleOverride === undefined)).toBe(true)
    expect(b.signature).toBe(a.signature)
  })
  it('places the subtitles where asked and records it as the user’s choice; the default position stays "default"', () => {
    const top = planSpeech(candidates, {}, ctx({ layout: { position: 'top' } })), mid = planSpeech(candidates, {}, ctx({ layout: { position: 'middle' } }))
    expect(top.subtitles.length).toBeGreaterThan(0)
    expect(top.subtitles.every(s => s.y === POSITION_Y.top)).toBe(true); expect(mid.subtitles.every(s => s.y === POSITION_Y.middle)).toBe(true)
    expect(top.subtitles[0].reconstruction?.properties.position.basis).toBe('user')
    expect(planSpeech(candidates, {}, ctx()).subtitles[0].reconstruction?.properties.position.basis).toBe('default')
    expect(top.signature).not.toBe(planSpeech(candidates, {}, ctx()).signature)
  })
  it('sets a text size as a per-subtitle style override only when one is chosen, and records it', () => {
    const big = planSpeech(candidates, {}, ctx({ layout: { fontSize: 44 } }))
    expect(big.subtitles.every(s => s.styleOverride?.fontSize === 44)).toBe(true); expect(big.subtitles[0].reconstruction?.properties).toHaveProperty('fontSize')
    expect(planSpeech(candidates, {}, ctx({ layout: { fontSize: 99 } })).subtitles.every(s => s.styleOverride === undefined)).toBe(true)
  })
  it('breaks long lines in the subtitle text while the script keeps the unbroken words', () => {
    const p = planSpeech(candidates, {}, ctx({ layout: { maxChars: 20 } }))
    const long = p.subtitles.find(s => s.id.endsWith('sp:17'))!
    expect(long.text).toContain('\n'); expect(long.text.split('\n').every(l => Array.from(l).length <= 20 || !l.includes(' '))).toBe(true)
    expect(long.text.replace(/\n/g, ' ')).toBe('A very long explanation that the recogniser kept as a single segment')
    expect(long.reconstruction?.properties).toHaveProperty('lineBreaks')
    expect(p.script.flatMap(s => s.lines).find(l => l.candidateId === 'sp:17')!.text).not.toContain('\n')
  })
  it('does not change which lines are included, their times, or what they say', () => {
    const a = planSpeech(candidates, {}, ctx()), b = planSpeech(candidates, {}, ctx({ layout: { position: 'top', fontSize: 52, maxChars: 24 } }))
    expect(b.subtitles.map(s => [s.id, s.startTime, s.endTime, s.text.replace(/\n/g, ' ')])).toEqual(a.subtitles.map(s => [s.id, s.startTime, s.endTime, s.text]))
    expect(b.record.counts).toEqual(a.record.counts)
  })
})

describe('the controls', () => {
  const ev = evidenceFor(CAST, 'owned'), cands = buildSpeechCandidates(ev), timeMap = makeTimeMap(42.6, 42.6, 'identity')
  const base = { state: { kind: 'ready' as const }, rightsStatus: 'owned', candidates: cands, resolved: cands.map(c => resolveSpeech(c, undefined, timeMap)), timeMap, onCorrect: () => {}, onIncludeAll: () => {}, onTimeMode: () => {} }
  const plan = planSpeech(cands, {}, ctx({ timeMap }))
  it('are shown only when the container supplies them, with position, size and line length', () => {
    expect(renderToStaticMarkup(<TranscriptReviewView {...base} plan={plan} />)).not.toContain('subtitle-layout')
    const h = renderToStaticMarkup(<TranscriptReviewView {...base} plan={plan} layout={{ position: 'top', fontSize: 36, maxChars: 28 }} onLayout={() => {}} />)
    for (const id of ['subtitle-layout', 'subtitle-position', 'subtitle-size', 'subtitle-maxchars']) expect(h).toContain(`data-testid="${id}"`)
    expect(h).toContain('value="top" selected'); expect(h).toContain('value="36" selected'); expect(h).toMatch(/value="28"/); expect(h).toContain('Different from the editor’s defaults')
  })
  it('say the subtitles stay ordinary editable ones and the wording is not changed', () => {
    const h = renderToStaticMarkup(<TranscriptReviewView {...base} plan={plan} layout={DEFAULT_LAYOUT} onLayout={() => {}} />)
    expect(h).toContain('still move, resize and restyle in Video Studio'); expect(h).toContain('the wording is not changed'); expect(h).not.toContain('Different from the editor’s defaults')
  })
})
