import { useState } from 'react'
import { useClient } from '@/contexts/ClientContext'
import { Link, useNavigate } from 'react-router-dom'
import { Home, FolderKanban, FileText, Image, Images, Clapperboard, ScanSearch, RefreshCw, Sparkles, FolderOpen, LayoutTemplate, Palette, Settings, Bell, Search, ChevronLeft, ChevronRight, Plus, UploadCloud, WandSparkles, Play, ArrowUpRight, Menu, Users, Target, BarChart3, BriefcaseBusiness, Zap, ExternalLink } from 'lucide-react'
import { ShowcaseMedia, ShowcaseTemplates, showcaseTemplates } from './StudioShowcase'
import './StudioHomePreview.css'

const nav = [
  { name:'Home', icon:Home, url:'/home' },
  { name:'Dashboard', icon:BarChart3, url:'/dashboard' },
  { name:'Campaigns', icon:FolderKanban, url:'/dashboard-classic' },
  { name:'Create Brief', icon:FileText, url:'/create-brief' },
  { name:'Post Creator', icon:Image, url:'/post-creator-v2' },
  { name:'Carousel Creator', icon:Images, url:'/carousel-creator' },
  { name:'Video Studio', icon:Clapperboard, url:'/video-studio-v3' },
  { name:'Deconstructor', icon:ScanSearch, url:'/deconstructor-v3' },
  { name:'Reconstructor', icon:RefreshCw, url:'/reconstructor/assets' },
  { name:'AI Generators', icon:Sparkles, url:'/video-studio-v2' },
  { name:'Clients', icon:Users, url:'/clients' },
  { name:'Strategic Intelligence', icon:Target, url:'/dashboard-classic' },
  { name:'Positioning', icon:Target, url:'/dashboard-classic' },
  { name:'Campaigns & Growth', icon:FolderKanban, url:'/dashboard-classic' },
  { name:'Assets', icon:FolderOpen, url:'/assets' },
  { name:'Templates', icon:LayoutTemplate, url:'/templates' },
  { name:'Brand Kit', icon:Palette, url:'/brands' },
]
const actions = [
  { title:'Social Post', detail:'Single image content for social media', icon:Image, tone:'lilac', url:'/post-creator-v2' },
  { title:'Carousel', detail:'Multi-image story (swipe or slide)', icon:Images, tone:'blue', url:'/carousel-creator' },
  { title:'Video', detail:'Create short or long-form videos', icon:Clapperboard, tone:'pink', url:'/video-studio-v3' },
  { title:'From Reference', detail:'Analyse and recreate a new version', icon:ScanSearch, tone:'mint', url:'/deconstructor-v3' },
  { title:'With AI', detail:'Create content from an idea or prompt', icon:WandSparkles, tone:'peach', url:'/video-studio-v2' },
  { title:'AI Generators', detail:'Images and video • Low, Medium, Best', icon:Sparkles, tone:'cream', url:'/video-studio-v2' },
]
const filters = ['All', ...new Set(showcaseTemplates.map(item => item.category))]
const actionMedia = ['product','editorial','workspace','property','wellness','workspace']
export default function StudioHomePreview() {
  const {client,clients,loading,switchClient}=useClient()
  const [collapsed,setCollapsed] = useState(false)
  const [mobileMenu,setMobileMenu] = useState(false)
  const [filter,setFilter] = useState('All')
  const [search,setSearch] = useState('')
  const navigate=useNavigate()
  const visibleClients=clients.filter(c=>!search||(c.name+' '+c.industry).toLowerCase().includes(search.toLowerCase()))
  return <div className="sg-home">
    <aside className={'sg-side '+(collapsed?'sg-side-collapsed ':'')+(mobileMenu?'sg-side-mobile-open':'')}>
      <div className="sg-brand"><img className="sg-brand-logo" src="/social-genius-official-logo.svg" alt="Social Genius official tree logo" />{!collapsed&&<div><strong>Social Genius</strong><small>Content Studio</small><em>The Positioning People</em></div>}</div>
      <button className="sg-collapse" aria-label="Toggle navigation" onClick={()=>setCollapsed(!collapsed)}>{collapsed?<ChevronRight size={17}/>:<ChevronLeft size={17}/>}</button>
      <nav aria-label="Studio navigation">{nav.map(item=><Link title={item.name} key={item.name} className={'sg-nav-link '+(item.name==='Home'?'sg-active':'')+(item.name==='AI Generators'?' sg-generator-nav':'')} to={item.url}><item.icon size={19}/>{!collapsed&&<span>{item.name}</span>}</Link>)}</nav>
      <div className="sg-side-bottom">{!collapsed&&<><div className="sg-project-tag"><span>✦</span><div><b>Content Studio</b><small>Creative workspace</small></div></div></>}<div className="sg-side-footer"><Link to="/settings" title="Settings"><Settings size={20}/></Link><Bell size={20}/><div className="sg-avatar">AS</div></div></div>
    </aside>
    <div className="sg-main">
      <header className="sg-top"><button className="sg-mobile-toggle" aria-label="Open navigation" onClick={()=>setMobileMenu(!mobileMenu)}><Menu/></button><div className="sg-client-switch"><BriefcaseBusiness size={17}/><select aria-label="Active client" value={client?.id??''} onChange={e=>switchClient(e.target.value)} disabled={!clients.length}><option value="" disabled>{loading?"Loading clients…":"Choose client"}</option>{clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div><div className="sg-search"><Search size={21}/><input aria-label="Search templates and projects" placeholder="Search projects, templates, assets, brands..." value={search} onChange={e=>setSearch(e.target.value)}/></div><button className="sg-ai-pill" onClick={()=>navigate('/video-studio-v2')}><Sparkles size={18}/> AI Assistant</button><Bell size={20}/><span className="sg-avatar">AS</span></header>
      <main className="sg-content">
        <section className="sg-hero"><div className="sg-hero-copy"><p>Welcome to</p><h1>Social Genius <span>Content Studio</span></h1><div>Plan. Create. Analyse. Recreate. Scale.</div></div><div className="sg-hero-logo"><img src="/social-genius-official-logo.svg" alt="Social Genius official tree logo" /><small>The Positioning People</small></div><div className="sg-gold-wave"/></section>
        <div className="sg-section-heading"><h2><Sparkles/> What would you like to create today?</h2><div className="sg-heading-actions"><button onClick={()=>navigate('/post-creator-v2')}><Plus size={16}/> New Project</button><button className="sg-primary" onClick={()=>navigate('/clients/'+(client?.id??'')+'/library')} disabled={!client}><UploadCloud size={16}/> Upload Media</button></div></div>
        <section className="sg-create-grid">{actions.map((a,index)=><article className={'sg-create-card sg-create-visual '+a.tone} key={a.title}><ShowcaseMedia asset={actionMedia[index]} video={a.title==='Video'||a.title==='From Reference'} label={a.title+' example'} /><Link to={a.url}><a.icon size={19}/><strong>{a.title}</strong><ArrowUpRight size={16}/></Link><p>{a.detail}</p></article>)}</section>
        <div className="sg-section-heading sg-templates-heading"><h2><LayoutTemplate/> Templates</h2><div className="sg-filters">{filters.map(f=><button key={f} onClick={()=>setFilter(f)} className={filter===f?'selected':''}>{f}</button>)}</div><Link to="/templates">View All →</Link></div>
        <ShowcaseTemplates category={filter} query={search} />
        <div className="sg-home-lower">
          <section className="sg-home-panel"><div className="sg-section-heading"><h2><Users/> Your Client Workspaces</h2><Link to="/clients">View all →</Link></div>
            <div className="sg-client-grid">{visibleClients.slice(0,6).map(c=><Link to={`/clients/${c.id}/overview`} className="sg-client-card" key={c.id}><div className="sg-client-card-head"><span className="sg-client-initial" style={{background:c.color}}>{c.logoInitial}</span><div><strong>{c.name}</strong><small>{c.industry}</small></div>{c.id===client?.id&&<span className="sg-focused">Focused</span>}</div><div className="sg-progress-label"><span>Positioning confidence</span><b>{c.positioningConfidence}%</b></div><div className="sg-progress-track"><span style={{width:`${Math.max(0,Math.min(100,c.positioningConfidence))}%`}}/></div></Link>)}{!loading&&visibleClients.length===0&&<p>No client workspaces match your search.</p>}</div>
          </section>
          <section className="sg-home-panel sg-quick-panel"><div className="sg-section-heading"><h2><Zap/> Quick Actions</h2></div>
            {([{label:'Browse Templates',detail:'Ready-to-use editable designs',url:'/templates',icon:LayoutTemplate},{label:'Brand Kit',detail:'Manage your brand assets',url:client?`/clients/${client.id}/brand-kit`:'/clients',icon:Palette},{label:'Manage Projects',detail:'Open saved workspaces',url:'/dashboard-classic',icon:FolderOpen},{label:'AI Assistant',detail:'Start an AI-assisted brief',url:'/post-creator-v2',icon:Sparkles}] as const).map(a=><Link key={a.label} to={a.url} className="sg-quick-action"><span><a.icon size={19}/></span><div><strong>{a.label}</strong><small>{a.detail}</small></div><ChevronRight size={16}/></Link>)}
          </section>
        </div>
        <div className="sg-home-lower sg-home-bottom">
          <section className="sg-home-panel"><div className="sg-section-heading"><h2><FolderOpen/> Continue Your Projects</h2><Link to="/dashboard-classic">Open workspace →</Link></div><p className="sg-real-data-note">Open your saved work in its Creator.</p><div className="sg-continue-actions"><Link to="/post-creator-v2"><Image size={18}/> Post projects <ArrowUpRight size={15}/></Link><Link to="/carousel-creator"><Images size={18}/> Carousel projects <ArrowUpRight size={15}/></Link><Link to="/video-studio-v3"><Clapperboard size={18}/> Video projects <ArrowUpRight size={15}/></Link></div></section>
          <section className="sg-home-panel"><div className="sg-section-heading"><h2><BarChart3/> Performance & Intelligence</h2></div><p className="sg-real-data-note">View actual performance and strategic information for your selected client.</p><div className="sg-continue-actions">{client&&<Link to={`/clients/${client.id}/analytics`}><BarChart3 size={18}/> Analytics <ExternalLink size={15}/></Link>}{client&&<Link to={`/clients/${client.id}/intelligence`}><Target size={18}/> Strategic Intelligence <ExternalLink size={15}/></Link>}</div></section>
        </div>
      </main>
    </div>
  </div>
}
