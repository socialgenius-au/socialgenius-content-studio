// M2.4a -- estimate WHAT KIND of transition one measured window shows. Deterministic, transparent, and deliberately modest: three signatures only, each from numbers
// a person can read, with a confidence and the reasons in plain words. Thresholds are a first, documented baseline validated against ONE real boundary (VA5368) plus
// synthetic profiles -- provisional, in the same spirit as the OCR and detector thresholds elsewhere -- and every result is a suggestion the person confirms.
import { DEFAULT_DURATION, MAX_DURATION, MIN_DURATION, clamp, round3, type Confidence, type TransitionKind } from './contract'
import type { BoundaryEvidence } from './evidence'

export const THRESHOLDS = {
  spikeRatio: 5,            // the biggest frame-to-frame change is at least this many times the typical (median) one: a cut
  spikeRatioHigh: 10,
  spikeShareMin: 0.4,       // ... and carries at least this share of all the change in the window
  spikeShareHigh: 0.55,
  elevatedFloor: 0.03,      // a pair counts as "changing" above this difference, or 4x the window's median, whichever is larger
  elevatedFactor: 4,
  cutMaxRun: 2,             // a cut changes at most a couple of consecutive pairs
  dissolveMinRun: 3,        // a dissolve changes several consecutive pairs
  dissolveHighRun: 4,
  dipRelative: 0.6,         // brightness falls to under 40 % of its edges ...
  dipDarkMax: 30,           // ... and is genuinely dark (0-255 scale)
  dipWithBlack: 0.4,        // when a frame inside the window is flagged black, a smaller dip is enough
} as const

export interface Features {
  pairs: number
  diffMax: number
  diffMedian: number
  spikeRatio: number
  spikeShare: number
  elevatedRun: number
  elevatedCount: number
  lumMin: number
  edgeMin: number
  lumDip: number                  // how far brightness fell below the dimmer edge, 0..1
  dipInside: boolean              // the darkest sample is neither the first nor the last
  blackInside: boolean            // a sample strictly inside the window is flagged black
}

export interface Classification {
  kind: TransitionKind
  confidence: Confidence
  /** Seconds the effect seems to last; null for a hard cut. */
  durationSeconds: number | null
  reasons: string[]
  features: Features
}

export function extractFeatures(b: BoundaryEvidence): Features {
  const d = b.diff.values
  const median = Math.max(b.diff.median, 1e-4)
  const max = Math.max(...d)
  const total = d.reduce((a, v) => a + v, 0) || 1
  const threshold = Math.max(THRESHOLDS.elevatedFloor, THRESHOLDS.elevatedFactor * median)
  let run = 0, best = 0, count = 0
  for (const v of d) { if (v > threshold) { run += 1; count += 1; best = Math.max(best, run) } else run = 0 }
  const lum = b.luminance.values
  const min = Math.min(...lum)
  const argmin = lum.indexOf(min)
  const edgeMin = Math.min(lum[0], lum[lum.length - 1])
  return {
    pairs: d.length, diffMax: max, diffMedian: b.diff.median, spikeRatio: max / Math.max(median, 0.002), spikeShare: max / total, elevatedRun: best, elevatedCount: count,
    lumMin: min, edgeMin, lumDip: edgeMin > 0 ? Math.max(0, (edgeMin - min) / edgeMin) : 0, dipInside: argmin > 0 && argmin < lum.length - 1,
    blackInside: b.blackFlags.slice(1, -1).some(Boolean),
  }
}

const pct = (n: number) => `${Math.round(n * 100)} %`
const num = (n: number, digits = 3) => n.toFixed(digits)

export function classifyBoundary(b: BoundaryEvidence): Classification {
  const f = extractFeatures(b)
  const T = THRESHOLDS
  const lum = b.luminance.values

  // 1. fade through black: brightness dips to dark in the middle of the window and comes back
  const darkDip = f.dipInside && f.lumDip >= T.dipRelative && f.lumMin < T.dipDarkMax
  if ((f.blackInside && f.lumDip >= T.dipWithBlack && f.dipInside) || darkDip) {
    const dark = lum.filter(v => v <= f.edgeMin * 0.7).length
    const seconds = clamp(round3((dark + 1) / b.fps), MIN_DURATION, MAX_DURATION)
    return {
      kind: 'fade_black', confidence: f.blackInside && f.lumDip >= T.dipRelative ? 'high' : 'medium', durationSeconds: seconds, features: f,
      reasons: [`Brightness dips to ${num(f.lumMin, 1)} from about ${num(f.edgeMin, 1)} inside the window${f.blackInside ? ' and a frame inside is flagged black' : ''}.`, `The dark stretch is about ${dark} of ${lum.length} samples, so roughly ${num(seconds, 1)} s.`],
    }
  }
  // 2. hard cut: one pair changes far more than the rest and carries most of the change
  if (f.spikeRatio >= T.spikeRatio && f.elevatedRun <= T.cutMaxRun && f.spikeShare >= T.spikeShareMin) {
    const high = f.spikeRatio >= T.spikeRatioHigh && f.spikeShare >= T.spikeShareHigh
    return {
      kind: 'cut', confidence: high ? 'high' : 'medium', durationSeconds: null, features: f,
      reasons: [`One frame pair changes ${num(f.spikeRatio, 1)}× more than the typical pair (${num(f.diffMax)} against ${num(f.diffMedian)}) and carries ${pct(f.spikeShare)} of all the change in the window.`, 'The rest of the window is steady: a single abrupt change, which is what a hard cut looks like.'],
    }
  }
  // 3. dissolve: several consecutive pairs change and none of them dominates
  if (f.elevatedRun >= T.dissolveMinRun && f.spikeShare < T.spikeShareMin) {
    const seconds = clamp(round3(f.elevatedRun / b.fps), MIN_DURATION, MAX_DURATION)
    return {
      kind: 'dissolve', confidence: f.elevatedRun >= T.dissolveHighRun ? 'medium' : 'low', durationSeconds: seconds, features: f,
      reasons: [`${f.elevatedRun} consecutive frame pairs change and no single pair carries more than ${pct(f.spikeShare)} of the change: a gradual change, roughly ${num(seconds, 1)} s.`, 'Fast motion or a flash can look the same, so this is never more than a medium-confidence suggestion.'],
    }
  }
  return {
    kind: 'cut', confidence: 'low', durationSeconds: null, features: f,
    reasons: [`The window has no clear signature (largest change ${num(f.spikeRatio, 1)}× the typical pair, ${f.elevatedRun} changing pair${f.elevatedRun === 1 ? '' : 's'}), so it is treated as a hard cut.`],
  }
}

export const defaultDuration = (c: Classification) => c.durationSeconds ?? DEFAULT_DURATION
