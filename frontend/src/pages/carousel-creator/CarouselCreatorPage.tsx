import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowLeft, Redo2, Undo2 } from 'lucide-react'
import { brandKitsApi, carouselTemplatesApi, carouselsApi } from '../../api/client'
import { withMediaToken } from '../../api/mediaAccess'
import type { PostDocument } from '../../lib/postDocument'
import { browserStorage, type KeyValueStorage } from '../../lib/carousel/storage'
import { CarouselServerError, createHttpCarouselServer, type CarouselServer, type ServerCarousel, type ServerCarouselSummary } from '../../lib/carousel/serverStore'
import { SyncEngine, discardUnsynced, planRecovery, type SyncState, type UnsyncedRecord } from '../../lib/carousel/syncEngine'
import { importAllLocal, importLocalCarousel, localCarousels, removeLocalCopy, type ImportOutcome, type LocalEntry } from '../../lib/carousel/migration'
import { applyBrandKit, detachBrandKit, kitFontFamilies, kitIdOf, kitSwatches, kitTokens, loadKitFonts, makeBrandLogo, makeBrandName, type ApplyReport, type BrandKit, type BrandKitSummary } from '../../lib/carousel/brandKit'
import { BrandTokensContext } from '../../lib/carousel/brandContext'
import { createHttpBrandKitStore, createHttpTemplateStore, type BrandKitStore, type TemplateStore } from '../../lib/carousel/assetsStore'
import { applyTemplateSlides, carouselFromTemplate, templateDocumentFrom, type InsertMode, type TemplateSummary } from '../../lib/carousel/templates'
import { themeById } from '../../lib/carousel/layouts'
import type { VideoSink } from '../../lib/carousel/videoRender'
import { cn } from '@/lib/utils'
import { editorReducer, initialState } from './editorState'
import StartScreen from './components/StartScreen'
import Filmstrip from './components/Filmstrip'
import StageCanvas from './components/StageCanvas'
import Inspector from './components/Inspector'
import LayersPanel from './components/LayersPanel'
import ExportPanel from './components/ExportPanel'
import BrandPanel from './components/BrandPanel'
import TemplatesPanel from './components/TemplatesPanel'
import BrandKitManager from './components/BrandKitManager'
import AnimatePanel from './components/AnimatePanel'
import { AuthBanner, ConflictBanner, RecoveryPrompt, SaveBadge } from './components/SyncStatus'

type PanelTab = 'edit' | 'layers' | 'brand' | 'templates' | 'animate' | 'export'

/** A carousel handed to the editor. `nonce` changes when the editor must start over from a different base (e.g. after loading the saved version). */
interface Opened { id: string; doc: PostDocument; themeId: string; activeSlideId?: string; version: number; startDirty?: boolean; nonce: number }

const messageOf = (e: unknown) => (e instanceof CarouselServerError ? e.message : e instanceof Error ? e.message : String(e))

