import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { planElementReconstruction, readElementReconstruction, validateElementAccount } from '../../deconstructor/reconstruction'
import { brandAsLogo, caption, handle, imageLayer, laptop, person, textLayer, topBar } from '../../deconstructor/reconstruction/fixtures'
import { DRAFT_EXTRAS_LARGE_BYTES, EXTRAS_REPORT_KEY, draftExtrasForSave, emptyExtras, extrasNote, pickDraftExtras } from './draftExtras'

const ctx = { referenceVideoId: 1, videoAnalysisId: 2, createdAt: '2026-11-03T00:00:00.000Z' }
const layers = { textOverlays: [textLayer('rt:1247', 1247), textLayer('rt:21', 21)], mediaOverlays: [imageLayer('ri:1', 'det:102', 'user_upload', 'detected_region')], shapes: [] }
const record = planElementReconstruction([handle(), caption(), person(), laptop(), topBar(), brandAsLogo()], layers, ctx).record

describe('pickDraftExtras', () => {
  it('takes the Reconstructor records and the assembly table, as copies, and nothing else', () => {
    const snap = { videoClips: [{ id: 'a' }], textOverlays: [], elementReconstruction: JSON.parse(JSON.stringify(record)), textReconstruction: { kind: 'text' }, assembly: { createdAt: 'x' }, blueprintPlan: { a: 1 }, canvasFormat: {}, somethingElse: { a: 1 } }
    const out = pickDraftExtras(snap)
    expect(Object.keys(out.kept).sort()).toEqual(['assembly', 'elementReconstruction', 'textReconstruction'])
    expect(out.kept.elementReconstruction).toEqual(snap.elementReconstruction); expect(out.kept.elementReconstruction).not.toBe(snap.elementReconstruction)
    ;(snap.elementReconstruction.items[0] as { elementId: string | null }).elementId = 'changed'
    expect((out.kept.elementReconstruction as { items: { elementId: string }[] }).items[0].elementId).toBe(record.items[0].elementId)            // later edits to the opened draft never reach the copy
    expect(out.issues).toEqual([])
  })
  it('NEVER drops a record: an oversized one and a malformed one are kept in full and reported', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const big = { rows: 'x'.repeat(DRAFT_EXTRAS_LARGE_BYTES + 10) }
    const out = pickDraftExtras({ elementReconstruction: big, textReconstruction: [1, 2], imageReconstruction: 'text', backgroundReconstruction: null })
    expect(out.kept.elementReconstruction).toEqual(big)
    expect(out.kept.textReconstruction).toEqual([1, 2]); expect(out.kept.imageReconstruction).toBe('text'); expect(out.kept.backgroundReconstruction).toBeNull()
    expect(out.issues.map(i => `${i.key}:${i.issue}`).sort()).toEqual(['backgroundReconstruction:not_an_object', 'elementReconstruction:large', 'elementReconstruction:unrecognised_account', 'imageReconstruction:not_an_object', 'textReconstruction:not_an_object'])
    expect(warn).toHaveBeenCalled(); warn.mockRestore()
  })
  it('a snapshot that is not an object, or has no records, yields nothing, so such a draft is saved exactly as before', () => {
    expect(pickDraftExtras(null)).toEqual(emptyExtras()); expect(pickDraftExtras('x')).toEqual(emptyExtras()); expect(pickDraftExtras({})).toEqual(emptyExtras())
    expect(draftExtrasForSave(pickDraftExtras({ videoClips: [], textOverlays: [], canvasFormat: {} }), layers)).toEqual({})
  })
})

describe('draftExtrasForSave', () => {
  it('writes every carried record back, and recomputes the element account from the layers that exist now', () => {
    const extras = pickDraftExtras({ elementReconstruction: record, textReconstruction: { kind: 'text' }, assembly: { a: 1 } })
    const unchanged = draftExtrasForSave(extras, layers)
    expect(unchanged.textReconstruction).toEqual({ kind: 'text' }); expect(unchanged.assembly).toEqual({ a: 1 }); expect(unchanged[EXTRAS_REPORT_KEY]).toBeUndefined()
    expect((unchanged.elementReconstruction as typeof record).counts).toEqual(record.counts)
    const edited = draftExtrasForSave(extras, { ...layers, textOverlays: layers.textOverlays.filter(l => l.id !== 'rt:21') })        // the person deleted a text layer
    const item = (edited.elementReconstruction as typeof record).items.find(i => i.elementId === 'tt:grp:21')!
    expect(record.items.find(i => i.elementId === 'tt:grp:21')!.status).toBe('approximate'); expect(item.status).toBe('not_included')
    expect(extras.kept.elementReconstruction).toEqual(record)                                                                          // the carried copy itself is not mutated
  })
  it('an unrecognised account is kept exactly as stored and the draft says so; a record is never lost', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const foreign = { schema: 'element-reconstruction-v9', items: [1] }
    const out = draftExtrasForSave(pickDraftExtras({ elementReconstruction: foreign }), layers)
    expect(out.elementReconstruction).toEqual(foreign)
    expect(out[EXTRAS_REPORT_KEY]).toEqual([{ key: 'elementReconstruction', issue: 'unrecognised_account', note: expect.any(String) }])
    warn.mockRestore()
  })
  it('the report list is regenerated each time, so it never accumulates and is absent once nothing is unusual', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const first = draftExtrasForSave(pickDraftExtras({ textReconstruction: [1] }), layers)
    expect(first[EXTRAS_REPORT_KEY]).toHaveLength(1)
    expect(draftExtrasForSave(pickDraftExtras(first), layers)[EXTRAS_REPORT_KEY]).toHaveLength(1)
    expect(draftExtrasForSave(pickDraftExtras({ textReconstruction: { ok: true }, [EXTRAS_REPORT_KEY]: first[EXTRAS_REPORT_KEY] }), layers)[EXTRAS_REPORT_KEY]).toBeUndefined()
    warn.mockRestore()
  })
})

