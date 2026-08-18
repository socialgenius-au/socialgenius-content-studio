import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Ban, CheckCircle2, Clock, ListChecks, Megaphone, TrendingUp, UserPlus } from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { LoadingState } from '@/components/common/LoadingState'
import { MetricCard } from '@/components/common/MetricCard'
import { StatusBadge } from '@/components/common/StatusBadge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { useClient } from '@/contexts/ClientContext'
import { cn } from '@/lib/utils'
import { opsService } from '@/services/opsService'
import { leadService } from '@/services/leadService'
import { campaignService } from '@/services/campaignService'
import { intelligenceService } from '@/services/intelligenceService'
import type { OpsTask, Lead, Campaign, IntelligenceFinding } from '@/types/domain'

export default function DashboardPage() {
  const { client: focusClient, clients, loading: clientsLoading } = useClient()
  const navigate = useNavigate()

  const [tasks, setTasks] = useState<OpsTask[]>([])
  const [leads, setLeads] = useState<Lead[]>([])
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [signals, setSignals] = useState<IntelligenceFinding[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!focusClient) return
    setLoading(true)
    Promise.all([
      opsService.list(focusClient.id),
      leadService.list(focusClient.id),
      campaignService.list(focusClient.id),
      intelligenceService.list(focusClient.id),
    ]).then(([t, l, c, i]) => {
      setTasks(t)
      setLeads(l)
      setCampaigns(c)
      setSignals(i.filter(f => f.classification === 'adapt' || f.evidenceType === 'hypothesis'))
      setLoading(false)
    })
  }, [focusClient])

  if (clientsLoading) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="Dashboard" />
        <LoadingState rows={4} />
      </div>
    )
  }

  if (!focusClient) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="Dashboard" />
        <EmptyState title="No clients yet" description="Add a client to start seeing what needs attention today." />
      </div>
    )
  }

  const overdueTasks = tasks.filter(t => t.overdue).length
  const dueTodayTasks = tasks.filter(t => !t.overdue && t.status !== 'done').length
  const approvalsPending = tasks.filter(t => t.status === 'awaiting_approval').length
  const newLeads = leads.filter(l => l.stage === 'new').length
  const awaitingResponse = leads.filter(l => l.stage === 'contacted').length
  const qualified = leads.filter(l => l.stage === 'qualified' || l.stage === 'opportunity').length
  const appointments = leads.filter(l => l.stage === 'appointment_quote').length
  const won = leads.filter(l => l.stage === 'won').length
  const activeCampaigns = campaigns.filter(c => c.status === 'active')

  const briefParts: string[] = []
  if (overdueTasks > 0) briefParts.push(`${overdueTasks} overdue task${overdueTasks === 1 ? '' : 's'} for ${focusClient.name}`)
  if (approvalsPending > 0) briefParts.push(`${approvalsPending} item${approvalsPending === 1 ? '' : 's'} awaiting your approval`)
  if (newLeads > 0) briefParts.push(`${newLeads} new lead${newLeads === 1 ? '' : 's'} not yet contacted`)
  const brief = briefParts.length > 0
    ? `${briefParts.length} thing${briefParts.length === 1 ? '' : 's'} need${briefParts.length === 1 ? 's' : ''} attention today: ${briefParts.join(', ')}.`
    : 'Nothing urgent today — everything is on track.'

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Dashboard"
        description={loading ? undefined : brief}
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {clients.map(c => {
          const priority = c.strategicPriority.length > 90 ? `${c.strategicPriority.slice(0, 90)}…` : c.strategicPriority
          return (
            <Card
              key={c.id}
              className={cn(
                'cursor-pointer transition-colors hover:border-primary/50',
                c.id === focusClient?.id && 'border-primary/60 ring-1 ring-primary/20'
              )}
              onClick={() => navigate(`/clients/${c.id}/overview`)}
            >
              <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
                <div className="flex items-center gap-2">
                  <div
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[11px] font-bold text-white"
                    style={{ background: c.color }}
                  >
                    {c.logoInitial}
                  </div>
                  <div className="flex flex-col leading-tight">
                    <CardTitle>{c.name}</CardTitle>
                    <span className="text-[11px] text-muted-foreground">{c.industry}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  {c.id === focusClient?.id && <Badge variant="accent">Focused</Badge>}
                  {c.positioningStatus !== 'not_started' && <StatusBadge status={c.positioningStatus} />}
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 pt-0">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>Positioning confidence</span>
                    <span>{c.positioningConfidence}%</span>
                  </div>
                  <Progress value={c.positioningConfidence} className="h-1" />
                </div>
                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>Market alignment</span>
                    <span>{c.positioningAlignment}%</span>
                  </div>
                  <Progress value={c.positioningAlignment} className="h-1" indicatorClassName="bg-sg-lime" />
                </div>
                <p className="text-xs text-muted-foreground">{priority}</p>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {loading ? (
        <LoadingState rows={3} />
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold text-foreground">Delivery status — {focusClient.name}</h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <MetricCard label="Overdue tasks" value={overdueTasks} icon={AlertTriangle} tone={overdueTasks > 0 ? 'destructive' : 'default'} />
              <MetricCard label="Due / in progress" value={dueTodayTasks} icon={Clock} />
              <MetricCard label="Approvals pending" value={approvalsPending} icon={ListChecks} tone={approvalsPending > 0 ? 'warning' : 'default'} />
              <MetricCard label="Recurring deliverables" value={tasks.filter(t => t.recurring).length} icon={CheckCircle2} />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold text-foreground">Leads — {focusClient.name}</h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              <MetricCard label="New" value={newLeads} icon={UserPlus} tone="accent" />
              <MetricCard label="Awaiting response" value={awaitingResponse} icon={Clock} tone={awaitingResponse > 0 ? 'warning' : 'default'} />
              <MetricCard label="Qualified" value={qualified} icon={TrendingUp} />
              <MetricCard label="Appointments/Quotes" value={appointments} icon={ListChecks} />
              <MetricCard label="Won" value={won} icon={CheckCircle2} tone="accent" />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5"><Megaphone className="h-3.5 w-3.5" /> Active campaigns</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {activeCampaigns.length === 0 ? (
                  <EmptyState icon={Megaphone} title="No active campaigns" description="Nothing currently running for this client." />
                ) : (
                  activeCampaigns.map(c => (
                    <div key={c.id} className="flex items-center justify-between gap-2 rounded-lg border border-border p-2.5">
                      <div className="flex flex-col">
                        <span className="text-xs font-semibold text-foreground">{c.name}</span>
                        <span className="text-[11px] text-muted-foreground">{c.objective}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="accent">{c.leadsGenerated} leads</Badge>
                        <StatusBadge status={c.status} />
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5" /> Intelligence alerts</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {signals.length === 0 ? (
                  <EmptyState icon={Ban} title="No open signals" description="No unresolved intelligence signals right now." />
                ) : (
                  signals.map(s => (
                    <div key={s.id} className="flex items-start justify-between gap-2 rounded-lg border border-border p-2.5">
                      <div className="flex flex-col">
                        <span className="text-xs font-semibold text-foreground">{s.title}</span>
                        <span className="text-[11px] text-muted-foreground">{s.area}</span>
                      </div>
                      <Badge variant={s.confidence === 'high' ? 'success' : s.confidence === 'medium' ? 'warning' : 'secondary'}>
                        {s.confidence} confidence
                      </Badge>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
