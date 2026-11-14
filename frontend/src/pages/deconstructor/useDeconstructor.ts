// C5 -- data + actions for the Deconstructor workspace. All READS are side-effect free. The only calls that can invoke paid AI are
// deconstruct(), deriveMechanisms() and buildBlueprint(); the page confirms with the user before each, and buildBlueprint is only ever
// called for a deliberately NEW blueprint (an existing blueprint is displayed with GET, never re-POSTed).
import { useCallback, useEffect, useRef, useState } from 'react'
import { deconstructorApi, referenceVideosApi, uploadApi } from '../../api/client'
import type { ReferenceVideo } from '../../types'
import type { Anatomy, BlueprintResponse, DeconStatus, MechanismSet, NewContentIntent } from '../../types/deconstructor'
import { summarizeDeconStatus } from './viewModel'
import { GIVE_UP_MESSAGE, nextPoll, POLL_MS } from './pollPolicy'

export function errorMessage(e: unknown, fallback: string): string {
  const d = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  if (typeof d === 'string' && d) return d
  if (d && typeof d === 'object' && 'message' in (d as object)) return String((d as { message: unknown }).message)
  if (Array.isArray(d) && d.length) return d.map(x => (x as { msg?: string })?.msg ?? '').filter(Boolean).join('; ') || fallback
  return fallback
}

export interface Loadable<T> { data: T | null; loading: boolean; error: string | null; missing: boolean }
const idle = <T,>(): Loadable<T> => ({ data: null, loading: false, error: null, missing: false })

