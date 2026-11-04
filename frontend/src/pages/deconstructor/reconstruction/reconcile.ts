// M5 -- keep the element account TRUE after the draft has been edited. The account is written when the Reconstructor saves; once a person edits layers in Video Studio the statuses can drift (a layer deleted, an
// image replaced by their own). The static part of each item (the element, its class, its evidence, its readiness, which candidate ids its layers carried) does not change; the dynamic part (which layers exist now
// and what that makes of the element) is a pure function of the current layers' own provenance. This recomputes it. Pure; it reads layers, never changes one, and never invents an element.
import type { ElementItem, ElementReconstructionRecord, GeneratedLayers, LayerKind, LinkedLayer, ReconstructionStatus } from './plan'
import { ELEMENT_RECONSTRUCTION_SCHEMA } from './plan'

const KIND_OF: Record<string, LayerKind> = { text: 'text', image: 'image', background: 'shape' }

function statusFor(item: ElementItem, layers: LinkedLayer[], g: GeneratedLayers): { status: ReconstructionStatus; reasons: string[] } {
  if (layers.length === 0) {
    if (item.readiness === 'not_reliable' || item.readiness === 'needs_background_restoration') return { status: 'unsupported', reasons: ['It cannot be rebuilt from the evidence.'] }
    if (item.readiness === 'needs_user_asset') return { status: 'missing_asset', reasons: ['It needs an image only you can supply, and none is in the draft.'] }
    return { status: 'not_included', reasons: ['No layer in the draft accounts for it any more.'] }
  }
  const all = [...(g.textOverlays ?? []), ...(g.mediaOverlays ?? []), ...(g.shapes ?? [])]
  let status: ReconstructionStatus = 'faithful'
  const rank: ReconstructionStatus[] = ['faithful', 'approximate', 'user_supplied']
  const up = (s: ReconstructionStatus) => { if (rank.indexOf(s) > rank.indexOf(status)) status = s }
  for (const l of layers) {
    const layer = all.find(x => x.id === l.id)
    const bases = Object.values(layer?.reconstruction?.properties ?? {}).map(p => p.basis)
    if (l.kind === 'image') up(layer?.reconstruction?.image?.source === 'user_upload' ? 'user_supplied' : 'approximate')
    else if (l.kind === 'text' && bases.includes('user') && (layer?.reconstruction?.corrected ?? []).includes('text')) up('user_supplied')
    else if (!(bases.length > 0 && bases.every(b => b === 'measured'))) up('approximate')
  }
  return { status, reasons: [`${layers.length} layer${layers.length === 1 ? '' : 's'} in the draft account for it.`] }
}

/** The record with each item's layers and status recomputed from the layers that exist now. Items keep their element, class, evidence and readiness. */
export function reconcileElementReconstruction(record: ElementReconstructionRecord, current: GeneratedLayers): ElementReconstructionRecord {
  if (!record || record.schema !== ELEMENT_RECONSTRUCTION_SCHEMA) return record
  const all = [...(current.textOverlays ?? []), ...(current.mediaOverlays ?? []), ...(current.shapes ?? [])]
  const items: ElementItem[] = record.items.map(item => {
    if (item.elementId === null) {
      const still = item.layers.filter(l => all.some(x => x.id === l.id))
      return { ...item, layers: still, status: still.length ? 'placeholder' : 'not_included', reasons: still.length ? item.reasons : ['The placeholder is no longer in the draft.'] }
    }
    const wanted = new Set([...(item.candidateIds ?? []), ...item.layers.map(l => l.candidateId)].filter(Boolean))
    // layers the Reconstructor linked to this element, found again by the candidate id their provenance carries (the layer ids may have been kept or not)
    const linked: LinkedLayer[] = all.filter(l => l.reconstruction && wanted.has(l.reconstruction.candidateId)).map(l => ({ id: l.id, kind: KIND_OF[l.reconstruction!.kind] ?? 'text', candidateId: l.reconstruction!.candidateId }))
    const s = statusFor(item, linked, current)
    return { ...item, layers: linked, status: s.status, reasons: s.reasons }
  })
  const counts = { elements: record.counts.elements, faithful: 0, approximate: 0, user_supplied: 0, placeholder: 0, missing_asset: 0, not_included: 0, unsupported: 0 } as ElementReconstructionRecord['counts']
  for (const i of items) counts[i.status]++
  return { ...record, items, counts }
}
