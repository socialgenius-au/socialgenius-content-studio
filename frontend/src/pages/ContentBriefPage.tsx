import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Home, FolderKanban, FileText, Image, Images, Clapperboard, ScanSearch, Sparkles, Palette, FolderOpen, Settings, Search, Bell, ChevronLeft, ChevronRight, Lightbulb, RefreshCw, ArrowRight, Save, Menu, X } from 'lucide-react'
import './ContentBriefPage.css'

const sections = [
  { label:'Home', url:'/dashboard', icon:Home },
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
type Brief = { topic:string; goal:string; audience:string; message:string; tone:string; brand:string; platforms:string[] }
const empty: Brief = {topic:'',goal:'',audience:'',message:'',tone:'',brand:'',platforms:['Instagram','Facebook']}
const platforms = ['Instagram','Facebook','TikTok','YouTube','LinkedIn']
export default function ContentBriefPage(){
  const navigate=useNavigate()
  const [collapsed,setCollapsed]=useState(false)
  const [mobile,setMobile]=useState(false)
  const [assistantOpen,setAssistantOpen]=useState(true)
  const [tab,setTab]=useState('Ideas')
  const [brief,setBrief]=useState<Brief>(()=>{try {return {...empty,...JSON.parse(sessionStorage.getItem('sg-content-brief')||'{}')}} catch{return empty}})
  const [saved,setSaved]=useState(false)
  const [query,setQuery]=useState('')
  const update=(patch:Partial<Brief>)=>{setBrief(v=>({...v,...patch}));setSaved(false)}
  const save=()=>{sessionStorage.setItem('sg-content-brief',JSON.stringify(brief));setSaved(true)}
  const toggle=(p:string)=>update({platforms:brief.platforms.includes(p)?brief.platforms.filter(x=>x!==p):[...brief.platforms,p]})
  const goNext=()=>{if(!brief.topic.trim()||!brief.goal||!brief.platforms.length)return;save();navigate('/create/generate')}
  return <div className="sgb-app">
    <aside className={'sgb-sidebar '+(collapsed?'sgb-collapsed ':'')+(mobile?'sgb-mobile-open':'')}>
      <button className="sgb-collapse" onClick={()=>setCollapsed(v=>!v)} aria-label="Collapse navigation">{collapsed?<ChevronRight size={17}/>:<ChevronLeft size={17}/>}</button>
      <div className="sgb-logo"><img src="/social-genius-official-logo.svg" alt="Social Genius official logo"/>{!collapsed&&<><strong>Social Genius</strong><span>Content Studio</span><small>The Positioning People</small></>}</div>
      <nav aria-label="Content Studio">{sections.map(s=><Link key={s.label} title={s.label} className={'sgb-nav '+(s.label==='Create Brief'?'sgb-current':'')} to={s.url}><s.icon size={19}/>{!collapsed&&s.label}</Link>)}</nav>
    </aside>
    <div className="sgb-body">
      <header className="sgb-top"><button className="sgb-menu" onClick={()=>setMobile(!mobile)} aria-label="Toggle navigation"><Menu/></button><div className="sgb-search"><Search size={20}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search projects, templates, assets, brands..." aria-label="Search"/></div><button className="sgb-ai-top" onClick={()=>setAssistantOpen(v=>!v)}><Sparkles size={19}/> AI Assistant</button><Bell size={20}/><div className="sgb-avatar">AS</div></header>
      <main className="sgb-main">
        <div className="sgb-banner"><div><h1>Create <em>Content</em></h1><p>Turn your idea into a high-performing post, carousel or video.</p></div><Clapperboard size={65}/></div>
        <div className="sgb-steps">{['Content Brief','Generate','Edit & Enhance','Publish / Export'].map((s,i)=><div className={'sgb-step '+(!i?'sgb-step-active':'')} key={s}><span>{i+1}</span><strong>{s}</strong></div>)}</div>
        <div className={'sgb-workspace '+(!assistantOpen?'sgb-wide':'')}>
          <section className="sgb-form-card">
            <div className="sgb-card-title"><FileText size={34}/><div><h2>Content Brief</h2><p>Tell us what you want to create.</p></div></div>
            <label className="sgb-field sgb-full"><span>Content Topic / Idea <b>*</b></span><textarea rows={3} value={brief.topic} onChange={e=>update({topic:e.target.value})} placeholder="e.g. How to choose the right washing machine for a family"/></label>
            <div className="sgb-two"><label className="sgb-field"><span>Goal / Objective <b>*</b></span><select value={brief.goal} onChange={e=>update({goal:e.target.value})}><option value="">Select a goal</option>{['Awareness','Engagement','Lead generation','Sales','Education','Brand positioning'].map(x=><option key={x}>{x}</option>)}</select></label><label className="sgb-field"><span>Audience</span><input value={brief.audience} onChange={e=>update({audience:e.target.value})} placeholder="Who is this for?"/></label></div>
            <div className="sgb-two"><label className="sgb-field"><span>Key Message (optional)</span><input value={brief.message} onChange={e=>update({message:e.target.value})} placeholder="Main point or takeaway..."/></label><label className="sgb-field"><span>Tone of Voice</span><select value={brief.tone} onChange={e=>update({tone:e.target.value})}><option value="">Select tone</option>{['Professional','Friendly','Confident','Educational','Inspirational','Playful'].map(x=><option key={x}>{x}</option>)}</select></label></div>
            <label className="sgb-field sgb-full"><span>Brand Kit</span><input value={brief.brand} onChange={e=>update({brand:e.target.value})} placeholder="Client or brand name (Brand Kit integration coming next)"/></label>
            <div className="sgb-field"><span>Platform(s) <b>*</b></span><div className="sgb-platforms">{platforms.map((p,i)=><button type="button" key={p} className={brief.platforms.includes(p)?'sgb-selected':''} onClick={()=>toggle(p)} aria-pressed={brief.platforms.includes(p)}><span className="sgb-platform-icon">{['◎','f','♪','▶','in'][i]}</span><strong>{p}</strong><span className="sgb-check">{brief.platforms.includes(p)?'✓':'○'}</span></button>)}</div></div>
          </section>
          {assistantOpen&&<aside className="sgb-helper"><div className="sgb-helper-title"><Sparkles size={28}/><div><h2>AI Content Helper</h2><p>Get ideas, angles and a ready-to-use brief.</p></div><button aria-label="Hide AI suggestions" onClick={()=>setAssistantOpen(false)}><X size={17}/></button></div><div className="sgb-tabs">{Object.keys(ideaSets).map(x=><button className={tab===x?'active':''} key={x} onClick={()=>setTab(x)}>{x}</button>)}</div><div className="sgb-ideas">{ideaSets[tab].filter(x=>!query||x.toLowerCase().includes(query.toLowerCase())).map(x=><button key={x} onClick={()=>update({topic:x})}><Lightbulb size={19}/>{x}</button>)}</div><button className="sgb-more" onClick={()=>setTab(tab==='Ideas'?'Angles':'Ideas')}><RefreshCw size={17}/> Explore More {tab==='Ideas'?'Angles':'Ideas'}</button><p className="sgb-helper-note">Example suggestions only. Live AI generation will be connected during the functionality phase.</p></aside>}
        </div>
        <div className="sgb-actions">{!assistantOpen&&<button onClick={()=>setAssistantOpen(true)}><Sparkles size={17}/> Show AI Helper</button>}<button onClick={save}><Save size={17}/> {saved?'Draft saved in this browser':'Save as Draft'}</button><button className="sgb-next" onClick={goNext} disabled={!brief.topic.trim()||!brief.goal||!brief.platforms.length}>Next: Generate Content <ArrowRight size={18}/></button></div>
        <p className="sgb-note">Design implementation: drafts are saved only in this browser session. The next step opens the Generate design screen; actual AI media generation and persistent storage are not yet connected.</p>
      </main>
    </div>
  </div>
}
