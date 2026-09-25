import { beforeEach, describe, expect, it, vi } from 'vitest'
import bpFx from '../../deconstructor/__fixtures__/va5368.c4-blueprint.json'
import type { BlueprintResponse } from '../../../types/deconstructor'
import { isBlueprintPlan } from './blueprintPlan'
import { consumeOpenDraftHint, OPEN_DRAFT_HINT_KEY, setOpenDraftHint } from './openDraftHint'
import {
  createStudioDraftFromBlueprint, existingProjectItems, STUDIO_PROJECT_BACKUP_KEY, STUDIO_PROJECT_KEY, STUDIO_ROUTE, STUDIO_STAGE_KEY,
} from './createStudioDraft'

const real = () => JSON.parse(JSON.stringify(bpFx)) as BlueprintResponse

function memStorage(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init))
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) }, removeItem: (k: string) => { m.delete(k) }, _m: m }
}

beforeEach(() => {
  const s = memStorage()
  ;(globalThis as unknown as { localStorage: unknown }).localStorage = s
  ;(globalThis as unknown as { sessionStorage: unknown }).sessionStorage = memStorage()
})

describe('openDraftHint', () => {
  it('is one-shot and rejects junk', () => {
    setOpenDraftHint(42)
    expect(consumeOpenDraftHint()).toBe(42)
    expect(consumeOpenDraftHint()).toBeNull()
    sessionStorage.setItem(OPEN_DRAFT_HINT_KEY, 'abc')
    expect(consumeOpenDraftHint()).toBeNull()
    sessionStorage.setItem(OPEN_DRAFT_HINT_KEY, '-3')
    expect(consumeOpenDraftHint()).toBeNull()
  })
})

describe('createStudioDraftFromBlueprint (USE BLUEPRINT)', () => {
  it('creates a durable draft holding 7 scenes, points the editor at Create/Edit and returns the Video Studio V2 route', async () => {
    const storage = memStorage()
    const createDraft = vi.fn().mockResolvedValue({ data: { id: 77 } })
    const res = await createStudioDraftFromBlueprint(real(), { createDraft, storage, confirmReplace: () => true, now: () => new Date('2026-09-25T00:00:00Z') })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.route).toBe(STUDIO_ROUTE)
    expect(res.route).toBe('/video-studio-v2')          // Video Studio V2, not the legacy /studio editor
    expect(res.draftId).toBe(77)
    expect(createDraft).toHaveBeenCalledTimes(1)
    const body = createDraft.mock.calls[0][0]
    expect(body.name).toMatch(/^Blueprint — .+ \(2026-09-25\)$/)
    const proj = JSON.parse(JSON.stringify(body.project_json))
    expect(isBlueprintPlan(proj.blueprintPlan)).toBe(true)
    expect(proj.blueprintPlan.scenes).toHaveLength(7)
    expect(proj.blueprintPlan.blueprintId).toBe('bp-008f30518f8d64f6')
    expect(proj.textOverlays.length).toBeGreaterThanOrEqual(8)   // 7 text placeholders + CTA placeholder
    expect(storage.getItem(STUDIO_STAGE_KEY)).toBe('create')
    expect(consumeOpenDraftHint()).toBe(77)
  })

  it('never creates from a stale / unknown / missing blueprint and makes no API call', async () => {
    const createDraft = vi.fn()
    const stale = real(); stale.status = 'stale'; stale.input_pin.current_anatomy_fingerprint = 'x'
    for (const r of [stale, { ...real(), status: 'unknown' as const }, { ...real(), blueprint: null }, null]) {
      const res = await createStudioDraftFromBlueprint(r, { createDraft, storage: memStorage(), confirmReplace: () => true })
      expect(res).toMatchObject({ ok: false, reason: 'blocked' })
    }
    expect(createDraft).not.toHaveBeenCalled()
    expect(consumeOpenDraftHint()).toBeNull()
  })

  it('protects an existing project: asks first, leaves it untouched on cancel, backs it up on confirm', async () => {
    const project = JSON.stringify({ videoClips: [{ id: 'a' }], textOverlays: [{ id: 't' }], mediaOverlays: [], audioTracks: [] })
    expect(existingProjectItems(memStorage({ [STUDIO_PROJECT_KEY]: project }))).toBe(2)

    const cancelStorage = memStorage({ [STUDIO_PROJECT_KEY]: project })
    const createDraft = vi.fn().mockResolvedValue({ data: { id: 5 } })
    const cancelled = await createStudioDraftFromBlueprint(real(), { createDraft, storage: cancelStorage, confirmReplace: () => false })
    expect(cancelled).toMatchObject({ ok: false, reason: 'cancelled' })
    expect(createDraft).not.toHaveBeenCalled()
    expect(cancelStorage.getItem(STUDIO_PROJECT_KEY)).toBe(project)

    const okStorage = memStorage({ [STUDIO_PROJECT_KEY]: project })
    const confirm = vi.fn().mockReturnValue(true)
    const ok = await createStudioDraftFromBlueprint(real(), { createDraft, storage: okStorage, confirmReplace: confirm })
    expect(ok.ok).toBe(true)
    expect(confirm).toHaveBeenCalledWith(2)
    expect(okStorage.getItem(STUDIO_PROJECT_BACKUP_KEY)).toBe(project)
    expect(okStorage.getItem(STUDIO_PROJECT_KEY)).toBeNull()
  })

  it('does not ask when the editor holds nothing', async () => {
    const confirm = vi.fn()
    const res = await createStudioDraftFromBlueprint(real(), { createDraft: vi.fn().mockResolvedValue({ data: { id: 1 } }), storage: memStorage(), confirmReplace: confirm })
    expect(res.ok).toBe(true)
    expect(confirm).not.toHaveBeenCalled()
  })

  it('a failed save changes nothing (no hint, project untouched)', async () => {
    const project = JSON.stringify({ textOverlays: [{ id: 't' }] })
    const storage = memStorage({ [STUDIO_PROJECT_KEY]: project })
    const res = await createStudioDraftFromBlueprint(real(), { createDraft: vi.fn().mockRejectedValue(new Error('500')), storage, confirmReplace: () => true })
    expect(res).toMatchObject({ ok: false, reason: 'failed' })
    expect(storage.getItem(STUDIO_PROJECT_KEY)).toBe(project)
    expect(consumeOpenDraftHint()).toBeNull()
  })
})
