// M1 / Stage 2 -- container for the Footage Assignment panel. Owns the state and the I/O; the Stage-1 engine (via runAssembly) makes every assembly decision.
// Rendered inside the existing "Create" step. Nothing here calls an AI provider; the only network traffic is the existing assets, upload and drafts endpoints.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Asset, ReferenceVideo } from '../../../types'
import type { BlueprintResponse } from '../../../types/deconstructor'
import type { BlueprintPlan } from '../../video-studio-v2/blueprint/blueprintPlan'
import type { UnderfilledPolicy } from '../assembly'
import type { TextLayerPlan } from '../textlayers'
import type { ImageLayerPlan } from '../imagelayers'
import type { TransitionPlan } from '../transitions'
import type { SpeechPlan } from '../transcript'
import { openAssembledDraft, saveAssembledDraft } from './assembledDraft'
import { defaultLibraryDeps, loadVideoAssets, probeAsset, uploadFootage, type LibraryDeps } from './footageLibrary'
import {
  REQUESTED_ELEMENTS, addClip, canOpenSaved, canUseAsFootage, footageKeyFor, moveClip, newClipEdit, pickerOrder, referenceAssetIdsOf, removeClip, runAssembly, updateClip,
  type ClipEdit, type LibraryEntry, type SceneEdits,
} from './footageModel'
import { FootageAssignmentView, type SavedInfo } from './FootageAssignmentView'

/** Live validation never reaches a saved draft (the draft is stamped at save time); a constant keeps the view a pure function of the form. */
const VALIDATION_STAMP = '2000-01-01T00:00:00.000Z'

export interface FootageAssignmentProps {
  resp: BlueprintResponse | null
  plan: BlueprintPlan
  references: ReferenceVideo[] | null
  libraryDeps?: LibraryDeps
  /** M2.1a (optional): approved reconstructed text layers to save into the draft. Absent = the unchanged M1 behaviour. */
  textLayers?: TextLayerPlan | null
  /** M2.2a (optional): approved, uploaded image layers to save into the draft. Absent = the unchanged behaviour. */
  imageLayers?: ImageLayerPlan | null
  /** M2.4a (optional): approved transitions to apply to the draft's clip joins at save. Absent = the unchanged behaviour. */
  transitionPlan?: TransitionPlan | null
  /** M2.5a (optional): approved transcript subtitles (and the per-scene script) to save into the draft. Absent = the unchanged behaviour. */
  speechPlan?: SpeechPlan | null
}

