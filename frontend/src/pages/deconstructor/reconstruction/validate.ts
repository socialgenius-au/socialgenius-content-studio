// M5 -- consumer-side check of the M4 contract (visual-element-v1). M5 develops against fixtures; this is the gate that says a fixture, or a real M4 output, really has the shape M5 relies on. Returns the
// problems found (empty = compatible). It checks structure and the contract's own rules (e.g. no rule-based graphical class, confidence within its cap), not business logic.
import { USER_ONLY_CLASSES, VISUAL_ELEMENT_SCHEMA, type VisualClass } from '../visual/contract'

const CLASSES: VisualClass[] = ['TEXT_CAPTION', 'TEXT_SUBTITLE', 'TEXT_HANDLE', 'TEXT_OTHER', 'LOGO_MARK', 'ICON_GRAPHIC', 'IMAGE_REGION', 'SHAPE_GRAPHIC', 'BACKGROUND_ELEMENT', 'UNKNOWN']
const CERTAINTY = ['OBSERVED', 'MEASURED', 'INFERRED', 'RESEARCH_SUPPORTED', 'RECOMMENDED']
const READINESS = ['native_text', 'native_shape', 'image_layer', 'needs_user_asset', 'needs_background_restoration', 'not_reliable']
const num = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

export function validateVisualElement(x: unknown): string[] {
  const p: string[] = []
  const e = x as Record<string, any> | null
  if (!e || typeof e !== 'object') return ['not an object']
  if (e.schema !== VISUAL_ELEMENT_SCHEMA) p.push(`schema must be ${VISUAL_ELEMENT_SCHEMA}`)
  if (typeof e.id !== 'string' || e.id === '') p.push('id must be a non-empty string')
  if (!num(e.first) || !num(e.last) || e.last < e.first) p.push('first/last must be numbers with last >= first')
  const b = e.box
  if (!b || !num(b.x) || !num(b.y) || !num(b.w) || !num(b.h) || b.w <= 0 || b.h <= 0) p.push('box must be a positive normalised rectangle')
  const c = e.classification
  if (!c) p.push('classification missing')
  else {
    if (!CLASSES.includes(c.class)) p.push(`unknown class ${String(c.class)}`)
    if (!CERTAINTY.includes(c.certainty)) p.push('certainty must use the analysis vocabulary')
    if (c.basis !== 'rule' && c.basis !== 'user') p.push('basis must be rule or user')
    if (c.basis === 'rule' && USER_ONLY_CLASSES.includes(c.class)) p.push(`a rule may not assign ${c.class}`)
    if (!num(c.confidence?.score) || c.confidence.score < 0 || c.confidence.score > 1) p.push('confidence.score must be within 0..1')
    if (c.basis === 'rule' && num(c.confidence?.score) && c.confidence.score > 0.8) p.push('a rule-based confidence is capped at 0.8')
    if (!Array.isArray(c.explanation) || c.explanation.length === 0) p.push('explanation must not be empty')
    if (!Array.isArray(c.evidence)) p.push('evidence must be a list')
  }
  const t = e.track
  if (!t || typeof t.id !== 'string' || !Array.isArray(t.observations) || t.observations.length === 0 || !Array.isArray(t.intervals) || t.intervals.length === 0) p.push('track needs an id, observations and intervals')
  const r = e.readiness
  if (!r || !READINESS.includes(r.state) || !Array.isArray(r.reasons)) p.push('readiness.state must be one of the contract states')
  const k = e.claims
  if (!k || k.originalAssetRecovered !== false || k.backgroundSeparated !== false || k.exactStyleRecovered !== false) p.push('claims must all be false')
  return p
}

// ---- the saved ACCOUNT (not the M4 elements) -----------------------------------------------------------------------------------------------------------------------------------------------------------
// A draft can carry an `elementReconstruction` record for a long time and be edited by other tools; anything that reads it back must treat it as untrusted. This is the gate: a record that fails it is kept
// as stored (nothing is thrown away) but is never reconciled, displayed as a fact or used as an instruction.
const STATUSES = ['faithful', 'approximate', 'user_supplied', 'placeholder', 'missing_asset', 'not_included', 'unsupported']
const LAYER_KINDS = ['text', 'image', 'shape']
const strings = (x: unknown): x is string[] => Array.isArray(x) && x.every(v => typeof v === 'string')

export function validateElementAccount(x: unknown): string[] {
  const p: string[] = []
  const r = x as Record<string, any> | null
  if (!r || typeof r !== 'object' || Array.isArray(r)) return ['not an object']
  if (r.schema !== 'element-reconstruction-v1') p.push('schema must be element-reconstruction-v1')
  if (!Array.isArray(r.items)) return [...p, 'items must be a list']
  if (!r.counts || typeof r.counts !== 'object') p.push('counts missing')
  else for (const k of ['elements', ...STATUSES]) if (!Number.isFinite(r.counts[k]) || r.counts[k] < 0) p.push(`counts.${k} must be a non-negative number`)
  r.items.forEach((it: any, i: number) => {
    const at = `item ${i + 1}`
    if (!it || typeof it !== 'object' || Array.isArray(it)) { p.push(`${at} is not an object`); return }
    if (it.elementId !== null && typeof it.elementId !== 'string') p.push(`${at}: elementId must be text or null`)
    if (!STATUSES.includes(it.status)) p.push(`${at}: unknown status`)
    if (!Array.isArray(it.layers) || !it.layers.every((l: any) => l && typeof l.id === 'string' && LAYER_KINDS.includes(l.kind))) p.push(`${at}: layers must be a list of {id, kind}`)
    if (!strings(it.reasons)) p.push(`${at}: reasons must be a list of text`)
    if (it.candidateIds !== undefined && !strings(it.candidateIds)) p.push(`${at}: candidateIds must be a list of text`)
  })
  return p.slice(0, 5)
}
