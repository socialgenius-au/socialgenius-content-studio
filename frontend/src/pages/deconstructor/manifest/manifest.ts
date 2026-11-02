// M2.6 -- the reconstruction MANIFEST: one read-only list of everything the Reconstructor has made for the draft, across every kind (text, pictures, background plates, transitions,
// subtitles, stacking order), each with its scene, its time, how it was found (measured / estimated / set by you) and what it does NOT claim. Pure: it reads the plans the panels already
// hold, reads nothing from the network, writes nothing, and changes no plan. It is a summary of the record, never a second source of truth.
import type { Bucket, CompositionPlan, OrderPolicy } from '../background/composition'
import { bucketOf, BUCKET_LABEL, POLICY_LABEL } from '../background/composition'
import type { BackgroundPlan } from '../background/materialize'
import type { ImageLayerPlan } from '../imagelayers/materialize'
import type { SpeechPlan } from '../transcript/materialize'
import type { TextLayerPlan } from '../textlayers/materialize'
import type { TransitionPlan } from '../transitions/materialize'
import { KIND_LABEL as TRANSITION_LABEL } from '../transitions/contract'

export type ManifestFamily = 'text' | 'picture' | 'plate' | 'transition' | 'subtitle' | 'stacking'
export const FAMILY_LABEL: Record<ManifestFamily, string> = { text: 'Text', picture: 'Pictures', plate: 'Background bars', transition: 'Transitions', subtitle: 'Subtitles', stacking: 'Stacking order' }
const FAMILY_ORDER: ManifestFamily[] = ['text', 'picture', 'plate', 'subtitle', 'transition', 'stacking']

/** What every entry in the manifest leaves unclaimed, in plain words. Shown once; each entry's own `claims` object is all false. */
export const NEVER_CLAIMED: readonly string[] = [
  'The original editing project, its layers, fonts and effects are not recovered: the analysis only has the finished video.',
  'Text burned into the footage is not removed, and nothing behind a text, picture or bar is recovered.',
  'Pictures are cut from the video and are not the original image files.',
  'Words are a machine transcript and can be wrong; the speaker’s voice, music and sound effects are not recovered.',
  'Transitions are estimates from brightness and change measurements, never the original effect.',
]

export interface ManifestEntry {
  family: ManifestFamily
  /** The layer id (or a stable id for a plan-level entry). */
  id: string
  scene: number | null
  /** Short description of what it is, in words. */
  label: string
  startTime: number | null
  endTime: number | null
  bucket: Bucket
  bucketLabel: string
  /** What this entry does not claim. Every value is false. */
  claims: Record<string, false>
}

export interface ManifestInput {
  scenes: readonly { sceneNumber: number; startTime: number; endTime: number }[]
  textLayers?: TextLayerPlan | null
  imageLayers?: ImageLayerPlan | null
  backgroundPlan?: BackgroundPlan | null
  speechPlan?: SpeechPlan | null
  transitionPlan?: TransitionPlan | null
  composition?: { plan: CompositionPlan | null; policy: OrderPolicy } | null
}

export interface ManifestSummary { family: ManifestFamily; label: string; total: number; byBucket: Record<Bucket, number> }
export interface Manifest { entries: ManifestEntry[]; summary: ManifestSummary[]; total: number; limitations: readonly string[]; claims: { originalProjectRecovered: false; originalAssetsRecovered: false } }

const clip = (s: string, n = 48) => { const t = s.replace(/\s+/g, ' ').trim(); return Array.from(t).length > n ? `${Array.from(t).slice(0, n - 1).join('')}…` : t }
const NO: Record<string, false> = {}

