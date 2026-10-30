// M2.2a -- turn APPROVED candidates (a slot plus the picture that fills it) into native Video Studio V2 image layers (MediaOverlay) and merge them into a draft
// snapshot. Pure. Handles: time mapping, the picture's own proportions (never stretched), duplicates, the rights gate for crops, and the provenance every
// layer carries. It never edits evidence, never touches the editor, never uploads anything, and never claims more than the evidence shows.
import type { ImageReconstructionProvenance, MediaOverlay } from '../../../types'
import {
  IMAGE_ENGINE_VERSION, LIMITATIONS, NO_CLAIMS, RECONSTRUCTION_SCHEMA, round3,
  type ImageSource, type Prop, type Rect,
} from './contract'
import type { ImageCandidate } from './candidates'
import { resolveImageCandidate, type ImageCorrections, type ResolvedImage, type TimeMap } from './corrections'
import { fitContain, sameRegion, type Box, type Canvas } from './geometry'

/** The picture chosen for a slot. `assetId` / `url` appear only once it has been uploaded; a layer needs them, a plan item without them is "ready to upload". */
export interface ImageRef {
  source: ImageSource
  width: number
  height: number
  fileName: string
  hasAlpha: boolean | null
  /** For a crop: the region of the frame it was cut from. If the slot's region later changes, the crop no longer matches it. */
  cropRegion?: Rect
  assetId?: number
  url?: string
}
export type ImageRefs = Readonly<Record<string, ImageRef>>

export interface ImageLayerContext {
  referenceVideoId: number
  videoAnalysisId: number
  timeMap: TimeMap
  canvas: Canvas
  referenceRightsStatus: string | null
  /** What the draft already holds. A layer whose id is already there is not added twice. */
  existingOverlays: readonly MediaOverlay[]
  createdAt: string
}

export type ImageItemStatus =
  | 'included' | 'ready_to_upload' | 'needs_image' | 'needs_rights' | 'crop_outdated'
  | 'excluded_default' | 'excluded_user' | 'duplicate' | 'outside_timeline' | 'invalid'
export interface ImagePlanItem { candidateId: string; status: ImageItemStatus; message: string; box?: Box; scale?: number }

export interface ImageReconstructionRecord {
  schema: typeof RECONSTRUCTION_SCHEMA
  kind: 'image'
  engineVersion: string
  referenceVideoId: number
  videoAnalysisId: number
  createdAt: string
  timeMap: { mode: TimeMap['mode']; factor: number; referenceSeconds: number | null; planSeconds: number }
  counts: { detected: number; drawn: number; included: number; waitingForUpload: number; waitingForDecision: number; excluded: number; duplicates: number; outside: number; invalid: number }
  items: ImagePlanItem[]
  /** What this record does NOT claim. Always false. */
  claims: typeof NO_CLAIMS
  limitations: string[]
}

export interface ImageLayerPlan {
  overlays: MediaOverlay[]
  items: ImagePlanItem[]
  record: ImageReconstructionRecord
  /** Changes whenever the layers a save would write change: lets the UI tell a saved draft from an edited one. */
  signature: string
}

export const layerId = (videoAnalysisId: number, c: Pick<ImageCandidate, 'id'>) => `ri:${videoAnalysisId}:${c.id}`

function provenanceOf(r: ResolvedImage, image: ImageRef & { assetId: number }, box: Box, scale: number, ctx: ImageLayerContext): ImageReconstructionProvenance {
  const c = r.candidate
  const p = (v: Prop<unknown>) => ({ basis: v.basis, ...(v.confidence ? { confidence: v.confidence } : {}), ...(v.note ? { note: v.note } : {}) })
  const crop = image.source === 'reference_frame_crop'
  return {
    schema: RECONSTRUCTION_SCHEMA, kind: 'image', candidateId: c.id, referenceVideoId: ctx.referenceVideoId, videoAnalysisId: ctx.videoAnalysisId, engineVersion: IMAGE_ENGINE_VERSION,
    origin: c.origin, evidence: c.evidence.map(e => ({ ...e })),
    frame: { id: c.frame.id, path: c.frame.path, timestamp: c.frame.timestamp, width: c.frame.width, height: c.frame.height },
    region: { x: r.region.value.x, y: r.region.value.y, w: r.region.value.w, h: r.region.value.h },
    image: {
      source: image.source, assetId: image.assetId, width: image.width, height: image.height, fileName: image.fileName, hasAlpha: image.hasAlpha,
      ...(crop ? { rightsAcknowledged: true, referenceRightsStatus: ctx.referenceRightsStatus } : {}),
    },
    sourceConfidence: c.sourceConfidence,
    properties: {
      region: p(r.region), startTime: p(r.start), endTime: p(r.end),
      image: { basis: 'user', note: crop ? 'A rectangular crop of the reference frame that you chose to use. Background included; enlarged from a low-resolution still.' : 'Your own image.' },
      box: { basis: 'inferred', confidence: 'high', note: `The largest box with the picture’s own proportions that fits inside the region, centred in it. Drawn ${scale.toFixed(2)}× the picture’s size.` },
      opacity: { basis: 'default', note: 'Fully opaque; the picture’s own transparency, if it has any, is kept.' },
    },
    corrected: [...r.corrected], claims: { ...NO_CLAIMS },
  }
}

