// M2.3c -- composition ordering. The Reconstructor generates text, pictures, plates and subtitles from different evidence at different times; this decides, at SAVE time only, the
// stacking they are written with, by setting explicit `order` values on its OWN layers (ids rb: ri: rc: rs:). The editor and the export both paint by `order` (ties by kind), so the
// stack in the preview is the stack in the MP4. Nothing the person made is ever touched, and after the save the editor's own reordering wins as always.
import { PLATE_ORDER } from './materialize'

export type OrderPolicy = 'as_generated' | 'recommended'
export const POLICY_LABEL: Record<OrderPolicy, string> = { as_generated: 'Leave each as generated', recommended: 'Recommended stacking' }
export type LayerKind = 'plate' | 'picture' | 'text' | 'subtitle'
export type Bucket = 'recovered' | 'inferred' | 'manual'
export const BUCKET_LABEL: Record<Bucket, string> = { recovered: 'Measured', inferred: 'Estimated', manual: 'Set by you' }

/** Bottom to top. Text keeps 0 (the default every other layer sits at). Subtitles imported from a transcript are written below everything (-1, -2, ...); the recommended stack lifts them on top. */
export const BANDS = { plate: PLATE_ORDER, picture: -10000, text: 0, subtitle: 10000 } as const
export const POLICY_RULES: Record<OrderPolicy, readonly string[]> = {
  as_generated: ['Every layer keeps the order it was generated with.'],
  recommended: [
    'Background plates go underneath everything else.',
    'Reconstructed pictures go above the plates and below text.',
    'Reconstructed text stays where it is, above pictures.',
    'Transcript subtitles go on top so nothing covers them.',
    'Only layers the Reconstructor made are moved, and only if they still carry the order they were generated with. Your own layers are never touched.',
  ],
}

interface Layered { id: string; order?: number; reconstruction?: unknown; startTime?: number; endTime?: number }
export interface CompositionInput { shapes: readonly unknown[]; mediaOverlays: readonly unknown[]; textOverlays: readonly unknown[]; subtitles: readonly unknown[] }

const PREFIX: { prefix: string; key: keyof CompositionInput; kind: LayerKind }[] = [
  { prefix: 'rb:', key: 'shapes', kind: 'plate' }, { prefix: 'ri:', key: 'mediaOverlays', kind: 'picture' },
  { prefix: 'rc:', key: 'textOverlays', kind: 'text' }, { prefix: 'rs:', key: 'subtitles', kind: 'subtitle' },
]

/** measured only -> Measured; any estimate or default -> Estimated; anything you set -> Set by you. */
export function bucketOf(reconstruction: unknown): Bucket {
  const props = (reconstruction as { properties?: Record<string, { basis?: string }> } | undefined)?.properties
  const bases = props ? Object.values(props).map(p => p?.basis) : []
  if (bases.includes('user')) return 'manual'
  if (bases.length > 0 && bases.every(b => b === 'measured')) return 'recovered'
  return 'inferred'
}

export interface GeneratedLayer { id: string; kind: LayerKind; order: number; bucket: Bucket; startTime: number | null; endTime: number | null }
export interface OrderChange { id: string; kind: LayerKind; from: number; to: number }

export function generatedLayers(s: CompositionInput): GeneratedLayer[] {
  const out: GeneratedLayer[] = []
  for (const { prefix, key, kind } of PREFIX) for (const l of s[key] as Layered[]) {
    if (typeof l.id === 'string' && l.id.startsWith(prefix)) out.push({ id: l.id, kind, order: l.order ?? 0, bucket: bucketOf(l.reconstruction), startTime: l.startTime ?? null, endTime: l.endTime ?? null })
  }
  return out
}

const target = (l: GeneratedLayer, policy: OrderPolicy): number | null => {
  if (policy !== 'recommended') return null
  if (l.kind === 'plate') return l.order === 0 ? BANDS.plate : null                                // plates are written at PLATE_ORDER already; only a plate left at 0 is moved
  if (l.kind === 'picture') return l.order === 0 ? BANDS.picture : null
  if (l.kind === 'subtitle') return l.order <= 0 ? BANDS.subtitle - l.order : null                 // -1 -> 10001, -2 -> 10002: the transcript's own list order is kept
  return null
}

