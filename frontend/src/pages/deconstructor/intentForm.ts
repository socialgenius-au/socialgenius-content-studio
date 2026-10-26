// C5 -- the "New content" form model. Mirrors the C4 backend contract (NewContentIntentIn) so the user gets inline feedback before any
// AI call: required Product/Service/Topic, Target Audience, Objective; everything else optional and NEVER invented when left blank.
import type { NewContentIntent } from '../../types/deconstructor'

export const MAX_REQUIRED_CHARS = 300
export const MAX_OPTIONAL_CHARS = 300
export const MAX_LIST_ITEMS = 20
export const MAX_LIST_ITEM_CHARS = 250
export const MIN_TARGET_SECONDS = 3
export const MAX_TARGET_SECONDS = 600
export const MAX_PLATFORM_CHARS = 80

export interface IntentForm {
  product: string
  audience: string
  objective: string
  business: string
  cta: string
  tone: string            // one item per line
  platform: string
  durationSeconds: string
  durationNotes: string
  mandatory: string       // one item per line
  prohibited: string      // one item per line
}

export const emptyIntentForm = (): IntentForm => ({
  product: '', audience: '', objective: '', business: '', cta: '', tone: '', platform: '', durationSeconds: '', durationNotes: '', mandatory: '', prohibited: '',
})

export type IntentErrors = Partial<Record<keyof IntentForm, string>>

const clean = (s: string) => s.replace(/\s+/g, ' ').trim()

/** One item per non-empty line; whitespace normalised; case-insensitive duplicates dropped (order kept). */
export function splitLines(s: string): string[] {
  const seen = new Set<string>(), out: string[] = []
  for (const line of s.split(/\r?\n/)) {
    const c = clean(line)
    if (!c || seen.has(c.toLowerCase())) continue
    seen.add(c.toLowerCase()); out.push(c)
  }
  return out
}

export function validateIntentForm(f: IntentForm): { ok: boolean; errors: IntentErrors; intent: NewContentIntent | null } {
  const errors: IntentErrors = {}
  const req = (k: 'product' | 'audience' | 'objective', label: string) => {
    const c = clean(f[k])
    if (!c) errors[k] = `${label} is required`
    else if (c.length < 3) errors[k] = `${label} needs at least 3 characters`
    else if (c.length > MAX_REQUIRED_CHARS) errors[k] = `${label} must be at most ${MAX_REQUIRED_CHARS} characters`
  }
  req('product', 'Product, service or topic'); req('audience', 'Target audience'); req('objective', 'Objective')
  for (const [k, label] of [['business', 'Business or brand'], ['cta', 'Desired call to action']] as const) {
    if (clean(f[k]).length > MAX_OPTIONAL_CHARS) errors[k] = `${label} must be at most ${MAX_OPTIONAL_CHARS} characters`
  }
  const lists: [keyof IntentForm, string][] = [['tone', 'Tone / style'], ['mandatory', 'Mandatory points'], ['prohibited', 'Prohibited claims or elements']]
  const parsed: Record<string, string[]> = {}
  for (const [k, label] of lists) {
    const items = splitLines(f[k]); parsed[k] = items
    if (items.length > MAX_LIST_ITEMS) errors[k] = `${label}: at most ${MAX_LIST_ITEMS} items`
    else if (items.some(i => i.length > MAX_LIST_ITEM_CHARS)) errors[k] = `${label}: each item must be at most ${MAX_LIST_ITEM_CHARS} characters`
  }
  const proh = new Set(parsed.prohibited.map(p => p.toLowerCase()))
  const clash = parsed.mandatory.filter(m => proh.has(m.toLowerCase()))
  if (clash.length && !errors.mandatory) errors.mandatory = `A mandatory point cannot also be prohibited: ${clash.join('; ')}`
  if (clean(f.platform).length > MAX_PLATFORM_CHARS) errors.platform = `Platform must be at most ${MAX_PLATFORM_CHARS} characters`
  if (clean(f.durationNotes).length > MAX_OPTIONAL_CHARS) errors.durationNotes = `Duration notes must be at most ${MAX_OPTIONAL_CHARS} characters`

  let seconds: number | null = null
  if (clean(f.durationSeconds)) {
    const n = Number(clean(f.durationSeconds))
    if (!Number.isFinite(n)) errors.durationSeconds = 'Enter a number of seconds'
    else if (n < MIN_TARGET_SECONDS || n > MAX_TARGET_SECONDS) errors.durationSeconds = `Target duration must be between ${MIN_TARGET_SECONDS} and ${MAX_TARGET_SECONDS} seconds`
    else seconds = n
  }
  if (Object.keys(errors).length) return { ok: false, errors, intent: null }

  const platform = clean(f.platform) || null, notes = clean(f.durationNotes) || null
  const intent: NewContentIntent = {
    product_service_or_topic: clean(f.product), target_audience: clean(f.audience), objective: clean(f.objective),
    business_or_brand: clean(f.business) || null, desired_cta: clean(f.cta) || null,
    tone_style_constraints: parsed.tone,
    duration_platform_constraints: platform || seconds != null || notes ? { platform, target_duration_seconds: seconds, notes } : null,
    mandatory_points: parsed.mandatory, prohibited_claims_or_elements: parsed.prohibited,
  }
  return { ok: true, errors, intent }
}
