// M2.1a -- turn APPROVED candidates into native Video Studio V2 text layers (TextOverlay) and merge them into a draft snapshot.
// Pure. Handles: time mapping, clipping to the draft, duplicates (within the batch and against what the draft already holds), conflicts with blueprint
// placeholders, and the provenance every layer carries. It never edits evidence, never touches the editor, and never claims more than the evidence shows.
import type { TextOverlay } from '../../../types'
import { isUnreplacedPlaceholder } from '../../video-studio-v2/blueprint/exportGuard'
import { iou, overlapSeconds, round3, TEXT_ENGINE_VERSION, RECONSTRUCTION_SCHEMA, type ReconstructionProvenance, type Prop, type Rect } from './contract'
import type { TextCandidate } from './candidates'
import { resolveCandidate, sameWording, type Corrections, type ResolvedText, type TimeMap } from './corrections'

export interface TextLayerContext {
  referenceVideoId: number
  videoAnalysisId: number
  timeMap: TimeMap
  canvas: { width: number; height: number }
  /** What the draft already holds: the blueprint placeholders (and anything else). Used for conflicts and duplicates. */
  existingOverlays: readonly TextOverlay[]
  createdAt: string
}

export type ItemStatus = 'included' | 'excluded_default' | 'excluded_user' | 'blocked_conflict' | 'duplicate' | 'outside_timeline' | 'invalid'
export interface PlanItem { candidateId: string; status: ItemStatus; message: string; replaces?: string[]; conflictsWith?: string[] }

export interface ReconstructionRecord {
  schema: typeof RECONSTRUCTION_SCHEMA
  kind: 'text'
  engineVersion: string
  referenceVideoId: number
  videoAnalysisId: number
  createdAt: string
  timeMap: { mode: TimeMap['mode']; factor: number; referenceSeconds: number | null; planSeconds: number }
  counts: { detected: number; included: number; excludedByDefault: number; excludedByUser: number; blocked: number; duplicates: number; outside: number; invalid: number }
  items: PlanItem[]
  replacedPlaceholders: string[]
  /** What this record does NOT claim. Always false: the original text stays burned into the reference video. */
  claims: { burnedInTextRemoved: false; originalFontsRecovered: false; originalLayersRecovered: false; backgroundPixelsRecovered: false }
  limitations: string[]
}

export interface TextLayerPlan {
  overlays: TextOverlay[]
  removePlaceholderIds: string[]
  items: PlanItem[]
  record: ReconstructionRecord
  /** Changes whenever the layers a save would write change: lets the UI tell a saved draft from an edited one. */
  signature: string
}

export const LIMITATIONS: readonly string[] = [
  'The text in the reference video is still burned into its pixels. Nothing was removed or hidden; these layers are new, separate text.',
  'Fonts, weights, outlines and shadows were not recovered. Size, position and colour are estimates from the detected box and the frame.',
  'When the text appeared and disappeared is only known between sampled frames.',
  'Export draws text in the exporter’s own font, upright; the exported position can differ slightly from the editor preview.',
]

const placeholderRect = (p: TextOverlay, canvas: { width: number; height: number }): Rect => {
  const scale = canvas.width / 1080
  const charsPerLine = Math.max(1, Math.floor(((p.width / 100) * canvas.width) / (0.5 * p.fontSize * scale)))
  const lines = Math.max(1, Math.ceil(Array.from(p.text).length / charsPerLine))
  return { x: p.x, y: p.y, w: p.width, h: ((lines * p.fontSize * 1.15 * scale) / canvas.height) * 100 }
}

const layerRect = (r: ResolvedText, canvas: { width: number; height: number }): Rect => {
  const own = (r.fontSize.value * 1.15 * (canvas.width / 1080)) / canvas.height * 100
  return { x: r.x.value, y: r.y.value, w: r.width.value, h: Math.max(r.candidate.group.box.h * 100, own) }
}

const layerId = (videoAnalysisId: number, c: TextCandidate) => `rc:${videoAnalysisId}:${c.id}`

function provenanceOf(r: ResolvedText, ctx: TextLayerContext): ReconstructionProvenance {
  const c = r.candidate
  const p = (v: Prop<unknown>) => ({ basis: v.basis, ...(v.confidence ? { confidence: v.confidence } : {}), ...(v.note ? { note: v.note } : {}) })
  return {
    schema: RECONSTRUCTION_SCHEMA, kind: 'text', candidateId: c.id, referenceVideoId: ctx.referenceVideoId, videoAnalysisId: ctx.videoAnalysisId,
    engineVersion: TEXT_ENGINE_VERSION, evidence: c.evidence.map(e => ({ ...e })), sourceConfidence: c.sourceConfidence,
    properties: {
      text: p(r.text), startTime: p(r.start), endTime: p(r.end), x: p(r.x), y: p(r.y), width: p(r.width), fontSize: p(r.fontSize), color: p(r.color),
      fontFamily: { basis: 'default', note: 'The original typeface is not recovered; the editor default is used.' },
    },
    corrected: [...r.corrected],
  }
}

