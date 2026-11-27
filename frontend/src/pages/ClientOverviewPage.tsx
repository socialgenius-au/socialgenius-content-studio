import { PortfolioPhoto } from './ClientsPage'
import { ShowcaseMedia } from './StudioShowcase'
import { Link } from 'react-router-dom'
import { Sparkles, Mail, Phone, MapPin } from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { LoadingState } from '@/components/common/LoadingState'
import { StatusBadge } from '@/components/common/StatusBadge'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { useClient } from '@/contexts/ClientContext'
import { useAICompanion, useAICompanionContext } from '@/contexts/AICompanionContext'
import { useEntitlements } from '@/contexts/EntitlementContext'
import { NAV_GROUPS, resolveNavPath } from '@/config/navigation'

export default function ClientOverviewPage() {
  const { client, loading } = useClient()
  const { open } = useAICompanion()
  useAICompanionContext(`Overview • ${client?.name ?? ''}`)

  const { entitlements, planName, loading: entitlementsLoading } = useEntitlements()

  if (loading || !client) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="Client Overview" />
        <LoadingState rows={4} />
      </div>
    )
  }

  const quickLinks = NAV_GROUPS.flatMap(g => g.items).filter(item => item.clientScoped)

  return (
    <div className="sg-client-profile flex flex-col gap-6">
<style>{`
body:has(.sg-client-profile) #root,body:has(.sg-client-profile) #root div:has(>aside[aria-label="Main navigation"]){background:#0b0b0b;color:#f5e9d2}
body:has(.sg-client-profile) aside[aria-label="Main navigation"],body:has(.sg-client-profile) #root header{background:#15120e;color:#f5e9d2;border-color:#65502c}
body:has(.sg-client-profile) aside nav a{color:#e5d6b8}
body:has(.sg-client-profile) aside nav a[aria-current="page"]{background:linear-gradient(110deg,#f3d58a,#b88634);color:#17120b}
.sg-client-profile{color:#f5e9d2}.sg-client-profile h1{font: bold 32px Georgia,serif;color:#f2d28b}
.sg-client-profile .bg-card,.sg-client-profile .sg-profile-panel{background:linear-gradient(145deg,#201b13,#101010);border:1px solid #755b31;color:#f5e9d2}
.sg-client-profile .text-muted-foreground{color:#c7bba6}.sg-client-profile .text-foreground{color:#f5e9d2}
.sg-client-profile button.bg-sg-forest{background:linear-gradient(110deg,#f3d58a,#b88634);color:#17120b}
.sg-profile-banner{position:relative;overflow:hidden;border:1px solid #755b31;border-radius:14px;min-height:210px;background:#17130e}
.sg-profile-banner img{width:100%;height:230px;object-fit:cover;opacity:.65}.sg-profile-banner-copy{position:absolute;inset:0;display:flex;align-items:flex-end;padding:24px;background:linear-gradient(90deg,#090909df,transparent)}
.sg-profile-banner-copy strong{font: bold 30px Georgia,serif;color:#f2d28b}.sg-profile-panel{border-radius:12px;padding:18px}.sg-profile-panel video,.sg-profile-panel img{width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:8px}
`}</style>
      <PageHeader
        title={client.name}
        description={`${client.industry} — ${client.location}`}
        actions={
          <Button size="sm" className="gap-1.5 bg-sg-forest text-sg-ivory hover:bg-sg-forest/90" onClick={open}>
            <Sparkles className="h-3.5 w-3.5" /> Open AI Companion
          </Button>
        }
      />

      <section className="sg-profile-banner"><PortfolioPhoto industry={client.industry}/><div className="sg-profile-banner-copy"><div><p className="text-xs">CLIENT PROFILE · INDUSTRY SAMPLE IMAGE</p><strong>{client.name}</strong><p>{client.industry} · {client.location}</p></div></div></section>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Business profile</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" /> {client.contact.email}</span>
              <span className="flex items-center gap-1.5"><Phone className="h-3.5 w-3.5" /> {client.contact.phone}</span>
              <span className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" /> {client.location}</span>
            </div>
            <Separator />
            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Goals</p>
              <div className="flex flex-wrap gap-1.5">
                {client.goals.map(g => (
                  <Badge key={g} variant="outline" className="font-normal">{g}</Badge>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Target customers</p>
              <p className="text-xs text-foreground">{client.targetCustomers}</p>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Capabilities</p>
                <p className="text-xs text-foreground">{client.capabilitiesSummary}</p>
              </div>
              <div>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Constraints</p>
                <p className="text-xs text-foreground">{client.constraintsSummary}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Positioning snapshot</CardTitle>
            <CardDescription>{client.strategicPriority}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {client.positioningStatus !== 'not_started' ? (
              <StatusBadge status={client.positioningStatus} className="w-fit" />
            ) : (
              <Badge variant="secondary" className="w-fit">Not started</Badge>
            )}
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                <span>AI confidence</span>
                <span>{client.positioningConfidence}%</span>
              </div>
              <Progress value={client.positioningConfidence} className="h-1.5" />
            </div>
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                <span>Market alignment</span>
                <span>{client.positioningAlignment}%</span>
              </div>
              <Progress value={client.positioningAlignment} className="h-1.5" indicatorClassName="bg-sg-lime" />
            </div>
            <Button asChild size="sm" variant="outline" className="mt-1">
              <Link to={`/clients/${client.id}/positioning`}>View Positioning</Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <article className="sg-profile-panel"><h2 className="mb-3 font-semibold">Brand identity</h2><div className="flex items-center gap-3"><span className="flex h-16 w-16 items-center justify-center rounded-xl text-2xl font-bold text-white" style={{background:client.color}}>{client.logoInitial}</span><div><strong>{client.name}</strong><p className="text-xs">Current workspace identity</p></div></div><div className="mt-4 flex items-center gap-3"><span className="h-10 w-10 rounded-lg border" style={{background:client.color}}/><span>{client.color}</span></div><p className="mt-3 text-xs text-muted-foreground">Brand typography and approved assets are managed in Brand Kit.</p></article>
        <article className="sg-profile-panel"><h2 className="mb-3 font-semibold">Creative inspiration</h2><ShowcaseMedia asset="workspace" video label="Sample business campaign video"/><p className="mt-2 text-xs text-muted-foreground">Demonstration video · not a client campaign</p></article>
        <article className="sg-profile-panel"><h2 className="mb-3 font-semibold">Positioning indicators</h2><div className="grid grid-cols-2 gap-2">{[['AI confidence',client.positioningConfidence],['Market alignment',client.positioningAlignment]].map(([label,value])=><div key={label} className="text-center"><svg viewBox="0 0 100 100" role="img" aria-label={label+': '+value+'%'}><circle cx="50" cy="50" r="40" fill="none" stroke="#40382b" strokeWidth="9"/><circle cx="50" cy="50" r="40" fill="none" stroke="#e9bd64" strokeWidth="9" strokeDasharray={String(Number(value)*2.513)+' 251.3'} transform="rotate(-90 50 50)"/><text x="50" y="55" textAnchor="middle" fill="#f2d28b" fontSize="19">{value}%</text></svg><p className="text-xs">{label}</p></div>)}</div></article>
      </section>
      <div>
        <h2 className="mb-2 text-sm font-semibold text-foreground">Jump into a module</h2>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
          {quickLinks.map(item => (
            <Link
              key={item.id}
              to={resolveNavPath(item, client.id)}
              className="flex flex-col items-start gap-1.5 rounded-lg border border-border bg-card p-3 transition-colors hover:border-primary/50 hover:bg-muted/40"
            >
              <item.icon className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs font-medium text-foreground">{item.label}</span>
            </Link>
          ))}
        </div>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
          <div>
            <CardTitle>Service plan</CardTitle>
            <CardDescription>{entitlementsLoading ? 'Loading…' : planName || '—'}</CardDescription>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link to={`/clients/${client.id}/service-config`}>Configure services</Link>
          </Button>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-1.5">
          {entitlements.filter(e => e.enabled).map(e => (
            <Badge key={e.key} variant="accent">
              {e.label} — {e.quantity}/{e.frequency}
            </Badge>
          ))}
          {!entitlementsLoading && entitlements.filter(e => e.enabled).length === 0 && (
            <span className="text-xs text-muted-foreground">No services enabled yet — configure this client's plan in Service Configurator.</span>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
