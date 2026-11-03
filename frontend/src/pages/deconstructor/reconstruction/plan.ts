// M5 -- ELEMENT RECONSTRUCTION PLAN. For every visual element M4 found (contract: ../visual/contract.ts), say honestly what became of it in the draft: rebuilt as a native layer (and how faithfully), filled by
// a person's own asset, waiting for an asset, left out, or not something that can be rebuilt. Pure: it READS the layers the existing panels generated (their provenance) and never creates, moves or edits one.
//
// Separation of concerns (the architecture rule): detection and classification are M4's; the layers themselves come from the existing text, image and background generators, which a person drives; this module
// is planning/accounting only, so it cannot silently turn an unsupported element into apparently finished output.
//
// Status vocabulary (what a person is told), strongest claim first:
//   faithful        every property of the layer is measured evidence (rare: timing is always inferred, so text and plates are normally "approximate")
//   approximate     a native layer exists, with at least one inferred or default property (position measured, style or timing estimated)
//   user_supplied   the layer holds the person's own content: their uploaded image, or wording they set
//   placeholder     a layer that still holds the blueprint's instruction text, not content
//   missing_asset   the element needs an image only the person can supply and none has been added
//   not_included    it could be rebuilt (native text or shape) but no layer was generated for it: left out by default or by the person
//   unsupported     it cannot be rebuilt from the evidence (a person in the footage, text too unsure to read, an unknown thing)
import type { ReadinessResult, VisualClass, VisualElement } from '../visual/contract'

export const ELEMENT_RECONSTRUCTION_SCHEMA = 'element-reconstruction-v1'
export const ELEMENT_RECONSTRUCTION_VERSION = '1.0.0'

export type ReconstructionStatus = 'faithful' | 'approximate' | 'user_supplied' | 'placeholder' | 'missing_asset' | 'not_included' | 'unsupported'
export const STATUS_LABEL: Record<ReconstructionStatus, string> = {
  faithful: 'Faithfully rebuilt', approximate: 'Approximately rebuilt', user_supplied: 'Your own content', placeholder: 'Placeholder', missing_asset: 'Needs your image', not_included: 'Not included', unsupported: 'Not rebuilt (unsupported)',
}

/** The part of a generated layer this module reads. Structural on purpose: the editor's own layer types (protected) are not imported or changed. */
export interface LayerLike {
  id: string
  text?: string
  reconstruction?: { kind: string; candidateId: string; properties?: Record<string, { basis: string }>; corrected?: string[]; origin?: string; image?: { source?: string } }
}
export interface GeneratedLayers { textOverlays?: readonly LayerLike[]; mediaOverlays?: readonly LayerLike[]; shapes?: readonly LayerLike[]; subtitles?: readonly LayerLike[] }

export type LayerKind = 'text' | 'image' | 'shape'
export interface LinkedLayer { id: string; kind: LayerKind; candidateId: string }

export interface ElementItem {
  /** The M4 element id; null only for a blueprint placeholder that no element accounts for. */
  elementId: string | null
  class: VisualClass | null
  classBasis: 'rule' | 'user' | null
  classConfidence: { level: string; score: number } | null
  readiness: ReadinessResult['state'] | null
  status: ReconstructionStatus
  layers: LinkedLayer[]
  reasons: string[]
  limitations: string[]
  /** The analysis rows this item traces back to: M4's evidence references, verbatim. */
  evidence: { kind: string; id: number | string; certainty: string }[]
  first: number | null
  last: number | null
}

export interface ElementReconstructionRecord {
  schema: typeof ELEMENT_RECONSTRUCTION_SCHEMA
  version: typeof ELEMENT_RECONSTRUCTION_VERSION
  referenceVideoId: number
  videoAnalysisId: number
  createdAt: string
  counts: Record<ReconstructionStatus, number> & { elements: number }
  items: ElementItem[]
  /** Reference assets (the reference video itself) found in the draft's footage, if any. A reconstruction never includes the reference's own footage. */
  referenceFootage: { checked: number; violations: string[] }
  /** `referenceFootageInserted` is a computed fact, not a promise: true when the draft's footage includes the reference's own asset (a violation of the reconstruction rule, reported here and never hidden). */
  claims: { originalAssetsRecovered: false; referenceFootageInserted: boolean; burnedInContentRemoved: false; exactStylesRecovered: false }
  limitations: string[]
}

