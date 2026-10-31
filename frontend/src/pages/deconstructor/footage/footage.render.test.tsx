// M1 / Stage 2 -- render smoke tests (server-side render, no DOM): the Footage Assignment panel on the real VA5368 plan, and the unchanged six-step page.
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import bpFx from '../__fixtures__/va5368.c4-blueprint.json'
import type { Asset } from '../../../types'
import type { BlueprintResponse } from '../../../types/deconstructor'
import { buildBlueprintPlan } from '../../video-studio-v2/blueprint/blueprintPlan'
import DeconstructorPage from '../DeconstructorPage'
import { CreateStage } from '../stages'
import { FootageAssignment } from './FootageAssignment'
import { FootageAssignmentView, type FootageAssignmentViewProps } from './FootageAssignmentView'
import { footageKeyFor, newClipEdit, readyEntry, runAssembly, type LibraryEntry, type SceneEdits } from './footageModel'

const resp = () => JSON.parse(JSON.stringify(bpFx)) as BlueprintResponse
const plan = buildBlueprintPlan(resp(), new Date('2026-10-01T00:00:00Z'))
const asset = (id: number, name = `v${id}.mp4`): Asset => ({ id, job_id: null, user_id: 1, original_filename: name, stored_filename: `s${id}.mp4`, file_path: `uploads/1/s${id}.mp4`, file_type: 'video', mime_type: 'video/mp4', file_size: 1000, created_at: '2026-10-01T00:00:00Z' })
const url = (p: string) => `/${p}`
const noop = () => {}

function props(over: { edits?: SceneEdits; library?: LibraryEntry[]; assets?: Asset[]; refs?: number[]; underfilled?: 'gap' | 'stretch' } & Partial<Omit<FootageAssignmentViewProps, 'library' | 'edits' | 'assets' | 'underfilled'>> = {}): FootageAssignmentViewProps {
  const { edits = {}, library = [], assets = [asset(1, 'shop.mp4'), asset(2, 'reference.mp4')], refs = [2], underfilled = 'gap', ...rest } = over
  const map = new Map(library.map(e => [e.key, e] as const))
  return {
    view: runAssembly({ plan, library: map, edits, referenceAssetIds: refs, underfilled, createdAt: '2026-10-01T00:00:00.000Z' }),
    edits, library: map, assets, referenceAssetIds: new Set(refs), libraryLoading: false, libraryError: null, uploadError: null, uploading: false, underfilled,
    saved: null, saving: false, saveMessage: null, openMessage: null,
    onUnderfilled: noop, onUpload: noop, onAdd: noop, onUpdate: noop, onRemove: noop, onMove: noop, onRetry: noop, onSave: noop, onOpen: noop,
    ...rest,
  }
}
const html = (p: FootageAssignmentViewProps) => renderToStaticMarkup(<FootageAssignmentView {...p} />)
const disabled = (markup: string, testId: string) => new RegExp(`<button[^>]*(?:disabled=""[^>]*data-testid="${testId}"|data-testid="${testId}"[^>]*disabled="")`).test(markup)

