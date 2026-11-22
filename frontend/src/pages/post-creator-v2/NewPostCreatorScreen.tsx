import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Bell, Check, ChevronDown, Cloud, Download, FolderOpen, Image, Layers, Play, Plus, Redo2, Star, Undo2 } from 'lucide-react'
import { carouselTemplatesApi } from '../../api/client'
import { useAuth } from '../../contexts/AuthContext'
import type { CarouselServer, ServerCarousel, ServerCarouselSummary } from '../../lib/carousel/serverStore'
import type { KeyValueStorage } from '../../lib/carousel/storage'
import { applyBrandKit } from '../../lib/carousel/brandKit'
import { themeById } from '../../lib/carousel/layouts'
import { createHttpTemplateStore, type BrandKitStore } from '../../lib/carousel/assetsStore'
import { templateDocumentFrom } from '../../lib/carousel/templates'
import { BrandTokensContext } from '../../lib/carousel/brandContext'
import { discardUnsynced, planRecovery, type UnsyncedRecord } from '../../lib/carousel/syncEngine'
import type { LibraryStore } from '../../lib/carousel/libraryStore'
import ExportPanel from '../carousel-creator/components/ExportPanel'
import { AuthBanner, ConflictBanner, RecoveryPrompt, SaveBadge } from '../carousel-creator/components/SyncStatus'
import { usePostFormat } from './format/PostFormatContext'
import { createPostDocument, emptyBrief } from './workflow'
import { illustratedPage, illustratedTemplates, postBrandMark, withIllustratedStarter } from './illustratedTemplates'
import { PostSessionProvider, usePostSession, type OpenedPost } from './session'
import PostWorkspace from './components/PostWorkspace'
import './NewPostCreatorScreen.css'

interface Props { server: CarouselServer; storage: KeyValueStorage | null; brandStore: BrandKitStore; libraryStore: LibraryStore }
type Dialog = 'export' | 'projects' | 'template' | 'notifications' | 'account'

function PostDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { dialog.current?.showModal() }, [])
  return <dialog className="sg-post-dialog" ref={dialog} aria-label={title} onCancel={e => { e.preventDefault(); onClose() }} onClick={e => { if (e.target === dialog.current) onClose() }}>
    <section>
      <button type="button" className="sg-new-post-close" onClick={onClose} aria-label="Close dialog">×</button>
      <h2>{title}</h2>{children}
    </section>
  </dialog>
}

function ProjectList({ server, onCreate, onOpen }: { server: CarouselServer; onCreate: () => Promise<void>; onOpen: (id: string) => Promise<void> }) {
  const [projects, setProjects] = useState<ServerCarouselSummary[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    server.list().then(list => { if (active) setProjects(list) })
      .catch(() => { if (active) setError('Projects could not be loaded.') })
    return () => { active = false }
  }, [server])
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError('')
    try { await action() }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not open project.') }
    finally { setBusy(false) }
  }
  return <div className="sg-new-post-projects">
    <button type="button" disabled={busy} onClick={() => void run(onCreate)}><Plus size={17}/> New post project</button>
    {error && <p role="alert">{error}</p>}
    {projects === null && !error && <p>Loading projects…</p>}
    {projects?.map(p => <button type="button" disabled={busy} key={p.id} onClick={() => void run(() => onOpen(p.id))}>{p.title} <small>{p.slideCount} {p.slideCount === 1 ? 'page' : 'pages'}</small></button>)}
  </div>
}

function Wordmark() {
  return <a className="sg-new-post-brand" href="/dashboard"><img src={postBrandMark} alt=""/><span><strong>Social Genius</strong><small>The Positioning People</small></span></a>
}