export interface ElementReconstructionPlan { items: ElementItem[]; record: ElementReconstructionRecord; signature: string }

export const LIMITATIONS: readonly string[] = [
  'This is an account of what was rebuilt, not a copy: the reference’s own pictures, fonts, effects and layers are not recovered.',
  'The reference’s footage is never inserted into the result; a rebuilt layer sits on your own footage, so there is no original text or graphic underneath it to remove.',
  'Classes are judgments from a few sampled stills, not visual recognition. Only a class you set yourself is a statement of fact.',
  'Timing is a guess between sampled frames; positions are boxes on small stills.',
]

export interface PlanContext {
  referenceVideoId: number
  videoAnalysisId: number
  createdAt: string
  /** Asset ids of the reference video itself, so the draft can be checked for its footage. */
  referenceAssetIds?: readonly number[]
  /** The draft's clips and overlays, by asset id, for that check. */
  footageAssetIds?: readonly { id: string; assetId: number | undefined }[]
}

// ── linking layers to elements ─────────────────────────────────────────────────────────────────

/** Candidate ids (the existing panels' own) an element's layers are written under. */
export function candidateIdsOf(e: VisualElement): { text: string[]; image: string[]; shape: string[] } {
  const out = { text: [] as string[], image: [] as string[], shape: [] as string[] }
  if (e.track.kind === 'text') {
    for (const gid of e.track.linkage.ids) out.text.push(`text:${gid}`)
    if (e.track.linkage.by === 'recurring_element') out.image.push(`rec:${e.id.replace(/^tt:rec:/, '')}`)
    out.image.push(`user:ve:${e.id}`)                                                           // a region marked from this element (slots.ts)
  } else if (e.track.kind === 'object') {
    for (const o of e.track.observations) if (o.evidence.kind === 'visual_object') out.image.push(`det:${o.evidence.id}`)
    out.image.push(`user:ve:${e.id}`)
  } else {
    const m = /^bt:(\d+):([a-z]+)(?::(outer|inner))?$/.exec(e.id)
    if (m) out.shape.push(m[3] ? `bg:${m[1]}:${m[2]}:${m[3]}` : `bg:${m[1]}:${m[2]}`)
  }
  return out
}

function linkLayers(e: VisualElement, g: GeneratedLayers): LinkedLayer[] {
  const ids = candidateIdsOf(e)
  const pick = (layers: readonly LayerLike[] | undefined, wanted: string[], kind: LayerKind) => (layers ?? []).filter(l => l.reconstruction && wanted.includes(l.reconstruction.candidateId)).map(l => ({ id: l.id, kind, candidateId: l.reconstruction!.candidateId }))
  return [...pick(g.textOverlays, ids.text, 'text'), ...pick(g.mediaOverlays, ids.image, 'image'), ...pick(g.shapes, ids.shape, 'shape')]
}

const basesOf = (l: LayerLike | undefined) => Object.values(l?.reconstruction?.properties ?? {}).map(p => p.basis)

function statusOfLayers(layers: LinkedLayer[], g: GeneratedLayers): { status: ReconstructionStatus; reasons: string[]; limitations: string[] } {
  const find = (l: LinkedLayer) => [...(g.textOverlays ?? []), ...(g.mediaOverlays ?? []), ...(g.shapes ?? [])].find(x => x.id === l.id)
  const reasons: string[] = [], limitations: string[] = []
  let status: ReconstructionStatus = 'faithful'
  const rank: ReconstructionStatus[] = ['faithful', 'approximate', 'user_supplied']
  const up = (s: ReconstructionStatus) => { if (rank.indexOf(s) > rank.indexOf(status)) status = s }
  for (const l of layers) {
    const layer = find(l)
    const bases = basesOf(layer)
    if (l.kind === 'image') {
      const src = layer?.reconstruction?.image?.source
      if (src === 'user_upload') { up('user_supplied'); reasons.push('An image you supplied fills the slot.') }
      else { up('approximate'); reasons.push('A rectangular crop of the reference still fills the slot.'); limitations.push('A crop includes its background and is enlarged from a small still, so it will look soft.') }
    } else if (bases.includes('user') && l.kind === 'text' && (layer?.reconstruction?.corrected ?? []).includes('text')) {
      up('user_supplied'); reasons.push('You set the wording of this text yourself.')
    } else if (bases.length > 0 && bases.every(b => b === 'measured')) {
      reasons.push('Every property of the layer is measured evidence.')
    } else {
      up('approximate')
      const soft = [...new Set(bases.filter(b => b !== 'measured'))]
      reasons.push(`A native ${l.kind} layer exists; some properties are ${soft.length ? soft.join('/') : 'estimated'} rather than measured.`)
    }
  }
  return { status, reasons: [...new Set(reasons)], limitations: [...new Set(limitations)] }
}

