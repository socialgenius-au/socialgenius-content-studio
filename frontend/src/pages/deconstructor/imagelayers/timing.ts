// M2.2a -- WHEN an image slot was on screen, and how sure we can be.
//
// A region is seen at ONE sampled frame. That is a single instant: it says nothing about how long the thing stayed. The honest estimate is the one the text
// engine uses: the true appear / disappear moments lie somewhere in the gaps to the neighbouring sampled frames of the same shot, so start / end go in the
// middle of those gaps and the half-gap is the reported uncertainty. This is inferred timing, never an observed duration, and the person is asked to set it.
import { MIN_VISIBLE_SECONDS, round3 } from './contract'
import type { FrameEvidence } from './evidence'

export const TIMING_UNCERTAIN_SECONDS = 0.5
const EPS = 1e-6

export interface FrameTiming {
  start: number                 // reference-video seconds (mapped onto the draft's timeline later)
  end: number
  startUncertainty: number      // +/- seconds the true appearance could differ by (upper bound)
  endUncertainty: number
  observedAt: number            // the one instant the region was actually SEEN -- measured
  shotStart: number             // the scene it belongs to: the widest span a "whole scene" choice could mean
  shotEnd: number
}

export function estimateFrameTiming(frame: FrameEvidence, frames: readonly FrameEvidence[]): FrameTiming {
  let prev: number | undefined, next: number | undefined
  for (const f of frames) {
    if (f.shotId !== frame.shotId) continue
    if (f.timestamp < frame.timestamp - EPS) prev = f.timestamp
    else if (f.timestamp > frame.timestamp + EPS && next === undefined) next = f.timestamp
  }
  const t = frame.timestamp
  const lower = Math.min(t, Math.max(prev ?? frame.shotStart, frame.shotStart))
  const upper = Math.max(t, Math.min(next ?? frame.shotEnd, frame.shotEnd))
  const startUncertainty = (t - lower) / 2, endUncertainty = (upper - t) / 2
  const start = t - startUncertainty
  let end = t + endUncertainty
  if (end - start < MIN_VISIBLE_SECONDS) end = start + MIN_VISIBLE_SECONDS            // a flash shorter than this cannot be seen or edited
  return {
    start: round3(Math.max(0, start)), end: round3(end), startUncertainty: round3(startUncertainty), endUncertainty: round3(endUncertainty),
    observedAt: t, shotStart: frame.shotStart, shotEnd: Math.max(frame.shotEnd, frame.shotStart),
  }
}

export const isTimingUncertain = (t: FrameTiming) => Math.max(t.startUncertainty, t.endUncertainty) > TIMING_UNCERTAIN_SECONDS
