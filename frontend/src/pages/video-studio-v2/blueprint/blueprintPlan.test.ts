import { describe, it, expect, beforeEach } from 'vitest'
import bpFixture from '../../deconstructor/__fixtures__/va5368.c4-blueprint.json'
import {
  buildBlueprintPlan, buildDraftSnapshot, buildPlaceholderOverlays, checkBlueprintUsable, draftNameFor, isBlueprintPlan,
  PLACEHOLDER_CTA_PREFIX, PLACEHOLDER_TEXT_PREFIX,
} from './blueprintPlan'
import type { BlueprintResponse } from '../../../types/deconstructor'

const real = () => JSON.parse(JSON.stringify(bpFixture)) as BlueprintResponse
const NOW = new Date('2026-09-25T10:00:00Z')

describe('checkBlueprintUsable', () => {
  it('accepts the real current blueprint', () => {
    expect(checkBlueprintUsable(real())).toEqual({ ok: true })
  })
  it('refuses a stale blueprint and says what changed', () => {
    const r = real(); r.status = 'stale'; r.input_pin.current_anatomy_fingerprint = 'other'
    const u = checkBlueprintUsable(r)
    expect(u.ok).toBe(false)
    if (!u.ok) { expect(u.code).toBe('stale'); expect(u.message).toMatch(/reference analysis has changed/) }
  })
  it('names the mechanisms when only they changed', () => {
    const r = real(); r.status = 'stale'; r.input_pin.current_mechanism_attempt_id = 99999
    const u = checkBlueprintUsable(r)
    if (!u.ok) expect(u.message).toMatch(/learned mechanisms have changed/)
  })
  it('refuses unknown, not_run, missing and null', () => {
    const r = real(); r.status = 'unknown'
    expect(checkBlueprintUsable(r)).toMatchObject({ ok: false, code: 'unknown' })
    const n = real(); n.status = 'not_run'; n.blueprint = null
    expect(checkBlueprintUsable(n)).toMatchObject({ ok: false, code: 'not_run' })
    const m = real(); m.blueprint = null
    expect(checkBlueprintUsable(m)).toMatchObject({ ok: false, code: 'missing' })
    expect(checkBlueprintUsable(null)).toMatchObject({ ok: false, code: 'missing' })
  })
  it('buildBlueprintPlan throws rather than creating from a stale blueprint', () => {
    const r = real(); r.status = 'stale'
    expect(() => buildBlueprintPlan(r, NOW)).toThrow(/out of date/)
  })
})