export function planTextLayers(candidates: readonly TextCandidate[], corrections: Corrections, ctx: TextLayerContext): TextLayerPlan {
  const overlays: TextOverlay[] = []
  const items: PlanItem[] = []
  const removed = new Set<string>()
  const existing = ctx.existingOverlays
  const existingIds = new Set(existing.map(o => o.id))
  const placeholders = existing.filter(o => o.blueprint && isUnreplacedPlaceholder(o))
  const plan = ctx.timeMap.planSeconds

  for (const c of candidates) {
    const corr = corrections[c.id]
    const r = resolveCandidate(c, corr, ctx.timeMap)
    const add = (status: ItemStatus, message: string, extra: Partial<PlanItem> = {}) => items.push({ candidateId: c.id, status, message, ...extra })

    if (!r.include) {
      const byUser = corr?.include === false
      add(byUser ? 'excluded_user' : 'excluded_default', byUser ? 'Left out by you.' : (c.flags.find(f => f.code === 'third_party_branding') ?? c.flags.find(f => f.code === 'duplicate_candidate') ?? c.flags.find(f => f.code === 'low_confidence') ?? c.flags.find(f => f.code === 'fragment'))?.message ?? 'Left out by default.')
      continue
    }
    if (r.invalid) { add('invalid', 'The text is empty, so there is nothing to make a layer from.'); continue }

    const start = Math.max(0, r.start.value), end = Math.min(plan, r.end.value)
    if (end - start < 0.1) { add('outside_timeline', `This text appears after the draft ends (${round3(r.start.value)} s of ${round3(plan)} s). Move its time or leave it out.`); continue }

    const id = layerId(ctx.videoAnalysisId, c)
    const rect = layerRect(r, ctx.canvas)
    const dup = existingIds.has(id)
      ? 'This text is already in the draft as a reconstruction layer.'
      : existing.find(o => !o.blueprint && sameWording(o.text, r.text.value) && overlapSeconds(o.startTime, o.endTime, start, end) > 0 && iou({ x: o.x, y: o.y, w: o.width, h: rect.h }, rect) > 0.5)
        ? 'The draft already has the same text at the same place and time.'
        : overlays.find(o => sameWording(o.text, r.text.value) && overlapSeconds(o.startTime, o.endTime, start, end) > 0 && iou({ x: o.x, y: o.y, w: o.width, h: rect.h }, rect) > 0.5)
          ? 'Another item you selected has the same text at the same place and time.'
          : null
    if (dup) { add('duplicate', dup); continue }

    const clashes = placeholders.filter(p => !removed.has(p.id) && overlapSeconds(p.startTime, p.endTime, start, end) > 0.05 && iou(placeholderRect(p, ctx.canvas), rect) > 0)
    if (clashes.length && !r.replacePlaceholder) {
      const names = clashes.map(p => (p.blueprint!.kind === 'cta' ? `the call to action for scene ${p.blueprint!.sectionNumber}` : `the text placeholder for scene ${p.blueprint!.sectionNumber}`))
      add('blocked_conflict', `Overlaps ${names.join(' and ')}. Replace the placeholder with this text, or leave this text out.`, { conflictsWith: clashes.map(p => p.id) })
      continue
    }
    for (const p of clashes) removed.add(p.id)

    const layer: TextOverlay = {
      id, text: r.text.value, x: r.x.value, y: r.y.value, width: r.width.value, startTime: round3(start), endTime: round3(end),
      fontFamily: 'Inter', fontSize: r.fontSize.value, bold: false, italic: false, color: r.color.value, bgColor: 'transparent', bgOpacity: 0, animation: 'none',
      reconstruction: provenanceOf(r, ctx),
    }
    // A layer that replaces a placeholder inherits its scene link: the draft stays traceable (and the export guard keeps treating it as a reconstruction).
    if (clashes.length) layer.blueprint = { ...clashes[0].blueprint! }
    overlays.push(layer)
    add('included', clashes.length ? `Replaces ${clashes.length === 1 ? 'a placeholder' : `${clashes.length} placeholders`}.` : 'Will be added as an editable text layer.', clashes.length ? { replaces: clashes.map(p => p.id) } : {})
  }

  const count = (s: ItemStatus) => items.filter(i => i.status === s).length
  const removePlaceholderIds = [...removed].sort()
  const record: ReconstructionRecord = {
    schema: RECONSTRUCTION_SCHEMA, kind: 'text', engineVersion: TEXT_ENGINE_VERSION, referenceVideoId: ctx.referenceVideoId, videoAnalysisId: ctx.videoAnalysisId, createdAt: ctx.createdAt,
    timeMap: { mode: ctx.timeMap.mode, factor: round3(ctx.timeMap.factor), referenceSeconds: ctx.timeMap.referenceSeconds, planSeconds: ctx.timeMap.planSeconds },
    counts: { detected: candidates.length, included: count('included'), excludedByDefault: count('excluded_default'), excludedByUser: count('excluded_user'), blocked: count('blocked_conflict'), duplicates: count('duplicate'), outside: count('outside_timeline'), invalid: count('invalid') },
    items, replacedPlaceholders: removePlaceholderIds, claims: { burnedInTextRemoved: false, originalFontsRecovered: false, originalLayersRecovered: false, backgroundPixelsRecovered: false },
    limitations: [...LIMITATIONS],
  }
  const signature = JSON.stringify([overlays.map(o => [o.id, o.text, o.x, o.y, o.width, o.startTime, o.endTime, o.fontSize, o.color]), removePlaceholderIds])
  return { overlays, removePlaceholderIds, items, record, signature }
}

/** The part of a draft snapshot this touches. Anything else on the snapshot passes through untouched. */
export interface HasTextOverlays { textOverlays: TextOverlay[] }

/** Add the approved layers to a draft snapshot, remove only the placeholders they replace, and attach the reconstruction record. Returns a NEW object. */
export function mergeTextLayers<S extends HasTextOverlays>(snapshot: S, plan: TextLayerPlan | null | undefined): S & { reconstruction?: ReconstructionRecord } {
  if (!plan || (plan.overlays.length === 0 && plan.items.length === 0)) return snapshot
  const remove = new Set(plan.removePlaceholderIds)
  const have = new Set(snapshot.textOverlays.map(o => o.id))
  const kept = snapshot.textOverlays.filter(o => !remove.has(o.id))
  return { ...snapshot, textOverlays: [...kept, ...plan.overlays.filter(o => !have.has(o.id))], reconstruction: plan.record }
}
