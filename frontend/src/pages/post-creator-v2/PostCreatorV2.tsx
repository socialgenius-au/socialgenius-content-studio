import { useCallback, useEffect, useMemo, useState } from 'react'
import { Sparkles, ArrowLeft, BookmarkPlus, Download, LayoutTemplate, Image as ImageIcon, FolderOpen, ArrowRight, WandSparkles, Palette, FilePlus2 } from 'lucide-react'
import './PostCreatorV2.css'
import { brandKitsApi, carouselsApi, libraryItemsApi } from '../../api/client'
import { applyBrandKit } from '../../lib/carousel/brandKit'
import type { BrandKitSummary } from '../../lib/carousel/brandKit'
import { createHttpBrandKitStore, type BrandKitStore } from '../../lib/carousel/assetsStore'
import { createHttpLibraryStore, type LibraryStore } from '../../lib/carousel/libraryStore'
import { themeById } from '../../lib/carousel/layouts'
import { browserStorage, type KeyValueStorage } from '../../lib/carousel/storage'
import { createHttpCarouselServer, type CarouselServer, type ServerCarousel, type ServerCarouselSummary } from '../../lib/carousel/serverStore'
import { discardUnsynced, planRecovery, type UnsyncedRecord } from '../../lib/carousel/syncEngine'
import { AuthBanner, ConflictBanner, RecoveryPrompt, SaveBadge } from '../carousel-creator/components/SyncStatus'
import BriefTab from './tabs/BriefTab'
import IntelligenceTab from './tabs/IntelligenceTab'
import ReferencesTab from './tabs/ReferencesTab'
import CreateTab from './tabs/CreateTab'
import ReviewTab from './tabs/ReviewTab'
import { PostFormatProvider, usePostFormat } from './format/PostFormatContext'
import { PostSessionProvider, messageOf, usePostSession, type OpenedPost } from './session'
import { createPostDocument, emptyBrief, type PostBrief } from './workflow'

export type ThemeMode = 'light' | 'dark'
export type Stage = 'brief' | 'intelligence' | 'references' | 'create' | 'review'

const STAGES: { id: Stage; num: number; label: string }[] = [
  { id: 'brief', num: 1, label: 'Brief' },
  { id: 'intelligence', num: 2, label: 'Intelligence' },
  { id: 'references', num: 3, label: 'References' },
  { id: 'create', num: 4, label: 'Create' },
  { id: 'review', num: 5, label: 'Review' },
]

const THEME_KEY = 'sg-post-creator-v2-theme'

export interface PostCreatorV2Props {
  /** Storage and Brand Kit services. They default to the signed-in account's real server storage; tests pass in-memory ones. */
  server?: CarouselServer
  storage?: KeyValueStorage | null
  brandStore?: BrandKitStore
  libraryStore?: LibraryStore
}

const readDraftParam = (): string | null => (typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('draft'))
const writeDraftParam = (id: string | null) => {
  if (typeof window === 'undefined') return
  const u = new URL(window.location.href)
  if (id) u.searchParams.set('draft', id); else u.searchParams.delete('draft')
  window.history.replaceState(null, '', u.toString())
}

/** Banners and the post bar that only exist while a post is open. */
function SessionBar({ onClose }: { onClose: () => void }) {
  const s = usePostSession()
  const [resolving, setResolving] = useState(false)
  const close = async () => {
    await s.saveNow()
    if (s.sync.unsaved && !window.confirm('Some changes have not been saved to your account yet. They stay in this browser and you will be offered them back next time you open this post. Close it anyway?')) return
    onClose()
  }
  return (
    <div style={{ display: 'grid', gap: 8, marginBottom: 12 }} data-testid="pcv2-session-bar">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <strong data-testid="pcv2-post-title">{s.doc.title}</strong>
        <SaveBadge state={s.sync} onRetry={s.retry} />
        <span style={{ flex: 1 }} />
        <button type="button" className="pcv2-btn pcv2-btn-secondary" onClick={() => void close()} data-testid="pcv2-close-post">Close post · my drafts</button>
      </div>
      <ConflictBanner state={s.sync} busy={resolving} onKeepMine={() => { setResolving(true); void s.resolveConflict('keep-mine').finally(() => setResolving(false)) }} onUseServer={() => { setResolving(true); void s.resolveConflict('use-server').finally(() => setResolving(false)) }} />
      <AuthBanner state={s.sync} />
    </div>
  )
}

