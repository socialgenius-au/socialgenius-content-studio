// The account stays true after the draft is edited: statuses are recomputed from the layers that exist now.
import { describe, expect, it } from 'vitest'
import { planElementReconstruction, reconcileElementReconstruction } from '.'
import { brandAsLogo, caption, handle, imageLayer, laptop, person, textLayer, topBar, plate } from './fixtures'

const ctx = { referenceVideoId: 1, videoAnalysisId: 2, createdAt: '2026-11-03T00:00:00.000Z' }
const els = [handle(), caption(), person(), laptop(), topBar(), brandAsLogo()]
const layers = { textOverlays: [textLayer('rt:1247', 1247), textLayer('rt:1259', 1259), textLayer('rt:21', 21)], mediaOverlays: [imageLayer('ri:1', 'det:102', 'user_upload', 'detected_region')], shapes: [plate('rb:1', 'bg:1:top')] }
const record = planElementReconstruction(els, layers, ctx).record
const st = (r: typeof record, id: string) => r.items.find(i => i.elementId === id)!

describe('reconcileElementReconstruction', () => {
  it('with the layers unchanged it changes nothing that matters', () => {
    const r = reconcileElementReconstruction(record, layers)
    expect(r.items.map(i => [i.elementId, i.status, i.layers.map(l => l.id)])).toEqual(record.items.map(i => [i.elementId, i.status, i.layers.map(l => l.id)]))
    expect(r.counts).toEqual(record.counts)
  })
  it('a layer the person deleted in the editor makes its element "not included" again, never leaving a stale claim', () => {
    const edited = { ...layers, textOverlays: layers.textOverlays.filter(l => l.id !== 'rt:21') }
    const r = reconcileElementReconstruction(record, edited)
    expect(st(record, 'tt:grp:21').status).toBe('approximate'); expect(st(r, 'tt:grp:21')).toMatchObject({ status: 'not_included', layers: [] })
    expect(r.counts.not_included).toBe(record.counts.not_included + 1)
  })
  it('an image slot whose image the person removed becomes a missing asset; one they replace with their own becomes their content', () => {
    expect(st(reconcileElementReconstruction(record, { ...layers, mediaOverlays: [] }), 'ot:det:102').status).toBe('missing_asset')
    const crop = { ...layers, mediaOverlays: [imageLayer('ri:1', 'det:102', 'reference_frame_crop', 'detected_region')] }
    expect(st(reconcileElementReconstruction(record, crop), 'ot:det:102').status).toBe('approximate')
  })
  it('layers keep their link when they are re-found by candidate id even if their ids changed, and an undone deletion is found again', () => {
    const renamed = { ...layers, textOverlays: layers.textOverlays.map(l => ({ ...l, id: `${l.id}-copy` })) }
    expect(st(reconcileElementReconstruction(record, renamed), 'tt:rec:2202').layers.map(l => l.id)).toEqual(['rt:1247-copy', 'rt:1259-copy'])
    const gone = reconcileElementReconstruction(record, { ...layers, textOverlays: [] })
    expect(st(gone, 'tt:grp:21').status).toBe('not_included')
    expect(st(reconcileElementReconstruction(gone, layers), 'tt:grp:21').status).toBe('approximate')             // brought back
  })
  it('layers the person added themselves are not claimed by any element, and elements are never invented or dropped', () => {
    const r = reconcileElementReconstruction(record, { ...layers, textOverlays: [...layers.textOverlays, textLayer('mine', 999)] })
    expect(r.items.flatMap(i => i.layers.map(l => l.id))).not.toContain('mine'); expect(r.items.map(i => i.elementId)).toEqual(record.items.map(i => i.elementId))
  })
  it('does not mutate the record, and passes a foreign record through', () => {
    const before = JSON.stringify(record)
    reconcileElementReconstruction(record, { ...layers, textOverlays: [] })
    expect(JSON.stringify(record)).toBe(before)
    const other = { schema: 'something-else', items: [] } as never
    expect(reconcileElementReconstruction(other, layers)).toBe(other)
  })
})