export function FootageAssignment({ resp, plan, references, libraryDeps, textLayers, imageLayers, transitionPlan, speechPlan }: FootageAssignmentProps) {
  const navigate = useNavigate()
  const deps = useMemo(() => libraryDeps ?? defaultLibraryDeps(), [libraryDeps])
  const [assets, setAssets] = useState<Asset[]>([])
  const [libraryLoading, setLibraryLoading] = useState(true)
  const [libraryError, setLibraryError] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [library, setLibrary] = useState<ReadonlyMap<string, LibraryEntry>>(new Map())
  const [edits, setEdits] = useState<SceneEdits>({})
  const [underfilled, setUnderfilled] = useState<UnderfilledPolicy>('gap')
  const [saved, setSaved] = useState<{ draftId: number; name: string; clips: number; plan: BlueprintPlan; signature: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [openMessage, setOpenMessage] = useState<string | null>(null)
  const uid = useRef(0)
  const alive = useRef(true)
  const inFlight = useRef(new Set<string>())
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  const referenceIds = useMemo(() => referenceAssetIdsOf(references), [references])
  const referenceSet = useMemo(() => new Set(referenceIds), [referenceIds])
  const pickerAssets = useMemo(() => pickerOrder(assets, referenceIds), [assets, referenceIds])

  useEffect(() => {
    let cancelled = false
    void loadVideoAssets(deps).then(r => {
      if (cancelled) return
      setLibraryLoading(false)
      if (r.ok) { setAssets(r.assets); setLibraryError(null) } else setLibraryError(r.message)
    })
    return () => { cancelled = true }
  }, [deps])

  const setEntry = useCallback((e: LibraryEntry) => { if (alive.current) setLibrary(m => new Map(m).set(e.key, e)) }, [])

  /** Read an asset's real length once (a failed read can be retried). The clip is added to the scene straight away and shows "reading length…" meanwhile. */
  const ensureProbed = useCallback(async (asset: Asset) => {
    const key = footageKeyFor(asset.id)
    if (inFlight.current.has(key)) return
    inFlight.current.add(key)
    setEntry({ state: 'probing', key, assetId: asset.id, name: asset.original_filename })
    try { setEntry(await probeAsset(asset, deps)) } finally { inFlight.current.delete(key) }
  }, [deps, setEntry])

  const onAdd = (sceneNumber: number, assetId: number) => {
    const asset = assets.find(a => a.id === assetId)
    if (!asset || !canUseAsFootage(asset, referenceSet)) return                         // the picker disables reference videos; this is the second lock
    const key = footageKeyFor(asset.id)
    setEdits(e => addClip(e, sceneNumber, newClipEdit(`c${++uid.current}`, key)))
    const have = library.get(key)
    if (!have || have.state === 'failed') void ensureProbed(asset)
  }

  const onRetry = (key: string) => {
    const asset = assets.find(a => footageKeyFor(a.id) === key)
    if (asset) void ensureProbed(asset)
  }

  const onUpload = async (file: File) => {
    setUploading(true); setUploadError(null)
    try {
      const r = await uploadFootage(file, deps)
      if (!alive.current) return
      if (r.asset) setAssets(a => (a.some(x => x.id === r.asset!.id) ? a : [r.asset!, ...a]))
      if (r.ok) setEntry(r.entry); else setUploadError(r.message)
    } finally { if (alive.current) setUploading(false) }
  }

  const view = useMemo(() => runAssembly({ plan, library, edits, referenceAssetIds: referenceIds, underfilled, createdAt: VALIDATION_STAMP }), [plan, library, edits, referenceIds, underfilled])
  const signature = useMemo(() => JSON.stringify(textLayers || imageLayers || transitionPlan || speechPlan ? [edits, underfilled, ...(textLayers ? [textLayers.signature] : []), ...(imageLayers ? [`img:${imageLayers.signature}`] : []), ...(transitionPlan ? [`tr:${transitionPlan.signature}`] : []), ...(speechPlan ? [`sp:${speechPlan.signature}`] : [])] : [edits, underfilled]), [edits, underfilled, textLayers, imageLayers, transitionPlan, speechPlan])

  const onSave = async () => {
    if (!view.canSave) return
    setSaving(true); setSaveMessage(null); setOpenMessage(null)
    try {
      const r = await saveAssembledDraft({
        resp, plan, footage: view.footage, assignments: view.assignments, existingDraftId: saved?.draftId ?? null,
        options: { underfilled, referenceAssetIds: referenceIds, requestedElements: REQUESTED_ELEMENTS }, textLayers, imageLayers, transitionPlan, speechPlan,
      })
      if (!alive.current) return
      if (r.ok) setSaved({ draftId: r.draftId, name: r.name, clips: r.clips, plan: r.plan, signature })
      else setSaveMessage(r.message)
    } finally { if (alive.current) setSaving(false) }
  }

  const onOpen = () => {
    if (!saved || !canOpenSaved(saved, signature)) return
    setOpenMessage(null)
    const r = openAssembledDraft(saved.draftId, saved.plan)
    if (r.ok) navigate(r.route); else setOpenMessage(r.message)
  }

  const savedInfo: SavedInfo | null = saved ? { draftId: saved.draftId, name: saved.name, clips: saved.clips, stale: saved.signature !== signature } : null

  return (
    <FootageAssignmentView
      view={view} edits={edits} library={library} assets={pickerAssets} referenceAssetIds={referenceSet}
      libraryLoading={libraryLoading} libraryError={libraryError} uploadError={uploadError} uploading={uploading}
      underfilled={underfilled} saved={savedInfo} saving={saving} saveMessage={saveMessage} openMessage={openMessage}
      onUnderfilled={setUnderfilled} onUpload={f => void onUpload(f)} onAdd={onAdd}
      onUpdate={(s, id, patch) => setEdits(e => updateClip(e, s, id, patch as Partial<Omit<ClipEdit, 'uid'>>))}
      onRemove={(s, id) => setEdits(e => removeClip(e, s, id))} onMove={(s, id, by) => setEdits(e => moveClip(e, s, id, by))}
      onRetry={onRetry} onSave={() => void onSave()} onOpen={onOpen}
    />
  )
}
