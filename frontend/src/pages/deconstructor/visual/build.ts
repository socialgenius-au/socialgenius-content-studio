// M4 -- assemble VisualElement objects (contract.ts) from the analysis the Deconstructor already stored: OCR occurrence groups and the recurring elements that link them, the detector's boxes and the persistent
// elements the backend derived from them, and (optionally) background bars measured in the browser. Pure: no network, no storage, no mutation of the input.
//
// Identity is the analysis's own. A text track is a recurring element (the backend linked its groups by text similarity and position) or a single occurrence group; an object track is a persistent visual element
// (the backend linked same-shot detections) or a single detection. This module NEVER merges two things because they sit in similar places, and never splits one the backend linked; shot boundaries are respected
// because the backend only links objects within a shot, and a text track that crosses one says so.
import type { ReferenceVideo } from '../../../types'
import { readImageEvidence, type DetectionEvidence, type ImageEvidence } from '../imagelayers/evidence'
import { readTextEvidence, type TextEvidence, type TextEvidenceGroup } from '../textlayers/evidence'
import { applyCorrection, classifyBackgroundBar, classifyObjectTrack, classifyTextTrack, findSubtitleLines } from './classify'
import { NO_CLAIMS, VISUAL_ELEMENT_SCHEMA, round3, type ClassCorrections, type Rect, type Track, type TrackObservation, type VisualElement } from './contract'
import { readinessOf } from './readiness'
import { movementOf, visibilityIntervals } from './signals'

export type VisualInput = Pick<ReferenceVideo, 'id' | 'shots'> & Partial<Pick<ReferenceVideo, 'technical_details' | 'rights_status' | 'recurring_elements'>>

/** The persistent visual element the API returns per shot. `types/index.ts` (protected) does not declare it, so it is read through this local shape. */
interface PersistentLite { id: number; member_visual_object_ids?: number[]; start_time?: number; end_time?: number; linkage_confidence?: number | null; native_label?: string | null }

/** A flat band measured on the reference's stills (see ../background). Optional input: it is measured in the browser from pixels, not stored by the analysis. */
export interface BarEvidence { sceneNumber: number; side: 'top' | 'bottom' | 'left' | 'right'; size: number; /** how far in from its edge a gradient's inner step starts (share of the frame) */ offset?: number; /** which half of a gradient this step is; absent for a flat bar */ part?: 'outer' | 'inner'; color: string; uniformity: number; framesSeen: number; framesMeasured: number; flat: boolean; startTime: number; endTime: number; frameIds: number[] }

export interface BuildOptions { videoAnalysisId: number; background?: readonly BarEvidence[]; corrections?: ClassCorrections }

const barBox = (b: Pick<BarEvidence, 'side' | 'size' | 'offset'>): Rect => { const o = b.offset ?? 0; return b.side === 'top' ? { x: 0, y: o, w: 1, h: b.size } : b.side === 'bottom' ? { x: 0, y: 1 - o - b.size, w: 1, h: b.size } : b.side === 'left' ? { x: o, y: 0, w: b.size, h: 1 } : { x: 1 - o - b.size, y: 0, w: b.size, h: 1 } }

// ── text tracks ──────────────────────────────────────────────────────────────────────────────────

function groupObservations(g: TextEvidenceGroup, frameIdByPath: ReadonlyMap<string, number>): TrackObservation[] {
  const frameOf = (p: string | null) => (p ? frameIdByPath.get(p) ?? null : null)
  if (g.observations.length === 0) return [{ time: g.first, frameId: frameOf(g.frame.path), shotId: g.shotId, box: g.box, text: g.text, ocrConfidence: g.confidence, evidence: { kind: 'text_element', id: g.id, certainty: 'MEASURED', note: 'The occurrence group’s own head reading.' } }]
  return g.observations.map(o => ({ time: o.timestamp, frameId: frameOf(o.framePath), shotId: g.shotId, box: o.box, text: o.text, ocrConfidence: o.confidence, evidence: { kind: 'text_observation' as const, id: o.id, certainty: 'MEASURED' as const, note: 'One OCR reading on one sampled still.' } }))
}

function intervalsFor(obs: readonly TrackObservation[], ev: TextEvidence, shots: ReadonlyMap<number, { start: number; end: number }>) {
  const byShot = new Map<number | null, number[]>()
  for (const o of obs) byShot.set(o.shotId, [...(byShot.get(o.shotId) ?? []), o.time])
  return [...byShot.entries()].flatMap(([shotId, times]) => {
    const ext = shotId !== null ? shots.get(shotId) : undefined
    return visibilityIntervals(times, ev.sampleTimes.filter(t => !ext || (t >= ext.start - 0.05 && t <= ext.end + 0.05)), shotId)
  }).sort((a, b) => a.start - b.start)
}

