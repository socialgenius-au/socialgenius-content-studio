// M2.4a -- test helpers ONLY (not imported by any product code). The VA5368 profile below is the REAL measured window of its one cut (numbers only, from the analysis);
// the other profiles are invented to show the signatures the classifier is meant to tell apart.
import type { ReferenceVideo, TransitionEvidenceSummary } from '../../../types'
import type { PlanScene } from '../../video-studio-v2/blueprint/blueprintPlan'
import { sceneJoins, type SceneJoin } from './candidates'
import { readTransitionEvidence } from './evidence'

export interface Profile { id: number; at: number; lum: number[]; diff: number[]; black?: boolean[]; fps?: number }

export function summary(p: Profile): TransitionEvidenceSummary {
  const fps = p.fps ?? 10
  const sorted = [...p.diff].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  const argmax = p.diff.indexOf(Math.max(...p.diff))
  return {
    id: p.id, boundary_timestamp: p.at, window_start: p.at - 0.5, window_end: p.at + 0.5, preceding_shot_id: 1, following_shot_id: 2, sampling_fps: fps, sample_count: p.lum.length, frame_pair_count: p.diff.length,
    sample_timestamps: p.lum.map((_, i) => p.at - 0.5 + i / fps),
    luminance: { values: p.lum, first_value: p.lum[0], last_value: p.lum[p.lum.length - 1], min: Math.min(...p.lum), max: Math.max(...p.lum), signed_total_change: p.lum[p.lum.length - 1] - p.lum[0] },
    frame_difference: { values: p.diff, median, max: Math.max(...p.diff), argmax_index: argmax }, black_frame_flags: p.black ?? p.lum.map(() => false), certainty: 'MEASURED',
  }
}

/** The one real boundary of VA5368 (39.87 s): a single pair spikes (0.155 against a median of 0.007) while brightness steps from about 52 to 13. */
export const REAL_CUT: Profile = {
  id: 7001, at: 39.866667,
  lum: [43.05694203317901, 44.01725742669753, 44.905454282407405, 51.778139467592595, 51.76814236111111, 13.488421103395062, 13.587188946759259, 14.19611786265432, 14.045763406635803, 13.68122588734568],
  diff: [0.0069113297325102884, 0.006830434141249092, 0.036900058248608085, 0.0036867775659646575, 0.15483881399782135, 0.0037273341049382717, 0.002991491542604696, 0.004608741451827644, 0.0067747575496247886],
}
export const DISSOLVE: Profile = { id: 7002, at: 10, lum: [60, 60, 60, 58, 54, 50, 47, 45, 45, 45], diff: [0.004, 0.004, 0.004, 0.05, 0.06, 0.058, 0.052, 0.004, 0.004] }
export const FADE_BLACK: Profile = { id: 7003, at: 20, lum: [58, 58, 55, 35, 9, 1, 8, 33, 54, 58], black: [false, false, false, false, false, true, false, false, false, false], diff: [0.004, 0.01, 0.06, 0.11, 0.1, 0.1, 0.1, 0.05, 0.004] }
export const SHALLOW_DIP: Profile = { id: 7004, at: 22, lum: [58, 58, 52, 44, 40, 45, 52, 58, 58, 58], diff: [0.004, 0.004, 0.05, 0.05, 0.05, 0.05, 0.004, 0.004, 0.004] }
export const FAST_MOTION: Profile = { id: 7005, at: 30, lum: [50, 50, 51, 50, 52, 50, 51, 50, 50, 50], diff: [0.02, 0.025, 0.03, 0.028, 0.026, 0.024, 0.027, 0.022, 0.02] }
export const CUT_TO_DARK: Profile = { id: 7006, at: 35, lum: [60, 60, 60, 60, 4, 3, 3, 3, 3, 3], black: [false, false, false, false, true, true, true, true, true, true], diff: [0.004, 0.004, 0.004, 0.2, 0.004, 0.004, 0.004, 0.004, 0.004] }

export const reference = (profiles: Profile[]): Pick<ReferenceVideo, 'id'> & Partial<Pick<ReferenceVideo, 'shots' | 'transition_evidence'>> => ({ id: 5127, shots: [], transition_evidence: profiles.map(summary) })
export const evidenceFor = (profiles: Profile[]) => readTransitionEvidence(reference(profiles), 5368)

/** A plan with scenes ending at the given times (the last end is the plan length). */
export const planWith = (ends: number[]): { scenes: PlanScene[]; totalSeconds: number } => {
  let start = 0
  const scenes = ends.map((end, i) => { const s = { sceneNumber: i + 1, order: i, startTime: start, endTime: end, duration: end - start } as PlanScene; start = end; return s })
  return { scenes, totalSeconds: ends[ends.length - 1] }
}
export const joinsFor = (ends: number[]): SceneJoin[] => sceneJoins(planWith(ends))