function Editor({ server, onCreate, onOpen }: { server: CarouselServer; onCreate: () => Promise<void>; onOpen: (id: string) => Promise<void> }) {
  const s = usePostSession()
  const { user, logout } = useAuth()
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [modeOpen, setModeOpen] = useState(false)
  const mode = useRef<HTMLDivElement>(null)
  const [notice, setNotice] = useState('')
  const [templateName, setTemplateName] = useState('')
  const [templateRevision, setTemplateRevision] = useState(0)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!notice || dialog) return
    const timeout = window.setTimeout(() => setNotice(''), 5000)
    return () => window.clearTimeout(timeout)
  }, [notice, dialog])
  const activeIndex = s.doc.pages.findIndex(page => page.id === s.state.activeSlideId)
  const initials = user?.username.split(/[^a-zA-Z0-9]+/).filter(Boolean).map(part => part[0]).slice(0, 2).join('').toUpperCase() || 'SG'

  useEffect(() => {
    const dismiss = (event: PointerEvent) => { if (!mode.current?.contains(event.target as Node)) setModeOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setModeOpen(false) }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape) }
  }, [])

  const saveTemplate = async () => {
    if (!templateName.trim() || busy) return
    setBusy(true)
    try {
      const store = createHttpTemplateStore(carouselTemplatesApi)
      await store.create({ name: templateName.trim(), description: 'Editable Post Creator template', kind: s.doc.pages.length === 1 ? 'layout' : 'carousel', document: templateDocumentFrom(s.doc) })
      setTemplateRevision(v => v + 1)
      setDialog(null)
      setNotice('Template saved. Find it under Design → Templates.')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Template could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    setBusy(true)
    try { setNotice(await s.saveNow() ? 'Project saved.' : 'Changes are waiting to sync.') }
    finally { setBusy(false) }
  }
  const ensureSaved = async (action: () => Promise<void>) => {
    if (!await s.saveNow()) throw new Error('Save this project before opening another.')
    await action()
    setDialog(null)
  }

  return <div className="sg-new-post">
    <header className="sg-new-post-header">
      <Wordmark/>
      <a className="sg-new-post-studio" href="/dashboard"><Play size={23}/> Content Studio</a>
      <div className="sg-post-header-menu" ref={mode}>
        <button type="button" aria-label="Creator mode" aria-expanded={modeOpen} onClick={() => setModeOpen(value => !value)}><Image size={21}/> Post Creator <ChevronDown size={17}/></button>
        {modeOpen && <div className="sg-post-mode-options">
          <button type="button" onClick={() => setModeOpen(false)}><Image size={20}/> <span><strong>Post Creator</strong> (Single Design)</span><Check size={18}/></button>
          <a href="/carousel-creator"><Layers size={20}/> <span><strong>Carousel Creator</strong> (Multi-Slide Design)</span></a>
        </div>}
      </div>
      <div className="sg-new-post-spacer"/>
      <button type="button" className="sg-post-header-icon" aria-label="Undo" disabled={!s.state.past.length} onClick={() => s.dispatch({ type: 'undo' })}><Undo2 size={23}/></button>
      <button type="button" className="sg-post-header-icon" aria-label="Redo" disabled={!s.state.future.length} onClick={() => s.dispatch({ type: 'redo' })}><Redo2 size={23}/></button>
      <span className="sg-new-post-status" role="status"><Cloud size={21}/>{['failed', 'conflict', 'auth'].includes(s.sync.status) ? 'Save needs attention' : s.sync.unsaved ? 'Saving…' : 'Autosaved'}</span>
      <button type="button" disabled={busy} onClick={() => void save()}><FolderOpen size={19}/> Save Project</button>
      <button type="button" className="sg-post-save-template" aria-label="Save as Template" onClick={() => { setTemplateName(s.doc.title + ' Template'); setNotice(''); setDialog('template') }}><Star size={19}/> <span>Save as Template</span></button>
      <button type="button" className="sg-new-post-export" onClick={() => setDialog('export')}><Download size={19}/> Export <ChevronDown size={16}/></button>
      <button type="button" className="sg-post-header-icon sg-post-notifications" aria-label="Notifications" onClick={() => setDialog('notifications')}><Bell size={23}/></button>
      <button type="button" className="sg-post-avatar" aria-label="Account" onClick={() => setDialog('account')}>{initials}</button>
    </header>
    {notice && !dialog && <div className="sg-new-post-notice" role="status">{notice}<button type="button" aria-label="Dismiss status" onClick={() => setNotice('')}>×</button></div>}
    {['conflict', 'auth', 'failed'].includes(s.sync.status) && <div className="sg-new-post-conflict">
      <ConflictBanner state={s.sync} busy={busy} onKeepMine={() => { setBusy(true); void s.resolveConflict('keep-mine').finally(() => setBusy(false)) }} onUseServer={() => { setBusy(true); void s.resolveConflict('use-server').finally(() => setBusy(false)) }}/>
      <AuthBanner state={s.sync}/>
      {s.sync.status === 'failed' && <div className="rounded bg-white p-3"><SaveBadge state={s.sync} onRetry={s.retry}/></div>}
    </div>}
    <div className="sg-new-post-main"><PostWorkspace onProjects={() => setDialog('projects')} templateRevision={templateRevision}/></div>
    {dialog === 'export' && <PostDialog title="Export design" onClose={() => setDialog(null)}><BrandTokensContext.Provider value={s.tokens}><ExportPanel doc={s.doc} activeIndex={activeIndex}/></BrandTokensContext.Provider></PostDialog>}
    {dialog === 'projects' && <PostDialog title="Projects" onClose={() => setDialog(null)}><label className="sg-post-project-name">Current project name<input value={s.doc.title} maxLength={80} onChange={e => s.updateBrief({ title: e.target.value })}/></label><ProjectList server={server} onCreate={() => ensureSaved(onCreate)} onOpen={id => ensureSaved(() => onOpen(id))}/></PostDialog>}
    {dialog === 'template' && <PostDialog title="Save as template" onClose={() => setDialog(null)}><form className="sg-new-post-template-form" onSubmit={e => { e.preventDefault(); void saveTemplate() }}>
      <label>Template name<input autoFocus required maxLength={120} value={templateName} onChange={e => setTemplateName(e.target.value)}/></label>
      {notice && <p role="alert">{notice}</p>}
      <button className="sg-post-dialog-primary" type="submit" disabled={busy || !templateName.trim()}>{busy ? 'Saving…' : 'Save template'}</button>
    </form></PostDialog>}
    {dialog === 'account' && <PostDialog title="Account" onClose={() => setDialog(null)}><p>{user?.username}</p><button className="sg-post-dialog-primary" type="button" onClick={() => void s.saveNow().then(ok => {
      if (ok) logout()
      else { setDialog(null); setNotice('Save this project before signing out.') }
    })}>Sign out</button></PostDialog>}
    {dialog === 'notifications' && <PostDialog title="Notifications" onClose={() => setDialog(null)}><SaveBadge state={s.sync} onRetry={s.retry}/></PostDialog>}
  </div>
}

