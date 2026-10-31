// M2.4a -- the one read the review panel makes: the existing reference-video endpoint (GET, no side effects), turned into frozen transition evidence or a plain-words
// problem. No analysis is started and nothing is written.
import type { ReferenceVideo } from '../../../types'
import type { BlueprintPlan } from '../../video-studio-v2/blueprint/blueprintPlan'
import { errorMessage } from '../useDeconstructor'
import { STALE_ANALYSIS_MESSAGE } from '../textlayers/loadEvidence'
import { readTransitionEvidence, type TransitionEvidence } from './evidence'

export type LoadedTransitionEvidence =
  | { kind: 'ready'; evidence: TransitionEvidence }
  | { kind: 'none'; evidence: TransitionEvidence }
  | { kind: 'error'; message: string }

export async function loadTransitionEvidence(plan: Pick<BlueprintPlan, 'referenceVideoId' | 'videoAnalysisId'>, getReference: (id: number) => Promise<ReferenceVideo>): Promise<LoadedTransitionEvidence> {
  try {
    const ref = await getReference(plan.referenceVideoId)
    if (ref.latest_analysis && ref.latest_analysis.id !== plan.videoAnalysisId) return { kind: 'error', message: STALE_ANALYSIS_MESSAGE.replace('its text no longer matches', 'its cuts no longer match') }
    const evidence = readTransitionEvidence(ref, plan.videoAnalysisId)
    return { kind: evidence.boundaries.length === 0 ? 'none' : 'ready', evidence }
  } catch (e) {
    return { kind: 'error', message: `Could not read the reference’s cuts. ${errorMessage(e, 'Please try again.')}` }
  }
}
