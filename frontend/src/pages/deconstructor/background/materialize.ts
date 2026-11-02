// M2.3b -- turn APPROVED plate candidates into native Video Studio V2 shape layers and merge them into a draft snapshot. Pure. A plate is a flat block of a MEASURED colour sitting
// exactly in a measured bar, for the span of its scene. It never edits evidence, never touches the editor, and never claims more than the stills show.
import type { BackgroundReconstructionProvenance, Shape } from '../../../types'
import { BACKGROUND_ENGINE_VERSION, LIMITATIONS, NO_CLAIMS, RECONSTRUCTION_SCHEMA, round3, type Side } from './contract'
import type { PlateCandidate } from './candidates'
import { resolvePlate, type PlateCorrections, type ResolvedPlate } from './corrections'

/** Plates sit under everything else the Reconstructor generates and under any default-order layer. Explicit, so the editor and the export agree without relying on the tie rule. */
export const PLATE_ORDER = -20000
export const plateLayerId = (videoAnalysisId: number, c: Pick<PlateCandidate, 'id'>) => `rb:${videoAnalysisId}:${c.id}`

export interface BackgroundContext {
  referenceVideoId: number
  videoAnalysisId: number
  /** The draft's length: a plate that starts after it is not added. */
  planSeconds: number
  existingShapes: readonly Pick<Shape, 'id'>[]
  createdAt: string
}

export type PlateStatus = 'included' | 'excluded_default' | 'excluded_user' | 'duplicate' | 'outside_timeline'
export interface PlateItem { candidateId: string; status: PlateStatus; message: string }

export interface BackgroundRecord {
  schema: typeof RECONSTRUCTION_SCHEMA
  kind: 'background'
  engineVersion: string
  referenceVideoId: number
  videoAnalysisId: number
  createdAt: string
  counts: { measured: number; included: number; excluded: number; duplicates: number; outside: number }
  items: PlateItem[]
  claims: typeof NO_CLAIMS
  limitations: string[]
}

export interface BackgroundPlan {
  shapes: Shape[]
  items: PlateItem[]
  record: BackgroundRecord
  /** Changes whenever the layers a save would write change. */
  signature: string
}

function geometry(side: Side, size: number): Pick<Shape, 'kind' | 'x' | 'y' | 'width' | 'height' | 'fullWidth'> {
  const p = round3(size * 100)
  switch (side) {
    case 'top': return { kind: 'banner', x: 0, y: 0, width: 100, height: p, fullWidth: true }
    case 'bottom': return { kind: 'banner', x: 0, y: round3(100 - p), width: 100, height: p, fullWidth: true }
    case 'left': return { kind: 'rectangle', x: 0, y: 0, width: p, height: 100 }
    case 'right': return { kind: 'rectangle', x: round3(100 - p), y: 0, width: p, height: 100 }
  }
}

function provenanceOf(r: ResolvedPlate, ctx: BackgroundContext, start: number, end: number): BackgroundReconstructionProvenance {
  const c = r.candidate
  return {
    schema: RECONSTRUCTION_SCHEMA, kind: 'background', candidateId: c.id, referenceVideoId: ctx.referenceVideoId, videoAnalysisId: ctx.videoAnalysisId, engineVersion: BACKGROUND_ENGINE_VERSION,
    sceneNumber: c.sceneNumber, side: c.side,
    evidence: { framesMeasured: c.framesMeasured, framesSeen: c.framesSeen, uniformity: c.uniformity, size: c.size, frameIds: [...c.frameIds] },
    properties: {
      color: { basis: r.color.basis, ...(r.color.note ? { note: r.color.note } : {}) },
      region: { basis: r.size.basis, note: r.size.basis === 'user' ? `The ${c.side} bar at ${(r.size.value * 100).toFixed(1)}% of the frame, as set by you (measured: ${(c.size * 100).toFixed(1)}%).` : `The ${c.side} bar, ${(c.size * 100).toFixed(1)}% of the frame, measured on ${c.framesSeen} still${c.framesSeen === 1 ? '' : 's'}.` },
      startTime: { basis: 'inferred', confidence: 'medium', note: `The span of scene ${c.sceneNumber} on the draft’s timeline.` },
      endTime: { basis: 'inferred', confidence: 'medium', note: `The span of scene ${c.sceneNumber} on the draft’s timeline.` },
    },
    claims: { ...NO_CLAIMS },
  }
}

export function planBackground(candidates: readonly PlateCandidate[], corrections: PlateCorrections, ctx: BackgroundContext): BackgroundPlan {
  const shapes: Shape[] = []
  const items: PlateItem[] = []
  const existing = new Set(ctx.existingShapes.map(s => s.id))
  for (const c of candidates) {
    const r = resolvePlate(c, corrections[c.id])
    const add = (status: PlateStatus, message: string) => items.push({ candidateId: c.id, status, message })
    if (!r.include) { add(corrections[c.id]?.include === false ? 'excluded_user' : 'excluded_default', corrections[c.id]?.include === false ? 'Left out by you.' : (c.flags.find(f => f.severity === 'warning')?.message ?? 'Left out by default.')); continue }
    const start = Math.max(0, c.startTime), end = Math.min(ctx.planSeconds, c.endTime)
    if (end - start < 0.1) { add('outside_timeline', 'This scene is not inside the draft’s length.'); continue }
    const id = plateLayerId(ctx.videoAnalysisId, c)
    if (existing.has(id)) { add('duplicate', 'This plate is already in the draft.'); continue }
    shapes.push({ id, ...geometry(c.side, r.size.value), fillColor: r.color.value, opacity: 1, borderWidth: 0, startTime: round3(start), endTime: round3(end), order: PLATE_ORDER, reconstruction: provenanceOf(r, ctx, start, end) })
    add('included', 'Will be added as an editable shape in the bar.')
  }
  const count = (...s: PlateStatus[]) => items.filter(i => s.includes(i.status)).length
  const record: BackgroundRecord = {
    schema: RECONSTRUCTION_SCHEMA, kind: 'background', engineVersion: BACKGROUND_ENGINE_VERSION, referenceVideoId: ctx.referenceVideoId, videoAnalysisId: ctx.videoAnalysisId, createdAt: ctx.createdAt,
    counts: { measured: candidates.length, included: count('included'), excluded: count('excluded_default', 'excluded_user'), duplicates: count('duplicate'), outside: count('outside_timeline') },
    items, claims: { ...NO_CLAIMS }, limitations: [...LIMITATIONS],
  }
  return { shapes, items, record, signature: JSON.stringify(shapes.map(s => [s.id, s.fillColor, s.x, s.y, s.width, s.height, s.startTime, s.endTime])) }
}

/** The part of a draft snapshot this touches. */
export interface HasShapes { shapes: readonly unknown[] }

/** Add the approved plates to a draft snapshot and attach the record. Returns a NEW object; merging the same plan again changes nothing more. */
export function mergeBackground<S extends HasShapes>(snapshot: S, plan: BackgroundPlan | null | undefined): S | (Omit<S, 'shapes'> & { shapes: Shape[]; backgroundReconstruction: BackgroundRecord }) {
  if (!plan || plan.shapes.length === 0) return snapshot
  const have = new Set((snapshot.shapes as Shape[]).map(s => s.id))
  return { ...snapshot, shapes: [...(snapshot.shapes as Shape[]), ...plan.shapes.filter(s => !have.has(s.id))], backgroundReconstruction: plan.record }
}
