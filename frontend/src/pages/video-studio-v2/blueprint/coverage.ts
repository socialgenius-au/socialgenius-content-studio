// Footage coverage of blueprint scenes. PURE. Shared by the export guard and the readiness panel so both use one definition of "this scene has footage".
import type { VideoClip } from '../../../types'

export interface SceneWindow { sceneNumber: number; startTime: number; endTime: number }

/** A scene counts as having footage when clips cover more than this many seconds of its window (anything smaller is rounding between two adjoining clips). */
export const FOOTAGE_TOLERANCE = 0.1

/** Seconds of [start, end) covered by at least one clip (overlapping clips are not counted twice). */
export function coveredSeconds(start: number, end: number, clips: readonly Pick<VideoClip, 'startTime' | 'endTime'>[]): number {
  const spans = clips
    .map(c => [Math.max(start, c.startTime), Math.min(end, c.endTime)] as const)
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0])
  let total = 0
  let curEnd = -Infinity
  for (const [a, b] of spans) {
    if (b <= curEnd) continue
    total += b - Math.max(a, curEnd)
    curEnd = b
  }
  return total
}

export function scenesWithoutFootage(scenes: readonly SceneWindow[], clips: readonly Pick<VideoClip, 'startTime' | 'endTime'>[]): SceneWindow[] {
  return scenes.filter(s => coveredSeconds(s.startTime, s.endTime, clips) <= FOOTAGE_TOLERANCE)
}
