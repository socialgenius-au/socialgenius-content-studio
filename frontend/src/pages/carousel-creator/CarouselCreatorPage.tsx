import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowLeft, Redo2, Undo2 } from 'lucide-react'
import { stripMediaToken } from '../../api/mediaAccess'
import type { PostDocument } from '../../lib/postDocument'
import { browserStorage, deleteCarousel, listCarousels, loadCarousel, saveCarousel, type CarouselSummary, type KeyValueStorage } from '../../lib/carousel/storage'
import { cn } from '@/lib/utils'
import { editorReducer, initialState } from './editorState'
import StartScreen from './components/StartScreen'
import Filmstrip from './components/Filmstrip'
import StageCanvas from './components/StageCanvas'
import Inspector from './components/Inspector'
import LayersPanel from './components/LayersPanel'
import ExportPanel from './components/ExportPanel'

type PanelTab = 'edit' | 'layers' | 'export'
type SaveStatus = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved'; at: string } | { kind: 'error'; text: string } | { kind: 'unavailable' }

const AUTOSAVE_MS = 500

function Editor({ initialDoc, themeId, activeSlideId, storage, onExit }: { initialDoc: PostDocument; themeId: string; activeSlideId?: string; storage: KeyValueStorage | null; onExit: () => void }) {
  const [state, dispatch] = useReducer((s: ReturnType<typeof initialState>, a: Parameters<typeof editorReducer>[1]) => editorReducer(s, a), undefined, () => initialState(initialDoc, themeId, activeSlideId))
  const [tab, setTab] = useState<PanelTab>('edit')
  const [save, setSave] = useState<SaveStatus>(storage ? { kind: 'idle' } : { kind: 'unavailable' })
  const lastSavedActive = useRef(state.activeSlideId)

  // Autosave: every change (and the open slide) is written after a short pause, so each slide's content persists as it is edited.
  useEffect(() => {
    if (!storage) return
    const activeChanged = lastSavedActive.current !== state.activeSlideId
    if (!state.dirty && !activeChanged) return
    setSave({ kind: 'saving' })
    const t = setTimeout(() => {
      const r = saveCarousel(storage, state.doc, { themeId: state.themeId, activeSlideId: state.activeSlideId }, { stripToken: stripMediaToken })
      if (r.ok) { lastSavedActive.current = state.activeSlideId; dispatch({ type: 'saved' }); setSave({ kind: 'saved', at: r.savedAt }) }
      else setSave({ kind: 'error', text: r.error })
    }, AUTOSAVE_MS)
    return () => clearTimeout(t)
  }, [state.doc, state.themeId, state.activeSlideId, state.dirty, storage])

  useEffect(() => {
    if (!state.dirty || storage) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [state.dirty, storage])

  const page = state.doc.pages.find(p => p.id === state.activeSlideId) ?? state.doc.pages[0]
  const activeIndex = state.doc.pages.findIndex(p => p.id === page.id)
  const selected = state.selectedElementId ? page.elements.find(e => e.id === state.selectedElementId) : undefined

  const tabBtn = (id: PanelTab, label: string) => (
    <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={cn('flex-1 rounded px-2 py-1.5 text-sm font-medium', tab === id ? 'bg-card shadow-sm' : 'text-muted-foreground')} data-testid={`tab-${id}`}>{label}</button>
  )

  return (
    <div className="flex flex-col gap-3" data-testid="carousel-editor" data-document-id={state.doc.id}>
      <header className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={onExit} className="inline-flex h-9 items-center gap-1 rounded-md border border-border bg-card px-2.5 text-sm hover:bg-muted" data-testid="back-to-list"><ArrowLeft className="h-4 w-4" />All carousels</button>
        <input aria-label="Carousel name" className="h-9 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 text-lg font-semibold hover:border-border focus:border-border focus:bg-background" value={state.doc.title} onChange={e => dispatch({ type: 'setTitle', title: e.target.value })} data-testid="doc-title" />
        <div className="flex items-center gap-1">
          <button type="button" className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card hover:bg-muted disabled:opacity-40" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={state.past.length === 0} onClick={() => dispatch({ type: 'undo' })} data-testid="undo"><Undo2 className="h-4 w-4" /></button>
          <button type="button" className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card hover:bg-muted disabled:opacity-40" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={state.future.length === 0} onClick={() => dispatch({ type: 'redo' })} data-testid="redo"><Redo2 className="h-4 w-4" /></button>
        </div>
        <p className="text-xs text-muted-foreground" role="status" aria-live="polite" data-testid="save-status">
          {save.kind === 'saving' && 'Saving…'}
          {save.kind === 'saved' && `Saved ${new Date(save.at).toLocaleTimeString(undefined, { timeStyle: 'short' })}`}
          {save.kind === 'idle' && 'All changes saved'}
          {save.kind === 'unavailable' && 'Not saved: browser storage is blocked'}
          {save.kind === 'error' && <span className="text-destructive">{save.text}</span>}
        </p>
      </header>

      {state.notice && <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100" data-testid="notice">{state.notice} <button type="button" className="ml-2 underline" onClick={() => dispatch({ type: 'clearNotice' })}>Dismiss</button></p>}

      <div className="grid gap-3 md:grid-cols-[9.5rem_minmax(0,1fr)] xl:h-[calc(100vh-11rem)] xl:min-h-[560px] xl:grid-cols-[9.5rem_minmax(0,1fr)_21rem]">
        <div className="order-2 min-h-0 md:order-none md:h-[72vh] md:min-h-[480px] xl:h-full xl:min-h-0"><Filmstrip doc={state.doc} activeId={page.id} onSelect={id => dispatch({ type: 'selectSlide', id })} onAdd={layout => dispatch({ type: 'addSlide', layout })} onDuplicate={id => dispatch({ type: 'duplicateSlide', id })} onDelete={id => dispatch({ type: 'deleteSlide', id })} onMove={(id, to) => dispatch({ type: 'moveSlide', id, to })} /></div>
        <div className="order-1 flex min-h-0 flex-col md:order-none md:h-[72vh] md:min-h-[480px] xl:h-full xl:min-h-0"><StageCanvas doc={state.doc} pageId={page.id} selectedId={state.selectedElementId} dispatch={dispatch} /></div>
        <aside className="order-3 min-h-0 rounded-lg border border-border bg-card p-3 md:col-span-2 xl:col-span-1 xl:h-full xl:overflow-y-auto" aria-label="Editor panels">
          <div role="tablist" aria-label="Panels" className="mb-3 flex gap-1 rounded-md bg-muted p-1">{tabBtn('edit', 'Edit')}{tabBtn('layers', 'Layers')}{tabBtn('export', 'Export')}</div>
          {tab === 'edit' && <Inspector doc={state.doc} page={page} selected={selected} dispatch={dispatch} />}
          {tab === 'layers' && <LayersPanel page={page} selectedId={state.selectedElementId} dispatch={dispatch} />}
          {tab === 'export' && <ExportPanel doc={state.doc} activeIndex={activeIndex} />}
        </aside>
      </div>
    </div>
  )
}

export default function CarouselCreatorPage() {
  const [params, setParams] = useSearchParams()
  const storage = useMemo(() => browserStorage(), [])
  const [list, setList] = useState<CarouselSummary[]>(() => (storage ? listCarousels(storage) : []))
  const [open, setOpen] = useState<{ doc: PostDocument; themeId: string; activeSlideId?: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const refreshList = useCallback(() => { if (storage) setList(listCarousels(storage)) }, [storage])

  const openById = useCallback((id: string) => {
    if (!storage) return
    const r = loadCarousel(storage, id)
    if (r.ok) { setOpen({ doc: r.record.document, themeId: r.record.themeId, activeSlideId: r.record.activeSlideId }); setError(null); setParams({ doc: id }, { replace: true }) }
    else { setError(r.error); setParams({}, { replace: true }) }
  }, [storage, setParams])

  // Reopen the carousel named in the address (a refresh or a shared link) once.
  const initial = useRef(params.get('doc'))
  useEffect(() => { if (initial.current) { openById(initial.current); initial.current = null } }, [openById])

  const create = (doc: PostDocument, themeId: string) => {
    if (storage) saveCarousel(storage, doc, { themeId }, { stripToken: stripMediaToken })
    setOpen({ doc, themeId }); setError(null); setParams({ doc: doc.id }, { replace: true }); refreshList()
  }
  const exit = () => { setOpen(null); setParams({}, { replace: true }); refreshList() }

  return (
    <div className="space-y-3">
      {error && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive" data-testid="open-error">{error}</p>}
      {open
        ? <Editor key={open.doc.id} initialDoc={open.doc} themeId={open.themeId} activeSlideId={open.activeSlideId} storage={storage} onExit={exit} />
        : <StartScreen saved={list} storageAvailable={!!storage} onOpen={openById} onDelete={id => { if (storage) { deleteCarousel(storage, id); refreshList() } }} onCreate={create} />}
    </div>
  )
}