describe('Footage Assignment panel', () => {
  it('shows one row per blueprint scene with its time range, in order, plus upload and the reference notice', () => {
    const m = html(props())
    for (let i = 1; i <= 7; i++) expect(m).toContain(`data-testid="scene-row-${i}"`)
    expect(m).toContain('Scene 1') ; expect(m).toContain('0:00.0 – 0:04.0') ; expect(m).toContain('data-testid="footage-upload-button"')
    expect(m).toContain('The reference video itself can’t be used')
    expect(m).toContain('0 of 7 scenes have footage')
  })
  it('lists a reference video in the picker but disabled and labelled', () => {
    const m = html(props())
    expect(m).toMatch(/<option value="1"[^>]*>shop\.mp4<\/option>/)
    expect(m).toMatch(/<option value="2" disabled=""[^>]*>reference\.mp4 — reference video \(can’t be used\)<\/option>/)
  })
  it('an assigned scene shows its clip, real length, covered status and "covers the whole scene"', () => {
    const e: SceneEdits = { 1: [newClipEdit('c1', footageKeyFor(1))] }
    const m = html(props({ edits: e, library: [readyEntry(asset(1, 'shop.mp4'), 20, url)] }))
    expect(m).toContain('shop.mp4') ; expect(m).toContain('20s long') ; expect(m).toContain('Covered') ; expect(m).toContain('Covers the whole scene')
    expect(m).toContain('1 of 7 scenes have footage')
    expect(disabled(m, 'save-assembled-button')).toBe(false)
  })
  it('short footage shows the uncovered seconds and a warning, but can still be saved', () => {
    const e: SceneEdits = { 2: [newClipEdit('c1', footageKeyFor(1))] }
    const m = html(props({ edits: e, library: [readyEntry(asset(1), 3, url)] }))
    expect(m).toContain('Partly covered') ; expect(m).toContain('2s uncovered') ; expect(m).toContain('data-testid="warnings"')
    expect(disabled(m, 'save-assembled-button')).toBe(false)
  })
  it('problems are shown on the scene and in a "fix these" list, and saving is disabled', () => {
    const e: SceneEdits = { 3: [{ ...newClipEdit('c1', footageKeyFor(1)), trimIn: '99' }] }
    const m = html(props({ edits: e, library: [readyEntry(asset(1), 20, url)] }))
    expect(m).toContain('Needs attention') ; expect(m).toContain('data-testid="blockers"') ; expect(m).toContain('Fix these before saving')
    expect(disabled(m, 'save-assembled-button')).toBe(true)
  })
  it('footage still being read or unreadable is visible, with a way to retry', () => {
    const e: SceneEdits = { 1: [newClipEdit('c1', footageKeyFor(1))], 2: [newClipEdit('c2', footageKeyFor(3))] }
    const m = html(props({ edits: e, library: [{ state: 'probing', key: 'a1', assetId: 1, name: 'shop.mp4' }, { state: 'failed', key: 'a3', assetId: 3, name: 'bad.mp4', reason: 'This file could not be opened as a video.' }] }))
    expect(m).toContain('reading length') ; expect(m).toContain('This file could not be opened as a video.') ; expect(m).toContain('Try again')
    expect(disabled(m, 'save-assembled-button')).toBe(true)
  })
  it('empty, load-error and upload-error states are explained', () => {
    expect(html(props({ assets: [] }))).toContain('data-testid="no-footage"')
    expect(html(props({ libraryError: 'Could not load your videos.' }))).toContain('Could not load your videos.')
    expect(html(props({ uploadError: 'File exceeds size limit' }))).toContain('File exceeds size limit')
    expect(html(props({ uploading: true }))).toContain('Upload footage')
  })
  it('lists what is automatic, partial and unsupported -- and says unsupported items are never presented as editable', () => {
    const m = html(props())
    for (const k of ['automatic', 'partial', 'unsupported']) expect(m).toContain(`data-testid="elements-${k}"`)
    expect(m).toContain('Not recreated') ; expect(m).toContain('never copied and never presented as editable')
    expect(m).toContain('placeholder')                                        // the placeholder-text warning
  })
  it('save / open buttons follow the draft state', () => {
    const e: SceneEdits = { 1: [newClipEdit('c1', footageKeyFor(1))] }
    const base = { edits: e, library: [readyEntry(asset(1), 20, url)] }
    const fresh = html(props(base))
    expect(fresh).toContain('Save draft') ; expect(disabled(fresh, 'open-assembled-button')).toBe(true) ; expect(fresh).toContain('Nothing is created until you press Save draft')
    const saved = html(props({ ...base, saved: { draftId: 9, name: 'Blueprint — X', clips: 1, stale: false } }))
    expect(saved).toContain('Save changes to the draft') ; expect(disabled(saved, 'open-assembled-button')).toBe(false) ; expect(saved).toContain('Saved as “Blueprint — X” with 1 clip')
    const stale = html(props({ ...base, saved: { draftId: 9, name: 'Blueprint — X', clips: 1, stale: true } }))
    expect(disabled(stale, 'open-assembled-button')).toBe(true) ; expect(stale).toContain('data-testid="saved-stale"')
    expect(html(props({ ...base, saveMessage: 'Could not save' }))).toContain('Could not save')
    expect(html(props({ ...base, saved: { draftId: 9, name: 'n', clips: 1, stale: false }, openMessage: 'Cancelled — your current Video Studio project was left untouched.' }))).toContain('left untouched')
  })
})

describe('inside the existing Deconstructor workspace', () => {
  it('the six steps are still there, unchanged and in order', () => {
    const m = renderToStaticMarkup(<MemoryRouter><DeconstructorPage /></MemoryRouter>)
    const ids = [...m.matchAll(/data-testid="step-([a-z]+)"/g)].map(x => x[1])
    expect(ids).toEqual(['reference', 'anatomy', 'mechanisms', 'intent', 'blueprint', 'create'])
    for (const label of ['Reference', 'Anatomy', 'Mechanisms', 'New content', 'Blueprint', 'Create']) expect(m).toContain(label)
    expect(m).not.toContain('footage-assignment')                              // not on the first step
  })
  it('the Create step keeps its own "Use blueprint in Video Studio" action, and the footage panel sits beneath it', () => {
    const create = renderToStaticMarkup(<CreateStage blueprint={{ data: resp(), loading: false, error: null, missing: false }} busy={null} onUse={noop} sceneSummary={{ n: 7, seconds: 30 }} useMessage={null} />)
    expect(create).toContain('data-testid="open-studio-button"') ; expect(create).toContain('Use blueprint in Video Studio')
    const panel = renderToStaticMarkup(<MemoryRouter><FootageAssignment resp={resp()} plan={plan} references={[]} /></MemoryRouter>)
    expect(panel).toContain('data-testid="footage-assignment"') ; expect(panel).toContain('Assign your footage')
    expect(panel).not.toContain('open-studio-button')
  })
})