// ── the plan ────────────────────────────────────────────────────────────────────────────────────

export function planElementReconstruction(elements: readonly VisualElement[], generated: GeneratedLayers, ctx: PlanContext): ElementReconstructionPlan {
  const items: ElementItem[] = []
  for (const e of elements) {
    const layers = linkLayers(e, generated)
    const base = {
      elementId: e.id, class: e.classification.class, classBasis: e.classification.basis, classConfidence: { ...e.classification.confidence }, readiness: e.readiness.state,
      layers, evidence: e.classification.evidence.map(x => ({ kind: x.kind, id: x.id, certainty: x.certainty })), first: e.first, last: e.last,
    }
    if (layers.length > 0) {
      const s = statusOfLayers(layers, generated)
      items.push({ ...base, status: s.status, reasons: [...s.reasons], limitations: [...e.readiness.limitations, ...s.limitations] })
    } else if (e.readiness.state === 'not_reliable') {
      items.push({ ...base, status: 'unsupported', reasons: [...e.readiness.reasons], limitations: [...e.readiness.limitations] })
    } else if (e.readiness.state === 'needs_user_asset') {
      items.push({ ...base, status: 'missing_asset', reasons: ['It needs an image only you can supply, and none has been added.', ...e.readiness.reasons], limitations: [...e.readiness.limitations] })
    } else if (e.readiness.state === 'needs_background_restoration') {
      items.push({ ...base, status: 'unsupported', reasons: [...e.readiness.reasons], limitations: [...e.readiness.limitations] })
    } else {
      items.push({ ...base, status: 'not_included', reasons: ['It could be rebuilt as a native layer, but no layer was generated for it (left out by default or by you).', ...e.readiness.reasons], limitations: [...e.readiness.limitations] })
    }
  }
  // blueprint text that still holds its instruction: not an element's layer, but a placeholder the person must replace
  for (const t of generated.textOverlays ?? []) {
    if (t.reconstruction || typeof t.text !== 'string' || !/^(\[|TEXT PLACEHOLDER|CTA PLACEHOLDER)/i.test(t.text.trim())) continue
    items.push({ elementId: null, class: null, classBasis: null, classConfidence: null, readiness: null, status: 'placeholder', layers: [{ id: t.id, kind: 'text', candidateId: '' }], reasons: ['A blueprint instruction is still in place of real text.'], limitations: [], evidence: [], first: null, last: null })
  }
  const counts = { elements: elements.length, faithful: 0, approximate: 0, user_supplied: 0, placeholder: 0, missing_asset: 0, not_included: 0, unsupported: 0 } as ElementReconstructionRecord['counts']
  for (const i of items) counts[i.status]++
  const ref = new Set(ctx.referenceAssetIds ?? [])
  const footage = ctx.footageAssetIds ?? []
  const violations = footage.filter(f => f.assetId !== undefined && ref.has(f.assetId)).map(f => f.id)
  const record: ElementReconstructionRecord = {
    schema: ELEMENT_RECONSTRUCTION_SCHEMA, version: ELEMENT_RECONSTRUCTION_VERSION, referenceVideoId: ctx.referenceVideoId, videoAnalysisId: ctx.videoAnalysisId, createdAt: ctx.createdAt,
    counts, items, referenceFootage: { checked: footage.length, violations },
    claims: { originalAssetsRecovered: false, referenceFootageInserted: violations.length > 0, burnedInContentRemoved: false, exactStylesRecovered: false }, limitations: [...LIMITATIONS],
  }
  return { items, record, signature: JSON.stringify(items.map(i => [i.elementId, i.status, i.layers.map(l => l.id)]).concat([[violations.length]] as never)) }
}