function Workflow({ stage, goTo, goNext, goBack, brief, setBrief, kits, onStart, starting, startError, drafts, draftsError, onOpenDraft, openingId }: {
  stage: Stage; goTo: (s: Stage) => void; goNext: () => void; goBack: () => void; brief: PostBrief; setBrief: (patch: Partial<PostBrief>) => void; kits: BrandKitSummary[] | null
  onStart: () => void; starting: boolean; startError: string | null; drafts: ServerCarouselSummary[] | null; draftsError: string | null; onOpenDraft: (id: string) => void; openingId: string | null
}) {
  return (
    <>
      {stage === 'brief' && <BriefTab draftBrief={brief} onDraftBrief={setBrief} kits={kits} onStart={onStart} starting={starting} startError={startError} drafts={drafts} draftsError={draftsError} onOpenDraft={onOpenDraft} openingId={openingId} onNext={goNext} />}
      {stage === 'intelligence' && <IntelligenceTab onNext={goNext} onBack={goBack} />}
      {stage === 'references' && <ReferencesTab onNext={goNext} onBack={goBack} onGoCreate={() => goTo('create')} />}
      {stage === 'create' && <CreateTab onNext={goNext} onBack={goBack} />}
      {stage === 'review' && <ReviewTab onBack={goBack} onGoCreate={() => goTo('create')} />}
    </>
  )
}

