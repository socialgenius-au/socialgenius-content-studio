// Hand-off of the REAL reference-5131 blueprint (recovered from the AI ledger, saved 2026-11-09) into Video Studio: the same code path "Use blueprint" runs, with only the network call replaced.
// Verifies scenes, durations, mechanism mapping, editable text placeholders and that nothing from the reference's subject is carried into the editor's scene instructions.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import bpFx from '../../deconstructor/__fixtures__/ref5131.c4-blueprint.json'
import type { BlueprintResponse } from '../../../types/deconstructor'
import { buildBlueprintPlan, buildDraftSnapshot, checkBlueprintUsable, PLACEHOLDER_CTA_PREFIX, PLACEHOLDER_TEXT_PREFIX } from './blueprintPlan'
import { createStudioDraftFromBlueprint, STUDIO_ROUTE, STUDIO_STAGE_KEY } from './createStudioDraft'

const real = () => JSON.parse(JSON.stringify(bpFx)) as BlueprintResponse
function memStorage() {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) }, removeItem: (k: string) => { m.delete(k) }, _m: m }
}
beforeEach(() => {
  ;(globalThis as unknown as { localStorage: unknown }).localStorage = memStorage()
  ;(globalThis as unknown as { sessionStorage: unknown }).sessionStorage = memStorage()
})

describe('reference 5131 blueprint -> Video Studio', () => {
  it('is current and usable, with four scenes totalling 12 seconds', () => {
    expect(checkBlueprintUsable(real()).ok).toBe(true)
    const plan = buildBlueprintPlan(real(), new Date('2026-11-09T00:00:00Z'))
    expect(plan.scenes.map(s => [s.sceneNumber, s.structuralRole, s.duration])).toEqual([[1, 'opening', 2], [2, 'demonstration', 3], [3, 'demonstration', 3], [4, 'call_to_action', 4]])
    expect(plan.totalSeconds).toBe(12)
    expect(plan.scenes.map((s, i) => [s.startTime, s.endTime, s.order === i])).toEqual([[0, 2, true], [2, 5, true], [5, 8, true], [8, 12, true]])
  })

  it('applies M01 to scene 1, M02 to scenes 2-3 and M03 to scene 4, each with its transferable principle', () => {
    const plan = buildBlueprintPlan(real())
    expect(plan.scenes.map(s => s.mechanisms.map(m => m.id))).toEqual([['M01'], ['M02'], ['M02'], ['M03']])
    expect(plan.mechanismsUsed).toEqual(['M01', 'M02', 'M03'])
    for (const s of plan.scenes) for (const m of s.mechanisms) expect(m.principle.length).toBeGreaterThan(20)
    expect(plan.scenes.every(s => s.trace.referenceVideoId === 5131 && s.trace.mechanismIds.length === 1)).toBe(true)
  })

  it('gives every scene editable text and the closing scene a CTA placeholder, and keeps the mandatory point on scene 3', () => {
    const plan = buildBlueprintPlan(real())
    const snap = buildDraftSnapshot(plan)
    expect(snap.textOverlays.length).toBeGreaterThanOrEqual(4)
    expect(snap.textOverlays.filter(o => o.text.startsWith(PLACEHOLDER_TEXT_PREFIX)).length).toBe(4)
    expect(snap.textOverlays.filter(o => o.text.startsWith(PLACEHOLDER_CTA_PREFIX)).length).toBe(1)
    expect(plan.scenes[2].mandatoryPoints.length).toBe(1)
    expect(plan.scenes[3].cta).toBeTruthy()
    expect(snap.timeline.duration).toBe(12)
  })

  it('carries none of the reference\'s subject, brand or OCR-artefact words into any scene instruction the editor receives', () => {
    const plan = buildBlueprintPlan(real())
    const text = plan.scenes.map(s => [s.purpose, s.contentInstruction, s.visual, s.text, s.speech, s.pacing, s.transition, s.cta, ...s.requiredInformation].join(' ')).join(' ').toLowerCase()
    for (const w of ['ginger', 'garlic', 'paste', 'barakah', 'waites', 'realing', 'sloving', 'steam', 'jar', 'saree', 'kitchen']) expect(text, w).not.toMatch(new RegExp(`\\b${w}\\b`))
  })

  it('"Use blueprint" creates one draft, stores the plan for the editor and routes to Video Studio V2', async () => {
    const storage = memStorage()
    const createDraft = vi.fn().mockResolvedValue({ data: { id: 5131 } })
    const res = await createStudioDraftFromBlueprint(real(), { createDraft, storage, confirmReplace: () => true, now: () => new Date('2026-11-09T00:00:00Z') })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.route).toBe(STUDIO_ROUTE)
    expect(res.draftId).toBe(5131)
    expect(createDraft).toHaveBeenCalledTimes(1)
    const body = createDraft.mock.calls[0][0]
    expect(body.name).toContain('SocialGenius')
    expect(body.project_json.blueprintPlan.scenes).toHaveLength(4)
    expect(body.project_json.textOverlays.length).toBeGreaterThanOrEqual(4)
    expect(storage._m.get(STUDIO_STAGE_KEY)).toBe('create')
  })
})
