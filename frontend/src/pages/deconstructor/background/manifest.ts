// M2.3f -- the hook the M2.6 reconstruction manifest will read. Pure data, no UI: each element this stage produces, which scene it belongs to, whether it was measured, estimated or set
// by the person, and what it does NOT claim. The manifest itself does not exist yet; this is the shape M2.6 consumes.
import type { Bucket, CompositionPlan, OrderPolicy } from './composition'
import { bucketOf } from './composition'
import type { BackgroundPlan } from './materialize'

export interface ManifestEntry {
  family: 'background' | 'composition'
  /** The layer id, or a stable id for a plan-level entry. */
  id: string
  scene: number | null
  element: 'background_plate' | 'stacking_order'
  bucket: Bucket
  /** What this entry does not claim: every value is false. */
  claims: Record<string, false>
  note: string
}

export function backgroundManifest(plan: BackgroundPlan | null | undefined): ManifestEntry[] {
  if (!plan) return []
  return plan.shapes.map(s => ({
    family: 'background', id: s.id, scene: s.reconstruction?.sceneNumber ?? null, element: 'background_plate', bucket: bucketOf(s.reconstruction),
    claims: { ...(s.reconstruction?.claims ?? { backgroundRecovered: false, contentBehindOverlaysRecovered: false, inpainted: false }) },
    note: `A flat ${s.fillColor} block in the ${s.reconstruction?.side ?? ''} bar, from ${s.reconstruction?.evidence.framesSeen ?? 0} measured still(s).`,
  }))
}

export function compositionManifest(plan: CompositionPlan | null | undefined, policy: OrderPolicy): ManifestEntry[] {
  if (!plan || plan.changes.length === 0) return []
  return [{ family: 'composition', id: `composition:${policy}`, scene: null, element: 'stacking_order', bucket: 'inferred', claims: { originalLayerStructureRecovered: false }, note: `Stacking order set on ${plan.changes.length} generated layer(s) by the “${policy}” policy; the original layer structure is not known.` }]
}
