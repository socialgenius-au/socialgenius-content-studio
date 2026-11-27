import { Home, Users, FolderOpen, Target, Calendar, BarChart3, CheckCircle, Sparkles, Settings, Bell, Search, Layers, Megaphone } from "lucide-react"
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { ShowcaseMedia } from './StudioShowcase'
import './StudioHomePreview.css'

const dashboards = {
  admin: {
    title: 'Admin dashboard', subtitle: 'Workspace oversight and publishing activity',
    metrics: [['Active workspaces','4'],['Campaigns in progress','7'],['Publishing this week','9'],['Open approvals','3']],
    section: 'Workspace activity',
    rows: [['Social Genius','Positioning campaign','In review'],['Social Genius','Business Show launch','Scheduled'],['Training workspace','Brand guidelines','Complete']],
  },
  manager: {
    title: 'Manager dashboard', subtitle: 'Campaign delivery, review queues and team workload',
    metrics: [['Active campaigns','3'],['Ready for review','4'],['Scheduled this week','6'],['Tasks due','5']],
    section: 'Campaign reviews',
    rows: [['Positioning campaign','Reel rough cut','In review'],['Business Show launch','Launch carousel','Scheduled'],['Founder series','Opening hook','In progress']],
  },
  staff: {
    title: 'Staff dashboard', subtitle: 'Your production queue and upcoming deadlines',
    metrics: [['Assigned tasks','5'],['In progress','2'],['Awaiting feedback','1'],['Completed this week','4']],
    section: 'Assigned work',
    rows: [['Business Show launch','Prepare carousel edits','In progress'],['Founder series','Cut the interview opener','Ready'],['Positioning campaign','Update caption variants','In review']],
  },
  client: {
    title: 'Social Genius dashboard', subtitle: 'Campaign progress, content for review and recent results',
    metrics: [['Campaigns underway','2'],['Content for review','3'],['Published this month','12'],['Sample reach','24.8k']],
    section: 'Content and campaign updates',
    rows: [['Positioning campaign','Why positioning comes first','In review'],['Business Show launch','Meet us at booth B936','Scheduled'],['Founder series','Start with the business you have','Published']],
  },
} as const

type DashboardRole = keyof typeof dashboards
const roleLabels: Record<DashboardRole,string> = {admin:'Admin',manager:'Manager',staff:'Staff',client:'Client'}

function isDashboardRole(value: string | null): value is DashboardRole {
  return value !== null && Object.prototype.hasOwnProperty.call(dashboards, value)
}

export default function RoleDashboard() {
  const { user } = useAuth()
  const [query] = useSearchParams()
  const accountRole = user?.role?.toLowerCase() ?? ''
  const requested = query.get('preview')
  const role: DashboardRole = accountRole === 'admin' && isDashboardRole(requested)
    ? requested : isDashboardRole(accountRole) ? accountRole : 'staff'
  const screen = dashboards[role]
  return <div className="sg-home sg-role-dashboard">
    <aside className="sg-dashboard-side"><Link to="/home" className="sg-brand"><img className="sg-brand-logo" src="/social-genius-official-logo.svg" alt="Social Genius"/><strong>SOCIAL GENIUS</strong><small>The Positioning People</small></Link><nav aria-label="Dashboard navigation">{[{label:'Home',url:'/home',icon:Home},{label:'Dashboard',url:'/dashboard',icon:BarChart3},{label:'Clients',url:'/clients',icon:Users},{label:'My Projects',url:'/planner',icon:FolderOpen},{label:'Creation',url:'/create-brief',icon:Sparkles},{label:'Campaigns',url:'/dashboard-classic',icon:Megaphone},{label:'Assets',url:'/assets',icon:Layers},{label:'Settings',url:'/settings',icon:Settings}].filter(item=>role!=='client'||!['Clients','Settings'].includes(item.label)).map(item=><Link key={item.label} className={'sg-nav-link '+(item.label==='Dashboard'?'sg-active':'')} to={item.url}><item.icon size={19}/>{item.label}</Link>)}</nav></aside><main className="sg-content">
      <header className="sg-top sg-public-top">
        <div><h1 className="sg-dashboard-title">{roleLabels[role]} Dashboard</h1><small>{screen.subtitle}</small></div>
        <div className="sg-dashboard-top-actions"><Search size={19}/><Bell size={19}/><Link className="sg-showcase-cta" to="/home">Studio Home</Link></div>
      </header>
      <section className="sg-hero sg-dashboard-hero">
        <div className="sg-hero-copy"><p>{roleLabels[role]} workspace · Sample data</p><h1>{screen.title}</h1><p>{screen.subtitle}</p></div>
      <div className="sg-dashboard-quick">{[{label:'New project',url:'/planner',icon:FolderOpen},{label:'Create content',url:'/create-brief',icon:Sparkles},{label:'Campaigns',url:'/dashboard-classic',icon:Target},{label:'Templates',url:'/templates',icon:Calendar}].map(item=><Link key={item.label} to={item.url}><item.icon size={25}/>{item.label}</Link>)}</div></section>
      {accountRole === 'admin' && <nav className="sg-role-tabs" aria-label="Preview sample dashboards">
        {(Object.keys(roleLabels) as DashboardRole[]).map(item => <Link key={item} to={item==='admin'?'/dashboard':`/dashboard?preview=${item}`} aria-current={role===item?'page':undefined}>{roleLabels[item]}</Link>)}
      </nav>}
      <section className="sg-kpi-grid" aria-label="Sample dashboard metrics">
        {screen.metrics.map(([label,value])=><article className="sg-home-panel" key={label}><p>{label}</p><strong>{value}</strong><div className="sg-kpi-decoration" aria-hidden="true">{[18,32,24,44,38,56,48,65].map((h,i)=><i key={i} style={{height:h+"%"}}/>)}</div></article>)}
      </section>
      <section className="sg-dashboard-body">
        <article className="sg-home-panel"><h2>{screen.section}</h2><ul className="sg-work-list">
          {screen.rows.map(([campaign,title,status])=><li key={title}><div><strong>{title}</strong><small>{campaign}</small></div><span>{status}</span></li>)}
        </ul></article>
        <article className="sg-showcase-card"><ShowcaseMedia asset="workspace" video label="Sample Social Genius campaign preview" /><div><small>Social Genius</small><h2>Positioning campaign</h2><p>Sample creative preview</p></div></article>
      </section>
      <section className="sg-dashboard-extra"><article className="sg-home-panel"><h2>{role==='staff'?'Recent content':'Recent projects'}</h2><div className="sg-dashboard-media-grid">{['product','property','editorial'].map((asset,i)=><Link key={asset} to="/planner" className="sg-showcase-card"><ShowcaseMedia asset={asset} label="Illustrative project artwork"/><div><strong>{['Product campaign','Property series','Brand stories'][i]}</strong><small>Sample preview</small></div></Link>)}</div></article><article className="sg-home-panel"><h2>{role==='staff'?'My workflow':'Delivery overview'}</h2><div className="sg-dashboard-flow">{['Brief','Create','Review','Publish'].map((step,i)=><div key={step}><CheckCircle size={24}/><span>{i+1}. {step}</span></div>)}</div><p className="sg-real-data-note">Illustrative workflow · live metrics not connected</p></article></section>
    </main>
  </div>
}