export function planImageLayers(candidates: readonly ImageCandidate[], corrections: ImageCorrections, images: ImageRefs, ctx: ImageLayerContext): ImageLayerPlan {
  const overlays: MediaOverlay[] = []
  const items: ImagePlanItem[] = []
  const existingIds = new Set(ctx.existingOverlays.map(o => o.id))
  const plan = ctx.timeMap.planSeconds

  for (const c of candidates) {
    const corr = corrections[c.id]
    const r = resolveImageCandidate(c, corr, ctx.timeMap)
    const add = (status: ImageItemStatus, message: string, extra: Partial<ImagePlanItem> = {}) => items.push({ candidateId: c.id, status, message, ...extra })

    if (!r.include) {
      const byUser = corr?.include === false
      add(byUser ? 'excluded_user' : 'excluded_default', byUser ? 'Left out by you.' : (c.flags.find(f => f.code === 'person_detected') ?? c.flags.find(f => f.code === 'low_confidence'))?.message ?? 'Left out by default.')
      continue
    }
    const start = Math.max(0, r.start.value), end = Math.min(plan, r.end.value)
    if (end - start < 0.1) { add('outside_timeline', `This appears after the draft ends (${round3(r.start.value)} s of ${round3(plan)} s). Move its time or leave it out.`); continue }
    const id = layerId(ctx.videoAnalysisId, c)
    if (existingIds.has(id)) { add('duplicate', 'This is already in the draft as a reconstruction layer.'); continue }

    const image = images[c.id]
    if (!image) { add('needs_image', 'Choose an image of your own, or a crop of the reference, to put here.'); continue }
    const crop = image.source === 'reference_frame_crop'
    if (crop && !r.rightsAcknowledged) { add('needs_rights', 'Confirm you may use this part of the reference video, or choose an image of your own.'); continue }
    if (crop && (!image.cropRegion || !sameRegion(image.cropRegion, r.region.value))) { add('crop_outdated', 'The region changed after the crop was made. Crop it again, or choose an image of your own.'); continue }
    const fit = fitContain(r.region.value, image, ctx.canvas)
    if (!fit) { add('invalid', 'The region or the image has no usable size.'); continue }
    if (image.assetId === undefined || !image.url) { add('ready_to_upload', 'Ready. The image is added to your library when you use “Add images to the draft”.', { box: fit.box, scale: fit.scale }); continue }

    overlays.push({
      id, url: image.url, assetId: image.assetId, x: fit.box.x, y: fit.box.y, width: fit.box.width, height: fit.box.height, opacity: 1,
      startTime: round3(start), endTime: round3(end), reconstruction: provenanceOf(r, { ...image, assetId: image.assetId }, fit.box, fit.scale, ctx),
    })
    add('included', 'Will be added as an editable image layer.', { box: fit.box, scale: fit.scale })
  }

  const count = (...s: ImageItemStatus[]) => items.filter(i => s.includes(i.status)).length
  const record: ImageReconstructionRecord = {
    schema: RECONSTRUCTION_SCHEMA, kind: 'image', engineVersion: IMAGE_ENGINE_VERSION, referenceVideoId: ctx.referenceVideoId, videoAnalysisId: ctx.videoAnalysisId, createdAt: ctx.createdAt,
    timeMap: { mode: ctx.timeMap.mode, factor: round3(ctx.timeMap.factor), referenceSeconds: ctx.timeMap.referenceSeconds, planSeconds: ctx.timeMap.planSeconds },
    counts: {
      detected: candidates.filter(c => c.origin === 'detected_region').length, drawn: candidates.filter(c => c.origin === 'user_region').length,
      included: count('included'), waitingForUpload: count('ready_to_upload'), waitingForDecision: count('needs_image', 'needs_rights', 'crop_outdated'),
      excluded: count('excluded_default', 'excluded_user'), duplicates: count('duplicate'), outside: count('outside_timeline'), invalid: count('invalid'),
    },
    items, claims: { ...NO_CLAIMS }, limitations: [...LIMITATIONS],
  }
  const signature = JSON.stringify(overlays.map(o => [o.id, o.assetId, o.x, o.y, o.width, o.height, o.startTime, o.endTime]))
  return { overlays, items, record, signature }
}

/** The part of a draft snapshot this touches. Anything else on the snapshot passes through untouched. */
export interface HasMediaOverlays { mediaOverlays: readonly unknown[] }

/** Add the approved layers to a draft snapshot and attach the reconstruction record. Returns a NEW object; merging the same plan again changes nothing more. */
export function mergeImageLayers<S extends HasMediaOverlays>(snapshot: S, plan: ImageLayerPlan | null | undefined): S | (Omit<S, 'mediaOverlays'> & { mediaOverlays: MediaOverlay[]; imageReconstruction: ImageReconstructionRecord }) {
  if (!plan || plan.overlays.length === 0) return snapshot
  const have = new Set((snapshot.mediaOverlays as MediaOverlay[]).map(o => o.id))
  return { ...snapshot, mediaOverlays: [...(snapshot.mediaOverlays as MediaOverlay[]), ...plan.overlays.filter(o => !have.has(o.id))], imageReconstruction: plan.record }
}