function Shell({ server, storage, brandStore, libraryStore }: Required<Omit<PostCreatorV2Props, 'storage'>> & { storage: KeyValueStorage | null }) {
  const { canvas } = usePostFormat()
  const [theme, setTheme] = useState<ThemeMode>('light')
  const [stage, setStage] = useState<Stage>('brief')
  const [showStart, setShowStart] = useState(() => !readDraftParam() && !(typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('template')))
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [assistantPrompt, setAssistantPrompt] = useState('')
  const [brief, setBrief] = useState<PostBrief>(() => { const b=emptyBrief();if(typeof window==='undefined')return b;const q=new URLSearchParams(window.location.search);const title=q.get('template');return title?{...b,title:title.slice(0,120),keyMessage:title.slice(0,120),instructions:'Marketplace starter: customise this content in Post Creator. Template graphics have not been imported.'}:b })
  const [opened, setOpened] = useState<OpenedPost | null>(null)
  const [recovery, setRecovery] = useState<{ carousel: ServerCarousel; record: UnsyncedRecord; serverNewer: boolean } | null>(null)
  const [drafts, setDrafts] = useState<ServerCarouselSummary[] | null>(null)
  const [draftsError, setDraftsError] = useState<string | null>(null)
  const [kits, setKits] = useState<BrandKitSummary[] | null>(null)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const [openingId, setOpeningId] = useState<string | null>(null)
  const nonce = useMemo(() => ({ n: 0 }), [])

  useEffect(() => {
    const saved = window.localStorage.getItem(THEME_KEY)
    if (saved === 'light' || saved === 'dark') setTheme(saved)
  }, [])
  // The shared panels (canvas tools, inspector, export) take their colours from the app theme, so the Light/Dark switch drives it while this page is open and restores it on leaving.
  useEffect(() => {
    const root = document.documentElement
    const before = root.getAttribute('data-theme')
    root.setAttribute('data-theme', theme)
    return () => { if (before) root.setAttribute('data-theme', before); else root.removeAttribute('data-theme') }
  }, [theme])
  const setThemeAndPersist = (mode: ThemeMode) => { setTheme(mode); window.localStorage.setItem(THEME_KEY, mode) }

  const loadDrafts = useCallback(async () => {
    try { setDrafts((await server.list()).filter(d => d.slideCount === 1)); setDraftsError(null) } catch (e) { setDrafts([]); setDraftsError(`Could not load your drafts: ${messageOf(e)}`) }
  }, [server])
  useEffect(() => { void loadDrafts() }, [loadDrafts])
  useEffect(() => { let live = true; brandStore.list().then(l => { if (live) setKits(l) }).catch(() => { if (live) setKits([]) }); return () => { live = false } }, [brandStore])

  const openCarousel = useCallback((c: ServerCarousel, base?: Partial<OpenedPost>) => {
    nonce.n += 1
    setOpened({ id: c.id, doc: c.document, themeId: c.themeId, activeSlideId: c.activeSlideId, version: c.version, nonce: nonce.n, ...base })
    setRecovery(null); writeDraftParam(c.id)
  }, [nonce])

  const openById = useCallback(async (id: string) => {
    setOpeningId(id); setStartError(null)
    try {
      const c = await server.get(id)
      const plan = planRecovery(storage, c)
      if (plan.kind === 'already-saved') discardUnsynced(storage, id)
      if (plan.kind === 'offer') { setRecovery({ carousel: c, record: plan.record, serverNewer: plan.serverNewer }); return }
      openCarousel(c); setStage('brief')
    } catch (e) { setStartError(`Could not open that post: ${messageOf(e)}`); writeDraftParam(null) } finally { setOpeningId(null) }
  }, [server, storage, openCarousel])

  const initial = useMemo(() => ({ id: readDraftParam() }), [])
  useEffect(() => { if (initial.id) void openById(initial.id) }, [initial, openById])

  const start = async () => {
    setStarting(true); setStartError(null)
    try {
      let doc = createPostDocument(brief, { platformKey: canvas.platformKey, formatKey: canvas.formatKey, width: canvas.width, height: canvas.height, ratio: canvas.ratioLabel })
      if (brief.brandKitId) {
        try { doc = applyBrandKit(doc, await brandStore.get(brief.brandKitId), themeById(brief.themeId)).doc } catch { /* the post still starts without the kit; it can be applied in Create > Brand */ }
      }
      openCarousel(await server.create(doc, { themeId: brief.themeId }))
      setBrief(emptyBrief()); setStage('intelligence')
    } catch (e) { setStartError(`Could not start the post: ${messageOf(e)}`) } finally { setStarting(false) }
  }
  const closePost = () => { setOpened(null); setStage('brief'); setShowStart(true); writeDraftParam(null); void loadDrafts() }

  const stageIndex = STAGES.findIndex(s => s.id === stage)
  const goTo = (s: Stage) => { if (opened || s === 'brief') { setShowStart(false); setStage(s) } }
  const goNext = () => { const next = STAGES[stageIndex + 1]; if (next) setStage(next.id) }
  const goBack = () => { const prev = STAGES[stageIndex - 1]; if (prev) setStage(prev.id) }

  const workflow = (
    <Workflow stage={stage} goTo={goTo} goNext={goNext} goBack={goBack} brief={brief} setBrief={patch => setBrief(b => ({ ...b, ...patch }))} kits={kits} onStart={() => void start()} starting={starting} startError={startError}
      drafts={drafts} draftsError={draftsError} onOpenDraft={id => void openById(id)} openingId={openingId} />
  )

  return (
    <div className="pcv2" data-theme={theme}>
      {!opened && showStart && !recovery ? <main className="pcv2-start" aria-label="Post Creator start screen">
        <div className="pcv2-start-top"><a href="/dashboard" className="pcv2-start-back"><ArrowLeft size={17}/> Home</a><span>Social Genius · Content Studio</span><select aria-label="Creator mode" value="post" onChange={e=>{if(e.target.value==='carousel')window.location.assign('/carousel-creator')}}><option value="post">Post Creator</option><option value="carousel">Carousel Creator</option></select></div>
        <section className="pcv2-start-hero"><span className="pcv2-start-eyebrow"><Sparkles size={17}/> YOUR CREATIVE WORKSPACE</span><h1>Create something <em>brilliant.</em></h1><p>Start with a blank post, customise a template or use an AI-assisted brief. Every design opens in the same editable Post Creator.</p></section>
        <h2>How would you like to start?</h2><div className="pcv2-start-options">
          <button type="button" onClick={()=>{setShowStart(false);setStage('brief')}}><span className="pcv2-start-icon lilac"><FilePlus2 size={29}/></span><strong>Start from scratch</strong><small>Create a new post with your own text, images and brand.</small><ArrowRight size={18}/></button>
          <a href="/templates"><span className="pcv2-start-icon blue"><LayoutTemplate size={29}/></span><strong>Choose a template</strong><small>Browse editable templates, then customise in Post Creator.</small><ArrowRight size={18}/></a>
          <button type="button" onClick={()=>{setShowStart(false);setAssistantOpen(true);setStage('brief')}}><span className="pcv2-start-icon gold"><WandSparkles size={29}/></span><strong>Create with AI</strong><small>Describe your idea and prepare an editable creative brief.</small><ArrowRight size={18}/></button>
        </div>
        <div className="pcv2-start-bottom"><section><h2><FolderOpen size={20}/> Continue your posts</h2>{draftsError&&<p role="alert">{draftsError}</p>}{drafts===null&&<p>Loading saved posts…</p>}{drafts?.length===0&&<p>No saved posts yet. Start your first design above.</p>}<div className="pcv2-start-drafts">{drafts?.slice(0,8).map(d=><button type="button" key={d.id} disabled={openingId===d.id} onClick={()=>{setShowStart(false);void openById(d.id)}}><ImageIcon size={20}/><span>{d.title}</span><ArrowRight size={16}/></button>)}</div></section><section><h2><Palette size={20}/> Your design tools</h2><p>Text, shapes, media, backgrounds, layers, Brand Kit, save and export remain available inside the existing editor.</p><button type="button" onClick={()=>{setShowStart(false);setStage('brief')}}>Open Post Creator <ArrowRight size={16}/></button></section></div>
      </main> : <>
      <header className="pcv2-header">
        <a className="pcv2-brand" href="/dashboard">
          <span className="pcv2-brand-badge"><Sparkles size={16} /></span>
          <span className="pcv2-brand-name">SocialGenius</span>
        </a>

        <div className="pcv2-titles">
          <div className="pcv2-title">POST CREATOR — From Brief to Finished Post</div>
          <div className="pcv2-subtitle">Create, customise, save and export using one workspace.</div>
        </div>

        <nav className="pcv2-stepper" aria-label="Post Creator workflow">
          {STAGES.map((s, i) => {
            const locked = !opened && s.id !== 'brief'
            return (
              <span key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {i > 0 && <span className="pcv2-step-arrow">→</span>}
                <button type="button" className={`pcv2-step ${stage === s.id ? 'is-active' : ''} ${i < stageIndex ? 'is-done' : ''}`} onClick={() => goTo(s.id)} disabled={locked} aria-disabled={locked}
                  title={locked ? 'Start the post in Brief first' : undefined} data-testid={`pcv2-step-${s.id}`}>
                  <span className="pcv2-step-num">{s.num}</span>
                  {s.label.toUpperCase()}
                </button>
              </span>
            )
          })}
        </nav>

        <div className="pcv2-theme-toggle" role="group" aria-label="Theme">
          <button type="button" className={theme === 'light' ? 'is-active' : ''} onClick={() => setThemeAndPersist('light')}>Light</button>
          <button type="button" className={`pcv2-theme-knob ${theme === 'dark' ? 'is-dark' : ''}`} aria-label="Toggle theme" onClick={() => setThemeAndPersist(theme === 'light' ? 'dark' : 'light')} />
          <button type="button" className={theme === 'dark' ? 'is-active' : ''} onClick={() => setThemeAndPersist('dark')}>Dark</button>
        </div>
      </header>

      <div className="pcv2-unifiedbar" aria-label="Unified creator toolbar">
        <strong>Social Genius · Content Studio</strong>
        <select aria-label="Creator mode" value="post" onChange={e=>{if(e.target.value==='carousel' && window.confirm('Switch to Carousel Creator? Your post is saved separately.'))window.location.assign('/carousel-creator')}}><option value="post">Post Creator</option><option value="carousel">Carousel Creator</option></select>
        <button type="button" onClick={()=>setAssistantOpen(v=>!v)} aria-expanded={assistantOpen}>✦ AI Assistant</button>
        <button type="button" onClick={()=>{setAssistantOpen(false);goTo('create')}} disabled={!opened}>Manual editor</button>
        <button type="button" onClick={()=>goTo('review')} disabled={!opened}>Save / Export</button>
        <a href="/templates">Templates</a>
      </div>
      {assistantOpen&&<section className="pcv2-ai-panel" aria-label="AI Assistant"><div className="pcv2-ai-title"><strong>✦ AI Assistant</strong><button type="button" onClick={()=>setAssistantOpen(false)}>Close ×</button></div><label htmlFor="pcv2-ai-prompt">Describe the post you want to create</label><textarea id="pcv2-ai-prompt" value={assistantPrompt} onChange={e=>setAssistantPrompt(e.target.value)} rows={3} placeholder="Create a promotional post for my business using our brand colours" /><p>Prompt-to-design generation is not connected yet. You can apply this prompt to your editable brief.</p><button type="button" disabled={!assistantPrompt.trim()} onClick={()=>{setBrief(b=>({...b,keyMessage:assistantPrompt.slice(0,500),instructions:assistantPrompt.slice(0,1000)}));goTo('brief');setAssistantOpen(false)}}>Use prompt in brief</button></section>}
      <div className="pcv2-body">
        {recovery ? (
          <RecoveryPrompt title={recovery.carousel.title} serverNewer={recovery.serverNewer}
            onRestore={() => { openCarousel(recovery.carousel, { doc: recovery.record.document, themeId: recovery.record.themeId, activeSlideId: recovery.record.activeSlideId, version: recovery.record.baseVersion }); setStage('brief') }}
            onDiscard={() => { discardUnsynced(storage, recovery.carousel.id); openCarousel(recovery.carousel); setStage('brief') }} />
        ) : opened ? (
          <PostSessionProvider key={`${opened.id}:${opened.nonce}`} opened={opened} server={server} buffer={storage} brandStore={brandStore} libraryStore={libraryStore} onReload={c => { discardUnsynced(storage, c.id); openCarousel(c) }}>
            <SessionBar onClose={closePost} />
            {workflow}
          </PostSessionProvider>
        ) : workflow}
      </div>
      </>}
    </div>
  )
}

export default function PostCreatorV2({ server: serverProp, storage: storageProp, brandStore: brandProp, libraryStore: libraryProp }: PostCreatorV2Props = {}) {
  const server = useMemo(() => serverProp ?? createHttpCarouselServer(carouselsApi), [serverProp])
  const storage = useMemo(() => (storageProp === undefined ? browserStorage() : storageProp), [storageProp])
  const brandStore = useMemo(() => brandProp ?? createHttpBrandKitStore(brandKitsApi), [brandProp])
  const libraryStore = useMemo(() => libraryProp ?? createHttpLibraryStore(libraryItemsApi), [libraryProp])
  return (
    <PostFormatProvider>
      <Shell server={server} storage={storage} brandStore={brandStore} libraryStore={libraryStore} />
    </PostFormatProvider>
  )
}
