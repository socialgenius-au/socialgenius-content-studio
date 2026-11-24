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
    <main className="sg-content">
      <header className="sg-top sg-public-top">
        <Link to="/home" className="sg-brand"><img className="sg-brand-logo" src="/social-genius-official-logo.svg" alt="" /><strong>Content Studio</strong></Link>
        <Link className="sg-showcase-cta" to="/home">Studio Home</Link>
      </header>
      <section className="sg-hero sg-dashboard-hero">
        <div className="sg-hero-copy"><p>{roleLabels[role]} workspace · Sample data</p><h1>{screen.title}</h1><p>{screen.subtitle}</p></div>
      </section>
      {accountRole === 'admin' && <nav className="sg-role-tabs" aria-label="Preview sample dashboards">
        {(Object.keys(roleLabels) as DashboardRole[]).map(item => <Link key={item} to={item==='admin'?'/dashboard':`/dashboard?preview=${item}`} aria-current={role===item?'page':undefined}>{roleLabels[item]}</Link>)}
      </nav>}
      <section className="sg-kpi-grid" aria-label="Sample dashboard metrics">
        {screen.metrics.map(([label,value])=><article className="sg-home-panel" key={label}><p>{label}</p><strong>{value}</strong></article>)}
      </section>
      <section className="sg-dashboard-body">
        <article className="sg-home-panel"><h2>{screen.section}</h2><ul className="sg-work-list">
          {screen.rows.map(([campaign,title,status])=><li key={title}><div><strong>{title}</strong><small>{campaign}</small></div><span>{status}</span></li>)}
        </ul></article>
        <article className="sg-showcase-card"><ShowcaseMedia asset="workspace" video label="Sample Social Genius campaign preview" /><div><small>Social Genius</small><h2>Positioning campaign</h2><p>Sample creative preview</p></div></article>
      </section>
    </main>
  </div>
}
