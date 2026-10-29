// PROPOSAL tests for exportGuard.ts. Target path if approved: frontend/src/pages/video-studio-v2/blueprint/exportGuard.test.ts
import { describe, expect, it } from 'vitest'
import fx from '../../deconstructor/assembly/__fixtures__/va5368.assembled.snapshot.json'
import type { TextOverlay, VideoClip } from '../../../types'
import { PLACEHOLDER_CTA_PREFIX, PLACEHOLDER_TEXT_PREFIX } from './blueprintPlan'
import { GAP_TOLERANCE, checkReconstructionExport, isUnreplacedPlaceholder } from './exportGuard'

const tag = (kind: 'text' | 'cta' = 'text', n = 1) => ({ blueprintId: 'bp-x', sectionNumber: n, kind, mechanismIds: [], referenceVideoId: 1, c3AttemptId: null })
const ov = (text: string, blueprint?: ReturnType<typeof tag>) => ({ text, ...(blueprint ? { blueprint } : {}) }) as Pick<TextOverlay, 'text' | 'blueprint'>
const clip = (s: number, e: number) => ({ startTime: s, endTime: e }) as Pick<VideoClip, 'startTime' | 'endTime'>
const full = () => JSON.parse(JSON.stringify(fx.snapshot)) as { textOverlays: TextOverlay[]; videoClips: VideoClip[] }

describe('what counts as a genuine placeholder', () => {
  it('tag + prefix: yes (text and call-to-action)', () => {
    expect(isUnreplacedPlaceholder(ov(PLACEHOLDER_TEXT_PREFIX + 'Say the hook', tag('text')))).toBe(true)
    expect(isUnreplacedPlaceholder(ov(PLACEHOLDER_CTA_PREFIX + 'Visit us', tag('cta')))).toBe(true)
  })
  it('ordinary text that merely looks similar (no tag): no', () => {
    for (const t of ['TEXT PLACEHOLDER — a tutorial title', 'CTA PLACEHOLDER', 'My placeholder', PLACEHOLDER_TEXT_PREFIX + 'x']) expect(isUnreplacedPlaceholder(ov(t))).toBe(false)
  })
  it('tagged but replaced by real wording: no (the tag survives edits, the prefix does not)', () => {
    expect(isUnreplacedPlaceholder(ov('Tiles that last a lifetime', tag()))).toBe(false)
    expect(isUnreplacedPlaceholder(ov('', tag()))).toBe(false)
  })
  it('placeholder wording mentioned mid-sentence is not a placeholder', () => {
    expect(isUnreplacedPlaceholder(ov('Never ship TEXT PLACEHOLDER — in a video', tag()))).toBe(false)
  })
  it('editor whitespace quirks still count', () => {
    const NB = String.fromCharCode(160), NL = String.fromCharCode(10)               // non-breaking space / newline, spelled out so they stay visible
    for (const t of ['  TEXT PLACEHOLDER — x', NL + 'TEXT PLACEHOLDER — x', 'TEXT PLACEHOLDER —' + NB + 'x', 'TEXT PLACEHOLDER —x', 'TEXT' + NB + 'PLACEHOLDER' + NB + '—' + NB + 'x', 'CTA' + NB + 'PLACEHOLDER' + NB + '— x']) expect(isUnreplacedPlaceholder(ov(t, tag())), JSON.stringify(t)).toBe(true)
  })
  it('a partly edited placeholder that keeps the prefix is still a placeholder; one whose prefix was removed is not', () => {
    expect(isUnreplacedPlaceholder(ov(PLACEHOLDER_TEXT_PREFIX + 'Short phrase. And my own words', tag()))).toBe(true)
    expect(isUnreplacedPlaceholder(ov('Short phrase. And my own words', tag()))).toBe(false)
  })
  it('malformed tags and values never throw', () => {
    expect(isUnreplacedPlaceholder({ text: PLACEHOLDER_TEXT_PREFIX, blueprint: { ...tag(), kind: 'weird' as never } })).toBe(false)
    expect(isUnreplacedPlaceholder({ text: undefined as never, blueprint: tag() })).toBe(false)
    expect(isUnreplacedPlaceholder({ text: null as never })).toBe(false)
  })
})