export default function NewPostCreatorScreen({ server, storage, brandStore, libraryStore }: Props) {
  const { canvas } = usePostFormat()
  const [opened, setOpened] = useState<OpenedPost | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [projects, setProjects] = useState(false)
  const [recovery, setRecovery] = useState<{ carousel: ServerCarousel; record: UnsyncedRecord; serverNewer: boolean } | null>(null)
  const started = useRef(false)
  const nonce = useRef(0)

  const open = useCallback((c: ServerCarousel, restored?: UnsyncedRecord) => {
    setOpened({ id: c.id, doc: restored?.document ?? c.document, themeId: restored?.themeId ?? c.themeId, activeSlideId: restored?.activeSlideId ?? c.activeSlideId, version: restored?.baseVersion ?? c.version, nonce: ++nonce.current, recovered: !!restored })
    sessionStorage.setItem('sg-last-post-draft', c.id)
    const url = new URL(window.location.href)
    url.searchParams.set('draft', c.id)
    url.searchParams.delete('fromBrief')
    url.searchParams.delete('template')
    window.history.replaceState(null, '', url)
    setRecovery(null)
    setProjects(false)
  }, [])

  const load = useCallback(async (id: string) => {
    const carousel = await server.get(id)
    const plan = planRecovery(storage, carousel)
    if (plan.kind === 'offer') {
      setRecovery({ carousel, record: plan.record, serverNewer: plan.serverNewer })
      return
    }
    if (plan.kind === 'already-saved') discardUnsynced(storage, id)
    open(carousel)
  }, [server, storage, open])

  const create = useCallback(async (fromLaunch = false) => {
    const q = new URLSearchParams(window.location.search)
    const fromBrief = fromLaunch && q.get('fromBrief') === '1'
    const templateName = fromLaunch ? q.get('template') : null
    const template = illustratedTemplates.find(t => t.name.toLowerCase() === templateName?.toLowerCase())
    let brief = emptyBrief()
    const raw = fromBrief ? sessionStorage.getItem('sg-content-brief') : null
    if (raw) {
      const v = JSON.parse(raw) as Record<string, unknown>
      if (v.contentType === 'post') {
        const str = (key: string) => typeof v[key] === 'string' ? String(v[key]) : ''
        const kit = Number(v.brandKitId)
        brief = { ...brief, title: str('topic'), goal: str('goal') || brief.goal, audience: str('audience'), keyMessage: str('message'), product: str('product'), cta: str('cta'), instructions: str('instructions'), brandKitId: Number.isInteger(kit) && kit > 0 ? kit : null }
      }
    }
    brief.title ||= templateName?.slice(0, 80) || 'Untitled Post'
    let doc = createPostDocument(brief, { platformKey: canvas.platformKey, formatKey: canvas.formatKey, width: canvas.width, height: canvas.height, ratio: canvas.ratioLabel })
    if (template) doc = { ...doc, pages: [illustratedPage(template.id, doc.format)] }
    else if (!fromBrief && !templateName) doc = withIllustratedStarter(doc)
    if (brief.brandKitId) doc = applyBrandKit(doc, await brandStore.get(brief.brandKitId), themeById(brief.themeId)).doc
    open(await server.create(doc, { themeId: brief.themeId }))
  }, [canvas, brandStore, server, open])

  useEffect(() => {
    if (started.current) return
    started.current = true
    const q = new URLSearchParams(window.location.search)
    const id = q.get('draft') || (q.get('fromBrief') === '1' || q.has('template') ? null : sessionStorage.getItem('sg-last-post-draft'))
    void (id ? load(id) : create(true))
      .catch(e => setError(e instanceof Error ? e.message : 'Could not load project.'))
      .finally(() => setLoading(false))
  }, [load, create])

  return <>
    {opened ? <PostSessionProvider key={opened.id + ':' + opened.nonce} opened={opened} server={server} buffer={storage} brandStore={brandStore} libraryStore={libraryStore} onReload={c => { discardUnsynced(storage, c.id); open(c) }}><Editor server={server} onCreate={() => create()} onOpen={load}/></PostSessionProvider>
      : <div className="sg-new-post sg-new-post-start"><header className="sg-new-post-header"><Wordmark/><strong className="sg-new-post-studio">Content Studio</strong></header>
        <main><h1>{loading ? 'Opening Post Creator' : 'Post Creator'}</h1>{error && <p role="alert">{error}</p>}
          {!loading && <button type="button" onClick={() => setProjects(true)}>Open or create a project</button>}
        </main>
      </div>}
    {projects && <PostDialog title="Projects" onClose={() => setProjects(false)}><ProjectList server={server} onCreate={() => create()} onOpen={load}/></PostDialog>}
    {recovery && <PostDialog title="Recover project" onClose={() => setRecovery(null)}><RecoveryPrompt title={recovery.carousel.title} serverNewer={recovery.serverNewer}
      onRestore={() => open(recovery.carousel, recovery.record)}
      onDiscard={() => { discardUnsynced(storage, recovery.carousel.id); open(recovery.carousel) }}/></PostDialog>}
  </>
}