function Editor({ opened, server, buffer, brandStore, templateStore, videoSink, onExit, onReload, onManageKits, kitsRefresh }: { opened: Opened; server: CarouselServer; buffer: KeyValueStorage | null; brandStore: BrandKitStore; templateStore: TemplateStore; videoSink?: VideoSink; onExit: () => void; onReload: (c: ServerCarousel) => void; onManageKits: () => void; kitsRefresh: number }) {
  const [state, dispatch] = useReducer((s: ReturnType<typeof initialState>, a: Parameters<typeof editorReducer>[1]) => editorReducer(s, a), undefined, () => initialState(opened.doc, opened.themeId, opened.activeSlideId))
  const [tab, setTab] = useState<PanelTab>('edit')
  const [engine, setEngine] = useState<SyncEngine | null>(null)
  const [sync, setSync] = useState<SyncState>({ status: 'clean', version: opened.version, unsaved: false, attempts: 0 })
  const [resolving, setResolving] = useState(false)
  const [snap, setSnap] = useState(true)
  const [kit, setKit] = useState<BrandKit | null>(null)
  const [kits, setKits] = useState<BrandKitSummary[] | null>(null)
  const [kitError, setKitError] = useState<string | null>(null)
  const [kitBusy, setKitBusy] = useState(false)
  const [report, setReport] = useState<ApplyReport | null>(null)
  const [missingKit, setMissingKit] = useState<number | null>(null)
  const [templates, setTemplates] = useState<TemplateSummary[] | null>(null)
  const [tplError, setTplError] = useState<string | null>(null)
  const [tplMessage, setTplMessage] = useState<string | null>(null)
  const [tplBusy, setTplBusy] = useState(false)
  const linkedKit = kitIdOf(state.doc)
  const reloadRef = useRef(onReload)
  reloadRef.current = onReload

  // One sync engine per open carousel. Cleanup sends anything still waiting (leaving the page by any route) and keeps a local safety copy if that does not finish.
  useEffect(() => {
    const e = new SyncEngine({ server, docId: opened.id, initialVersion: opened.version, buffer, onServerDocument: c => reloadRef.current(c) })
    const unsubscribe = e.subscribe(setSync)
    setEngine(e)
    return () => { unsubscribe(); e.persistNow(); void e.flush(); e.dispose() }
  }, [server, opened.id, opened.version, buffer])

  // Every change (and the open slide) goes to the engine, which saves it after a short pause, one request at a time.
  const sent = useRef<{ doc: PostDocument; themeId: string; active: string } | null>(opened.startDirty ? null : { doc: state.doc, themeId: state.themeId, active: state.activeSlideId })
  useEffect(() => {
    if (!engine) return
    const last = sent.current
    if (last && last.doc === state.doc && last.themeId === state.themeId && last.active === state.activeSlideId) return
    sent.current = { doc: state.doc, themeId: state.themeId, active: state.activeSlideId }
    engine.notifyChange({ doc: state.doc, themeId: state.themeId, activeSlideId: state.activeSlideId })
  }, [engine, state.doc, state.themeId, state.activeSlideId])

  useEffect(() => { if (sync.status === 'saved' && !sync.unsaved) dispatch({ type: 'saved' }) }, [sync.status, sync.unsaved])

  // Closing or hiding the tab: keep the local safety copy current, and warn if the server does not have everything.
  useEffect(() => {
    if (!engine) return
    const hide = () => { if (document.visibilityState === 'hidden') { engine.persistNow(); void engine.flush() } }
    const warn = (e: BeforeUnloadEvent) => { if (engine.getState().unsaved) { engine.persistNow(); e.preventDefault() } }
    document.addEventListener('visibilitychange', hide)
    window.addEventListener('beforeunload', warn)
    return () => { document.removeEventListener('visibilitychange', hide); window.removeEventListener('beforeunload', warn) }
  }, [engine])

  // Brand Kit: list the account's kits once, and load the kit this carousel is linked to (a missing or unreachable kit leaves the saved colours and fonts exactly as they are).
  useEffect(() => {
    let live = true
    brandStore.list().then(l => { if (live) setKits(l) }).catch(e => { if (live) { setKits([]); setKitError(messageOf(e)) } })
    return () => { live = false }
  }, [brandStore, kitsRefresh])
  useEffect(() => {
    if (linkedKit === null) { setKit(null); setMissingKit(null); return }
    let live = true
    brandStore.get(linkedKit).then(k => { if (live) { setKit(k); setMissingKit(null); setKitError(null) } })
      .catch(e => { if (live) { setKit(null); if (e instanceof CarouselServerError && e.kind === 'not_found') setMissingKit(linkedKit); else setKitError(messageOf(e)) } })
    return () => { live = false }
  }, [linkedKit, brandStore, kitsRefresh])
  useEffect(() => { if (kit) void loadKitFonts(kit.kit, withMediaToken) }, [kit])
  const tokens = useMemo(() => (kit ? kitTokens(kit.kit, themeById(state.themeId)) : undefined), [kit, state.themeId])

  const chooseKit = async (id: number | null) => {
    setReport(null); setKitError(null)
    if (id === null) { dispatch({ type: 'commitDoc', doc: detachBrandKit(state.doc) }); setKit(null); return }
    setKitBusy(true)
    try {
      const k = await brandStore.get(id)
      setKit(k)
      dispatch({ type: 'commitDoc', doc: { ...state.doc, revision: state.doc.revision + 1, updatedAt: new Date().toISOString(), context: { ...state.doc.context, brand: { ...state.doc.context.brand, brandKitId: String(k.id) } } } })
    } catch (e) { setKitError(messageOf(e)) } finally { setKitBusy(false) }
  }
  const applyKit = () => { if (!kit) return; const r = applyBrandKit(state.doc, kit, themeById(state.themeId)); setReport(r.report); dispatch({ type: 'commitDoc', doc: r.doc }) }

  const loadTemplates = useCallback(async () => { try { setTemplates(await templateStore.list()); setTplError(null) } catch (e) { setTemplates([]); setTplError(messageOf(e)) } }, [templateStore])
  useEffect(() => { if (tab === 'templates' && templates === null) void loadTemplates() }, [tab, templates, loadTemplates])
  const tplRun = async (fn: () => Promise<string | void>) => { setTplBusy(true); setTplError(null); setTplMessage(null); try { const m = await fn(); if (m) setTplMessage(m) } catch (e) { setTplError(messageOf(e)) } finally { setTplBusy(false) } }
  const scopeDoc = (scope: 'carousel' | 'slide') => templateDocumentFrom(state.doc, scope === 'slide' ? [state.activeSlideId] : undefined)

  const leave = async () => {
    if (engine) {
      await engine.flush()
      if (engine.getState().unsaved && !window.confirm('Some changes have not been saved to your account yet. They stay in this browser and you will be offered them back next time you open this carousel. Leave anyway?')) return
    }
    onExit()
  }
  const resolve = async (choice: 'keep-mine' | 'use-server') => { if (!engine) return; setResolving(true); try { await engine.resolveConflict(choice) } finally { setResolving(false) } }

  const page = state.doc.pages.find(p => p.id === state.activeSlideId) ?? state.doc.pages[0]
  const activeIndex = state.doc.pages.findIndex(p => p.id === page.id)
  const selected = state.selectedElementId ? page.elements.find(e => e.id === state.selectedElementId) : undefined

  const tabBtn = (id: PanelTab, label: string) => (
    <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={cn('flex-1 shrink-0 rounded px-2 py-1.5 text-sm font-medium', tab === id ? 'bg-card shadow-sm' : 'text-muted-foreground')} data-testid={`tab-${id}`}>{label}</button>
  )

  return (
    <div className="flex flex-col gap-3" data-testid="carousel-editor" data-document-id={state.doc.id}>
      <header className="flex flex-wrap items-center gap-2" data-testid="editor-header">
        <button type="button" onClick={() => void leave()} className="inline-flex h-9 items-center gap-1 rounded-md border border-border bg-card px-2.5 text-sm hover:bg-muted" data-testid="back-to-list"><ArrowLeft className="h-4 w-4" />All carousels</button>
        <input aria-label="Carousel name" className="order-last h-9 w-full min-w-0 rounded-md border border-transparent bg-transparent px-2 text-lg font-semibold hover:border-border focus:border-border focus:bg-background md:order-none md:w-auto md:flex-1" value={state.doc.title} onChange={e => dispatch({ type: 'setTitle', title: e.target.value })} data-testid="doc-title" />
        <div className="flex items-center gap-1">
          <button type="button" className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card hover:bg-muted disabled:opacity-40" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={state.past.length === 0} onClick={() => dispatch({ type: 'undo' })} data-testid="undo"><Undo2 className="h-4 w-4" /></button>
          <button type="button" className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card hover:bg-muted disabled:opacity-40" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={state.future.length === 0} onClick={() => dispatch({ type: 'redo' })} data-testid="redo"><Redo2 className="h-4 w-4" /></button>
        </div>
        <label className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-2 text-xs"><input type="checkbox" checked={snap} onChange={e => setSnap(e.target.checked)} data-testid="snap-toggle" />Snap</label>
        <SaveBadge state={sync} onRetry={engine ? () => engine.retryNow() : undefined} />
      </header>

      <BrandTokensContext.Provider value={tokens}>
      <ConflictBanner state={sync} busy={resolving} onKeepMine={() => void resolve('keep-mine')} onUseServer={() => void resolve('use-server')} />
      <AuthBanner state={sync} />
      {state.notice && <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100" data-testid="notice">{state.notice} <button type="button" className="ml-2 underline" onClick={() => dispatch({ type: 'clearNotice' })}>Dismiss</button></p>}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 xl:h-[calc(100vh-11rem)] xl:min-h-[560px] xl:grid-cols-[9.5rem_minmax(0,1fr)_21rem]">
        <div className="order-2 min-h-0 xl:order-none xl:h-full"><Filmstrip doc={state.doc} activeId={page.id} onSelect={id => dispatch({ type: 'selectSlide', id })} onAdd={layout => dispatch({ type: 'addSlide', layout })} onDuplicate={id => dispatch({ type: 'duplicateSlide', id })} onDelete={id => dispatch({ type: 'deleteSlide', id })} onMove={(id, to) => dispatch({ type: 'moveSlide', id, to })} /></div>
        <div className="order-1 flex min-h-0 flex-col xl:order-none xl:h-full"><StageCanvas doc={state.doc} pageId={page.id} selectedId={state.selectedElementId} selectedIds={state.selectedIds} snap={snap} dispatch={dispatch} /></div>
        <aside className="order-3 min-h-0 rounded-lg border border-border bg-card p-3 xl:h-full xl:overflow-y-auto" aria-label="Editor panels">
          <div role="tablist" aria-label="Panels" className="mb-3 flex gap-1 overflow-x-auto rounded-md bg-muted p-1">{tabBtn('edit', 'Edit')}{tabBtn('layers', 'Layers')}{tabBtn('brand', 'Brand')}{tabBtn('templates', 'Templates')}{tabBtn('animate', 'Animate')}{tabBtn('export', 'Export')}</div>
          {tab === 'edit' && <Inspector doc={state.doc} page={page} selected={selected} selectedIds={state.selectedIds} swatches={kit ? kitSwatches(kit.kit) : []} kitFonts={kit ? kitFontFamilies(kit.kit) : []} dispatch={dispatch} />}
          {tab === 'layers' && <LayersPanel page={page} selectedId={state.selectedElementId} selectedIds={state.selectedIds} dispatch={dispatch} />}
          {tab === 'brand' && (
            <BrandPanel kit={kit} missingKitId={missingKit} kits={kits} error={kitError} busy={kitBusy} report={report} onChooseKit={id => void chooseKit(id)} onApply={applyKit} onDetach={() => void chooseKit(null)} onManage={onManageKits}
              onAddLogo={l => dispatch({ type: 'addPrepared', element: makeBrandLogo(l) })} onAddName={n => dispatch({ type: 'addPrepared', element: makeBrandName(n, state.doc.format, themeById(state.themeId)) })} />
          )}
          {tab === 'templates' && (
            <TemplatesPanel templates={templates} error={tplError} message={tplMessage} busy={tplBusy}
              onSave={(scope, name, description) => void tplRun(async () => { await templateStore.create({ name, description, kind: scope === 'slide' ? 'layout' : 'carousel', document: scopeDoc(scope), brandKitId: linkedKit }); await loadTemplates(); return `Saved the template "${name}".` })}
              onApply={(id, mode: InsertMode) => void tplRun(async () => { const t = await templateStore.get(id); const r = applyTemplateSlides(state.doc, t, mode, state.activeSlideId); dispatch({ type: 'commitDoc', doc: r.doc, activeSlideId: r.slideIds[0] }); return r.formatDiffers ? `Added ${r.slideIds.length} slide${r.slideIds.length === 1 ? '' : 's'}. The template was made for a different shape, so check the layout.` : `Added ${r.slideIds.length} slide${r.slideIds.length === 1 ? '' : 's'} from "${t.name}".` })}
              onDuplicate={id => void tplRun(async () => { await templateStore.duplicate(id); await loadTemplates(); return 'Duplicated.' })}
              onRename={(id, name) => void tplRun(async () => { await templateStore.update(id, { name }); await loadTemplates(); return 'Renamed.' })}
              onUpdateFrom={(id, scope) => void tplRun(async () => { await templateStore.update(id, { document: scopeDoc(scope) }); await loadTemplates(); return 'Template updated.' })}
              onDelete={id => void tplRun(async () => { await templateStore.remove(id); await loadTemplates(); return 'Deleted.' })} />
          )}
          {tab === 'animate' && <AnimatePanel doc={state.doc} page={page} pageIndex={activeIndex} selected={state.selectedIds.length === 1 ? selected : undefined} dispatch={dispatch} videoSink={videoSink} />}
          {tab === 'export' && <ExportPanel doc={state.doc} activeIndex={activeIndex} />}
        </aside>
      </div>
      </BrandTokensContext.Provider>
    </div>
  )
}

export interface CarouselCreatorPageProps {
  /** Brand Kit and template storage (account-owned, server-backed). Defaults to the real APIs; tests pass in-memory stores. */
  brandStore?: BrandKitStore
  templateStore?: TemplateStore
  /** Where animated-video frames are encoded. Defaults to the server; tests pass a fake. */
  videoSink?: VideoSink
  /** Where carousels are stored. Defaults to the signed-in account's server storage; tests pass an in-memory server. */
  server?: CarouselServer
  /** Browser storage used ONLY for (a) carousels saved before accounts stored them and (b) the unsynced-edits safety copy. `null` = unavailable. */
  storage?: KeyValueStorage | null
}

export default function CarouselCreatorPage({ server: serverProp, storage: storageProp, brandStore: brandProp, templateStore: templateProp, videoSink }: CarouselCreatorPageProps = {}) {
  const [params, setParams] = useSearchParams()
  const server = useMemo(() => serverProp ?? createHttpCarouselServer(carouselsApi), [serverProp])
  const storage = useMemo(() => (storageProp === undefined ? browserStorage() : storageProp), [storageProp])
  const brandStore = useMemo(() => brandProp ?? createHttpBrandKitStore(brandKitsApi), [brandProp])
  const templateStore = useMemo(() => templateProp ?? createHttpTemplateStore(carouselTemplatesApi), [templateProp])
  const [managing, setManaging] = useState(false)
  const [kitsRefresh, setKitsRefresh] = useState(0)
  const [startKits, setStartKits] = useState<BrandKitSummary[] | null>(null)
  const [startTemplates, setStartTemplates] = useState<TemplateSummary[] | null>(null)

  const [items, setItems] = useState<ServerCarouselSummary[]>([])
  const [listState, setListState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [listError, setListError] = useState<string | undefined>()
  const [open, setOpen] = useState<Opened | null>(null)
  const [recovery, setRecovery] = useState<{ carousel: ServerCarousel; record: UnsyncedRecord; serverNewer: boolean } | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [local, setLocal] = useState<LocalEntry[]>(() => (storage ? localCarousels(storage) : []))
  const [importResults, setImportResults] = useState<Record<string, ImportOutcome>>({})
  const [importing, setImporting] = useState(false)
  const nonce = useRef(0)

  const loadList = useCallback(async () => {
    setListState('loading')
    try { setItems(await server.list()); setListState('ready'); setListError(undefined) }
    catch (e) { setListState('error'); setListError(messageOf(e)) }
  }, [server])
  useEffect(() => { void loadList() }, [loadList])
  useEffect(() => {
    let live = true
    brandStore.list().then(l => { if (live) setStartKits(l) }).catch(() => { if (live) setStartKits([]) })
    templateStore.list().then(l => { if (live) setStartTemplates(l) }).catch(() => { if (live) setStartTemplates([]) })
    return () => { live = false }
  }, [brandStore, templateStore, kitsRefresh, open])
  const refreshLocal = useCallback(() => { if (storage) setLocal(localCarousels(storage)) }, [storage])

  const openCarousel = useCallback((c: ServerCarousel, base?: Partial<Opened>) => {
    nonce.current += 1
    setOpen({ id: c.id, doc: c.document, themeId: c.themeId, activeSlideId: c.activeSlideId, version: c.version, nonce: nonce.current, ...base })
    setRecovery(null); setActionError(null); setParams({ doc: c.id }, { replace: true })
  }, [setParams])

  const openById = useCallback(async (id: string) => {
    setBusy(true); setActionError(null)
    try {
      const c = await server.get(id)
      const plan = planRecovery(storage, c)
      if (plan.kind === 'already-saved') discardUnsynced(storage, id)
      if (plan.kind === 'offer') { setRecovery({ carousel: c, record: plan.record, serverNewer: plan.serverNewer }); setParams({ doc: id }, { replace: true }); return }
      openCarousel(c)
    } catch (e) { setActionError(messageOf(e)); setParams({}, { replace: true }) }
    finally { setBusy(false) }
  }, [server, storage, openCarousel, setParams])

  // Reopen the carousel named in the address (a refresh or a shared link) once.
  const initial = useRef(params.get('doc'))
  useEffect(() => { if (initial.current) { void openById(initial.current); initial.current = null } }, [openById])

  const create = async (doc: PostDocument, themeId: string, kitId?: number | null) => {
    setBusy(true); setActionError(null)
    try {
      let toCreate = doc
      if (kitId) { const k = await brandStore.get(kitId); toCreate = applyBrandKit(doc, k, themeById(themeId)).doc }       // the new carousel starts in the chosen kit's colours and fonts
      openCarousel(await server.create(toCreate, { themeId }))
    }
    catch (e) { setActionError(`Could not create the carousel: ${messageOf(e)}`) }
    finally { setBusy(false) }
  }
  const duplicate = async (id: string) => {
    setBusy(true); setActionError(null)
    try { await server.duplicate(id); await loadList() } catch (e) { setActionError(`Could not duplicate: ${messageOf(e)}`) } finally { setBusy(false) }
  }
  const remove = async (id: string) => {
    setBusy(true); setActionError(null)
    try { await server.remove(id); discardUnsynced(storage, id); await loadList() } catch (e) { setActionError(`Could not delete: ${messageOf(e)}`) } finally { setBusy(false) }
  }
  const useTemplate = async (id: number) => {
    setBusy(true); setActionError(null)
    try { const t = await templateStore.get(id); openCarousel(await server.create(carouselFromTemplate(t), { themeId: 'forest' })) }
    catch (e) { setActionError(`Could not start from the template: ${messageOf(e)}`) } finally { setBusy(false) }
  }
  const exit = () => { setOpen(null); setParams({}, { replace: true }); void loadList() }

  const importOne = async (id: string, asCopy: boolean) => {
    if (!storage) return
    setImporting(true)
    const r = await importLocalCarousel(storage, server, id, { asCopy })
    setImportResults(prev => ({ ...prev, [id]: r })); refreshLocal(); setImporting(false); void loadList()
  }
  const importAll = async () => {
    if (!storage) return
    setImporting(true)
    const out = await importAllLocal(storage, server)
    setImportResults(prev => ({ ...prev, ...Object.fromEntries(out.map(o => [o.id, o])) })); refreshLocal(); setImporting(false); void loadList()
  }
  const removeLocal = async (id: string) => {
    if (!storage) return
    const r = await removeLocalCopy(storage, server, id)
    if (!r.ok) setActionError(r.error)
    refreshLocal()
  }

  const manager = managing ? <BrandKitManager store={brandStore} onClose={() => setManaging(false)} onChanged={() => setKitsRefresh(n => n + 1)} /> : null
  if (open) {
    return (
      <div className="space-y-3">
        {manager}
        <div hidden={managing}>
          <Editor key={`${open.id}:${open.nonce}`} opened={open} server={server} buffer={storage} brandStore={brandStore} templateStore={templateStore} videoSink={videoSink} onExit={exit} kitsRefresh={kitsRefresh} onManageKits={() => setManaging(true)}
            onReload={c => { discardUnsynced(storage, c.id); openCarousel(c) }} />
        </div>
      </div>
    )
  }
  if (managing) return <div className="space-y-3">{manager}</div>
  if (recovery) {
    return (
      <div className="space-y-3">
        <RecoveryPrompt title={recovery.carousel.title} serverNewer={recovery.serverNewer}
          onRestore={() => openCarousel(recovery.carousel, { doc: recovery.record.document, themeId: recovery.record.themeId, activeSlideId: recovery.record.activeSlideId, version: recovery.record.baseVersion, startDirty: true })}
          onDiscard={() => { discardUnsynced(storage, recovery.carousel.id); openCarousel(recovery.carousel) }} />
      </div>
    )
  }
  return (
    <div className="space-y-3">
      <StartScreen items={items} listState={listState} listError={listError} onRetryList={() => void loadList()} busy={busy} actionError={actionError}
        onOpen={id => void openById(id)} onDuplicate={id => void duplicate(id)} onDelete={id => void remove(id)} onCreate={(d, t, k) => void create(d, t, k)}
        kits={startKits} templates={startTemplates} onUseTemplate={id => void useTemplate(id)} onOpenBrandKits={() => setManaging(true)}
        local={local} importResults={importResults} importing={importing} onImportAll={() => void importAll()} onImportOne={(id, asCopy) => void importOne(id, asCopy)} onRemoveLocal={id => void removeLocal(id)} />
    </div>
  )
}