export function useDeconstructor(referenceVideoId: number | null) {
  const [references, setReferences] = useState<Loadable<ReferenceVideo[]>>({ ...idle(), loading: true })
  const [status, setStatus] = useState<DeconStatus | null>(null)
  const [anatomy, setAnatomy] = useState<Loadable<Anatomy>>(idle())
  const [mechanisms, setMechanisms] = useState<Loadable<MechanismSet>>(idle())
  const [blueprint, setBlueprint] = useState<Loadable<BlueprintResponse>>(idle())
  const [busy, setBusy] = useState<null | 'deconstruct' | 'mechanisms' | 'blueprint' | 'upload' | 'frames' | 'speech'>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const followRef = useRef<((id: number, startedByClick: boolean) => void) | null>(null)   // set below; lets load() resume following a run that is already in progress
  const seq = useRef(0)   // guards against a slow response for a previously selected reference overwriting the current one

  const loadReferences = useCallback(async () => {
    setReferences(r => ({ ...r, loading: true, error: null }))
    try {
      const { data } = await referenceVideosApi.list()
      setReferences({ data: data as ReferenceVideo[], loading: false, error: null, missing: false })
    } catch (e) {
      setReferences({ data: null, loading: false, error: errorMessage(e, 'Could not load your reference videos.'), missing: false })
    }
  }, [])

  const load = useCallback(async (id: number) => {
    const my = ++seq.current
    setAnatomy({ ...idle(), loading: true }); setMechanisms({ ...idle(), loading: true }); setBlueprint({ ...idle(), loading: true })
    const [st, an, me, bp] = await Promise.allSettled([
      deconstructorApi.deconstructStatus(id), deconstructorApi.anatomy(id), deconstructorApi.mechanisms(id), deconstructorApi.blueprint(id),
    ])
    if (my !== seq.current) return
    const loaded = st.status === 'fulfilled' ? (st.value.data as DeconStatus) : null
    setStatus(loaded)
    // A run that is already in progress (page reloaded or reopened while the server is still working) must be followed to the end, not shown as a frozen snapshot.
    if (loaded && summarizeDeconStatus(loaded).state === 'running') followRef.current?.(id, false)
    const pack = <T,>(r: PromiseSettledResult<{ data: unknown }>, what: string): Loadable<T> => {
      if (r.status === 'fulfilled') return { data: r.value.data as T, loading: false, error: null, missing: false }
      const code = (r.reason as { response?: { status?: number } })?.response?.status
      if (code === 404 || code === 409 || code === 422) return { data: null, loading: false, error: null, missing: true }
      return { data: null, loading: false, error: errorMessage(r.reason, `Could not load ${what}.`), missing: false }
    }
    setAnatomy(pack<Anatomy>(an, 'the content anatomy'))
    setMechanisms(pack<MechanismSet>(me, 'the mechanisms'))
    setBlueprint(pack<BlueprintResponse>(bp, 'the blueprint'))
  }, [])

  useEffect(() => { void loadReferences() }, [loadReferences])
  useEffect(() => {
    if (referenceVideoId == null) { seq.current++; setStatus(null); setAnatomy(idle()); setMechanisms(idle()); setBlueprint(idle()); return }
    void load(referenceVideoId)
  }, [referenceVideoId, load])

  // ── deconstruct (C1): POST once, then follow the status until the run settles ──
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const following = useRef(false)
  useEffect(() => () => { following.current = false; if (pollTimer.current) clearTimeout(pollTimer.current) }, [])

  const follow = useCallback((id: number, startedByClick: boolean) => {
    if (following.current) { return }                               // one follow-up loop at a time
    following.current = true
    const t0 = Date.now()
    let polls = 0
    const step = async () => {
      if (!following.current) return
      let settle = true
      try {
        const { data } = await deconstructorApi.deconstructStatus(id)
        const s = data as DeconStatus
        setStatus(s)
        polls += 1
        const decision = nextPoll({ progress: summarizeDeconStatus(s), pollsSoFar: polls, startedByClick, elapsedMs: Date.now() - t0 })
        if (decision === 'continue') { settle = false; pollTimer.current = setTimeout(() => void step(), POLL_MS) }
        else if (decision === 'give_up') setActionError(GIVE_UP_MESSAGE)
      } catch (e) {
        setActionError(errorMessage(e, 'Lost contact while checking progress.'))
      }
      if (!settle) return
      following.current = false
      setBusy(null)
      await Promise.all([load(id), loadReferences()])
    }
    void step()
  }, [load, loadReferences])
  followRef.current = follow

  const deconstruct = useCallback(async () => {
    if (referenceVideoId == null) return
    setBusy('deconstruct'); setActionError(null)
    try {
      const { data } = await deconstructorApi.deconstruct(referenceVideoId)
      setStatus(data as DeconStatus)
      follow(referenceVideoId, true)
    } catch (e) {
      setActionError(errorMessage(e, 'Could not start deconstruction.')); setBusy(null)
    }
  }, [referenceVideoId, follow])

  /** Re-reads the stored status and results; if a run is still going it is followed again. */
  const refreshStatus = useCallback(async () => {
    if (referenceVideoId == null) return
    setActionError(null)
    following.current = false
    if (pollTimer.current) clearTimeout(pollTimer.current)
    await Promise.all([load(referenceVideoId), loadReferences()])
  }, [referenceVideoId, load, loadReferences])

  /** After a new reading is added the anatomy changed, so re-read it and the (possibly now stale) mechanisms from the server. */
  const reloadAfterReading = useCallback(async (id: number) => {
    const [an, me] = await Promise.allSettled([deconstructorApi.anatomy(id), deconstructorApi.mechanisms(id)])
    if (an.status === 'fulfilled') setAnatomy({ data: an.value.data as Anatomy, loading: false, error: null, missing: false })
    if (me.status === 'fulfilled') setMechanisms({ data: me.value.data as MechanismSet, loading: false, error: null, missing: false })
  }, [])

  // PAID: an AI looks at selected keyframes. Only ever called after the page has confirmed with the user.
  const readFrames = useCallback(async () => {
    if (referenceVideoId == null) return
    setBusy('frames'); setActionError(null)
    try { await deconstructorApi.readFrames(referenceVideoId); await reloadAfterReading(referenceVideoId) }
    catch (e) { setActionError(errorMessage(e, 'Could not add the visual reading.')) } finally { setBusy(null) }
  }, [referenceVideoId, reloadAfterReading])

  // FREE: local speech model, no AI provider.
  const rereadSpeech = useCallback(async () => {
    if (referenceVideoId == null) return
    setBusy('speech'); setActionError(null)
    try { await deconstructorApi.rereadSpeech(referenceVideoId); await reloadAfterReading(referenceVideoId) }
    catch (e) { setActionError(errorMessage(e, 'Could not re-read the speech.')) } finally { setBusy(null) }
  }, [referenceVideoId, reloadAfterReading])

  const deriveMechanisms = useCallback(async () => {
    if (referenceVideoId == null) return
    setBusy('mechanisms'); setActionError(null)
    try {
      const { data } = await deconstructorApi.deriveMechanisms(referenceVideoId, anatomy.data?.provenance.fingerprint ?? null)
      setMechanisms({ data: data as MechanismSet, loading: false, error: null, missing: false })
    } catch (e) {
      setActionError(errorMessage(e, 'Could not derive mechanisms.'))
    } finally { setBusy(null) }
  }, [referenceVideoId, anatomy.data])

  const buildBlueprint = useCallback(async (intent: NewContentIntent, lessonIds: number[] = []): Promise<BlueprintResponse | null> => {
    if (referenceVideoId == null) return null
    setBusy('blueprint'); setActionError(null)
    try {
      const { data } = await deconstructorApi.buildBlueprint(referenceVideoId, {
        intent, ...(lessonIds.length ? { lesson_ids: lessonIds } : {}), video_analysis_id: mechanisms.data?.video_analysis_id ?? null,
        anatomy_fingerprint: anatomy.data?.provenance.fingerprint ?? null, mechanism_attempt_id: mechanisms.data?.provenance?.reasoning_attempt_id ?? null,
      })
      const r = data as BlueprintResponse
      setBlueprint({ data: r, loading: false, error: null, missing: false })
      return r
    } catch (e) {
      setActionError(errorMessage(e, 'Could not build the blueprint.'))
      return null
    } finally { setBusy(null) }
  }, [referenceVideoId, anatomy.data, mechanisms.data])

  // ── add a reference: existing upload + ingest endpoints ──
  const addReference = useCallback(async (file: File): Promise<number | null> => {
    setBusy('upload'); setActionError(null)
    try {
      const up = await uploadApi.upload(file)
      const assetId = (up.data as { id?: number; asset_id?: number }).id ?? (up.data as { asset_id?: number }).asset_id
      if (assetId == null) throw new Error('no asset id')
      const { data } = await referenceVideosApi.ingest(assetId)
      await loadReferences()
      return (data as ReferenceVideo).id
    } catch (e) {
      setActionError(errorMessage(e, 'Could not add that video as a reference.'))
      return null
    } finally { setBusy(null) }
  }, [loadReferences])

  const progress = summarizeDeconStatus(status)
  return { references, status, progress, anatomy, mechanisms, blueprint, busy, actionError, setActionError, deconstruct, deriveMechanisms, readFrames, rereadSpeech, buildBlueprint, addReference, refreshStatus, reload: () => (referenceVideoId != null ? load(referenceVideoId) : Promise.resolve()) }
}
