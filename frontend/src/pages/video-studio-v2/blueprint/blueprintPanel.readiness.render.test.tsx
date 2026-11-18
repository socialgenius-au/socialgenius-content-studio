// The Blueprint panel with live readiness: a real 7-scene plan (VA5368), rendered to static markup.
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import bpFx from '../../deconstructor/__fixtures__/va5368.c4-blueprint.json'
import type { BlueprintResponse } from '../../../types/deconstructor'
import type { VideoClip } from '../../../types'
import { buildBlueprintPlan, buildPlaceholderOverlays } from './blueprintPlan'
import { BlueprintPlanView } from './BlueprintPlanPanel'
import { computeReadiness } from './readiness'

const plan = buildBlueprintPlan(JSON.parse(JSON.stringify(bpFx)) as BlueprintResponse, new Date('2026-01-01T00:00:00Z'))
const clip = (s: number, e: number) => ({ startTime: s, endTime: e }) as Pick<VideoClip, 'startTime' | 'endTime'>
const html = (clips: ReturnType<typeof clip>[], texts = buildPlaceholderOverlays(plan)) =>
  renderToStaticMarkup(<BlueprintPlanView plan={plan} readiness={computeReadiness(plan.scenes, clips, texts, [])} onAssignFootage={() => {}} />)

describe('Blueprint panel readiness', () => {
  it('a fresh blueprint draft: no footage anywhere, placeholders everywhere, not ready, says why and offers to assign footage', () => {
    const h = html([])
    expect(plan.scenes).toHaveLength(7)
    expect(h).toContain(`Footage: 0 of 7 scenes`)
    expect(h).toContain('Not ready to export yet')
    expect(h).toContain('blueprint-assign-footage')
    expect((h.match(/No footage/g) ?? []).length).toBe(7)
    expect(h).toContain('Text: placeholder')
    expect(h).toContain('blueprint-blocker')
  })
  it('all scenes covered and every placeholder replaced: ready, no blocker, no assign link', () => {
    const replaced = buildPlaceholderOverlays(plan).map(o => ({ ...o, text: 'Real words' }))
    const h = html([clip(0, plan.totalSeconds)], replaced)
    expect(h).toContain('Ready to export')
    expect(h).not.toContain('Not ready')
    expect(h).not.toContain('blueprint-blocker')
    expect(h).not.toContain('blueprint-assign-footage')
  })
  it('without readiness (older callers) it renders exactly as before: no checklist', () => {
    const h = renderToStaticMarkup(<BlueprintPlanView plan={plan} />)
    expect(h).not.toContain('blueprint-readiness')
    expect(h).toContain('blueprint-scene-1')
  })
})
