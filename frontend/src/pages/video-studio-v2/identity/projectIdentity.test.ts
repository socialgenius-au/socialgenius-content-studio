// Project identity: shown/saved from the project itself; never the old "ABC Tiles" constant for a project that is not ABC Tiles; existing drafts' identities are never rewritten.
import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import bpFx from '../../deconstructor/__fixtures__/ref5131.c4-blueprint.json'
import type { BlueprintResponse } from '../../../types/deconstructor'
import { buildBlueprintPlan } from '../blueprint/blueprintPlan'
import { defaultDraftNameFor, identityForSave, identityFromBlueprint, isLegacyDemoIdentity, LEGACY_DEMO_IDENTITY, NEUTRAL_IDENTITY, parseIntentSummary, resolveProjectIdentity } from './projectIdentity'
import { getProjectContext, setProjectContext } from './projectContextStore'

const plan = () => buildBlueprintPlan(JSON.parse(JSON.stringify(bpFx)) as BlueprintResponse, new Date('2026-11-14T00:00:00Z'))
const REAL = { client: 'Acme Plumbing', campaign: 'Spring Offer' }

describe('resolveProjectIdentity', () => {
  it('uses the business and topic of the blueprint the project was built from', () => {
    const r = resolveProjectIdentity({ plan: plan() })
    expect(r).toEqual({ client: 'SocialGenius', campaign: 'SocialGenius Content Studio', source: 'blueprint' })
  })

  it('draft 9 case: a blueprint draft whose saved identity is the old demo default shows the blueprint\'s identity, not ABC Tiles', () => {
    const r = resolveProjectIdentity({ plan: plan(), stored: LEGACY_DEMO_IDENTITY })
    expect(r.client).toBe('SocialGenius')
    expect(r.source).toBe('blueprint')
  })

  it('an identity the draft carries that is not the old default is kept exactly, even when a blueprint exists', () => {
    expect(resolveProjectIdentity({ plan: plan(), stored: REAL })).toEqual({ ...REAL, source: 'draft' })
  })

  it('a legacy ABC Tiles draft with no blueprint keeps saying so (its recorded identity is not rewritten)', () => {
    expect(resolveProjectIdentity({ stored: LEGACY_DEMO_IDENTITY })).toEqual({ ...LEGACY_DEMO_IDENTITY, source: 'draft' })
  })

  it('no project at all gives the neutral fallback, never a demo client', () => {
    expect(resolveProjectIdentity({})).toEqual(NEUTRAL_IDENTITY)
    expect(resolveProjectIdentity({ stored: { client: '', campaign: '' } })).toEqual(NEUTRAL_IDENTITY)
    expect(resolveProjectIdentity({ stored: null, plan: null })).toEqual(NEUTRAL_IDENTITY)
    expect(NEUTRAL_IDENTITY.client).toBe('No project selected')
    expect(JSON.stringify(NEUTRAL_IDENTITY)).not.toMatch(/ABC|Tiles|Builders/)
  })

  it('is case- and spacing-tolerant about recognising the old default', () => {
    expect(isLegacyDemoIdentity({ client: ' abc  tiles ', campaign: 'BUILDERS footfall campaign' })).toBe(true)
    expect(isLegacyDemoIdentity(REAL)).toBe(false)
  })
})

describe('what is saved', () => {
  it('a blueprint project is saved under its own identity', () => {
    expect(identityForSave({ plan: plan(), stored: LEGACY_DEMO_IDENTITY, draftName: 'x' })).toEqual({ client: 'SocialGenius', campaign: 'SocialGenius Content Studio' })
  })
  it('an existing real identity is saved back unchanged', () => {
    expect(identityForSave({ stored: REAL, draftName: 'x' })).toEqual(REAL)
  })
  it('a project with no identity is saved under its own draft name, never under a demo client', () => {
    expect(identityForSave({ draftName: 'My reel' })).toEqual({ client: 'Untitled project', campaign: 'My reel' })
    expect(identityForSave({})).toEqual({ client: 'Untitled project', campaign: 'Untitled video' })
  })
  it('default draft names follow the project, not the demo', () => {
    const now = new Date('2026-11-14T10:00:00')
    expect(defaultDraftNameFor(resolveProjectIdentity({ plan: plan() }), now)).toMatch(/^SocialGenius — SocialGenius Content Studio \(/)
    expect(defaultDraftNameFor(NEUTRAL_IDENTITY, now)).toMatch(/^Untitled video \(/)
  })
})

describe('parsing the blueprint summary', () => {
  it('reads topic and business', () => {
    expect(parseIntentSummary('Topic: Spring sale on boots, for all. Audience: x. Objective: y. Business: Acme Boots. Format: Reels, 12s.')).toEqual({ topic: 'Spring sale on boots, for all', business: 'Acme Boots' })
  })
  it('degrades to a neutral blueprint identity when the summary is missing or odd', () => {
    expect(identityFromBlueprint({ intentSummary: '' } as never)).toEqual({ client: 'Blueprint project', campaign: 'Blueprint video' })
    expect(identityFromBlueprint(null)).toBeNull()
  })
})

describe('project context store', () => {
  beforeEach(() => setProjectContext(null))
  it('starts empty and resets', () => {
    expect(getProjectContext()).toEqual({ draftId: null, draftName: '', storedIdentity: null })
    setProjectContext({ draftId: 9, draftName: 'D', storedIdentity: REAL })
    expect(getProjectContext().draftId).toBe(9)
    setProjectContext(null)
    expect(getProjectContext().draftId).toBeNull()
  })
})

describe('the editor no longer hard-codes the identity', () => {
  const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8')
  it('the sidebar card, the saved identity, the default draft name and the AI prompt context come from the project', () => {
    const shell = read('../VideoStudioV2.tsx'), edit = read('../components/CreateEditTab.tsx')
    expect(shell).not.toContain('<strong>ABC Tiles</strong>')
    expect(shell).toContain('<ProjectIdentityCard />')
    expect(edit).not.toContain('PROJECT_CLIENT_IDENTITY')
    expect(edit).not.toContain('ABC Tiles — Builders Footfall Campaign (')
    expect(edit).toContain('identityForSave(')
    expect(edit).toContain('defaultDraftNameFor(')
    expect(edit).toContain('setProjectContext(')
  })
})
