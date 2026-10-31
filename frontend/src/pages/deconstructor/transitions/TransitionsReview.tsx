// M2.4a -- container for the transition review panel. Owns the state and the I/O; the engine makes every decision. I/O is limited to ONE read of the existing
// reference-video endpoint (GET, no side effects). Nothing here writes to the analysis, calls an AI provider, or touches the editor. Approved transitions leave through
// `onPlan` and are applied to the draft's clips by the existing draft save.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { referenceVideosApi } from '../../../api/client'
import type { ReferenceVideo } from '../../../types'
import type { BlueprintPlan } from '../../video-studio-v2/blueprint/blueprintPlan'
import { buildTransitionCandidates, sceneJoins } from './candidates'
import { makeTimeMap, resolveTransition, setTransitionCorrection, type TransitionCorrection, type TransitionCorrections, type TimeMap } from './corrections'
import type { TransitionEvidence } from './evidence'
import { loadTransitionEvidence } from './loadEvidence'
import { planTransitions, type TransitionPlan } from './materialize'
import { TransitionsReviewView, type ReviewState } from './TransitionsReviewView'

export interface TransitionsDeps { getReference: (id: number) => Promise<ReferenceVideo>; now: () => Date }
export const defaultTransitionsDeps = (): TransitionsDeps => ({ getReference: async id => (await referenceVideosApi.get(id)).data as ReferenceVideo, now: () => new Date() })

export interface TransitionsReviewProps {
  plan: BlueprintPlan
  /** Receives the approved transitions (or null when none apply) every time the review changes. */
  onPlan: (plan: TransitionPlan | null) => void
  deps?: Partial<TransitionsDeps>
}

export function TransitionsReview({ plan, onPlan, deps: override }: TransitionsReviewProps) {
  const deps = useMemo(() => ({ ...defaultTransitionsDeps(), ...override }), [override])
  const [evidence, setEvidence] = useState<TransitionEvidence | null>(null)
  const [state, setState] = useState<ReviewState>({ kind: 'loading' })
  const [corrections, setCorrections] = useState<TransitionCorrections>({})
  const [modeOverride, setModeOverride] = useState<TimeMap['mode'] | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    setState({ kind: 'loading' }); setEvidence(null); setCorrections({})
    void (async () => {
      const loaded = await loadTransitionEvidence(plan, deps.getReference)
      if (cancelled) return
      if (loaded.kind === 'error') { setState({ kind: 'error', message: loaded.message }); return }
      setEvidence(loaded.evidence); setState({ kind: loaded.kind })
    })()
    return () => { cancelled = true }
  }, [deps, plan.referenceVideoId, plan.videoAnalysisId])

  const timeMap = useMemo(() => makeTimeMap(evidence?.durationSeconds ?? null, plan.totalSeconds, modeOverride), [evidence, plan.totalSeconds, modeOverride])
  const joins = useMemo(() => sceneJoins(plan), [plan])
  const candidates = useMemo(() => (evidence ? buildTransitionCandidates(evidence, joins, timeMap) : []), [evidence, joins, timeMap])
  const resolved = useMemo(() => candidates.map(c => resolveTransition(c, corrections[c.id])), [candidates, corrections])
  const layerPlan = useMemo(
    () => planTransitions(candidates, corrections, { referenceVideoId: plan.referenceVideoId, videoAnalysisId: plan.videoAnalysisId, timeMap, createdAt: deps.now().toISOString() }),
    [candidates, corrections, timeMap, plan.referenceVideoId, plan.videoAnalysisId, deps],
  )

  useEffect(() => { onPlan(layerPlan.changes.length > 0 ? layerPlan : null) }, [layerPlan, onPlan])
  useEffect(() => () => onPlan(null), [onPlan])                              // leaving the panel never leaves stale changes behind

  const onCorrect = useCallback((id: string, patch: Partial<Record<keyof TransitionCorrection, unknown>>) => setCorrections(c => setTransitionCorrection(c, id, patch)), [])
  return <TransitionsReviewView state={state} candidates={candidates} resolved={resolved} plan={layerPlan} timeMap={timeMap} sceneCount={plan.scenes.length} onCorrect={onCorrect} onTimeMode={setModeOverride} />
}
