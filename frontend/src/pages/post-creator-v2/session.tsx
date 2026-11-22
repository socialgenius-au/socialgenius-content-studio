// Post Creator V2 - ONE editing session per open post. It owns the editor state (the same reducer the Carousel Creator uses: selection, undo/redo, layers, drags) and the ONE autosave engine
// that writes the post to the account's server storage, so every stage (Brief, Intelligence, References, Create, Review) edits the same saved document and nothing can save over another stage.
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type Dispatch, type ReactNode } from 'react'
import { withMediaToken } from '../../api/mediaAccess'
import type { PostDocument } from '../../lib/postDocument'
import type { KeyValueStorage } from '../../lib/carousel/storage'
import { CarouselServerError, type CarouselServer, type ServerCarousel } from '../../lib/carousel/serverStore'
import { SyncEngine, type SyncState } from '../../lib/carousel/syncEngine'
import { applyBrandKit, detachBrandKit, kitFontFamilies, kitIdOf, kitSwatches, kitTokens, loadKitFonts, type ApplyReport, type BrandKit, type BrandKitSummary } from '../../lib/carousel/brandKit'
import type { BrandKitStore } from '../../lib/carousel/assetsStore'
import type { LibraryStore } from '../../lib/carousel/libraryStore'
import { themeById } from '../../lib/carousel/layouts'
import type { BrandTokens } from '../../lib/postDocument'
import { editorReducer, initialState, type EditorAction } from '../carousel-creator/editorState'
import { workflowOf, withWorkflow, type PostBrief, type PostWorkflow } from './workflow'

export interface OpenedPost { id: string; doc: PostDocument; themeId: string; activeSlideId?: string; version: number; nonce: number; recovered?: boolean }

export const messageOf = (e: unknown) => (e instanceof CarouselServerError ? e.message : e instanceof Error ? e.message : String(e))

type EditorState = ReturnType<typeof initialState>

export interface PostSessionApi {
  state: EditorState
  dispatch: Dispatch<EditorAction>
  sync: SyncState
  doc: PostDocument
  workflow: PostWorkflow
  /** Replaces the workflow (brief / notes / references) and saves it with the post. Several updates in the same moment build on each other, never overwrite each other. */
  setWorkflow: (update: (w: PostWorkflow) => PostWorkflow) => void
  /** Edits brief fields (and the post's name when the title changes) in one saved step. */
  updateBrief: (patch: Partial<PostBrief>) => void
  /** Sends every change to the account now. Resolves true when nothing is left unsaved. */
  saveNow: () => Promise<boolean>
  retry: () => void
  resolveConflict: (choice: 'keep-mine' | 'use-server') => Promise<void>
  // Brand Kit (real, account-owned)
  kit: BrandKit | null
  kits: BrandKitSummary[] | null
  kitError: string | null
  kitBusy: boolean
  kitReport: ApplyReport | null
  missingKit: number | null
  chooseKit: (id: number | null) => Promise<void>
  applyKit: () => void
  tokens: BrandTokens | undefined
  swatches: ReturnType<typeof kitSwatches>
  kitFonts: string[]
  libraryStore: LibraryStore
}

const Ctx = createContext<PostSessionApi | null>(null)
export const usePostSession = (): PostSessionApi => { const v = useContext(Ctx); if (!v) throw new Error('usePostSession must be used inside <PostSessionProvider>'); return v }
/** null before a post has been started. */
export const useOptionalPostSession = (): PostSessionApi | null => useContext(Ctx)

export interface PostSessionProps {
  opened: OpenedPost
  server: CarouselServer
  buffer: KeyValueStorage | null
  brandStore: BrandKitStore
  libraryStore: LibraryStore
  /** The server holds a different version than this editor (the person chose "use the saved version"): reopen from it. */
  onReload: (c: ServerCarousel) => void
  children: ReactNode
}

