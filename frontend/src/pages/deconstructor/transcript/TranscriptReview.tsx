// M2.5a -- container for the transcript review panel. Owns the state and the I/O; the engine makes every decision. I/O is limited to ONE read of the existing reference-video
// endpoint (GET, no side effects). Nothing here writes to the analysis, runs speech recognition, calls an AI provider, or touches the editor. Approved subtitles leave through
// `onPlan` and are saved by the existing draft save.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { referenceVideosApi } from '../../../api/client'
import type { ReferenceVideo } from '../../../types'
import type { BlueprintPlan } from '../../video-studio-v2/blueprint/blueprintPlan'
import { buildSpeechCandidates } from './candidates'
import { makeTimeMap, resolveSpeech, setAllIncluded, setSpeechCorrection, type SpeechCorrection, type SpeechCorrections, type TimeMap } from './corrections'
import type { SpeechEvidence } from './evidence'
import { loadSpeechEvidence } from './loadEvidence'
import { planSpeech, type SpeechPlan } from './materialize'
import { TranscriptReviewView, type ReviewState } from './TranscriptReviewView'

export interface TranscriptDeps { getReference: (id: number) => Promise<ReferenceVideo>; now: () => Date }
export const defaultTranscriptDeps = (): TranscriptDeps => ({ getReference: async id => (await referenceVideosApi.get(id)).data as ReferenceVideo, now: () => new Date() })

export interface TranscriptReviewProps {
  plan: BlueprintPlan
  /** Receives the approved subtitles (or null when none are approved) every time the review changes. */
  onPlan: (plan: SpeechPlan | null) => void
  deps?: Partial<TranscriptDeps>
}

export function TranscriptReview({ plan, onPlan, deps: override }: TranscriptReviewProps) {
  const deps = useMemo(() => ({ ...defaultTranscriptDeps(), ...override }), [override])
  const [evidence, setEvidence] = useState<SpeechEvidence | null>(null)
  const [state, setState] = useState<ReviewState>({ kind: 'loading' })
  const [corrections, setCorrections] = useState<SpeechCorrections>({})
  const [modeOverride, setModeOverride] = useState<TimeMap['mode'] | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    setState({ kind: 'loading' }); setEvidence(null); setCorrections({})
    void (async () => {
      const loaded = await loadSpeechEvidence(plan, deps.getReference)
      if (cancelled) return
      if (loaded.kind === 'error') { setState({ kind: 'error', message: loaded.message }); return }
      setEvidence(loaded.evidence); setState({ kind: loaded.kind })
    })()
    return () => { cancelled = true }
  }, [deps, plan.referenceVideoId, plan.videoAnalysisId])

  const timeMap = useMemo(() => makeTimeMap(evidence?.durationSeconds ?? null, plan.totalSeconds, modeOverride), [evidence, plan.totalSeconds, modeOverride])
  const candidates = useMemo(() => (evidence ? buildSpeechCandidates(evidence) : []), [evidence])
  const resolved = useMemo(() => candidates.map(c => resolveSpeech(c, corrections[c.id], timeMap)), [candidates, corrections, timeMap])
  const speechPlan = useMemo(
    () => planSpeech(candidates, corrections, {
      referenceVideoId: plan.referenceVideoId, videoAnalysisId: plan.videoAnalysisId, timeMap, scenes: plan.scenes.map(s => ({ sceneNumber: s.sceneNumber, startTime: s.startTime, endTime: s.endTime })),
      existingSubtitleIds: [], createdAt: deps.now().toISOString(),
    }),
    [candidates, corrections, timeMap, plan.scenes, plan.referenceVideoId, plan.videoAnalysisId, deps],
  )

  useEffect(() => { onPlan(speechPlan.subtitles.length > 0 ? speechPlan : null) }, [speechPlan, onPlan])
  useEffect(() => () => onPlan(null), [onPlan])                              // leaving the panel never leaves stale subtitles behind

  const onCorrect = useCallback((id: string, patch: Partial<Record<keyof SpeechCorrection, unknown>>) => setCorrections(c => setSpeechCorrection(c, id, patch)), [])
  const onIncludeAll = useCallback((include: boolean) => setCorrections(c => setAllIncluded(c, candidates.map(x => x.id), include)), [candidates])
  return <TranscriptReviewView state={state} rightsStatus={evidence?.rightsStatus ?? null} candidates={candidates} resolved={resolved} plan={speechPlan} timeMap={timeMap} onCorrect={onCorrect} onIncludeAll={onIncludeAll} onTimeMode={setModeOverride} />
}
