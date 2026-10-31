// M2.2a -- container for the image-layer review panel. Owns the state and the I/O; the engine makes every decision.
// I/O is limited to: ONE read of the existing reference-video endpoint (GET, no side effects), reading reference frames the app already serves (only for a crop the
// person asked for), and -- only when the person presses "Add images to the draft" -- uploading the pictures they chose through the existing asset upload.
// Nothing here writes to the analysis, calls an AI provider, or touches the editor. Approved layers leave through `onPlan` and are saved by the existing draft save.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { assetsApi, referenceVideosApi } from '../../../api/client'
import type { ReferenceVideo } from '../../../types'
import type { BlueprintPlan } from '../../video-studio-v2/blueprint/blueprintPlan'
import { buildImageCandidates, type ManualRegion } from './candidates'
import type { Rect } from './contract'
import { makeTimeMap, resolveImageCandidate, setImageCorrection, type ImageCorrection, type ImageCorrections, type TimeMap } from './corrections'
import type { ImageEvidence } from './evidence'
import { DEFAULT_CANVAS } from './geometry'
import {
  browserDecode, browserFrameCropper, defaultUploadDeps, pickFrameCrop, pickImageFile, toImageRef, uploadChosen,
  type FrameCropper, type ImageDecoder, type PickedImage, type UploadDeps,
} from './imageFiles'
import { ImageLayersReviewView, type ReviewState } from './ImageLayersReviewView'
import { loadImageEvidence } from './loadEvidence'
import { planImageLayers, type ImageLayerPlan, type ImageRefs } from './materialize'

export interface ImageLayersDeps {
  getReference: (id: number) => Promise<ReferenceVideo>
  frameUrl: (path: string) => string
  cropper: FrameCropper
  decode: ImageDecoder
  upload: UploadDeps
  makeUrl: (b: Blob) => string
  now: () => Date
}

export const defaultImageLayersDeps = (): ImageLayersDeps => ({
  getReference: async id => (await referenceVideosApi.get(id)).data as ReferenceVideo,
  frameUrl: assetsApi.previewUrl,
  cropper: browserFrameCropper(assetsApi.previewUrl),
  decode: browserDecode,
  upload: defaultUploadDeps(),
  makeUrl: b => URL.createObjectURL(b),
  now: () => new Date(),
})

export interface ImageLayersReviewProps {
  plan: BlueprintPlan
  /** Receives the approved layers (or null when nothing is approved and uploaded) every time the review changes. */
  onPlan: (plan: ImageLayerPlan | null) => void
  deps?: Partial<ImageLayersDeps>
}

interface Uploaded { token: string; assetId: number; url: string }

