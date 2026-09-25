// C5 -- data + actions for the Deconstructor workspace. All READS are side-effect free. The only calls that can invoke paid AI are
// deconstruct(), deriveMechanisms() and buildBlueprint(); the page confirms with the user before each, and buildBlueprint is only ever
// called for a deliberately NEW blueprint (an existing blueprint is displayed with GET, never re-POSTed).
import { useCallback, useEffect, useRef, useState } from 'react'
import { deconstructorApi, referenceVideosApi, uploadApi } from '../../api/client'
import type { ReferenceVideo } from '../../types'
import type { Anatomy, BlueprintResponse, DeconStatus, MechanismSet, NewContentIntent } from '../../types/deconstructor'
import { summarizeDeconStatus } from './viewModel'

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
  const [busy, setBusy] = useState<null | 'deconstruct' | 'mechanisms' | 'blueprint' | 'upload'>(null)
  const [actionError, setActionError] = useState<string | null>(null)
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
    setStatus(st.status === 'fulfilled' ? (st.value.data as DeconStatus) : null)
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

  // ── deconstruct (C1): POST once, then poll the status until it settles ──
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (pollTimer.current) clearTimeout(pollTimer.current) }, [])

  const poll = useCallback(async (id: number) => {
    try {
      const { data } = await deconstructorApi.deconstructStatus(id)
      const s = data as DeconStatus
      setStatus(s)
      if (summarizeDeconStatus(s).state === 'running') { pollTimer.current = setTimeout(() => void poll(id), 3000); return }
    } catch (e) {
      setActionError(errorMessage(e, 'Lost contact while checking progress.'))
    }
    setBusy(null)
    await Promise.all([load(id), loadReferences()])
  }, [load, loadReferences])

  const deconstruct = useCallback(async () => {
    if (referenceVideoId == null) return
    setBusy('deconstruct'); setActionError(null)
    try {
      const { data } = await deconstructorApi.deconstruct(referenceVideoId)
      setStatus(data as DeconStatus)
      void poll(referenceVideoId)
    } catch (e) {
      setActionError(errorMessage(e, 'Could not start deconstruction.')); setBusy(null)
    }
  }, [referenceVideoId, poll])

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

  const buildBlueprint = useCallback(async (intent: NewContentIntent): Promise<BlueprintResponse | null> => {
    if (referenceVideoId == null) return null
    setBusy('blueprint'); setActionError(null)
    try {
      const { data } = await deconstructorApi.buildBlueprint(referenceVideoId, {
        intent, video_analysis_id: mechanisms.data?.video_analysis_id ?? null,
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
  return { references, status, progress, anatomy, mechanisms, blueprint, busy, actionError, setActionError, deconstruct, deriveMechanisms, buildBlueprint, addReference, reload: () => (referenceVideoId != null ? load(referenceVideoId) : Promise.resolve()) }
}