export interface CompositionPlan { policy: OrderPolicy; layers: GeneratedLayer[]; changes: OrderChange[]; signature: string }

export function planComposition(s: CompositionInput, policy: OrderPolicy): CompositionPlan {
  const layers = generatedLayers(s)
  const changes: OrderChange[] = []
  for (const l of layers) { const to = target(l, policy); if (to !== null && to !== l.order) changes.push({ id: l.id, kind: l.kind, from: l.order, to }) }
  return { policy, layers, changes, signature: JSON.stringify([policy, changes.map(c => [c.id, c.to])]) }
}

export interface CompositionRecord { kind: 'composition'; policy: OrderPolicy; changes: OrderChange[]; counts: Record<LayerKind, number> }

/** Returns the snapshot itself when nothing changes; otherwise a NEW object with the changed layers and a record. Applying it again changes nothing more. */
export function applyComposition<S extends CompositionInput>(snapshot: S, policy: OrderPolicy | null | undefined): S {
  if (!policy || policy === 'as_generated') return snapshot
  const plan = planComposition(snapshot, policy)
  if (plan.changes.length === 0) return snapshot
  const to = new Map(plan.changes.map(c => [c.id, c.to]))
  const move = (arr: readonly unknown[]) => (arr as Layered[]).map(l => (to.has(l.id) ? { ...l, order: to.get(l.id) } : l))
  const counts: Record<LayerKind, number> = { plate: 0, picture: 0, text: 0, subtitle: 0 }
  for (const c of plan.changes) counts[c.kind]++
  return { ...snapshot, shapes: move(snapshot.shapes), mediaOverlays: move(snapshot.mediaOverlays), textOverlays: move(snapshot.textOverlays), subtitles: move(snapshot.subtitles), compositionReconstruction: { kind: 'composition', policy, changes: plan.changes, counts } as CompositionRecord }
}


// ── M2.3 per-scene view: what the Reconstructor generated in each scene, bottom to top, and where the stacking policy puts it ─────────────────────────────────
export const KIND_LABEL: Record<LayerKind, string> = { plate: 'Background plate', picture: 'Picture', text: 'Text', subtitle: 'Subtitle' }
/** the editor's tie rule at equal `order` (media < text < lower third < shape < subtitle), so a plate (a shape) sits above text and pictures unless its explicit order says otherwise */
const TIE_RANK: Record<LayerKind, number> = { picture: 0, text: 1, plate: 3, subtitle: 4 }

export interface SceneLayerRow { id: string; kind: LayerKind; label: string; bucket: Bucket; startTime: number | null; endTime: number | null; before: number; after: number; moved: boolean }
export interface SceneLayerGroup { sceneNumber: number; startTime: number; endTime: number; rows: SceneLayerRow[] }

/** Group the plan's layers by the scene they start in (layers with no times, or outside every scene, go in no scene's list), each list bottom to top by the order the policy will write. */
export function layersByScene(plan: CompositionPlan, scenes: readonly { sceneNumber: number; startTime: number; endTime: number }[]): SceneLayerGroup[] {
  const after = new Map(plan.changes.map(c => [c.id, c.to] as const))
  return scenes.map((sc, i) => {
    const last = i === scenes.length - 1
    const rows = plan.layers
      .filter(l => l.startTime !== null && l.startTime >= sc.startTime && (l.startTime < sc.endTime || (last && l.startTime <= sc.endTime)))
      .map(l => ({ id: l.id, kind: l.kind, label: KIND_LABEL[l.kind], bucket: l.bucket, startTime: l.startTime, endTime: l.endTime, before: l.order, after: after.get(l.id) ?? l.order, moved: after.has(l.id) }))
      .sort((a, b) => a.after - b.after || TIE_RANK[a.kind] - TIE_RANK[b.kind] || a.id.localeCompare(b.id))
    return { sceneNumber: sc.sceneNumber, startTime: sc.startTime, endTime: sc.endTime, rows }
  }).filter(g => g.rows.length > 0)
}
