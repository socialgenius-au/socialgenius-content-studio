// M2.2a -- the one read the review panel makes: the existing reference-video endpoint (GET, no side effects), turned into frozen visual evidence or a
// plain-words problem. No detection is started and nothing is written.
import type { ReferenceVideo } from '../../../types'
import type { BlueprintPlan } from '../../video-studio-v2/blueprint/blueprintPlan'
import { errorMessage } from '../useDeconstructor'
import { STALE_ANALYSIS_MESSAGE } from '../textlayers/loadEvidence'
import { readImageEvidence, type ImageEvidence } from './evidence'

export type LoadedImageEvidence =
  | { kind: 'ready'; evidence: ImageEvidence }
  | { kind: 'no_frames'; evidence: ImageEvidence }
  | { kind: 'error'; message: string }

export async function loadImageEvidence(plan: Pick<BlueprintPlan, 'referenceVideoId' | 'videoAnalysisId'>, getReference: (id: number) => Promise<ReferenceVideo>): Promise<LoadedImageEvidence> {
  try {
    const ref = await getReference(plan.referenceVideoId)
    if (ref.latest_analysis && ref.latest_analysis.id !== plan.videoAnalysisId) return { kind: 'error', message: STALE_ANALYSIS_MESSAGE.replace('its text no longer matches', 'its frames no longer match') }
    const evidence = readImageEvidence(ref, plan.videoAnalysisId)
    return { kind: evidence.frames.length === 0 ? 'no_frames' : 'ready', evidence }
  } catch (e) {
    return { kind: 'error', message: `Could not read the reference’s frames. ${errorMessage(e, 'Please try again.')}` }
  }
}
