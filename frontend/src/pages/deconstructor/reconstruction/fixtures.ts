// M5 -- deterministic FIXTURES of the M4 contract (visual-element-v1) and of the layers the existing panels generate. M5 develops and is tested against these, independent of M4's own implementation;
// the integration step then runs the real M4 output through the same validator (validate.ts) and the same plan. Test helpers only: not imported by product code.
import { NO_CLAIMS, VISUAL_ELEMENT_SCHEMA, type Classification, type EvidenceRef, type Readiness, type Track, type TrackObservation, type VisualClass, type VisualElement } from '../visual/contract'
import type { LayerLike } from './plan'

const ev = (kind: EvidenceRef['kind'], id: number | string, certainty: EvidenceRef['certainty'] = 'MEASURED'): EvidenceRef => ({ kind, id, certainty, note: 'fixture' })
const obs = (time: number, box: [number, number, number, number], text: string | undefined, frameId: number | null, evidence: EvidenceRef, conf: number | null = 0.9): TrackObservation =>
  ({ time, frameId, shotId: 1, box: { x: box[0], y: box[1], w: box[2], h: box[3] }, text, ocrConfidence: conf, evidence })

export interface ElOptions { id: string; cls: VisualClass; kind?: Track['kind']; by?: Track['linkage']['by']; ids?: number[]; text?: string; label?: string; readiness: Readiness; basis?: 'rule' | 'user'; score?: number; observations?: TrackObservation[]; reasons?: string[]; limitations?: string[] }

export function el(o: ElOptions): VisualElement {
  const observations = o.observations ?? [obs(5, [0.2, 0.3, 0.3, 0.05], o.text, 7, ev(o.kind === 'object' ? 'visual_object' : 'text_observation', 1))]
  const score = o.score ?? 0.6
  const classification: Classification = {
    class: o.cls, certainty: o.basis === 'user' ? 'OBSERVED' : 'INFERRED', basis: o.basis ?? 'rule', confidence: { level: score >= 0.75 ? 'high' : score >= 0.45 ? 'medium' : 'low', score },
    explanation: ['fixture'], evidence: [ev('text_element', o.ids?.[0] ?? 1), ...(o.by === 'recurring_element' ? [ev('recurring_element', o.id.replace(/^tt:rec:/, ''), 'INFERRED')] : [])], alternatives: [],
  }
  const track: Track = { id: o.id, kind: o.kind ?? 'text', shotIds: [1], observations, intervals: [{ start: observations[0].time, end: observations[observations.length - 1].time, observed: observations.map(x => x.time), kind: observations.length > 1 ? 'span_between_sightings' : 'single_instant', shotId: 1 }],
    movement: { kind: observations.length > 1 ? 'static' : 'single_sighting', spots: 1, spread: { x: 0, y: 0 }, notes: [] }, linkage: { by: o.by ?? 'occurrence_group', ids: o.ids ?? [1], crossesShotBoundary: false } }
  return {
    schema: VISUAL_ELEMENT_SCHEMA, id: o.id, first: track.intervals[0].start, last: track.intervals[0].end, box: observations[0].box,
    ...(o.text !== undefined ? { text: { best: o.text, readings: [o.text], ocrConfidence: 0.9 } } : {}), ...(o.label ? { detectorLabel: o.label } : {}),
    classification, track, readiness: { state: o.readiness, reasons: o.reasons ?? ['fixture'], limitations: o.limitations ?? [] }, claims: { ...NO_CLAIMS },
  }
}