export function buildManifest(input: ManifestInput): Manifest {
  const scenes = [...input.scenes].sort((a, b) => a.startTime - b.startTime)
  const sceneAt = (start: number | null, end: number | null): number | null => {
    if (start === null || end === null || scenes.length === 0) return null
    const mid = (start + end) / 2
    return (scenes.find(s => mid >= s.startTime && mid < s.endTime) ?? (mid < scenes[0].startTime ? scenes[0] : scenes[scenes.length - 1])).sceneNumber
  }
  const make = (family: ManifestFamily, id: string, label: string, start: number | null, end: number | null, bucket: Bucket, scene: number | null, claims: Record<string, false> = NO): ManifestEntry =>
    ({ family, id, scene: scene ?? sceneAt(start, end), label, startTime: start, endTime: end, bucket, bucketLabel: BUCKET_LABEL[bucket], claims: { ...claims } })

  const entries: ManifestEntry[] = []
  for (const o of input.textLayers?.overlays ?? []) entries.push(make('text', o.id, `“${clip(o.text)}”`, o.startTime, o.endTime, bucketOf(o.reconstruction), null, { ...(input.textLayers!.record.claims) }))
  for (const o of input.imageLayers?.overlays ?? []) entries.push(make('picture', o.id, 'Picture cut from the reference', o.startTime, o.endTime, bucketOf(o.reconstruction), null, { ...(input.imageLayers!.record.claims) }))
  for (const s of input.backgroundPlan?.shapes ?? []) {
    const side = s.reconstruction?.side
    entries.push(make('plate', s.id, `${side ? `${side[0].toUpperCase()}${side.slice(1)} bar` : 'Bar'}, flat ${s.fillColor}`, s.startTime, s.endTime, bucketOf(s.reconstruction), s.reconstruction?.sceneNumber ?? null,
      { ...(s.reconstruction?.claims ?? { backgroundRecovered: false, contentBehindOverlaysRecovered: false, inpainted: false }) }))
  }
  for (const s of input.speechPlan?.subtitles ?? []) entries.push(make('subtitle', s.id, `“${clip(s.text)}”`, s.startTime, s.endTime, bucketOf(s.reconstruction), null, { ...(input.speechPlan!.record.claims) }))
  for (const c of input.transitionPlan?.changes ?? []) {
    const bases = [c.basis.kind, c.basis.duration]
    const bucket: Bucket = bases.includes('user') ? 'manual' : 'inferred'                      // a transition is only ever estimated, or set by you
    entries.push(make('transition', `tr:${c.candidateId}`, `${TRANSITION_LABEL[c.kind]} (${c.duration.toFixed(1)} s) after scene ${c.sceneNumber}`, c.joinTime, c.joinTime, bucket, c.sceneNumber, { ...(input.transitionPlan!.record.claims) }))
  }
  if (input.composition && input.composition.plan && input.composition.plan.changes.length > 0) {
    entries.push(make('stacking', `composition:${input.composition.policy}`, `${POLICY_LABEL[input.composition.policy]}: order set on ${input.composition.plan.changes.length} layer${input.composition.plan.changes.length === 1 ? '' : 's'}`, null, null, 'inferred', null, { originalLayerStructureRecovered: false }))
  }
  entries.sort((a, b) => (a.scene ?? 1e9) - (b.scene ?? 1e9) || (a.startTime ?? -1) - (b.startTime ?? -1) || FAMILY_ORDER.indexOf(a.family) - FAMILY_ORDER.indexOf(b.family) || a.id.localeCompare(b.id))

  const summary: ManifestSummary[] = FAMILY_ORDER.map(family => {
    const mine = entries.filter(e => e.family === family)
    return { family, label: FAMILY_LABEL[family], total: mine.length, byBucket: { recovered: mine.filter(e => e.bucket === 'recovered').length, inferred: mine.filter(e => e.bucket === 'inferred').length, manual: mine.filter(e => e.bucket === 'manual').length } }
  }).filter(s => s.total > 0)
  return { entries, summary, total: entries.length, limitations: NEVER_CLAIMED, claims: { originalProjectRecovered: false, originalAssetsRecovered: false } }
}

/** Plain-text export of the manifest (for a person to read or paste into a note). No ids of other people's data; just what the Reconstructor made. */
export function manifestText(m: Manifest): string {
  const t = (n: number | null) => (n === null ? '' : `${n.toFixed(1)}s`)
  const lines = [`Reconstruction manifest: ${m.total} element${m.total === 1 ? '' : 's'}`]
  for (const e of m.entries) lines.push(`${e.scene === null ? 'Draft' : `Scene ${e.scene}`}${e.startTime === null ? '' : ` ${t(e.startTime)}${e.endTime !== null && e.endTime !== e.startTime ? `–${t(e.endTime)}` : ''}`} | ${FAMILY_LABEL[e.family]} | ${e.label} | ${e.bucketLabel}`)
  lines.push('', 'Not recovered:', ...m.limitations.map(l => `- ${l}`))
  return lines.join('\n')
}
