// M2.5a -- the one read the review panel makes: the existing reference-video endpoint (GET, no side effects), turned into frozen transcript evidence or a plain-words problem.
// No speech recognition is started and nothing is written.
import type { ReferenceVideo } from '../../../types'
import type { BlueprintPlan } from '../../video-studio-v2/blueprint/blueprintPlan'
import { errorMessage } from '../useDeconstructor'
import { STALE_ANALYSIS_MESSAGE } from '../textlayers/loadEvidence'
import { readSpeechEvidence, type SpeechEvidence } from './evidence'

export type LoadedSpeechEvidence =
  | { kind: 'ready'; evidence: SpeechEvidence }
  | { kind: 'none'; evidence: SpeechEvidence }
  | { kind: 'error'; message: string }

export async function loadSpeechEvidence(plan: Pick<BlueprintPlan, 'referenceVideoId' | 'videoAnalysisId'>, getReference: (id: number) => Promise<ReferenceVideo>): Promise<LoadedSpeechEvidence> {
  try {
    const ref = await getReference(plan.referenceVideoId)
    if (ref.latest_analysis && ref.latest_analysis.id !== plan.videoAnalysisId) return { kind: 'error', message: STALE_ANALYSIS_MESSAGE.replace('its text no longer matches', 'its transcript no longer matches') }
    const evidence = readSpeechEvidence(ref, plan.videoAnalysisId)
    return { kind: evidence.segments.length === 0 ? 'none' : 'ready', evidence }
  } catch (e) {
    return { kind: 'error', message: `Could not read the reference’s transcript. ${errorMessage(e, 'Please try again.')}` }
  }
}
