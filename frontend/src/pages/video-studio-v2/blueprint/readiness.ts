// Reconstruction readiness: what each blueprint scene still needs before the video can be exported. PURE (no React, no I/O), so the panel and the export guard
// share one definition of "this scene has footage" and cannot disagree.
import type { AudioTrack, TextOverlay, VideoClip } from '../../../types'
import { checkReconstructionExport, isUnreplacedPlaceholder } from './exportGuard'
import { coveredSeconds, FOOTAGE_TOLERANCE, type SceneWindow } from './coverage'

export type { SceneWindow }

export interface SceneReadiness {
  sceneNumber: number
  footage: 'none' | 'partial' | 'full'
  footageSeconds: number
  placeholdersLeft: number
  hasVoice: boolean
}

export interface Readiness {
  scenes: SceneReadiness[]
  scenesWithFootage: number
  placeholdersLeft: number
  /** True exactly when the export guard would let the export through: it IS the guard's verdict, so the checklist and the Export button can never disagree. */
  ready: boolean
  /** The guard's own message when not ready (what the Export button would say), else null. */
  blocker: string | null
}

type Tagged = Pick<TextOverlay, 'text' | 'blueprint'>

export function computeReadiness(
  scenes: readonly SceneWindow[],
  clips: readonly Pick<VideoClip, 'startTime' | 'endTime'>[],
  textOverlays: readonly Tagged[],
  audioTracks: readonly Pick<AudioTrack, 'startTime' | 'endTime'>[] = [],
): Readiness {
  const rows: SceneReadiness[] = scenes.map(s => {
    const len = Math.max(0, s.endTime - s.startTime)
    const cov = coveredSeconds(s.startTime, s.endTime, clips)
    return {
      sceneNumber: s.sceneNumber,
      footage: cov <= FOOTAGE_TOLERANCE ? 'none' : cov >= len - FOOTAGE_TOLERANCE ? 'full' : 'partial',
      footageSeconds: Math.round(cov * 10) / 10,
      placeholdersLeft: (textOverlays ?? []).filter(o => o.blueprint?.sectionNumber === s.sceneNumber && isUnreplacedPlaceholder(o)).length,
      hasVoice: coveredSeconds(s.startTime, s.endTime, audioTracks) > FOOTAGE_TOLERANCE,
    }
  })
  const placeholdersLeft = rows.reduce((n, r) => n + r.placeholdersLeft, 0)
  const withFootage = rows.filter(r => r.footage !== 'none').length
  const verdict = scenes.length > 0 ? checkReconstructionExport(textOverlays, clips, scenes) : { ok: false as const, message: 'This blueprint has no scenes.' }
  return { scenes: rows, scenesWithFootage: withFootage, placeholdersLeft, ready: verdict.ok, blocker: verdict.ok ? null : verdict.message }
}
