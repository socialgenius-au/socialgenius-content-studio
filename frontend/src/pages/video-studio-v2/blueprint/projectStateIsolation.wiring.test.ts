// Project-state isolation (protected-patch companion test). Opening a saved draft must start from a clean project state for the PROJECT-SPECIFIC settings
// (canvas format, subtitle style, media list, dragged positions), while leaving everything else alone. Pins the exact shape of the change in the two protected files.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const norm = (s: string) => s.replace(/\r\n/g, '\n')
const edit = norm(readFileSync(join(__dirname, '..', 'components', 'CreateEditTab.tsx'), 'utf8'))
const ctx = norm(readFileSync(join(__dirname, '..', '..', '..', 'contexts', 'StudioContext.tsx'), 'utf8'))

const apply = edit.slice(edit.indexOf('const applyDraftSnapshot = '), edit.indexOf('const openMyDrafts = '))
const clear = edit.slice(edit.indexOf('const clearLiveProject = '), edit.indexOf('const applyDraftSnapshot = '))
const fresh = edit.slice(edit.indexOf('const handleNewDraft = '), edit.indexOf('const defaultDraftName = '))
const at = (s: string) => { const i = apply.indexOf(s); expect(i, s).toBeGreaterThan(-1); return i }

describe('applyDraftSnapshot starts from a clean project state', () => {
  it('subtitle style: the draft\'s own, else the editor default (never the previous project\'s)', () => {
    expect(apply).toContain('setSubtitleStyle(snap.subtitleStyle ?? { ...EDITOR_DEFAULT_SUBTITLE_STYLE });')
    expect(apply).not.toContain('if (snap.subtitleStyle) setSubtitleStyle')
  })
  it('canvas format: the draft\'s own, else the editor default; the Reconstructor colour is applied on that, not on the previous project\'s format', () => {
    expect(apply).toContain('setCanvasFormat(snap.canvasFormat ?? { ...EDITOR_DEFAULT_CANVAS_FORMAT });')
    expect(apply).toContain('{ ...(snap.canvasFormat ?? EDITOR_DEFAULT_CANVAS_FORMAT), background: reconstructorColour }')
    expect(apply).not.toContain('if (snap.canvasFormat) setCanvasFormat')
    expect(apply).not.toMatch(/snap\.canvasFormat \?\? canvasFormat\b/)
  })
  it('media list: entries the draft does not carry are dropped from the editor list (in-memory only), then the draft\'s are added', () => {
    expect(at('mediaAssets.forEach(a => { if (!wantedAssetIds.has(a.id)) removeMediaAsset(a.id); });')).toBeLessThan(at('(snap.mediaAssets ?? []).forEach(a => { if (!existingAssetIds.has(a.id)) addMediaAsset(a); });'))
  })
  it('dragged positions: cleared first, then the draft\'s own are set', () => {
    expect(at('resetCanvasItemPositions();')).toBeLessThan(at('Object.entries(snap.canvasItemPositions ?? {}).forEach(([id, pos]) => setCanvasItemPosition(id, pos));'))
  })
  it('imports the defaults from the mirrored, drift-tested module', () => {
    expect(edit).toContain('import { EDITOR_DEFAULT_CANVAS_FORMAT, EDITOR_DEFAULT_SUBTITLE_STYLE } from "../blueprint/projectDefaults";')
  })
  it('it is reached from exactly one place: opening a draft from My Drafts', () => {
    expect(edit.split('applyDraftSnapshot(').length - 1).toBe(1)            // one call (handleOpenDraft); the definition is `const applyDraftSnapshot = (snap...`
    expect(edit.split('const applyDraftSnapshot = ').length - 1).toBe(1)
    expect(edit).toContain('applyDraftSnapshot(full.project_json);')
  })
})

describe('what is deliberately NOT changed', () => {
  it('clearLiveProject still clears only the timeline lanes (no settings)', () => {
    for (const s of ['setCanvasFormat', 'setSubtitleStyle', 'resetCanvasItemPositions', 'removeMediaAsset']) expect(clear, s).not.toContain(s)
  })
  it('"+ New" still keeps the current canvas format on purpose and touches no other setting', () => {
    for (const s of ['setCanvasFormat', 'setSubtitleStyle', 'resetCanvasItemPositions', 'removeMediaAsset']) expect(fresh, s).not.toContain(s)
  })
  it('the saved-draft shape (what buildProjectSnapshot writes) is not touched by this change', () => {
    expect(edit).toContain('canvasFormat, timeline, canvasItemPositions,')
  })
})

describe('StudioContext: one new, narrow action', () => {
  it('declares, implements and provides resetCanvasItemPositions; it only empties the positions map', () => {
    expect(ctx).toContain('resetCanvasItemPositions: () => void')
    expect(ctx).toContain('const resetCanvasItemPositions = useCallback(() => setCanvasItemPositions({}), [])')
    expect(ctx).toContain('canvasItemPositions, setCanvasItemPosition, resetCanvasItemPositions,')
  })
  it('no existing action changed: removeMediaAsset stays in-memory only (it filters the list, nothing is deleted on the server)', () => {
    expect(ctx).toContain('const removeMediaAsset = useCallback((id: number) => setMediaAssets(p => p.filter(a => a.id !== id)), [])')
  })
})
