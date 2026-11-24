import { useCallback, useEffect, useMemo, useState } from 'react'
import { brandKitsApi } from '../api/client'
import { createHttpBrandKitStore } from '../lib/carousel/assetsStore'
import type { BrandKitSummary } from '../lib/carousel/brandKit'
import BrandKitManager from './carousel-creator/components/BrandKitManager'
import { Link, useNavigate } from 'react-router-dom'
import { Home, FolderKanban, FileText, Image, Images, Clapperboard, ScanSearch, Sparkles, Palette, FolderOpen, Settings, Search, Bell, ChevronLeft, ChevronRight, Lightbulb, RefreshCw, ArrowRight, Save, Menu, X } from 'lucide-react'
import './ContentBriefPage.css'

const sections = [
  { label:'Home', url:'/home', icon:Home },
  { label:'Campaigns', url:'/dashboard-classic', icon:FolderKanban },
  { label:'Create Brief', url:'/create-brief', icon:FileText },
  { label:'Post Creator', url:'/post-creator-v2', icon:Image },
  { label:'Carousel Creator', url:'/carousel-creator', icon:Images },
  { label:'Video Studio', url:'/video-studio-v2', icon:Clapperboard },
  { label:'From Reference', url:'/deconstructor', icon:ScanSearch },
  { label:'With AI', url:'/video-studio-v2', icon:Sparkles },
  { label:'AI Generators', url:'/video-studio-v2', icon:Sparkles },
  { label:'Brand Kit', url:'/dashboard-classic', icon:Palette },
  { label:'Assets & Media', url:'/dashboard-classic', icon:FolderOpen },
  { label:'Settings', url:'/settings', icon:Settings },
]
const initialIdeas = [
  '5 key tips for choosing a reliable washing machine',
  'Front load vs top load – which is better for your home?',
  'Common washing machine mistakes to avoid',
  'How to make your washing machine last longer',
  "A smart buyer's guide for busy families",
]
const ideaSets: Record<string,string[]> = {
  Ideas:initialIdeas,
  Angles:['Explain the most common misconception','Compare two popular choices','Show a practical before-and-after','Answer a frequently asked question','Share a quick expert checklist'],
  Headlines:['The essential guide to getting started','What most people overlook','Five things to know before you choose','A smarter way to approach this','Your next step, made simple'],
  Outlines:['Hook → Problem → Solution → Call to action','Question → Three tips → Summary','Before → After → How to achieve it','Myth → Reality → Practical advice','Audience need → Benefits → Next step'],
}
type ContentType = 'post' | 'carousel' | 'video'
type Brief = { topic:string; goal:string; audience:string; message:string; tone:string; brand:string; platforms:string[]; contentType:ContentType; brandKitId:number|null; product:string; offer:string; cta:string; instructions:string; references:string }
const empty: Brief = {topic:'',goal:'',audience:'',message:'',tone:'',brand:'',platforms:['Instagram','Facebook'],contentType:'post',brandKitId:null,product:'',offer:'',cta:'',instructions:'',references:''}
const platforms = ['Instagram','Facebook','TikTok','YouTube','LinkedIn']
export default function ContentBriefPage(){
  const navigate=useNavigate()
  const [collapsed,setCollapsed]=useState(false)
  const [mobile,setMobile]=useState(false)
  const [assistantOpen,setAssistantOpen]=useState(true)
  const [tab,setTab]=useState('Ideas')
  const [brief,setBrief]=useState<Brief>(()=>{try {return {...empty,...JSON.parse(sessionStorage.getItem('sg-content-brief')||'{}')}} catch{return empty}})
  const kitStore=useMemo(()=>createHttpBrandKitStore(brandKitsApi),[])
  const [kits,setKits]=useState<BrandKitSummary[]>([])
  const [kitEditorOpen,setKitEditorOpen]=useState(false)
  const [kitError,setKitError]=useState('')
  const loadKits=useCallback(async()=>{try{const items=await kitStore.list();setKits(items);setKitError('')}catch(e){setKitError(e instanceof Error?e.message:'Could not load Brand Kits. Please try again.')}},[kitStore])
  useEffect(()=>{void loadKits()},[loadKits])
  const [saved,setSaved]=useState(false)
  const [validation,setValidation]=useState(false)
  const [query,setQuery]=useState('')
  const update=(patch:Partial<Brief>)=>{setBrief(v=>({...v,...patch}));setSaved(false)}
  const save=()=>{sessionStorage.setItem('sg-content-brief',JSON.stringify(brief));setSaved(true)}
  const toggle=(p:string)=>update({platforms:brief.platforms.includes(p)?brief.platforms.filter(x=>x!==p):[...brief.platforms,p]})
  const goNext=()=>{setValidation(true);if(!brief.topic.trim()||!brief.goal||!brief.audience.trim()||!brief.message.trim()||!brief.platforms.length)return;save();const target={post:'/post-creator-v2',carousel:'/carousel-creator',video:'/video-studio-v2'}[brief.contentType];navigate(target+'?fromBrief=1',{state:{contentBrief:brief,brandKitId:brief.brandKitId}})}
  return <div className="sgb-app">
    <aside className={'sgb-sidebar '+(collapsed?'sgb-collapsed ':'')+(mobile?'sgb-mobile-open':'')}>
      <button className="sgb-collapse" onClick={()=>setCollapsed(v=>!v)} aria-label="Collapse navigation">{collapsed?<ChevronRight size={17}/>:<ChevronLeft size={17}/>}</button>
      <div className="sgb-logo"><img src="/social-genius-official-logo.svg" alt="Social Genius official logo"/>{!collapsed&&<><strong>Social Genius</strong><span>Content Studio</span><small>The Positioning People</small></>}</div>
      <nav aria-label="Content Studio">{sections.map(s=><Link key={s.label} title={s.label} className={'sgb-nav '+(s.label==='Create Brief'?'sgb-current':'')} to={s.url}><s.icon size={19}/>{!collapsed&&s.label}</Link>)}</nav>
    </aside>
    <div className="sgb-body">
      <header className="sgb-top"><button className="sgb-menu" onClick={()=>setMobile(!mobile)} aria-label="Toggle navigation"><Menu/></button><div className="sgb-search"><Search size={20}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search projects, templates, assets, brands..." aria-label="Search"/></div><button className="sgb-ai-top" onClick={()=>setAssistantOpen(v=>!v)}><Sparkles size={19}/> AI Assistant</button><Bell size={20}/><div className="sgb-avatar">AS</div></header>
      <main className="sgb-main">
        <div className="sgb-banner"><div><h1>Create <em>Content Brief</em></h1><p>Turn your idea into a clear, actionable content plan.</p></div><img src="/social-genius-official-logo.svg" alt="Social Genius" className="sgb-banner-logo"/></div>
        <div className="sgb-steps">{['Content Brief','Choose Creator','Create & Edit'].map((s,i)=><div className={'sgb-step '+(!i?'sgb-step-active':'')} key={s}><span>{i+1}</span><strong>{s}</strong></div>)}</div>
        <div className="sgb-brief-layout">
          <section className="sgb-brief-fields" aria-label="Content brief details">
            <fieldset className="sgb-type-card"><legend>Content Type <b>*</b><small>Choose what you want to create</small></legend><div className="sgb-type-options">
              {([{id:'post',label:'Post',detail:'Single image',icon:Image},{id:'carousel',label:'Carousel',detail:'Multiple slides',icon:Images},{id:'video',label:'Video',detail:'Short or long-form',icon:Clapperboard}] as const).map(t=><button key={t.id} type="button" className={brief.contentType===t.id?'selected':''} aria-pressed={brief.contentType===t.id} onClick={()=>update({contentType:t.id})}><t.icon size={25}/><span><strong>{t.label}</strong><small>{t.detail}</small></span>{brief.contentType===t.id&&<span className="sgb-type-check">✓</span>}</button>)}
            </div></fieldset>
            <div className="sgb-brief-grid">
              <label className="sgb-field sgb-tile"><span>Project Title <b>*</b></span><input value={brief.topic} onChange={e=>update({topic:e.target.value})} placeholder="e.g. Summer Launch Campaign" /></label>
              <label className="sgb-field sgb-tile"><span>Campaign Objective <b>*</b></span><select value={brief.goal} onChange={e=>update({goal:e.target.value})}><option value="">Select primary objective</option>{['Awareness','Engagement','Lead generation','Sales','Education','Brand positioning'].map(v=><option key={v}>{v}</option>)}</select></label>
              <label className="sgb-field sgb-tile"><span>Audience <b>*</b></span><input value={brief.audience} onChange={e=>update({audience:e.target.value})} placeholder="e.g. Homeowners, 25–55, Sydney"/></label>
              <label className="sgb-field sgb-tile"><span>Key Message <b>*</b></span><textarea rows={2} value={brief.message} onChange={e=>update({message:e.target.value})} placeholder="What is the main message you want to communicate?"/></label>
              <div className="sgb-tile"><strong>Product / Service</strong><p>What are you promoting or explaining?</p><label className="sgb-field"><span>Product or service (optional)</span><input value={brief.product} onChange={e=>update({product:e.target.value})} placeholder="e.g. Food packaging for restaurants"/></label><label className="sgb-field"><span>Offer (optional)</span><input value={brief.offer} onChange={e=>update({offer:e.target.value})} placeholder="e.g. Free consultation"/></label></div>
              <div className="sgb-tile"><strong>Brand Kit</strong><p>Apply your brand style to keep it consistent.</p><label className="sgb-field"><span>Saved Brand Kit</span><select value={brief.brandKitId??''} onChange={e=>{const id=e.target.value?Number(e.target.value):null;const selected=kits.find(k=>k.id===id);update({brandKitId:id,brand:selected?.name??''})}}><option value="">No Brand Kit selected</option>{kits.map(k=><option key={k.id} value={k.id}>{k.name} ({k.logoCount} logos)</option>)}</select></label><button type="button" className="sgb-manage-kit" onClick={()=>setKitEditorOpen(true)}><Palette size={17}/> Create / Edit Brand Kit <span>Upload logos, colours, fonts and brand images</span></button>{kitError&&<p role="alert" className="sgb-kit-error">{kitError}</p>}<label className="sgb-field"><span>Tone of voice</span><select value={brief.tone} onChange={e=>update({tone:e.target.value})}><option value="">Select tone</option>{['Professional','Friendly','Confident','Educational','Inspirational','Playful'].map(v=><option key={v}>{v}</option>)}</select></label></div>
            </div>
            <div className="sgb-brief-grid sgb-brief-extras"><label className="sgb-field sgb-tile"><span>Call to Action (optional)</span><input value={brief.cta} onChange={e=>update({cta:e.target.value})} placeholder="e.g. Enquire today"/></label><label className="sgb-field sgb-tile"><span>References / Existing Assets (optional)</span><textarea rows={2} value={brief.references} onChange={e=>update({references:e.target.value})} placeholder="Paste a reference link or describe existing images, videos or templates"/></label></div><label className="sgb-field sgb-tile sgb-instructions"><span>Additional instructions for AI or the creator (optional)</span><textarea rows={2} value={brief.instructions} onChange={e=>update({instructions:e.target.value})} placeholder="Anything else the Creator should know?"/></label>
            <div className="sgb-tile sgb-platform-tile"><strong>Publishing platforms</strong><p>Choose where this content will appear.</p><div className="sgb-platforms">{platforms.map((p,i)=><button type="button" key={p} className={brief.platforms.includes(p)?'sgb-selected':''} onClick={()=>toggle(p)} aria-pressed={brief.platforms.includes(p)}><span className="sgb-platform-icon">{['◎','f','♪','▶','in'][i]}</span><strong>{p}</strong><span className="sgb-check">{brief.platforms.includes(p)?'✓':'○'}</span></button>)}</div></div>
          </section>
          <aside className="sgb-summary"><div className="sgb-summary-art"><Sparkles size={55}/></div><div className="sgb-summary-body"><h2><Sparkles size={21}/> Brief Summary</h2><p>A live view of your content brief.</p><dl>{([['Content Type',brief.contentType[0].toUpperCase()+brief.contentType.slice(1)],['Project',brief.topic],['Objective',brief.goal],['Audience',brief.audience],['Key Message',brief.message],['Product / Service',brief.product],['Call to Action',brief.cta],['Brand Kit',kits.find(k=>k.id===brief.brandKitId)?.name||'Not selected']] as const).map(([k,v])=><div key={k}><dt>{k}:</dt><dd>{v||'—'}</dd></div>)}</dl></div></aside>
        </div>
        {validation&&(!brief.topic.trim()||!brief.goal||!brief.audience.trim()||!brief.message.trim()||!brief.platforms.length)&&<p role="alert" className="sgb-validation">Please complete Project Title, Objective, Audience, Key Message and at least one publishing platform.</p>}
        {kitEditorOpen&&<div className="sgb-kit-overlay" role="dialog" aria-modal="true" aria-label="Manage saved Brand Kits"><div className="sgb-kit-modal"><BrandKitManager store={kitStore} onClose={()=>{setKitEditorOpen(false);void loadKits()}} onChanged={()=>{void loadKits()}} /></div></div>}
        <div className="sgb-actions">{}<button onClick={save}><Save size={17}/> {saved?'Draft saved in this browser':'Save as Draft'}</button><button className="sgb-next" onClick={goNext} disabled={false}>Continue to {brief.contentType==='post'?'Post Creator':brief.contentType==='carousel'?'Carousel Creator':'Video Studio'} <ArrowRight size={18}/></button></div>
        <p className="sgb-note">Briefs are saved in this browser session. Continue opens your selected Creator; production details such as slides, scenes, media and transitions belong in the editor.</p>
      </main>
    </div>
  </div>
}