export const handle = () => el({ id: 'tt:rec:2202', cls: 'TEXT_HANDLE', by: 'recurring_element', ids: [1247, 1259, 1301], text: '@creator_x', readiness: 'native_text', score: 0.66, observations: [obs(3.1, [0.688, 0.282, 0.25, 0.028], '@creator_x', 1, ev('text_observation', 124701)), obs(10, [0.11, 0.707, 0.246, 0.023], '@creator_x', 2, ev('text_observation', 125901))] })
export const caption = () => el({ id: 'tt:grp:21', cls: 'TEXT_CAPTION', ids: [21], text: 'Hello there', readiness: 'native_text', score: 0.55 })
export const person = () => el({ id: 'ot:det:101', cls: 'UNKNOWN', kind: 'object', by: 'single', ids: [101], label: 'person', readiness: 'not_reliable', score: 0, observations: [obs(5, [0.08, 0.11, 0.88, 0.71], undefined, 2, ev('visual_object', 101), null)], reasons: ['A person in the reference’s own footage is not a graphic.'] })
export const laptop = () => el({ id: 'ot:det:102', cls: 'IMAGE_REGION', kind: 'object', by: 'single', ids: [102], label: 'laptop', readiness: 'needs_user_asset', score: 0.4, observations: [obs(10, [0.6, 0.1, 0.3, 0.12], undefined, 3, ev('visual_object', 102), null)], limitations: ['Supply your own image to fill the slot.'] })
export const brandText = () => el({ id: 'tt:grp:31', cls: 'TEXT_OTHER', ids: [31], text: 'BRAND', readiness: 'native_text', score: 0.5 })
export const brandAsLogo = () => el({ id: 'tt:grp:31', cls: 'LOGO_MARK', ids: [31], text: 'BRAND', readiness: 'needs_user_asset', basis: 'user', score: 1, observations: [obs(8, [0.8, 0.05, 0.15, 0.04], 'BRAND', 4, ev('text_observation', 3101))] })
export const lowOcr = () => el({ id: 'tt:grp:41', cls: 'UNKNOWN', ids: [41], text: 'Hel', readiness: 'not_reliable', score: 0, observations: [obs(3, [0.3, 0.3, 0.2, 0.05], 'Hel', 1, ev('text_observation', 4101), 0.2)] })
export const topBar = () => el({ id: 'bt:1:top', cls: 'BACKGROUND_ELEMENT', kind: 'background', by: 'single', ids: [], readiness: 'native_shape', score: 0.78, observations: [obs(0, [0, 0, 1, 0.12], undefined, 1, ev('background_measurement', 'bt:1:top'), null)] })
export const gradientBar = () => el({ id: 'bt:2:bottom', cls: 'BACKGROUND_ELEMENT', kind: 'background', by: 'single', ids: [], readiness: 'needs_background_restoration', score: 0.3, observations: [obs(10, [0, 0.8, 1, 0.2], undefined, 5, ev('background_measurement', 'bt:2:bottom'), null)], limitations: ['A gradient is rebuilt as two flat steps at most; a texture is not rebuilt. Real restoration is out of scope and would need a separately approved design.'] })

type Prop = { basis: string }
const props = (o: Record<string, string>): Record<string, Prop> => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { basis: v }]))
export const textLayer = (id: string, groupId: number, bases: Record<string, string> = { text: 'measured', region: 'measured', startTime: 'inferred', endTime: 'inferred', fontSize: 'inferred' }, corrected: string[] = [], text = 'x'): LayerLike =>
  ({ id, text, reconstruction: { kind: 'text', candidateId: `text:${groupId}`, properties: props(bases), corrected } })
export const allMeasuredText = (id: string, groupId: number): LayerLike => textLayer(id, groupId, { text: 'measured', region: 'measured', startTime: 'measured', endTime: 'measured' })
export const imageLayer = (id: string, candidateId: string, source: 'user_upload' | 'reference_frame_crop', origin = 'inferred_region'): LayerLike =>
  ({ id, reconstruction: { kind: 'image', candidateId, origin, image: { source }, properties: props({ region: 'inferred', image: source === 'user_upload' ? 'user' : 'measured', startTime: 'inferred' }), corrected: [] } })
export const plate = (id: string, candidateId: string): LayerLike => ({ id, reconstruction: { kind: 'background', candidateId, properties: props({ color: 'measured', region: 'measured', startTime: 'inferred', endTime: 'inferred' }), corrected: [] } })
export const blueprintPlaceholder = (id: string): LayerLike => ({ id, text: 'TEXT PLACEHOLDER: scene 3 hook' })
