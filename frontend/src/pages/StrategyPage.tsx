import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Map as MapIcon, ArrowRight } from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { LoadingState } from '@/components/common/LoadingState'
import { StatusBadge } from '@/components/common/StatusBadge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useClient } from '@/contexts/ClientContext'
import { useAICompanionContext } from '@/contexts/AICompanionContext'
import { strategyService } from '@/services/strategyService'
import { intelligenceService } from '@/services/intelligenceService'
import { campaignService } from '@/services/campaignService'
import { positioningService } from '@/services/positioningService'
import type { StrategicInitiative, ClassificationCIA, IntelligenceFinding, Campaign, PositioningProfile } from '@/types/domain'

const CLASSIFICATION_VARIANT: Record<ClassificationCIA, 'success' | 'warning' | 'secondary'> = {
  control: 'success',
  influence: 'warning',
  adapt: 'secondary',
}
const CLASSIFICATION_LABEL: Record<ClassificationCIA, string> = {
  control: 'Control',
  influence: 'Influence',
  adapt: 'Adapt',
}
const STATUS_OPTIONS: StrategicInitiative['status'][] = ['not_started', 'in_progress', 'at_risk', 'done']

export default function StrategyPage() {
  const { client } = useClient()
  const navigate = useNavigate()
  useAICompanionContext(client ? `Strategy & Roadmap • ${client.name}` : 'Strategy & Roadmap')

  const [initiatives, setInitiatives] = useState<StrategicInitiative[] | null>(null)
  const [intelligence, setIntelligence] = useState<IntelligenceFinding[]>([])
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [positioning, setPositioning] = useState<PositioningProfile | null>(null)

  useEffect(() => {
    if (!client) return
    setInitiatives(null)
    Promise.all([
      strategyService.list(client.id),
      intelligenceService.list(client.id),
      campaignService.list(client.id),
      positioningService.get(client.id),
    ]).then(([init, intel, camp, pos]) => {
      setInitiatives(init)
      setIntelligence(intel)
      setCampaigns(camp)
      setPositioning(pos ?? null)
    })
  }, [client])

  const updateStatus = (id: string, status: StrategicInitiative['status']) => {
    setInitiatives(prev => prev && prev.map(i => (i.id === id ? { ...i, status } : i)))
  }

  const chain = useMemo(() => {
    if (!initiatives) return null
    const initiativeIds = new Set(initiatives.map(i => i.id))
    const linkedCampaigns = campaigns.filter(c => c.strategicInitiativeId && initiativeIds.has(c.strategicInitiativeId))
    const platforms = new Set(linkedCampaigns.flatMap(c => c.platforms))
    const contentCount = linkedCampaigns.reduce((sum, c) => sum + c.assets.length, 0)
    const leads = linkedCampaigns.reduce((sum, c) => sum + c.leadsGenerated, 0)
    return [
      { label: 'Business Goal', value: client?.goals[0] ?? '—', onClick: () => client && navigate(`/clients/${client.id}/overview`) },
      { label: 'Positioning Goal', value: positioning?.targetPosition ?? 'Not set', onClick: () => client && navigate(`/clients/${client.id}/positioning`) },
      { label: 'Strategic Initiative', value: `${initiatives.length} initiative${initiatives.length === 1 ? '' : 's'}`, onClick: undefined },
      { label: 'Campaign', value: `${linkedCampaigns.length} linked`, onClick: () => client && navigate(`/clients/${client.id}/campaigns`) },
      { label: 'Content', value: `${contentCount} asset${contentCount === 1 ? '' : 's'}`, onClick: () => client && navigate(`/clients/${client.id}/create`) },
      { label: 'Platform', value: platforms.size > 0 ? `${platforms.size} platforms` : '—', onClick: undefined },
      { label: 'Result', value: `${leads} lead${leads === 1 ? '' : 's'}`, onClick: () => client && navigate(`/clients/${client.id}/analytics`) },
    ]
  }, [initiatives, campaigns, positioning, client, navigate])

  if (!client || initiatives === null) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="Strategy & Roadmap" description="Synchronising business goals, positioning and execution." />
        <LoadingState rows={4} />
      </div>
    )
  }

  const byHorizon = (h: 30 | 60 | 90) => initiatives.filter(i => i.horizon === h)

  const horizonSummary = (h: 30 | 60 | 90) => {
    const items = byHorizon(h)
    const counts: Record<ClassificationCIA, number> = { control: 0, influence: 0, adapt: 0 }
    for (const i of items) counts[i.classification]++
    return counts
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Strategy & Roadmap" description={client.strategicPriority} />

      {chain && (
        <div className="flex items-stretch gap-1 overflow-x-auto rounded-lg border border-border bg-muted/30 p-2">
          {chain.map((step, i) => (
            <div key={step.label} className="flex items-center gap-1">
              <button
                type="button"
                onClick={step.onClick}
                disabled={!step.onClick}
                className="flex min-w-[112px] flex-col gap-0.5 rounded-md px-2.5 py-1.5 text-left disabled:cursor-default enabled:hover:bg-background"
              >
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{step.label}</span>
                <span className="truncate text-xs font-medium text-foreground" title={step.value}>{step.value}</span>
              </button>
              {i < chain.length - 1 && <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />}
            </div>
          ))}
        </div>
      )}

      {initiatives.length === 0 ? (
        <EmptyState
          icon={MapIcon}
          title="No strategic initiatives yet"
          description="Initiatives normally follow Strategic Intelligence, Positioning and Social Audit findings."
        />
      ) : (
        <Tabs defaultValue="30">
          <TabsList>
            <TabsTrigger value="30">30 days</TabsTrigger>
            <TabsTrigger value="60">60 days</TabsTrigger>
            <TabsTrigger value="90">90 days</TabsTrigger>
          </TabsList>
          {([30, 60, 90] as const).map(h => {
            const summary = horizonSummary(h)
            return (
              <TabsContent key={h} value={String(h)} className="flex flex-col gap-3">
                {byHorizon(h).length === 0 ? (
                  <EmptyState title={`No initiatives in the ${h}-day view`} />
                ) : (
                  <>
                    <div className="flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                      <span>{byHorizon(h).length} initiatives —</span>
                      <Badge variant="success">{summary.control} control</Badge>
                      <Badge variant="warning">{summary.influence} influence</Badge>
                      <Badge variant="secondary">{summary.adapt} adapt</Badge>
                    </div>
                    {byHorizon(h).map(init => {
                      const supportingFindings = intelligence.filter(f => init.supportingIntelligenceIds.includes(f.id))
                      const linkedCampaigns = campaigns.filter(c => c.strategicInitiativeId === init.id)
                      return (
                        <Card key={init.id} className="shadow-none">
                          <CardHeader className="pb-2">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <CardTitle className="text-sm">{init.objective}</CardTitle>
                              <div className="flex items-center gap-1.5">
                                <Badge variant={CLASSIFICATION_VARIANT[init.classification]}>
                                  {CLASSIFICATION_LABEL[init.classification]}
                                </Badge>
                                <Select value={init.status} onValueChange={v => updateStatus(init.id, v as StrategicInitiative['status'])}>
                                  <SelectTrigger className="h-6 w-auto gap-1 border-none bg-transparent p-0 shadow-none [&>svg]:h-3 [&>svg]:w-3">
                                    <SelectValue>
                                      <StatusBadge status={init.status} className="cursor-pointer" />
                                    </SelectValue>
                                  </SelectTrigger>
                                  <SelectContent>
                                    {STATUS_OPTIONS.map(s => (
                                      <SelectItem key={s} value={s}>{s.replace(/_/g, ' ')}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>
                          </CardHeader>
                          <CardContent className="flex flex-col gap-2.5 pt-0 text-xs">
                            <p className="text-muted-foreground">
                              <span className="font-medium text-foreground">Why it matters: </span>
                              {init.whyItMatters}
                            </p>
                            <p className="text-muted-foreground">
                              <span className="font-medium text-foreground">Positioning relationship: </span>
                              {init.positioningRelationship}
                            </p>
                            {init.classification === 'adapt' && (
                              <p className="rounded-md bg-muted/40 px-2.5 py-1.5 text-[11px] text-muted-foreground">
                                Focus: how should the business position/adapt itself, not fix this external factor.
                              </p>
                            )}
                            <div>
                              <span className="font-medium text-foreground">Actions</span>
                              <ul className="mt-1 flex flex-col gap-0.5 text-muted-foreground">
                                {init.actions.map(a => (
                                  <li key={a}>• {a}</li>
                                ))}
                              </ul>
                            </div>

                            {(supportingFindings.length > 0 || linkedCampaigns.length > 0) && (
                              <div className="flex flex-col gap-2 border-t border-border pt-2">
                                {supportingFindings.length > 0 && (
                                  <div>
                                    <span className="font-medium text-foreground">Supporting intelligence</span>
                                    <div className="mt-1 flex flex-wrap gap-1.5">
                                      {supportingFindings.map(f => (
                                        <button
                                          key={f.id}
                                          onClick={() => navigate(`/clients/${client.id}/intelligence`)}
                                          className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] text-foreground hover:bg-muted"
                                          title={f.detail}
                                        >
                                          {f.title}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                )}
                                {linkedCampaigns.length > 0 && (
                                  <div>
                                    <span className="font-medium text-foreground">Linked campaigns</span>
                                    <div className="mt-1 flex flex-wrap gap-1.5">
                                      {linkedCampaigns.map(c => (
                                        <button
                                          key={c.id}
                                          onClick={() => navigate(`/clients/${client.id}/campaigns/${c.id}`)}
                                          className="flex items-center gap-1 rounded-full border border-sg-lime/40 bg-sg-lime/10 px-2 py-0.5 text-[11px] font-medium text-foreground hover:bg-sg-lime/20"
                                        >
                                          {c.name}
                                          <StatusBadge status={c.status} className="ml-0.5 px-1 py-0 text-[9px]" />
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}

                            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2 text-[11px] text-muted-foreground">
                              <span>{init.responsiblePerson}</span>
                              <span>Target: {init.targetDate}</span>
                              <span>KPI: {init.kpi}</span>
                            </div>
                          </CardContent>
                        </Card>
                      )
                    })}
                  </>
                )}
              </TabsContent>
            )
          })}
        </Tabs>
      )}
    </div>
  )
}
