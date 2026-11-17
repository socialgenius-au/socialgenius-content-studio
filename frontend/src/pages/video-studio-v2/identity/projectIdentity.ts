// The identity of the project open in Video Studio (the "client" and "campaign" labels shown in the sidebar, saved with a draft, and sent as context to the AI prompt generator).
// It used to be the constant "ABC Tiles / Builders Footfall Campaign" for EVERY project. It is now read from what the project actually is, in this order:
//   1. an identity the draft already carries that is not that old demo default (kept exactly; never overwritten),
//   2. else the blueprint the project was built from (its business and topic),
//   3. else an identity the draft carries, even if it is the old demo default (a legacy ABC Tiles draft keeps saying so),
//   4. else a neutral "no project selected" fallback.
// Nothing here writes to a draft or to any client record; it only decides what to show or to save on the NEXT explicit save.
import type { BlueprintPlan } from '../blueprint/blueprintPlan'

export interface StoredIdentity { client: string; campaign: string }
export interface ProjectIdentity extends StoredIdentity { source: 'draft' | 'blueprint' | 'neutral' }

export const LEGACY_DEMO_IDENTITY: StoredIdentity = { client: 'ABC Tiles', campaign: 'Builders Footfall Campaign' }
export const NEUTRAL_IDENTITY: ProjectIdentity = { client: 'No project selected', campaign: 'Open or save a draft to name this project', source: 'neutral' }

const clean = (s: unknown): string => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '')

export function isStoredIdentity(x: unknown): x is StoredIdentity {
  return !!x && typeof x === 'object' && !!clean((x as StoredIdentity).client) && !!clean((x as StoredIdentity).campaign)
}

export function isLegacyDemoIdentity(x: StoredIdentity | null | undefined): boolean {
  return !!x && clean(x.client).toLowerCase() === LEGACY_DEMO_IDENTITY.client.toLowerCase() && clean(x.campaign).toLowerCase() === LEGACY_DEMO_IDENTITY.campaign.toLowerCase()
}

const cut = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`)

/** "Topic: X. Audience: Y. Objective: Z. Business: B. Format: F." -> { topic, business }. Either may be missing. */
export function parseIntentSummary(summary: string | null | undefined): { topic: string; business: string } {
  const s = clean(summary)
  const topic = /Topic:\s*(.*?)(?:\.\s+(?:Audience|Objective|Business|Format):|\.?$)/.exec(s)?.[1] ?? ''
  const business = /Business:\s*(.*?)(?:\.\s+(?:Format|Audience|Objective|Topic):|\.?$)/.exec(s)?.[1] ?? ''
  return { topic: clean(topic), business: clean(business) }
}

export function identityFromBlueprint(plan: BlueprintPlan | null | undefined): StoredIdentity | null {
  if (!plan) return null
  const { topic, business } = parseIntentSummary(plan.intentSummary)
  const short = topic ? cut(topic.split(/,\s|:\s|\s[-–—]\s/)[0], 60) : ''
  if (business && short) return { client: cut(business, 60), campaign: short }
  if (business) return { client: cut(business, 60), campaign: 'Blueprint video' }
  if (short) return { client: 'Blueprint project', campaign: short }
  return { client: 'Blueprint project', campaign: 'Blueprint video' }
}

export function resolveProjectIdentity(input: { plan?: BlueprintPlan | null; stored?: StoredIdentity | null }): ProjectIdentity {
  const stored = isStoredIdentity(input.stored) ? { client: clean(input.stored.client), campaign: clean(input.stored.campaign) } : null
  if (stored && !isLegacyDemoIdentity(stored)) return { ...stored, source: 'draft' }
  const fromPlan = identityFromBlueprint(input.plan)
  if (fromPlan) return { ...fromPlan, source: 'blueprint' }
  if (stored) return { ...stored, source: 'draft' }
  return NEUTRAL_IDENTITY
}

/** The {client, campaign} pair written into a draft when it is SAVED. A project with no identity at all is saved under its own draft name, never under a demo client. */
export function identityForSave(input: { plan?: BlueprintPlan | null; stored?: StoredIdentity | null; draftName?: string }): StoredIdentity {
  const r = resolveProjectIdentity(input)
  if (r.source !== 'neutral') return { client: r.client, campaign: r.campaign }
  return { client: 'Untitled project', campaign: clean(input.draftName) || 'Untitled video' }
}

export function defaultDraftNameFor(identity: ProjectIdentity, now: Date = new Date()): string {
  const stamp = `${now.toLocaleDateString()} ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
  return identity.source === 'neutral' ? `Untitled video (${stamp})` : `${identity.client} — ${identity.campaign} (${stamp})`
}
