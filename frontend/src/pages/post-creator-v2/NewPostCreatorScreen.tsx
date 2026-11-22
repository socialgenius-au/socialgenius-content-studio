import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, Download, FolderOpen, Save, Star, Undo2, Redo2 } from 'lucide-react'
import type { CarouselServer, ServerCarousel } from '../../lib/carousel/serverStore'
import type { KeyValueStorage } from '../../lib/carousel/storage'
import { applyBrandKit } from '../../lib/carousel/brandKit'
import { themeById } from '../../lib/carousel/layouts'
import type { BrandKitStore } from '../../lib/carousel/assetsStore'
import type { LibraryStore } from '../../lib/carousel/libraryStore'
import { usePostFormat } from './format/PostFormatContext'
import { createPostDocument, emptyBrief } from './workflow'
import { PostSessionProvider, usePostSession, type OpenedPost } from './session'
import PostWorkspace from './components/PostWorkspace'
import ReviewTab from './tabs/ReviewTab'
import './NewPostCreatorScreen.css'

interface Props { server: CarouselServer; storage: KeyValueStorage | null; brandStore: BrandKitStore; libraryStore: LibraryStore }
function Editor({ onHome }: { onHome: () => void }) {
  const s = usePostSession()
  const [exportOpen, setExportOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const save = async () => { const ok = await s.saveNow(); setNotice(ok ? 'Project saved' : 'Changes are still syncing') }
  return <div className="sg-new-post">
    <header className="sg-new-post-header">
      <a className="sg-new-post-brand" href="/dashboard"><img src="/social-genius-official-logo.svg" alt="Social Genius" /><span><strong>Social Genius</strong><small>The Positioning People</small></span></a>
      <span className="sg-new-post-divider" />
      <strong className="sg-new-post-studio">▷ Content Studio</strong>
      <select aria-label="Creator mode" value="post" onChange={e=>{if(e.target.value==='carousel')window.location.assign('/carousel-creator')}}><option value="post">Post Creator (Single Design)</option><option value="carousel">Carousel Creator (Multi-Slide Design)</option></select>
      <div className="sg-new-post-spacer" />
      <button type="button" aria-label="Undo" disabled={!s.state.past.length} onClick={()=>s.dispatch({type:'undo'})}><Undo2 size={20}/></button>
      <button type="button" aria-label="Redo" disabled={!s.state.future.length} onClick={()=>s.dispatch({type:'redo'})}><Redo2 size={20}/></button>
      <span className="sg-new-post-status">{s.sync.unsaved?'Saving…':'Autosaved'}</span>
      <button type="button" onClick={()=>void save()}><FolderOpen size={18}/> Save Project</button>
      <button type="button" onClick={()=>{setNotice('To save as a reusable template, open the Templates library.');window.location.assign('/templates')}}><Star size={18}/> Templates</button>
      <button type="button" className="sg-new-post-export" onClick={()=>setExportOpen(true)}><Download size={18}/> Export</button>
      <button type="button" onClick={onHome} aria-label="Back to projects"><ArrowLeft size={18}/></button>
    </header>
    {notice&&<div className="sg-new-post-notice" role="status">{notice}<button type="button" onClick={()=>setNotice('')}>×</button></div>}
    <main className="sg-new-post-main"><PostWorkspace /></main>
    {exportOpen&&<div className="sg-new-post-overlay"><section role="dialog" aria-modal="true" aria-label="Save and export"><button type="button" className="sg-new-post-close" onClick={()=>setExportOpen(false)}>Close ×</button><ReviewTab onBack={()=>setExportOpen(false)} onGoCreate={()=>setExportOpen(false)}/></section></div>}
  </div>
}
export default function NewPostCreatorScreen({ server, storage, brandStore, libraryStore }: Props) {
  const { canvas } = usePostFormat()
  const [opened, setOpened] = useState<OpenedPost | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [nonce, setNonce] = useState(0)
  const [projects, setProjects] = useState<{id:string;title:string}[]>([])
  const [showProjects, setShowProjects] = useState(false)
  const open = useCallback((c: ServerCarousel) => {
    setNonce(n=>n+1)
    setOpened({ id:c.id, doc:c.document, themeId:c.themeId, activeSlideId:c.activeSlideId, version:c.version, nonce:Date.now() })
    sessionStorage.setItem('sg-last-post-draft',c.id)
    const u=new URL(window.location.href);u.searchParams.set('draft',c.id);window.history.replaceState(null,'',u.toString())
    setShowProjects(false)
  },[])
  const create = useCallback(async () => {
    setLoading(true);setError('')
    try {
      const raw=sessionStorage.getItem('sg-content-brief')
      let brief=emptyBrief()
      if(new URLSearchParams(window.location.search).get('fromBrief')==='1'&&raw) {
        const v=JSON.parse(raw) as Record<string,unknown>
        if(v.contentType==='post'){
          const str=(key:string)=>typeof v[key]==='string'?String(v[key]):''
          const kit=Number(v.brandKitId)
          brief={...brief,title:str('topic'),goal:str('goal')||brief.goal,audience:str('audience'),keyMessage:str('message'),product:str('product'),cta:str('cta'),instructions:str('instructions'),brandKitId:Number.isInteger(kit)&&kit>0?kit:null}
        }
      }
      if(!brief.title)brief.title='Untitled Post'
      let doc=createPostDocument(brief,{platformKey:canvas.platformKey,formatKey:canvas.formatKey,width:canvas.width,height:canvas.height,ratio:canvas.ratioLabel})
      if(brief.brandKitId)try{doc=applyBrandKit(doc,await brandStore.get(brief.brandKitId),themeById(brief.themeId)).doc}catch{/* can apply later */}
      open(await server.create(doc,{themeId:brief.themeId}))
    }catch(e){setError(e instanceof Error?e.message:'Could not create project')}
    finally{setLoading(false)}
  },[canvas,brandStore,server,open])
  useEffect(()=>{
    let live=true
    const init=async()=>{
      try{
        const q=new URLSearchParams(window.location.search)
        const id=q.get('draft')||(q.get('fromBrief')==='1'?null:sessionStorage.getItem('sg-last-post-draft'))
        if(id){const c=await server.get(id);if(live)open(c)}
        else if(live)await create()
      }catch(e){if(live){setError(e instanceof Error?e.message:'Could not load project');setLoading(false)}}
    }
    void init()
    return()=>{live=false}
  },[server,open,create])
  const loadProjects=async()=>{setShowProjects(true);setError('');try{setProjects((await server.list()).filter(x=>x.slideCount===1).map(x=>({id:x.id,title:x.title})))}catch(e){setError(e instanceof Error?e.message:'Could not load projects')}}
  const home=()=>{setOpened(null);setShowProjects(true);void loadProjects()}
  if(opened&&!showProjects)return <PostSessionProvider key={opened.id+':'+nonce} opened={opened} server={server} buffer={storage} brandStore={brandStore} libraryStore={libraryStore} onReload={open}><Editor onHome={home}/></PostSessionProvider>
  return <div className="sg-new-post sg-new-post-start"><header className="sg-new-post-header"><a href="/dashboard">← Content Studio</a><strong>Social Genius · Post Creator</strong></header><main><h1>{showProjects?'Your projects':'Opening Post Creator'}</h1>{loading&&<p>Preparing your editable canvas…</p>}{error&&<p role="alert">{error}</p>}<button type="button" onClick={()=>void create()} disabled={loading}><Save size={16}/> Create new post</button><button type="button" onClick={()=>void loadProjects()}>Open saved projects</button>{projects.map(p=><button key={p.id} type="button" onClick={()=>{setLoading(true);void server.get(p.id).then(open).catch(e=>setError(String(e))).finally(()=>setLoading(false))}}>{p.title}</button>)}</main></div>
}