describe('placeholders block the export', () => {
  it('blocks and names where they are', () => {
    const r = checkReconstructionExport([ov(PLACEHOLDER_TEXT_PREFIX + 'a', tag('text', 2)), ov(PLACEHOLDER_CTA_PREFIX + 'b', tag('cta', 7)), ov('real', tag('text', 3))], [clip(0, 10)])
    expect(r).toMatchObject({ ok: false, code: 'placeholders' })
    if (!r.ok) { expect(r.message).toContain('2 placeholder texts'); expect(r.message).toContain('scene 2'); expect(r.message).toContain('call to action, scene 7'); expect(r.message).not.toContain('scene 3') }
  })
  it('singular wording for one', () => {
    const r = checkReconstructionExport([ov(PLACEHOLDER_TEXT_PREFIX + 'a', tag())], [clip(0, 4)])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toMatch(/^1 placeholder text from .* is still in this video/)
  })
  it('passes once every placeholder is replaced or removed', () => {
    expect(checkReconstructionExport([ov('Hook line', tag('text', 1)), ov('Visit us today', tag('cta', 7))], [clip(0, 4)])).toEqual({ ok: true })
    expect(checkReconstructionExport([ov('Only one left', tag())], [clip(0, 4)])).toEqual({ ok: true })
  })
  it('the real Stage-2 assembled draft is blocked as saved, and passes when its 8 placeholders are replaced', () => {
    const d = full()
    const first = checkReconstructionExport(d.textOverlays, d.videoClips)
    expect(first).toMatchObject({ ok: false, code: 'placeholders' })
    if (!first.ok) expect(first.message).toContain('8 placeholder texts')
    d.textOverlays.forEach((t, i) => { t.text = `Real wording ${i}` })
    expect(checkReconstructionExport(d.textOverlays, d.videoClips)).toEqual({ ok: true })
  })
})

describe('existing, non-reconstruction projects are untouched', () => {
  it('no blueprint tag anywhere: always ok, whatever the text or the clips', () => {
    expect(checkReconstructionExport([ov('TEXT PLACEHOLDER — x'), ov('CTA PLACEHOLDER — y')], [clip(0, 1), clip(50, 60)])).toEqual({ ok: true })
    expect(checkReconstructionExport([], [])).toEqual({ ok: true })
    expect(checkReconstructionExport(undefined as never, undefined as never)).toEqual({ ok: true })
  })
  it('does not mutate its inputs', () => {
    const d = full(); const before = JSON.stringify(d)
    checkReconstructionExport(d.textOverlays, d.videoClips)
    expect(JSON.stringify(d)).toBe(before)
  })
})

describe('gaps on the video track (reconstruction projects only; export joins clips end to end)', () => {
  const rep = [ov('Real wording', tag())]
  it('contiguous clips from 0: ok', () => { expect(checkReconstructionExport(rep, [clip(0, 4), clip(4, 9), clip(9, 14)])).toEqual({ ok: true }) })
  it('a gap between clips blocks and says where', () => {
    const r = checkReconstructionExport(rep, [clip(0, 4), clip(9, 14)])
    expect(r).toMatchObject({ ok: false, code: 'gaps' })
    if (!r.ok) expect(r.message).toContain('from 4s to 9s')
  })
  it('a first clip that starts late blocks too (everything would shift earlier)', () => {
    expect(checkReconstructionExport(rep, [clip(4, 9)])).toMatchObject({ ok: false, code: 'gaps' })
  })
  it('order does not matter, overlaps are not gaps, and the exporter’s own 0.05 s tolerance is respected', () => {
    expect(checkReconstructionExport(rep, [clip(9, 14), clip(0, 4), clip(4, 9)])).toEqual({ ok: true })
    expect(checkReconstructionExport(rep, [clip(0, 5), clip(4, 9)])).toEqual({ ok: true })
    expect(checkReconstructionExport(rep, [clip(0, 4), clip(4 + GAP_TOLERANCE, 9)])).toEqual({ ok: true })
    expect(checkReconstructionExport(rep, [clip(0, 4), clip(4 + GAP_TOLERANCE + 0.01, 9)])).toMatchObject({ ok: false })
  })
  it('a clip nested inside another does not hide or invent a gap', () => {
    expect(checkReconstructionExport(rep, [clip(0, 10), clip(2, 4), clip(10, 12)])).toEqual({ ok: true })
    expect(checkReconstructionExport(rep, [clip(0, 10), clip(2, 4), clip(11, 12)])).toMatchObject({ ok: false, code: 'gaps' })
  })
  it('a shorter timeline than planned (no trailing clip) is not a gap -- nothing shifts', () => { expect(checkReconstructionExport(rep, [clip(0, 4), clip(4, 9)])).toEqual({ ok: true }) })
  it('placeholders are reported before gaps', () => {
    expect(checkReconstructionExport([ov(PLACEHOLDER_TEXT_PREFIX + 'a', tag())], [clip(9, 14)])).toMatchObject({ code: 'placeholders' })
  })
  it('the real assembled draft (gapless, 7 scenes) has no gap; removing a scene’s clip creates one', () => {
    const d = full(); d.textOverlays.forEach(t => { t.text = 'ok' })
    expect(checkReconstructionExport(d.textOverlays, d.videoClips)).toEqual({ ok: true })
    d.videoClips.splice(2, 1)                                                                  // scene 3 left without footage
    expect(checkReconstructionExport(d.textOverlays, d.videoClips)).toMatchObject({ ok: false, code: 'gaps' })
  })
})
