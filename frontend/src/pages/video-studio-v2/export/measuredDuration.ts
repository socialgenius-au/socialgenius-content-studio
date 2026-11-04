// Correcting a clip's RECORDED source duration from the media's own loaded metadata. `VideoClip.duration` is the length of the source file; the editor writes it when a clip is added (from the browser's
// metadata, but with a 10 s fallback when the metadata does not load in time) and a draft can carry a stale one. The dissolve window (export/dissolveWindow.ts) and speed changes both read it, so a wrong value
// shows frames the file does not have. This is the pure rule; the editor applies it on `loadedmetadata`.
//
// Only a valid measurement is ever used: a finite number above zero (and under a day). Zero, NaN, Infinity (live streams) and anything else never replace a recorded duration. A difference within TOLERANCE_S is the
// same value measured twice and is left alone. `trimOut` (how much of the file lies after the clip's end) moves by the same amount, so the clip's own span, duration - trimIn - trimOut, is exactly what it was
// and nothing on the timeline moves; it never goes below zero. startTime, endTime, trimIn and speed are never touched.
export const TOLERANCE_S = 0.02
export const MAX_DURATION_S = 86400

const round3 = (n: number) => Math.round(n * 1000) / 1000

export interface DurationFix { duration: number; trimOut: number }

export function durationCorrection(clip: { duration: number; trimOut: number }, measured: unknown): DurationFix | null {
  if (typeof measured !== 'number' || !Number.isFinite(measured) || measured <= 0 || measured > MAX_DURATION_S) return null
  const recordedValid = Number.isFinite(clip.duration) && clip.duration > 0
  if (!recordedValid) return { duration: round3(measured), trimOut: Number.isFinite(clip.trimOut) && clip.trimOut >= 0 ? clip.trimOut : 0 }
  const delta = measured - clip.duration
  if (Math.abs(delta) <= TOLERANCE_S) return null
  const trimOut = Number.isFinite(clip.trimOut) ? clip.trimOut : 0
  return { duration: round3(measured), trimOut: Math.max(0, round3(trimOut + delta)) }
}
