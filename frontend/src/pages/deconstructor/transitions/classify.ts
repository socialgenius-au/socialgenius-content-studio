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
  flashRise: 0.45,          // brightness climbs through at least this share of the headroom to white (255) above its brighter edge ...
  flashBrightMin: 150,      // ... and is genuinely bright (0-255 scale), somewhere strictly inside the window
  flashMaxSamples: 2,       // up to this many bright samples is a flash (a blink of white); more is a gradual fade through white
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
  lumMax: number
  edgeMax: number
  flashRise: number               // how far brightness climbed toward white above the brighter edge, 0..1 of the headroom
  peakInside: boolean             // the brightest sample is neither the first nor the last
  brightSamples: number           // samples above the bright threshold that sit inside the window
}

/** What the brightness did, when it climbed toward white and came back. The editor has no white transition, so this is described, never given its own kind. */
export type WhiteLook = 'flash' | 'fade_white'

export interface Classification {
  kind: TransitionKind
  /** Set when the brightness profile looks like a flash or a fade through white. `kind` is then the nearest thing the editor can do, and `reasons` say so. */
  look?: WhiteLook
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
  const max_ = Math.max(...lum), argmax = lum.indexOf(max_), edgeMax = Math.max(lum[0], lum[lum.length - 1])
  const brightLimit = Math.max(THRESHOLDS.flashBrightMin, edgeMax + 0.5 * (255 - edgeMax))
  return {
    lumMax: max_, edgeMax, flashRise: edgeMax < 255 ? Math.max(0, (max_ - edgeMax) / (255 - edgeMax)) : 0, peakInside: argmax > 0 && argmax < lum.length - 1,
    brightSamples: lum.slice(1, -1).filter(v => v >= brightLimit).length,
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
  // 1b. flash or fade through white: brightness climbs most of the way to white inside the window and comes back. The editor has no white transition, so this is DESCRIBED (`look`)
  //     and the nearest thing the editor can do is proposed: a blink of white -> a hard cut (the flash itself is not recreated); a gradual fade through white -> a dissolve.
  if (f.peakInside && f.flashRise >= T.flashRise && f.lumMax >= T.flashBrightMin && f.brightSamples >= 1) {
    const strong = f.flashRise >= 0.7
    const peak = `Brightness climbs to ${num(f.lumMax, 1)} from about ${num(f.edgeMax, 1)} inside the window, ${pct(f.flashRise)} of the way to white, and comes back.`
    const note = 'The editor has no white transition, so the original flash is not recreated; this is only the nearest transition it can do.'
    if (f.brightSamples <= T.flashMaxSamples) {
      return { kind: 'cut', look: 'flash', confidence: strong ? 'medium' : 'low', durationSeconds: null, features: f, reasons: [peak, `Only ${f.brightSamples} bright sample${f.brightSamples === 1 ? '' : 's'}: a blink of white, a flash, so a hard cut is the nearest.`, note] }
    }
    const bright = lum.filter(v => v >= f.edgeMax + 0.5 * (f.lumMax - f.edgeMax)).length
    const seconds = clamp(round3((bright + 1) / b.fps), MIN_DURATION, MAX_DURATION)
    return { kind: 'dissolve', look: 'fade_white', confidence: strong ? 'medium' : 'low', durationSeconds: seconds, features: f, reasons: [peak, `${f.brightSamples} bright samples in a row: a gradual fade through white, roughly ${num(seconds, 1)} s, so a dissolve is the nearest.`, note] }
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