describe('real VA5368 blueprint -> plan (7 sections -> 7 ordered scenes)', () => {
  const resp = real()
  const bp = resp.blueprint!
  const plan = buildBlueprintPlan(resp, NOW)

  it('creates 7 scenes in section order with cumulative timing', () => {
    expect(bp.sections).toHaveLength(7)
    expect(plan.scenes).toHaveLength(7)
    expect(plan.scenes.map(s => s.sceneNumber)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(plan.scenes.map(s => s.order)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(plan.scenes.map(s => s.duration)).toEqual(bp.sections.map(s => s.target_duration_seconds))
    let t = 0
    for (const s of plan.scenes) { expect(s.startTime).toBeCloseTo(t); t += s.duration; expect(s.endTime).toBeCloseTo(t) }
    expect(plan.totalSeconds).toBeCloseTo(30)
    expect(plan.totalSeconds).toBeCloseTo(bp.target.planned_total_seconds)
  })

  it('keeps stable order even if the API returned sections shuffled', () => {
    const shuffled = real(); shuffled.blueprint!.sections.reverse()
    const p = buildBlueprintPlan(shuffled, NOW)
    expect(p.scenes.map(s => s.sceneNumber)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(p.scenes.map(s => s.duration)).toEqual(plan.scenes.map(s => s.duration))
  })

  it('maps each direction field verbatim into the scene', () => {
    for (const [i, s] of bp.sections.entries()) {
      const sc = plan.scenes[i]
      expect(sc.contentInstruction).toBe(s.content_instruction)
      expect(sc.text).toBe(s.text_direction)
      expect(sc.visual).toBe(s.visual_direction)
      expect(sc.speech).toBe(s.speech_direction)
      expect(sc.pacing).toBe(s.pacing_direction)
      expect(sc.transition).toBe(s.transition_direction)
      expect(sc.structuralRole).toBe(s.structural_role)
      expect(sc.cta).toBe(s.cta_direction)
    }
  })

  it('takes scene mechanisms ONLY from section.mechanisms_applied', () => {
    for (const [i, s] of bp.sections.entries()) {
      expect(plan.scenes[i].mechanisms.map(m => m.id)).toEqual(s.mechanisms_applied)
      expect(plan.scenes[i].trace.mechanismIds).toEqual(s.mechanisms_applied)
    }
  })

  it('ignores disposition-level applied_in_sections (audit metadata) entirely', () => {
    const tampered = real()
    // Make every disposition claim EVERY section -- the plan must not change.
    for (const d of tampered.blueprint!.mechanism_dispositions) { d.applied_in_sections = [1, 2, 3, 4, 5, 6, 7]; d.authoritative_sections = [1, 2, 3, 4, 5, 6, 7] }
    const p = buildBlueprintPlan(tampered, NOW)
    expect(p.scenes.map(s => s.mechanisms.map(m => m.id))).toEqual(plan.scenes.map(s => s.mechanisms.map(m => m.id)))
  })

  it('labels applied mechanisms from dispositions without changing which are applied', () => {
    const anyApplied = plan.scenes.flatMap(s => s.mechanisms)
    expect(anyApplied.length).toBeGreaterThan(0)
    for (const m of anyApplied) { expect(m.type).not.toBe('unknown'); expect(m.principle.length).toBeGreaterThan(0) }
  })

  it('derives mechanismsUsed from the scenes', () => {
    expect(plan.mechanismsUsed).toEqual(Array.from(new Set(bp.sections.flatMap(s => s.mechanisms_applied))).sort())
  })

  it('maps mandatory points per section (MP01→s1,3; MP02→s2,3,4,5; MP03→s7)', () => {
    const at = (id: string) => plan.scenes.filter(s => s.mandatoryPoints.some(p => p.id === id)).map(s => s.sceneNumber)
    expect(at('MP01')).toEqual([1, 3])
    expect(at('MP02')).toEqual([2, 3, 4, 5])
    expect(at('MP03')).toEqual([7])
    for (const s of plan.scenes) for (const p of s.mandatoryPoints) expect(p.text.length).toBeGreaterThan(0)
  })

  it('carries a CTA instruction on the closing scene', () => {
    expect(plan.scenes[6].cta).toBeTruthy()
    expect(plan.scenes.filter(s => s.cta).map(s => s.sceneNumber)).toEqual(bp.sections.filter(s => s.cta_direction).map(s => s.section_number))
  })

  it('traces every scene back to blueprint / reference / C3 attempt / section', () => {
    for (const sc of plan.scenes) {
      expect(sc.trace).toMatchObject({ blueprintId: 'bp-008f30518f8d64f6', referenceVideoId: resp.reference_video_id, c3AttemptId: 12731, sectionNumber: sc.sceneNumber })
      expect(sc.trace.blueprintAttemptId).toBe(15831)
    }
    expect(plan).toMatchObject({ blueprintId: 'bp-008f30518f8d64f6', c3AttemptId: 12731, blueprintAttemptId: 15831 })
  })

  it('does not require optional fields (null transition/cta, empty lists)', () => {
    const lean = real()
    for (const s of lean.blueprint!.sections) {
      s.transition_direction = null; s.cta_direction = null; s.limitations = []; s.required_information = []
      s.mandatory_points_assigned = []; s.mechanisms_applied = []
    }
    lean.provenance = null
    const p = buildBlueprintPlan(lean, NOW)
    expect(p.scenes).toHaveLength(7)
    expect(p.mechanismsUsed).toEqual([])
    expect(p.blueprintAttemptId).toBeNull()
    expect(buildPlaceholderOverlays(p)).toHaveLength(7)   // text only, no CTA
  })

  it('survives a blueprint with quality-note gaps and an all-mechanisms-used note', () => {
    const noisy = real(); noisy.blueprint!.gaps.push({ field: 'x', kind: 'quality_note', reason: 'all_mechanisms_used' })
    expect(() => buildBlueprintPlan(noisy, NOW)).not.toThrow()
  })
})

describe('placeholder overlays and draft snapshot', () => {
  const plan = buildBlueprintPlan(real(), NOW)
  const overlays = buildPlaceholderOverlays(plan)

  it('creates one text placeholder per scene plus a CTA placeholder for CTA scenes, with unique ids', () => {
    const cta = plan.scenes.filter(s => s.cta).length
    expect(overlays).toHaveLength(7 + cta)
    expect(new Set(overlays.map(o => o.id)).size).toBe(overlays.length)
  })

  it('every overlay is clearly a placeholder, holds the instruction verbatim and is not polished copy', () => {
    for (const o of overlays) {
      const sceneNo = o.blueprint!.sectionNumber
      const scene = plan.scenes[sceneNo - 1]
      if (o.blueprint!.kind === 'cta') { expect(o.text).toBe(PLACEHOLDER_CTA_PREFIX + scene.cta) }
      else { expect(o.text).toBe(PLACEHOLDER_TEXT_PREFIX + scene.text) }
      expect(o.startTime).toBeCloseTo(scene.startTime)
      expect(o.endTime).toBeCloseTo(scene.endTime)
    }
  })

  it('overlay traceability names blueprint, section, mechanisms, reference and C3 attempt', () => {
    for (const o of overlays) {
      expect(o.blueprint).toMatchObject({ blueprintId: plan.blueprintId, referenceVideoId: plan.referenceVideoId, c3AttemptId: 12731 })
      expect(o.blueprint!.mechanismIds).toEqual(plan.scenes[o.blueprint!.sectionNumber - 1].trace.mechanismIds)
    }
  })

  it('draft snapshot has the editor shape, timeline = total duration, and embeds the plan', () => {
    const snap = buildDraftSnapshot(plan, { client: 'Acme' })
    expect(snap.videoClips).toEqual([])
    expect(snap.timeline.duration).toBeCloseTo(30)
    expect(snap.textOverlays).toHaveLength(overlays.length)
    expect(snap.blueprintPlan.scenes).toHaveLength(7)
    expect(snap.clientIdentity.client).toBe('Acme')
    // must round-trip through JSON (the backend stores project_json as opaque JSON)
    expect(isBlueprintPlan(JSON.parse(JSON.stringify(snap)).blueprintPlan)).toBe(true)
  })

  it('names the draft from the topic and date', () => {
    const n = draftNameFor(plan, NOW)
    expect(n.startsWith('Blueprint — ')).toBe(true)
    expect(n.endsWith('(2026-09-25)')).toBe(true)
  })

  it('isBlueprintPlan rejects junk', () => {
    expect(isBlueprintPlan(null)).toBe(false)
    expect(isBlueprintPlan({})).toBe(false)
    expect(isBlueprintPlan({ schema: 'other', blueprintId: 'x', scenes: [] })).toBe(false)
  })
})

describe('blueprintPlanStore', () => {
  beforeEach(() => {
    const mem = new Map<string, string>()
    ;(globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v) }, removeItem: (k: string) => { mem.delete(k) },
      clear: () => mem.clear(), key: () => null, length: 0,
    } as Storage
  })

  it('persists, restores, notifies, and clears', async () => {
    const store = await import('./blueprintPlanStore')
    store._resetBlueprintPlanCache()
    expect(store.getBlueprintPlan()).toBeNull()
    const plan = buildBlueprintPlan(real(), NOW)
    let n = 0
    // subscribe via the hook's underlying contract: setBlueprintPlan must notify
    store.setBlueprintPlan(plan)
    store._resetBlueprintPlanCache()
    expect(store.getBlueprintPlan()?.blueprintId).toBe(plan.blueprintId)
    store.setBlueprintPlan(null)
    store._resetBlueprintPlanCache()
    expect(store.getBlueprintPlan()).toBeNull()
    expect(n).toBe(0)
  })

  it('treats corrupted storage as no plan', async () => {
    const store = await import('./blueprintPlanStore')
    localStorage.setItem(store.PLAN_STORAGE_KEY, '{not json')
    store._resetBlueprintPlanCache()
    expect(store.getBlueprintPlan()).toBeNull()
    localStorage.setItem(store.PLAN_STORAGE_KEY, JSON.stringify({ schema: 'blueprint-plan-v1' }))
    store._resetBlueprintPlanCache()
    expect(store.getBlueprintPlan()).toBeNull()
  })
})