export function buildTextTracks(ref: VisualInput, ev: TextEvidence, frameIdByPath: ReadonlyMap<string, number>): Track[] {
  const shotExt = new Map<number, { start: number; end: number }>()
  for (const g of ev.groups) shotExt.set(g.shotId, { start: g.shotStart, end: g.shotEnd })
  const byId = new Map(ev.groups.map(g => [g.id, g] as const))
  const used = new Set<number>()
  const tracks: Track[] = []
  for (const r of [...(ref.recurring_elements ?? [])].sort((a, b) => a.id - b.id)) {
    const members = (r.member_text_element_ids ?? []).map(id => byId.get(id)).filter((g): g is TextEvidenceGroup => !!g && !used.has(g.id))
    if (members.length < 2) continue                                                              // a recurring element needs two groups we can see; otherwise its members stay single
    members.forEach(g => used.add(g.id))
    members.sort((a, b) => a.first - b.first || a.id - b.id)
    const obs = members.flatMap(g => groupObservations(g, frameIdByPath)).sort((a, b) => a.time - b.time)
    const shotIds = [...new Set(members.map(g => g.shotId))]
    tracks.push({ id: `tt:rec:${r.id}`, kind: 'text', shotIds, observations: obs, intervals: intervalsFor(obs, ev, shotExt), movement: movementOf(obs.map(o => o.box)), linkage: { by: 'recurring_element', ids: members.map(g => g.id), crossesShotBoundary: shotIds.length > 1 } })
  }
  for (const g of ev.groups) {
    if (used.has(g.id)) continue
    const obs = groupObservations(g, frameIdByPath).sort((a, b) => a.time - b.time)
    tracks.push({ id: `tt:grp:${g.id}`, kind: 'text', shotIds: [g.shotId], observations: obs, intervals: intervalsFor(obs, ev, shotExt), movement: movementOf(obs.map(o => o.box)), linkage: { by: obs.length > 1 ? 'occurrence_group' : 'single', ids: [g.id], crossesShotBoundary: false } })
  }
  return tracks.sort((a, b) => (a.intervals[0]?.start ?? 0) - (b.intervals[0]?.start ?? 0) || a.id.localeCompare(b.id))
}

// ── object tracks ────────────────────────────────────────────────────────────────────────────────

export function buildObjectTracks(ref: VisualInput, img: ImageEvidence): { track: Track; label: string; score: number | null }[] {
  const dets = new Map<number, DetectionEvidence>(img.detections.map(d => [d.id, d] as const))
  const framesByShot = new Map<number, number[]>()
  for (const f of img.frames) framesByShot.set(f.shotId, [...(framesByShot.get(f.shotId) ?? []), f.timestamp])
  const obsOf = (d: DetectionEvidence): TrackObservation => ({ time: d.timestamp, frameId: d.frameId, shotId: d.shotId, box: d.box, ocrConfidence: null, evidence: { kind: 'visual_object', id: d.id, certainty: 'MEASURED', note: `Detector label “${d.label}”${d.confidence !== null ? `, score ${d.confidence.toFixed(2)}` : ''}; a bounding box on one sampled still.` } })
  const used = new Set<number>()
  const out: { track: Track; label: string; score: number | null }[] = []
  for (const shot of ref.shots ?? []) for (const p of ((shot as unknown as { persistent_visual_elements?: PersistentLite[] }).persistent_visual_elements ?? [])) {
    const members = (p.member_visual_object_ids ?? []).map(id => dets.get(id)).filter((d): d is DetectionEvidence => !!d && d.shotId === shot.id && !used.has(d.id))   // never across a shot boundary
    if (members.length < 2) continue
    members.forEach(d => used.add(d.id))
    const obs = members.map(obsOf).sort((a, b) => a.time - b.time)
    const labels = [...new Set(members.map(d => d.label))]
    out.push({
      track: { id: `ot:pve:${p.id}`, kind: 'object', shotIds: [shot.id], observations: obs, intervals: visibilityIntervals(obs.map(o => o.time), framesByShot.get(shot.id) ?? [], shot.id), movement: movementOf(obs.map(o => o.box)),
        linkage: { by: 'persistent_visual_element', ids: [p.id], crossesShotBoundary: false } },
      label: labels.length === 1 ? labels[0] : labels.join(' / '), score: members.every(d => d.confidence !== null) ? Math.min(...members.map(d => d.confidence as number)) : null,
    })
  }
  for (const d of img.detections) {
    if (used.has(d.id)) continue
    const obs = [obsOf(d)]
    out.push({ track: { id: `ot:det:${d.id}`, kind: 'object', shotIds: [d.shotId], observations: obs, intervals: visibilityIntervals([d.timestamp], framesByShot.get(d.shotId) ?? [], d.shotId), movement: movementOf([d.box]), linkage: { by: 'single', ids: [d.id], crossesShotBoundary: false } }, label: d.label, score: d.confidence })
  }
  return out.sort((a, b) => (a.track.intervals[0]?.start ?? 0) - (b.track.intervals[0]?.start ?? 0) || a.track.id.localeCompare(b.track.id))
}