export function PostSessionProvider({ opened, server, buffer, brandStore, libraryStore, onReload, children }: PostSessionProps) {
  const [state, dispatch] = useReducer((s: EditorState, a: EditorAction) => editorReducer(s, a), undefined, () => {
    const initial = initialState(opened.doc, opened.themeId, opened.activeSlideId)
    const portrait = initial.doc.pages.find(p => p.id === initial.activeSlideId)?.elements.find(e => e.type === 'image' && e.name === 'Business portrait')
    return portrait ? editorReducer(initial, { type: 'selectElement', id: portrait.id }) : initial
  })
  const [engine, setEngine] = useState<SyncEngine | null>(null)
  const [sync, setSync] = useState<SyncState>({ status: 'clean', version: opened.version, unsaved: false, attempts: 0 })
  const [kit, setKit] = useState<BrandKit | null>(null)
  const [kits, setKits] = useState<BrandKitSummary[] | null>(null)
  const [kitError, setKitError] = useState<string | null>(null)
  const [kitBusy, setKitBusy] = useState(false)
  const [kitReport, setKitReport] = useState<ApplyReport | null>(null)
  const [missingKit, setMissingKit] = useState<number | null>(null)
  const reloadRef = useRef(onReload)
  reloadRef.current = onReload
  const linkedKit = kitIdOf(state.doc)

  // One engine per open post: debounced, one request at a time, a local safety copy, conflict detection. Cleanup sends whatever is still waiting.
  useEffect(() => {
    const e = new SyncEngine({ server, docId: opened.id, initialVersion: opened.version, buffer, onServerDocument: c => reloadRef.current(c) })
    const unsubscribe = e.subscribe(setSync)
    setEngine(e)
    return () => { unsubscribe(); e.persistNow(); void e.flush(); e.dispose() }
  }, [server, opened.id, opened.version, buffer])

  const sent = useRef<{ doc: PostDocument; themeId: string; active: string } | null>(opened.recovered ? null : { doc: state.doc, themeId: state.themeId, active: state.activeSlideId })
  useEffect(() => {
    if (!engine) return
    const last = sent.current
    if (last && last.doc === state.doc && last.themeId === state.themeId && last.active === state.activeSlideId) return
    sent.current = { doc: state.doc, themeId: state.themeId, active: state.activeSlideId }
    engine.notifyChange({ doc: state.doc, themeId: state.themeId, activeSlideId: state.activeSlideId })
  }, [engine, state.doc, state.themeId, state.activeSlideId])
  useEffect(() => { if (sync.status === 'saved' && !sync.unsaved) dispatch({ type: 'saved' }) }, [sync.status, sync.unsaved])

  // Closing or hiding the tab: keep the local safety copy current and warn if the server does not have everything.
  useEffect(() => {
    if (!engine) return
    const hide = () => { if (document.visibilityState === 'hidden') { engine.persistNow(); void engine.flush() } }
    const warn = (e: BeforeUnloadEvent) => { if (engine.getState().unsaved) { engine.persistNow(); e.preventDefault() } }
    document.addEventListener('visibilitychange', hide)
    window.addEventListener('beforeunload', warn)
    return () => { document.removeEventListener('visibilitychange', hide); window.removeEventListener('beforeunload', warn) }
  }, [engine])

  useEffect(() => {
    let live = true
    brandStore.list().then(l => { if (live) setKits(l) }).catch(e => { if (live) { setKits([]); setKitError(messageOf(e)) } })
    return () => { live = false }
  }, [brandStore])
  useEffect(() => {
    if (linkedKit === null) { setKit(null); setMissingKit(null); return }
    let live = true
    brandStore.get(linkedKit).then(k => { if (live) { setKit(k); setMissingKit(null); setKitError(null) } })
      .catch(e => { if (live) { setKit(null); if (e instanceof CarouselServerError && e.kind === 'not_found') setMissingKit(linkedKit); else setKitError(messageOf(e)) } })
    return () => { live = false }
  }, [linkedKit, brandStore])
  useEffect(() => { if (kit) void loadKitFonts(kit.kit, withMediaToken) }, [kit])
  const tokens = useMemo(() => (kit ? kitTokens(kit.kit, themeById(state.themeId)) : undefined), [kit, state.themeId])

  const chooseKit = useCallback(async (id: number | null) => {
    setKitReport(null); setKitError(null)
    if (id === null) { dispatch({ type: 'commitDoc', doc: detachBrandKit(state.doc) }); setKit(null); return }
    setKitBusy(true)
    try {
      const k = await brandStore.get(id)
      setKit(k)
      dispatch({ type: 'commitDoc', doc: { ...state.doc, revision: state.doc.revision + 1, updatedAt: new Date().toISOString(), context: { ...state.doc.context, brand: { ...state.doc.context.brand, brandKitId: String(k.id) } } } })
    } catch (e) { setKitError(messageOf(e)) } finally { setKitBusy(false) }
  }, [brandStore, state.doc])
  const applyKit = useCallback(() => { if (!kit) return; const r = applyBrandKit(state.doc, kit, themeById(state.themeId)); setKitReport(r.report); dispatch({ type: 'commitDoc', doc: r.doc }) }, [kit, state.doc, state.themeId])

  const workflow = useMemo(() => workflowOf(state.doc), [state.doc])
  // Several fields can finish saving in the same moment. Each update is built on the NEWEST document (kept in a ref and updated synchronously), not on the one from the last render, so none is lost.
  const latestDoc = useRef(state.doc)
  latestDoc.current = state.doc
  const updateDoc = useCallback((fn: (d: PostDocument) => PostDocument) => { const next = fn(latestDoc.current); latestDoc.current = next; dispatch({ type: 'commitDoc', doc: next }) }, [])
  const setWorkflow = useCallback((update: (w: PostWorkflow) => PostWorkflow) => updateDoc(d => withWorkflow(d, update(workflowOf(d)))), [updateDoc])
  const updateBrief = useCallback((patch: Partial<PostBrief>) => updateDoc(d => {
    const w = workflowOf(d)
    const next = withWorkflow(d, { ...w, brief: { ...w.brief, ...patch } })
    return patch.title !== undefined ? { ...next, title: patch.title.trim().slice(0, 80) || 'Untitled post' } : next
  }), [updateDoc])
  const saveNow = useCallback(async (): Promise<boolean> => { if (!engine) return false; await engine.flush(); return !engine.getState().unsaved }, [engine])
  const resolveConflict = useCallback(async (choice: 'keep-mine' | 'use-server') => { if (engine) await engine.resolveConflict(choice) }, [engine])

  const api = useMemo<PostSessionApi>(() => ({
    state, dispatch, sync, doc: state.doc, workflow, setWorkflow, updateBrief, saveNow, retry: () => engine?.retryNow(), resolveConflict,
    kit, kits, kitError, kitBusy, kitReport, missingKit, chooseKit, applyKit, tokens, swatches: kit ? kitSwatches(kit.kit) : [], kitFonts: kit ? kitFontFamilies(kit.kit) : [], libraryStore,
  }), [state, sync, workflow, setWorkflow, updateBrief, saveNow, engine, resolveConflict, kit, kits, kitError, kitBusy, kitReport, missingKit, chooseKit, applyKit, tokens, libraryStore])

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>
}
