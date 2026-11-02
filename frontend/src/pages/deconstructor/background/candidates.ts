// M2.3b -- candidates: one per measured bar per scene. Pure. A candidate says what was measured and whether it is safe to include by default; it never decides for the person.
import { ASPECT_TOLERANCE, DEFAULT_UNIFORMITY, MIN_PLATE, deepFreeze, type BackgroundFlag, type Side, type VarianceClass } from './contract'
import type { BackgroundEvidence } from './evidence'
import type { PaletteEntry } from './measure'
import { plateReach, REACH_THRESHOLD, type SceneFootage } from './footageReach'

export interface PlateCandidate {
  id: string                                    // "bg:<scene>:<side>"
  sceneNumber: number
  side: Side
  startTime: number                             // the scene's span on the draft's timeline
  endTime: number
  size: number                                  // share of the frame's height (top/bottom) or width (left/right), 0..1
  color: string                                 // measured, "#rrggbb"
  uniformity: number
  framesSeen: number
  framesMeasured: number
  frameIds: number[]
  variance: VarianceClass | null
  palette: PaletteEntry[]
  includeByDefault: boolean
  flags: BackgroundFlag[]
}

export const candidateId = (sceneNumber: number, side: Side) => `bg:${sceneNumber}:${side}`

/** What to say about a plate of this size and the footage in its scene (null when the footage is known not to reach it). Used for the measured size and again for a size the person sets. */
export function reachFlag(side: Side, size: number, uses: Parameters<typeof plateReach>[2], canvas: { width: number; height: number }): BackgroundFlag | null {
  const reach = plateReach(side, size, uses, canvas)
  if (reach.kind === 'no_footage') return { code: 'no_footage_yet', severity: 'info', message: 'No footage is assigned to this scene yet, so it is not known whether your footage reaches this bar.' }
  if (reach.kind === 'unknown') return { code: 'footage_size_unknown', severity: 'info', message: 'The size of the footage assigned to this scene could not be read, so it is not known whether it reaches this bar.' }
  if (reach.share > REACH_THRESHOLD) return { code: 'footage_overlap', severity: 'warning', message: `Your footage in this scene reaches ${Math.round(reach.share * 100)}% of this bar: a plate here would cover it.` }
  return null
}

export function buildPlateCandidates(evidence: BackgroundEvidence, canvas: { width: number; height: number }, footage?: SceneFootage): PlateCandidate[] {
  const out: PlateCandidate[] = []
  const fs = evidence.frameSize
  const aspectDiffers = !!fs && Math.abs(fs.width / fs.height - canvas.width / canvas.height) / (canvas.width / canvas.height) > ASPECT_TOLERANCE
  for (const s of evidence.scenes) {
    for (const b of s.bars) {
      const flags: BackgroundFlag[] = []
      if (b.framesSeen === 1) flags.push({ code: 'single_frame', severity: 'info', message: 'Seen on one still only.' })
      if (b.framesSeen < s.framesMeasured) flags.push({ code: 'seen_in_some_frames', severity: 'warning', message: `Seen on ${b.framesSeen} of ${s.framesMeasured} stills of this scene.` })
      if (aspectDiffers) flags.push({ code: 'aspect_differs', severity: 'warning', message: 'The reference and your canvas have different proportions, so the bar’s size would not carry over.' })
      if (!fs) flags.push({ code: 'frame_size_unknown', severity: 'info', message: 'The reference’s frame size is unknown; its proportions could not be compared with your canvas.' })
      if (b.size < MIN_PLATE) flags.push({ code: 'thin', severity: 'info', message: 'A very thin band.' })
      if (b.uniformity < DEFAULT_UNIFORMITY) flags.push({ code: 'not_uniform', severity: 'warning', message: 'The band is not perfectly flat.' })
      // Plates are drawn ABOVE the footage: where the user's own footage would be under the plate, the plate would hide it.
      const rf = reachFlag(b.side, b.size, footage?.[s.sceneNumber], canvas)
      if (rf) flags.push(rf)
      const covers = rf?.code === 'footage_overlap'
      const includeByDefault = b.uniformity >= DEFAULT_UNIFORMITY && b.framesSeen === s.framesMeasured && b.size >= MIN_PLATE && !aspectDiffers && !covers
      out.push({
        id: candidateId(s.sceneNumber, b.side), sceneNumber: s.sceneNumber, side: b.side, startTime: s.startTime, endTime: s.endTime, size: b.size, color: b.color,
        uniformity: b.uniformity, framesSeen: b.framesSeen, framesMeasured: s.framesMeasured, frameIds: b.frameIds, variance: s.variance, palette: s.palette, includeByDefault, flags,
      })
    }
  }
  return deepFreeze(out)
}