// ── assemble ─────────────────────────────────────────────────────────────────────────────────────

export function buildVisualElements(ref: VisualInput, opts: BuildOptions): VisualElement[] {
  const img = readImageEvidence(ref, opts.videoAnalysisId)
  const ev = readTextEvidence(ref, opts.videoAnalysisId)
  const frameIdByPath = new Map(img.frames.map(f => [f.path, f.id] as const))
  const videoSeconds = ev.durationSeconds ?? img.durationSeconds
  const out: VisualElement[] = []

  const textTracks = buildTextTracks(ref, ev, frameIdByPath)
  const subtitleTrackIds = findSubtitleLines(textTracks)
  for (const t of textTracks) {
    const base = classifyTextTrack(t, { videoSeconds, subtitleTrackIds })
    const cl = applyCorrection(base, opts.corrections?.[t.id])
    const bestObs = [...t.observations].sort((a, b) => (b.ocrConfidence ?? 0) - (a.ocrConfidence ?? 0))[0]
    const readings = [...new Set(t.observations.map(o => (o.text ?? '').trim()).filter(Boolean))]
    out.push({
      schema: VISUAL_ELEMENT_SCHEMA, id: t.id, first: t.intervals[0].start, last: t.intervals[t.intervals.length - 1].end, box: bestObs.box,
      text: { best: bestObs.text ?? readings[0] ?? '', readings, ocrConfidence: bestObs.ocrConfidence }, classification: cl, track: t,
      readiness: readinessOf({ classification: cl, track: t, ocrConfidence: bestObs.ocrConfidence, hasText: readings.length > 0, boxArea: bestObs.box.w * bestObs.box.h }), claims: { ...NO_CLAIMS },
    })
  }
  for (const { track: t, label, score } of buildObjectTracks(ref, img)) {
    const cl = applyCorrection(classifyObjectTrack(t, { label, detectorScore: score }), opts.corrections?.[t.id])
    out.push({
      schema: VISUAL_ELEMENT_SCHEMA, id: t.id, first: t.intervals[0].start, last: t.intervals[t.intervals.length - 1].end, box: t.observations[0].box, detectorLabel: label, classification: cl, track: t,
      readiness: readinessOf({ classification: cl, track: t, ocrConfidence: null, hasText: false, boxArea: t.observations[0].box.w * t.observations[0].box.h, objectLabel: label }), claims: { ...NO_CLAIMS },
    })
  }
  for (const b of opts.background ?? []) {
    const id = `bt:${b.sceneNumber}:${b.side}${b.part ? `:${b.part}` : ''}`
    const box = barBox(b)
    const t: Track = { id, kind: 'background', shotIds: [], observations: [{ time: b.startTime, frameId: b.frameIds[0] ?? null, shotId: null, box, ocrConfidence: null, evidence: { kind: 'background_measurement', id, certainty: 'MEASURED', note: `A ${b.side} band of ${b.color}, ${(b.size * 100).toFixed(1)}% of the frame, measured on ${b.framesSeen} of ${b.framesMeasured} stills.` } }],
      intervals: [{ start: round3(b.startTime), end: round3(b.endTime), observed: [round3(b.startTime)], kind: 'span_between_sightings', shotId: null }], movement: movementOf([box]), linkage: { by: 'single', ids: [], crossesShotBoundary: false } }
    const cl = applyCorrection(classifyBackgroundBar(t, { uniformity: b.uniformity, framesSeen: b.framesSeen, framesMeasured: b.framesMeasured, flat: b.flat }), opts.corrections?.[id])
    out.push({ schema: VISUAL_ELEMENT_SCHEMA, id, first: round3(b.startTime), last: round3(b.endTime), box, classification: cl, track: t, readiness: readinessOf({ classification: cl, track: t, ocrConfidence: null, hasText: false, boxArea: box.w * box.h, flatBackground: b.flat }), claims: { ...NO_CLAIMS } })
  }
  return out.sort((a, b) => a.first - b.first || a.id.localeCompare(b.id))
}
