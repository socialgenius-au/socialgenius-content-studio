// M2.1a -- the one read the review panel makes: the existing reference-video endpoint (GET, no side effects), turned into frozen evidence or a plain-words problem.
import type { ReferenceVideo } from '../../../types'
import type { BlueprintPlan } from '../../video-studio-v2/blueprint/blueprintPlan'
import { errorMessage } from '../useDeconstructor'
import { readTextEvidence, type TextEvidence } from './evidence'

export type LoadedEvidence =
  | { kind: 'ready'; evidence: TextEvidence }
  | { kind: 'empty'; evidence: TextEvidence }
  | { kind: 'error'; message: string }

export const STALE_ANALYSIS_MESSAGE = 'The reference was analysed again after this blueprint was built, so its text no longer matches the blueprint. Build a new blueprint first.'

export async function loadEvidence(plan: Pick<BlueprintPlan, 'referenceVideoId' | 'videoAnalysisId'>, getReference: (id: number) => Promise<ReferenceVideo>): Promise<LoadedEvidence> {
  try {
    const ref = await getReference(plan.referenceVideoId)
    if (ref.latest_analysis && ref.latest_analysis.id !== plan.videoAnalysisId) return { kind: 'error', message: STALE_ANALYSIS_MESSAGE }
    const evidence = readTextEvidence(ref, plan.videoAnalysisId)
    return { kind: evidence.groups.length === 0 ? 'empty' : 'ready', evidence }
  } catch (e) {
    return { kind: 'error', message: `Could not read the reference’s text. ${errorMessage(e, 'Please try again.')}` }
  }
}
