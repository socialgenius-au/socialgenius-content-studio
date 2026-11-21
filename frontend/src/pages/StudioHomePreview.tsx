import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Home, FolderKanban, FileText, Image, Images, Clapperboard, ScanSearch, RefreshCw, Sparkles, FolderOpen, LayoutTemplate, Palette, Settings, Bell, Search, ChevronLeft, ChevronRight, Plus, UploadCloud, WandSparkles, Play, ArrowUpRight, Menu } from 'lucide-react'
import './StudioHomePreview.css'

const nav = [
  { name:'Home', icon:Home, url:'/dashboard' },
  { name:'Campaigns', icon:FolderKanban, url:'/dashboard-classic' },
  { name:'Create Brief', icon:FileText, url:'/create-brief' },
  { name:'Post Creator', icon:Image, url:'/post-creator-v2' },
  { name:'Carousel Creator', icon:Images, url:'/carousel-creator' },
  { name:'Video Studio', icon:Clapperboard, url:'/video-studio-v2' },
  { name:'Deconstructor', icon:ScanSearch, url:'/deconstructor' },
  { name:'Reconstructor', icon:RefreshCw, url:'/video-studio-v2' },
  { name:'AI Generators', icon:Sparkles, url:'/video-studio-v2' },
  { name:'Assets', icon:FolderOpen, url:'/dashboard' },
  { name:'Templates', icon:LayoutTemplate, url:'/dashboard' },
  { name:'Brand Kit', icon:Palette, url:'/dashboard' },
]
const actions = [
  { title:'Social Post', detail:'Single image content for social media', icon:Image, tone:'lilac', url:'/post-creator-v2' },
  { title:'Carousel', detail:'Multi-image story (swipe or slide)', icon:Images, tone:'blue', url:'/carousel-creator' },
  { title:'Video', detail:'Create short or long-form videos', icon:Clapperboard, tone:'pink', url:'/video-studio-v2' },
  { title:'From Reference', detail:'Analyse and recreate a new version', icon:ScanSearch, tone:'mint', url:'/deconstructor' },
  { title:'With AI', detail:'Create content from an idea or prompt', icon:WandSparkles, tone:'peach', url:'/video-studio-v2' },
  { title:'AI Generators', detail:'Images and video • Low, Medium, Best', icon:Sparkles, tone:'cream', url:'/video-studio-v2' },
]
const templates = [
  { name:'Special Offer', kind:'Promotions', tone:'offer', description:'This Week' },
  { name:'New Arrival', kind:'Product', tone:'arrival', description:'Product spotlight' },
  { name:'Business Growth', kind:'Business', tone:'growth', description:'Strategy' },
  { name:'Property Opportunity', kind:'Real Estate', tone:'property', description:'Discover your next home' },
  { name:'Fitness & Wellness', kind:'Health & Wellness', tone:'fitness', description:'Routine' },
  { name:'Mindset & Success', kind:'Education', tone:'mindset', description:'Inspiration' },
]
const filters = ['All','Business','Marketing','Product','Service','Education','Real Estate','Health & Wellness','Promotions']
const projects = [
  { name:'Tile Education – Benefits', type:'Video', time:'0:43', tone:'tile', url:'/deconstructor' },
  { name:'Property – Home Buying', type:'Video', time:'0:38', tone:'property', url:'/video-studio-v2' },
  { name:'Product – Skincare', type:'Video', time:'0:32', tone:'product', url:'/video-studio-v2' },
  { name:'Fitness – Quick Routine', type:'Video', time:'0:45', tone:'fitness', url:'/video-studio-v2' },
  { name:'Business Growth Tips', type:'Video', time:'1:02', tone:'growth', url:'/video-studio-v2' },
  { name:'Tile Styles – Comparison', type:'Video', time:'0:36', tone:'tile', url:'/video-studio-v2' },
]
export default function StudioHomePreview() {
  const [collapsed,setCollapsed] = useState(false)
  const [mobileMenu,setMobileMenu] = useState(false)
  const [filter,setFilter] = useState('All')
  const [search,setSearch] = useState('')
  const navigate=useNavigate()
  const visibleTemplates=templates.filter(t=>(filter==='All'||t.kind===filter||filter==='Marketing')&&(!search|| (t.name+' '+t.kind).toLowerCase().includes(search.toLowerCase())))
  const visibleProjects=projects.filter(p=>!search||(p.name+' '+p.type).toLowerCase().includes(search.toLowerCase()))
  return <div className="sg-home">
    <aside className={'sg-side '+(collapsed?'sg-side-collapsed ':'')+(mobileMenu?'sg-side-mobile-open':'')}>
      <div className="sg-brand"><img className="sg-brand-logo" src="/social-genius-official-logo.svg" alt="Social Genius official tree logo" />{!collapsed&&<div><strong>Social Genius</strong><small>Content Studio</small><em>The Positioning People</em></div>}</div>
      <button className="sg-collapse" aria-label="Toggle navigation" onClick={()=>setCollapsed(!collapsed)}>{collapsed?<ChevronRight size={17}/>:<ChevronLeft size={17}/>}</button>
      <nav aria-label="Studio navigation">{nav.map(item=><Link title={item.name} key={item.name} className={'sg-nav-link '+(item.name==='Home'?'sg-active':'')+(item.name==='AI Generators'?' sg-generator-nav':'')} to={item.url}><item.icon size={19}/>{!collapsed&&<span>{item.name}</span>}</Link>)}</nav>
      <div className="sg-side-bottom">{!collapsed&&<><div className="sg-project-tag"><span>◎</span><div><b>Design Preview</b><small>● UI concept</small></div></div><p>Preview workspace</p></>}<div className="sg-side-footer"><Link to="/settings" title="Settings"><Settings size={20}/></Link><Bell size={20}/><div className="sg-avatar">AS</div></div></div>
    </aside>
    <div className="sg-main">
      <header className="sg-top"><button className="sg-mobile-toggle" aria-label="Open navigation" onClick={()=>setMobileMenu(!mobileMenu)}><Menu/></button><div className="sg-search"><Search size={21}/><input aria-label="Search templates and projects" placeholder="Search projects, templates, assets, brands..." value={search} onChange={e=>setSearch(e.target.value)}/></div><button className="sg-ai-pill" onClick={()=>navigate('/video-studio-v2')}><Sparkles size={18}/> AI Assistant</button><Bell size={20}/><span className="sg-avatar">AS</span></header>
      <main className="sg-content">
        <section className="sg-hero"><div className="sg-hero-copy"><p>Welcome to</p><h1>Social Genius <span>Content Studio</span></h1><div>Plan. Create. Analyse. Recreate. Scale.</div></div><div className="sg-hero-logo"><img src="/social-genius-official-logo.svg" alt="Social Genius official tree logo" /><small>The Positioning People</small></div><div className="sg-gold-wave"/></section>
        <div className="sg-section-heading"><h2><Sparkles/> What would you like to create today?</h2><div className="sg-heading-actions"><button onClick={()=>navigate('/dashboard-classic')}><Plus size={16}/> New Project</button><button className="sg-primary" onClick={()=>navigate('/video-studio-v2')}><UploadCloud size={16}/> Upload Media</button></div></div>
        <section className="sg-create-grid">{actions.map(a=><Link key={a.title} className={'sg-create-card '+a.tone} to={a.url}><a.icon size={35}/><strong>{a.title}</strong><p>{a.detail}</p><span className="sg-card-arrow"><ArrowUpRight size={17}/></span></Link>)}</section>
        <div className="sg-section-heading sg-templates-heading"><h2><LayoutTemplate/> Templates</h2><div className="sg-filters">{filters.map(f=><button key={f} onClick={()=>setFilter(f)} className={filter===f?'selected':''}>{f}</button>)}</div><Link to="/dashboard-classic">View All →</Link></div>
        <section className="sg-template-grid">{visibleTemplates.length?visibleTemplates.map(t=><button onClick={()=>navigate('/post-creator-v2')} key={t.name} className={'sg-template '+t.tone}><strong>{t.name}</strong><span>{t.description}</span></button>):<p>No templates match your search.</p>}</section>
        <div className="sg-section-heading"><h2><Play/> Recent Projects</h2><Link to="/dashboard">View All →</Link></div>
        <section className="sg-recent-grid">{visibleProjects.length?visibleProjects.map(p=><Link to={p.url} className="sg-recent" key={p.name}><div className={'sg-recent-art '+p.tone}><span className="sg-play"><Play size={12} fill="currentColor"/> {p.time}</span></div><div className="sg-recent-info"><b>{p.name}</b><small>{p.type} · Design preview</small></div></Link>):<p>No projects match your search.</p>}</section>
        <p className="sg-preview-note">UI design preview · Templates and recent projects are illustrative; these are not live records. Generator and other unfinished navigation entries lead to existing workspaces until their dedicated screens are built.</p>
      </main>
    </div>
  </div>
}