export function ImageLayersReview({ plan, onPlan, deps: override }: ImageLayersReviewProps) {
  const deps = useMemo(() => ({ ...defaultImageLayersDeps(), ...override }), [override])
  const [evidence, setEvidence] = useState<ImageEvidence | null>(null)
  const [state, setState] = useState<ReviewState>({ kind: 'loading' })
  const [manual, setManual] = useState<ManualRegion[]>([])
  const [corrections, setCorrections] = useState<ImageCorrections>({})
  const [picks, setPicks] = useState<Record<string, PickedImage>>({})
  const [uploaded, setUploaded] = useState<Record<string, Uploaded>>({})
  const [modeOverride, setModeOverride] = useState<TimeMap['mode'] | undefined>(undefined)
  const [frameId, setFrameId] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const seq = useRef(0)
  const live = useRef(picks)
  live.current = picks

  useEffect(() => {
    let cancelled = false
    setState({ kind: 'loading' }); setEvidence(null); setManual([]); setCorrections({}); setPicks({}); setUploaded({}); setFrameId(null); setMessage(null)
    void (async () => {
      const loaded = await loadImageEvidence(plan, deps.getReference)
      if (cancelled) return
      if (loaded.kind === 'error') { setState({ kind: 'error', message: loaded.message }); return }
      setEvidence(loaded.evidence)
      setState({ kind: loaded.kind === 'no_frames' ? 'no_frames' : 'ready' })
    })()
    return () => { cancelled = true }
  }, [deps, plan.referenceVideoId, plan.videoAnalysisId])
  useEffect(() => () => { for (const p of Object.values(live.current)) URL.revokeObjectURL(p.previewUrl) }, [])        // pictures held in memory are released when the panel goes away

  const candidates = useMemo(() => (evidence ? buildImageCandidates(evidence, manual) : []), [evidence, manual])
  const timeMap = useMemo(() => makeTimeMap(evidence?.durationSeconds ?? null, plan.totalSeconds, modeOverride), [evidence, plan.totalSeconds, modeOverride])
  const resolved = useMemo(() => candidates.map(c => resolveImageCandidate(c, corrections[c.id], timeMap)), [candidates, corrections, timeMap])
  const images = useMemo<ImageRefs>(() => Object.fromEntries(Object.entries(picks).map(([id, p]) => {
    const u = uploaded[id]
    return [id, toImageRef(p, u && u.token === p.token ? { assetId: u.assetId, url: u.url } : undefined)]
  })), [picks, uploaded])
  const layerPlan = useMemo(
    () => planImageLayers(candidates, corrections, images, {
      referenceVideoId: plan.referenceVideoId, videoAnalysisId: plan.videoAnalysisId, timeMap, canvas: DEFAULT_CANVAS, referenceRightsStatus: evidence?.rightsStatus ?? null,
      existingOverlays: [], createdAt: deps.now().toISOString(),
    }),
    [candidates, corrections, images, timeMap, evidence, plan.referenceVideoId, plan.videoAnalysisId, deps],
  )

  useEffect(() => { onPlan(layerPlan.overlays.length > 0 ? layerPlan : null) }, [layerPlan, onPlan])
  useEffect(() => () => onPlan(null), [onPlan])                              // leaving the panel never leaves stale layers behind

  const onCorrect = useCallback((id: string, patch: Partial<Record<keyof ImageCorrection, unknown>>) => { setMessage(null); setCorrections(c => setImageCorrection(c, id, patch)) }, [])
  const drop = useCallback((id: string) => {
    setPicks(p => { if (p[id]) URL.revokeObjectURL(p[id].previewUrl); const { [id]: _gone, ...rest } = p; return rest })
    setUploaded(u => { const { [id]: _gone, ...rest } = u; return rest })
  }, [])
  const keep = useCallback((id: string, image: PickedImage) => {
    setPicks(p => { if (p[id]) URL.revokeObjectURL(p[id].previewUrl); return { ...p, [id]: image } })
    setUploaded(u => { const { [id]: _gone, ...rest } = u; return rest })          // a new choice has not been uploaded
  }, [])

  const onChooseFile = useCallback(async (id: string, file: File) => {
    setMessage(null)
    const r = await pickImageFile(file, deps.decode, deps.makeUrl)
    if (r.ok) keep(id, r.image); else setMessage(r.message)
  }, [deps, keep])
  const onCrop = useCallback(async (id: string) => {
    setMessage(null)
    const c = candidates.find(x => x.id === id)
    if (!c) return
    const region = resolveImageCandidate(c, corrections[id], timeMap).region.value
    const r = await pickFrameCrop({ id: c.frame.id, path: c.frame.path }, region, deps.cropper, deps.makeUrl)
    if (r.ok) keep(id, r.image); else setMessage(r.message)
  }, [candidates, corrections, timeMap, deps, keep])

  const onAddRegion = useCallback((fid: number, region: Rect) => {
    seq.current += 1
    setManual(m => [...m, { id: `user:${fid}:${seq.current}`, frameId: fid, region }])
  }, [])
  const onRemoveRegion = useCallback((id: string) => {
    setManual(m => m.filter(x => x.id !== id)); setCorrections(c => setImageCorrection(c, id, { include: undefined, region: undefined, start: undefined, end: undefined, rightsAcknowledged: undefined })); drop(id)
  }, [drop])

  const onApply = useCallback(async () => {
    const waiting = layerPlan.items.filter(i => i.status === 'ready_to_upload').map(i => i.candidateId)
    if (waiting.length === 0) return
    setBusy(true); setMessage(null)
    const { done, failed } = await uploadChosen(waiting, live.current, deps.upload)
    setUploaded(u => ({ ...u, ...done }))
    setBusy(false)
    if (failed.length) setMessage(`Could not add ${failed.join(', ')}. Nothing was changed for ${failed.length === 1 ? 'it' : 'them'}: try again.`)
  }, [layerPlan, deps])

  return (
    <ImageLayersReviewView
      state={state} evidence={evidence} candidates={candidates} resolved={resolved} plan={layerPlan} corrections={corrections} picks={picks} timeMap={timeMap}
      busy={busy} message={message} frameId={frameId} frameUrl={deps.frameUrl}
      onCorrect={onCorrect} onTimeMode={setModeOverride} onAddRegion={onAddRegion} onRemoveRegion={onRemoveRegion} onPickFrame={setFrameId}
      onChooseFile={(id, f) => { void onChooseFile(id, f) }} onCrop={id => { void onCrop(id) }} onClearImage={drop} onApply={() => { void onApply() }}
    />
  )
}
