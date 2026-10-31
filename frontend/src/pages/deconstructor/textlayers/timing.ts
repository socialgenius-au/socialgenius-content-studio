// M2.1a -- WHEN the text was on screen, and how sure we can be.
//
// What the evidence really is: OCR ran on a sparse set of sampled frames (about one every 2 s in the VA5368 analysis). A text group was READ at its
// observations' instants; between two samples nothing was looked at. So the true appear / disappear moments lie somewhere in the gaps either side.
// We place start / end in the MIDDLE of those gaps (the unbiased guess) and report the half-gap as the uncertainty. The gaps are measured against the
// instants where OCR demonstrably read something, so the reported uncertainty is an UPPER bound (a sampled frame with no text in it would only narrow it).
import { round3 } from './contract'
import type { TextEvidenceGroup } from './evidence'

export const MIN_VISIBLE_SECONDS = 0.5
/** Uncertainty above this many seconds (either side) is flagged to the person reviewing. */
export const TIMING_UNCERTAIN_SECONDS = 0.5
const EPS = 1e-6

export interface TimingEstimate {
  start: number                 // reference-video seconds (mapped onto the draft's timeline later)
  end: number
  startUncertainty: number      // +/- seconds the true appearance could differ by (upper bound)
  endUncertainty: number
  observedFirst: number         // the first / last instant the text was actually READ -- measured
  observedLast: number
  observations: number
}

export function estimateTiming(g: TextEvidenceGroup, sampleTimes: readonly number[]): TimingEstimate {
  let prev: number | undefined, next: number | undefined
  for (const t of sampleTimes) {
    if (t < g.first - EPS) prev = t
    else if (t > g.last + EPS && next === undefined) next = t
  }
  const lower = Math.min(g.first, Math.max(prev ?? g.shotStart, g.shotStart))
  const upper = Math.max(g.last, Math.min(next ?? g.shotEnd, g.shotEnd))
  const startUncertainty = (g.first - lower) / 2
  const endUncertainty = (upper - g.last) / 2
  let start = g.first - startUncertainty
  let end = g.last + endUncertainty
  if (end - start < MIN_VISIBLE_SECONDS) end = start + MIN_VISIBLE_SECONDS            // a flash shorter than this cannot be read or edited
  return {
    start: round3(Math.max(0, start)), end: round3(end), startUncertainty: round3(startUncertainty), endUncertainty: round3(endUncertainty),
    observedFirst: g.first, observedLast: g.last, observations: g.observations.length || 1,
  }
}

export const isTimingUncertain = (t: TimingEstimate) => Math.max(t.startUncertainty, t.endUncertainty) > TIMING_UNCERTAIN_SECONDS
