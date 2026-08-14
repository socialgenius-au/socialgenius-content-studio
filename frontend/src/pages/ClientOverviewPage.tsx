import { useEffect, useState } from 'react'
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
import { servicePlanService } from '@/services/servicePlanService'
import { NAV_GROUPS, resolveNavPath } from '@/config/navigation'
import type { ServicePlan } from '@/types/domain'

export default function ClientOverviewPage() {
  const { client, loading } = useClient()
  const { open } = useAICompanion()
  useAICompanionContext(`Overview • ${client?.name ?? ''}`)

  const [plan, setPlan] = useState<ServicePlan | undefined>()

  useEffect(() => {
    if (!client) return
    servicePlanService.get(client.servicePlanId).then(setPlan)
  }, [client])

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
    <div className="flex flex-col gap-6">
      <PageHeader
        title={client.name}
        description={`${client.industry} — ${client.location}`}
        actions={
          <Button size="sm" className="gap-1.5 bg-sg-forest text-sg-ivory hover:bg-sg-forest/90" onClick={open}>
            <Sparkles className="h-3.5 w-3.5" /> Open AI Companion
          </Button>
        }
      />

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
        <CardHeader>
          <CardTitle>Service plan</CardTitle>
          <CardDescription>{plan?.name ?? 'Loading…'}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-1.5">
          {plan?.entitlements.filter(e => e.enabled).map(e => (
            <Badge key={e.key} variant="accent">
              {e.label} — {e.quantity}/{e.frequency}
            </Badge>
          ))}
          {plan && plan.entitlements.filter(e => e.enabled).length === 0 && (
            <span className="text-xs text-muted-foreground">No services enabled yet — configure this client's plan in Service Configurator.</span>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