describe('an invalid record is kept but never used', () => {
  it('a well-formed account passes the gate; a real one reads back', () => {
    expect(validateElementAccount(record)).toEqual([]); expect(readElementReconstruction({ elementReconstruction: record })).toEqual(record)
  })
  it('the warning exists the moment the draft is OPENED, before any save, so the status line can show it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const broken = { ...JSON.parse(JSON.stringify(record)), items: ['nope'] }
    const opened = pickDraftExtras({ elementReconstruction: broken })
    expect(opened.issues.map(i => i.issue)).toEqual(['invalid_account']); expect(extrasNote(opened)).toMatch(/not valid and was kept unchanged but not used/)
    expect(pickDraftExtras({ elementReconstruction: record }).issues).toEqual([]); expect(extrasNote(pickDraftExtras({ elementReconstruction: record }))).toBe('')
    warn.mockRestore()
  })
  it('the right schema with damaged contents is kept exactly as stored, NOT reconciled, reported with a reason and what to do, and not read as an account', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const broken = { ...JSON.parse(JSON.stringify(record)), items: [{ elementId: 7, status: 'faithful', layers: 'x' }, 'nope'] }
    const out = draftExtrasForSave(pickDraftExtras({ elementReconstruction: broken }), layers)
    expect(out.elementReconstruction).toEqual(broken)                                                        // nothing lost, nothing "fixed"
    const issue = (out[EXTRAS_REPORT_KEY] as { key: string; issue: string; note: string }[])[0]
    expect(issue).toMatchObject({ key: 'elementReconstruction', issue: 'invalid_account' }); expect(issue.note).toMatch(/NOT used/); expect(issue.note).toMatch(/rebuild the draft from the Reconstructor/); expect(issue.note).toMatch(/elementId must be text or null/)
    expect(readElementReconstruction({ elementReconstruction: broken })).toBeNull()
    warn.mockRestore()
  })
  it('counts that are missing or negative, an unknown status and a layer without an id are each rejected', () => {
    const base = JSON.parse(JSON.stringify(record))
    expect(validateElementAccount({ ...base, counts: undefined })).toContain('counts missing')
    expect(validateElementAccount({ ...base, counts: { ...base.counts, faithful: -1 } }).join()).toMatch(/counts.faithful/)
    expect(validateElementAccount({ ...base, items: [{ ...base.items[0], status: 'invented' }] }).join()).toMatch(/unknown status/)
    expect(validateElementAccount({ ...base, items: [{ ...base.items[0], layers: [{ kind: 'text' }] }] }).join()).toMatch(/layers must be a list/)
    expect(validateElementAccount(null)).toEqual(['not an object']); expect(validateElementAccount([])).toEqual(['not an object'])
  })
  it('preserved metadata can never override an editor-owned key: the output holds only records, the report, and nothing the editor models', () => {
    const snap = { videoClips: [{ id: 'evil' }], textOverlays: [{ id: 'evil' }], canvasFormat: { width: 1 }, timeline: { duration: 1 }, canvasBackground: '#ff0000', elementReconstruction: record, assembly: { a: 1 } }
    const out = draftExtrasForSave(pickDraftExtras(snap), layers)
    expect(Object.keys(out).sort()).toEqual(['assembly', 'elementReconstruction'])
  })
})

describe('the visible note', () => {
  it('is empty when nothing is unusual, and otherwise one actionable sentence', () => {
    expect(extrasNote(pickDraftExtras({ elementReconstruction: record }))).toBe('')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(extrasNote(pickDraftExtras({ textReconstruction: [1], imageReconstruction: 'x' }))).toMatch(/^ — note: 2 saved reconstruction records are not valid and were kept unchanged but not used .*rebuild the draft from the Reconstructor/)
    expect(extrasNote(pickDraftExtras({ elementReconstruction: { rows: 'x'.repeat(DRAFT_EXTRAS_LARGE_BYTES + 5) } }))).toMatch(/unusually large and was kept in full/)
    warn.mockRestore()
  })
})

describe('wiring in the editor (source check)', () => {
  const src = readFileSync(join(__dirname, '../components/CreateEditTab.tsx'), 'utf8').replace(/\r\n/g, '\n')
  it('picks the extras up when a draft is opened, writes them first (named keys win), and clears them for a new project', () => {
    expect(src).toContain('draftExtrasRef.current = pickDraftExtras(snap)')
    expect(src).toContain('setDraftStatus(`Saved "${name}"${extrasNote(draftExtrasRef.current)}`)'); expect(src).toContain('setDraftStatus(`Opened "${full.name}"${extrasNote(draftExtrasRef.current)}`)')
    expect(src).toMatch(/buildProjectSnapshot = \(\): DraftProjectSnapshot => \(\{\n\s+\.\.\.draftExtrasForSave\(draftExtrasRef\.current, \{ textOverlays, mediaOverlays, shapes \}\),\n\s+videoClips,/)
    expect(src).toMatch(/draftExtrasRef\.current = emptyExtras\(\);\n\s+clearLiveProject\(\);/)
  })
})
