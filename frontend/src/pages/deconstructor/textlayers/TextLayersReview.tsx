// M2.1a -- container for the text-layer review panel. Owns the state and the I/O; the engine makes every decision.
// I/O is limited to: ONE read of the existing reference-video endpoint (GET, no side effects), and reading frame images the app already serves.
// Nothing here writes to the analysis, calls an AI provider, or touches the editor. Approved layers leave through `onPlan` and are saved by the existing draft save.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { assetsApi, referenceVideosApi } from '../../../api/client'
import type { ReferenceVideo } from '../../../types'
import { buildPlaceholderOverlays, type BlueprintPlan } from '../../video-studio-v2/blueprint/blueprintPlan'
import type { Appearance } from './appearance'
import { buildTextCandidates } from './candidates'
import { makeTimeMap, replaceAllBlocked, resolveCandidate, setCorrection, type Corrections, type TextCorrection, type TimeMap } from './corrections'
import type { TextEvidence } from './evidence'
import { loadEvidence } from './loadEvidence'
import { browserFrameSampler, readAppearances, type FrameSampler } from './framePixels'
import { DEFAULT_CANVAS } from './geometry'
import { planTextLayers, type TextLayerPlan } from './materialize'
import { TextLayersReviewView, type ReviewState } from './TextLayersReviewView'

export interface TextLayersDeps {
  getReference: (id: number) => Promise<ReferenceVideo>
  sampler: FrameSampler
  now: () => Date
}

export const defaultTextLayersDeps = (): TextLayersDeps => ({
  getReference: async id => (await referenceVideosApi.get(id)).data as ReferenceVideo,
  sampler: browserFrameSampler(assetsApi.previewUrl),
  now: () => new Date(),
})

export interface TextLayersReviewProps {
  plan: BlueprintPlan
  /** Receives the approved layers (or null when nothing is approved) every time the review changes. */
  onPlan: (plan: TextLayerPlan | null) => void
  deps?: Partial<TextLayersDeps>
}

export function TextLayersReview({ plan, onPlan, deps: override }: TextLayersReviewProps) {
  const deps = useMemo(() => ({ ...defaultTextLayersDeps(), ...override }), [override])
  const [evidence, setEvidence] = useState<TextEvidence | null>(null)
  const [state, setState] = useState<ReviewState>({ kind: 'loading' })
  const [appearances, setAppearances] = useState<ReadonlyMap<number, Appearance>>(new Map())
  const [readingColours, setReadingColours] = useState(false)
  const [corrections, setCorrections] = useState<Corrections>({})
  const [modeOverride, setModeOverride] = useState<TimeMap['mode'] | undefined>(undefined)
  useEffect(() => {
    let cancelled = false
    setState({ kind: 'loading' }); setEvidence(null); setAppearances(new Map()); setCorrections({})
    void (async () => {
      const loaded = await loadEvidence(plan, deps.getReference)
      if (cancelled) return
      if (loaded.kind === 'error') { setState({ kind: 'error', message: loaded.message }); return }
      setEvidence(loaded.evidence)
      setState({ kind: loaded.kind })
      if (loaded.kind === 'empty') return
      setReadingColours(true)
      try {
        const found = await readAppearances(loaded.evidence, deps.sampler, () => cancelled)
        if (!cancelled) setAppearances(found)
      } finally {
        if (!cancelled) setReadingColours(false)
      }
    })()
    return () => { cancelled = true }
  }, [deps, plan.referenceVideoId, plan.videoAnalysisId])

  const candidates = useMemo(() => (evidence ? buildTextCandidates(evidence, { appearances, canvas: DEFAULT_CANVAS }) : []), [evidence, appearances])
  const timeMap = useMemo(() => makeTimeMap(evidence?.durationSeconds ?? null, plan.totalSeconds, modeOverride), [evidence, plan.totalSeconds, modeOverride])
  const placeholders = useMemo(() => buildPlaceholderOverlays(plan), [plan])
  const resolved = useMemo(() => candidates.map(c => resolveCandidate(c, corrections[c.id], timeMap)), [candidates, corrections, timeMap])
  const layerPlan = useMemo(
    () => planTextLayers(candidates, corrections, {
      referenceVideoId: plan.referenceVideoId, videoAnalysisId: plan.videoAnalysisId, timeMap, canvas: DEFAULT_CANVAS, existingOverlays: placeholders, createdAt: deps.now().toISOString(),
    }),
    [candidates, corrections, timeMap, placeholders, plan.referenceVideoId, plan.videoAnalysisId, deps],
  )

  useEffect(() => { onPlan(layerPlan.overlays.length > 0 ? layerPlan : null) }, [layerPlan, onPlan])
  useEffect(() => () => onPlan(null), [onPlan])                              // leaving the panel never leaves stale layers behind

  const blockedIds = useMemo(() => layerPlan.items.filter(i => i.status === 'blocked_conflict').map(i => i.candidateId), [layerPlan])
  const onReplaceAllBlocked = useCallback(() => setCorrections(c => replaceAllBlocked(c, blockedIds)), [blockedIds])
  const onCorrect = useCallback((id: string, patch: Partial<Record<keyof TextCorrection, unknown>>) => setCorrections(c => setCorrection(c, id, patch)), [])

  return (
    <TextLayersReviewView
      state={state} candidates={candidates} resolved={resolved} plan={layerPlan} corrections={corrections} timeMap={timeMap}
      readingColours={readingColours} placeholdersLeft={placeholders.length - layerPlan.removePlaceholderIds.length}
      onCorrect={onCorrect} onTimeMode={setModeOverride} onReplaceAllBlocked={onReplaceAllBlocked}
    />
  )
}
