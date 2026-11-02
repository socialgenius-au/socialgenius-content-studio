// M2.3b/c -- container for the background review panel. Owns the state and the I/O; the engine makes every decision. I/O is the evidence read in loadEvidence.ts (a GET of the existing
// reference-video endpoint plus read-only loads of the stills). Approved plates and the chosen stacking policy leave through `onPlan` / `onPolicy` and are applied to the draft by the
// existing draft save. Nothing here writes to the analysis, calls an AI provider or touches the editor.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { assetsApi, referenceVideosApi } from '../../../api/client'
import type { ReferenceVideo } from '../../../types'
import type { BlueprintPlan } from '../../video-studio-v2/blueprint/blueprintPlan'
import { makeTimeMap } from '../textlayers/corrections'
import { DEFAULT_CANVAS } from '../textlayers/geometry'
import { buildPlateCandidates } from './candidates'
import { planComposition, type CompositionInput, type OrderPolicy } from './composition'
import { setPlateCorrection, type PlateCorrections } from './corrections'
import type { BackgroundEvidence } from './evidence'
import { browserPixelReader, evidenceKey, loadBackgroundEvidence, type PixelReader } from './loadEvidence'
import { planBackground, type BackgroundPlan } from './materialize'
import type { SceneFootage } from './footageReach'
import { BackgroundReviewView, type ReviewState } from './BackgroundReviewView'

export interface BackgroundDeps { getReference: (id: number) => Promise<ReferenceVideo>; readPixels: PixelReader; now: () => Date }
export const defaultBackgroundDeps = (): BackgroundDeps => ({ getReference: async id => (await referenceVideosApi.get(id)).data as ReferenceVideo, readPixels: browserPixelReader(assetsApi.previewUrl), now: () => new Date() })

export interface BackgroundReviewProps {
  plan: BlueprintPlan
  /** The layers the other reconstruction panels have approved so far, so the stacking summary reflects the real draft. */
  generated: CompositionInput
  /** What each scene's assigned clips are (size and Fit/Fill), so a plate that would cover the footage is flagged. Absent or empty = nothing known yet. */
  footage?: SceneFootage
  onPlan: (plan: BackgroundPlan | null) => void
  onPolicy: (policy: OrderPolicy) => void
  deps?: Partial<BackgroundDeps>
}

export function BackgroundReview({ plan, generated, footage, onPlan, onPolicy, deps: override }: BackgroundReviewProps) {
  const deps = useMemo(() => ({ ...defaultBackgroundDeps(), ...override }), [override])
  const [evidence, setEvidence] = useState<BackgroundEvidence | null>(null)
  const [state, setState] = useState<ReviewState>({ kind: 'loading' })
  const [corrections, setCorrections] = useState<PlateCorrections>({})
  const [policy, setPolicy] = useState<OrderPolicy>('as_generated')

  const key = evidenceKey(plan)
  useEffect(() => {
    let cancelled = false
    setState({ kind: 'loading' }); setEvidence(null); setCorrections({})
    void (async () => {
      const loaded = await loadBackgroundEvidence(plan, secs => makeTimeMap(secs, plan.totalSeconds), deps.getReference, deps.readPixels, () => cancelled)
      if (cancelled) return
      if (loaded.kind === 'error') { setState({ kind: 'error', message: loaded.message }); return }
      if (loaded.kind === 'no_frames') { setState({ kind: 'no_frames' }); return }
      setEvidence(loaded.evidence); setState({ kind: 'ready' })
    })()
    return () => { cancelled = true }
  }, [deps, key])                                                         // the ids, not the plan object: assigning footage re-renders the page and must not reload the stills or reset the review

  const candidates = useMemo(() => (evidence ? buildPlateCandidates(evidence, DEFAULT_CANVAS, footage) : []), [evidence, footage])
  const layerPlan = useMemo(
    () => planBackground(candidates, corrections, { referenceVideoId: plan.referenceVideoId, videoAnalysisId: plan.videoAnalysisId, planSeconds: plan.totalSeconds, existingShapes: [], createdAt: deps.now().toISOString() }),
    [candidates, corrections, plan.referenceVideoId, plan.videoAnalysisId, plan.totalSeconds, deps],
  )
  const composition = useMemo(() => planComposition({ ...generated, shapes: [...generated.shapes, ...layerPlan.shapes] }, policy), [generated, layerPlan, policy])

  useEffect(() => { onPlan(layerPlan.shapes.length > 0 ? layerPlan : null) }, [layerPlan, onPlan])
  useEffect(() => { onPolicy(policy) }, [policy, onPolicy])
  useEffect(() => () => { onPlan(null); onPolicy('as_generated') }, [onPlan, onPolicy])             // leaving the panel never leaves stale changes behind

  const onCorrect = useCallback((id: string, patch: { include?: boolean; color?: string; size?: number }) => setCorrections(c => setPlateCorrection(c, id, patch)), [])
  return <BackgroundReviewView state={state} evidence={evidence} candidates={candidates} corrections={corrections} plan={layerPlan} policy={policy} composition={composition} scenes={plan.scenes} footage={footage} onCorrect={onCorrect} onPolicy={setPolicy} />
}
