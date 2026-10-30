// M2.1a -- test helpers ONLY (not imported by any product code). Builds synthetic reference analyses and pixel images.
// The shape mirrors what the real VA5368 analysis looks like (measured separately and not committed: one 9:16 shot, ~21 sample instants about 2 s apart,
// word-by-word caption reveals, a repeating creator handle, OCR confidences 0.35-1.0) -- but every string and number here is invented.
import type { RecurringElementSummary, ReferenceVideo, ShotFrameSummary, TextElementSummary, TextObservationSummary } from '../../../types'
import type { PixelImage } from './appearance'
import { buildTextCandidates, type CandidateOptions } from './candidates'
import { readTextEvidence, type ReferenceEvidenceInput } from './evidence'

export const FRAME_PATH = '/data/uploads/1/frame-a.jpg'
export const FRAME_W = 480
export const FRAME_H = 864
export const DURATION = 42.6

export interface Obs { t: number; text?: string; conf?: number; box?: [number, number, number, number]; id?: number }
export interface TextSpec { id: number; text: string; box: [number, number, number, number]; conf: number | null; obs?: Obs[]; style?: Record<string, unknown> | null; frame?: string | null }

export function textElement(s: TextSpec): TextElementSummary {
  const obs = s.obs ?? [{ t: 3 }]
  const observations: TextObservationSummary[] = obs.map((o, i) => {
    const b = o.box ?? s.box
    return { id: o.id ?? s.id * 100 + i, text: o.text ?? s.text, timestamp: o.t, x: b[0], y: b[1], width: b[2], height: b[3], confidence_score: o.conf ?? s.conf, evidence_summary: null, source_frame_asset_file_path: s.frame === undefined ? FRAME_PATH : s.frame }
  })
  const times = observations.map(o => o.timestamp)
  return {
    id: s.id, text: s.text, start_time: Math.min(...times), end_time: Math.max(...times), x: s.box[0], y: s.box[1], width: s.box[2], height: s.box[3],
    certainty: 'MEASURED', confidence_score: s.conf, category: null, style_details: s.style === undefined ? { dominant_text_color_rgb: [30, 30, 30], dominant_background_color_rgb: [160, 160, 160] } : s.style,
    evidence_summary: null, produced_by_pass: 'text_analysis_v1', source_frame_asset_file_path: s.frame === undefined ? FRAME_PATH : s.frame, observations,
  }
}

export interface RefOptions { texts: TextSpec[]; recurring?: { id: number; members: number[] }[]; duration?: number | null; frame?: [number, number] | null; shotStart?: number; shotEnd?: number }

export function reference(o: RefOptions): ReferenceEvidenceInput {
  const [fw, fh] = o.frame === undefined ? [FRAME_W, FRAME_H] : o.frame ?? [0, 0]
  const frames: ShotFrameSummary[] = fw
    ? [{ id: 1, order: 0, timestamp: 0, extraction_method: 'x', width: fw, height: fh, measurements: {}, certainty: 'MEASURED', evidence_summary: null, produced_by_pass: null, asset_file_path: FRAME_PATH }]
    : []
  const recurring: RecurringElementSummary[] = (o.recurring ?? []).map(r => ({ id: r.id, member_text_element_ids: r.members, start_time: 0, end_time: 1, certainty: 'INFERRED', confidence_score: 0.8, reasoning: null, evidence_summary: null, produced_by_pass: null }))
  const duration = o.duration === undefined ? DURATION : o.duration
  return {
    id: 5127,
    rights_status: 'unknown_third_party',
    technical_details: fw || duration ? ({ container: { duration_seconds: duration }, video: { width: fw || null, height: fh || null, duration_seconds: duration } } as unknown as ReferenceVideo['technical_details']) : null,
    shots: [{ id: 9, order: 0, start_time: o.shotStart ?? 0, end_time: o.shotEnd ?? (duration ?? 40), certainty: 'MEASURED', evidence_summary: null, produced_by_pass: null, frames, text_elements: o.texts.map(textElement) }],
    recurring_elements: recurring,
  }
}

/** A cast of invented captions covering the cases the engine has to handle. Observation instants (3, 6, 9...) are the shared sample grid. */
export const CAST: TextSpec[] = [
  { id: 1, text: 'Welcome to the show', box: [0.1, 0.75, 0.6, 0.035], conf: 0.92, obs: [{ t: 3 }, { t: 6 }] },
  { id: 2, text: 'Second line', box: [0.1, 0.8, 0.3, 0.035], conf: 0.81, obs: [{ t: 9 }] },
  { id: 3, text: 'Ki Dun', box: [0.2, 0.75, 0.2, 0.035], conf: 0.83, obs: [{ t: 12, text: 'Ki Dun', conf: 0.83 }, { t: 15, text: 'Ki Duniya Badal', conf: 0.7 }] },
  { id: 4, text: 'X', box: [0.3, 0.3, 0.05, 0.03], conf: 0.35, obs: [{ t: 18 }] },
  { id: 5, text: 'maybe a word', box: [0.1, 0.5, 0.4, 0.03], conf: 0.31, obs: [{ t: 21 }] },
  { id: 6, text: '@creator_name', box: [0.65, 0.28, 0.25, 0.03], conf: 0.9, obs: [{ t: 3 }] },
  { id: 7, text: 'Great Offer', box: [0.1, 0.1, 0.4, 0.04], conf: 0.88, obs: [{ t: 24 }, { t: 27 }] },
]

export function candidatesFor(o: Partial<RefOptions> = {}, opts: CandidateOptions = {}) {
  const ev = readTextEvidence(reference({ texts: CAST, ...o }), 5368)
  return { evidence: ev, candidates: buildTextCandidates(ev, opts) }
}

// ── pixel images ─────────────────────────────────────────────────────────────────────────────────

export type Rgb = [number, number, number]
export function image(w: number, h: number, paint: (x: number, y: number) => Rgb): PixelImage {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [r, g, b] = paint(x, y); const i = (y * w + x) * 4; data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255 }
  return { width: w, height: h, data }
}

/** A text-like region: a field of thin strokes (about `coverage` of the area) inside a box, over a background and surrounded by `ring`. */
export function textRegion(opts: { w?: number; h?: number; margin?: number; text: Rgb; box: Rgb; ring: Rgb; coverage?: number; seed?: number }) {
  const { w = 120, h = 24, margin = 10, text, box, ring, coverage = 0.3, seed = 1 } = opts
  const W = w + margin * 2, H = h + margin * 2
  let s = seed
  const rnd = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296 }
  return {
    img: image(W, H, (x, y) => {
      const inside = x >= margin && x < margin + w && y >= margin && y < margin + h
      if (!inside) return ring
      return rnd() < coverage ? text : box
    }),
    inner: { x: margin, y: margin, w, h },
  }
}
