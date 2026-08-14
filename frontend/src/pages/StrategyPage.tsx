import { useEffect, useState } from 'react'
import { Map as MapIcon } from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { LoadingState } from '@/components/common/LoadingState'
import { StatusBadge } from '@/components/common/StatusBadge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { useClient } from '@/contexts/ClientContext'
import { useAICompanionContext } from '@/contexts/AICompanionContext'
import { strategyService } from '@/services/strategyService'
import type { StrategicInitiative, ClassificationCIA } from '@/types/domain'

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

const GOAL_CHAIN = ['Business Goal', 'Positioning Goal', 'Strategic Initiative', 'Campaign', 'Content', 'Platform', 'Result']

export default function StrategyPage() {
  const { client } = useClient()
  useAICompanionContext(client ? `Strategy & Roadmap • ${client.name}` : 'Strategy & Roadmap')

  const [initiatives, setInitiatives] = useState<StrategicInitiative[] | null>(null)

  useEffect(() => {
    if (!client) return
    setInitiatives(null)
    strategyService.list(client.id).then(setInitiatives)
  }, [client])

  if (!client || initiatives === null) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="Strategy & Roadmap" description="Synchronising business goals, positioning and execution." />
        <LoadingState rows={4} />
      </div>
    )
  }

  const byHorizon = (h: 30 | 60 | 90) => initiatives.filter(i => i.horizon === h)

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Strategy & Roadmap" description={client.strategicPriority} />

      <div className="flex flex-wrap items-center gap-1 overflow-x-auto rounded-lg border border-border bg-muted/30 px-3 py-2 text-[11px] font-medium text-muted-foreground">
        {GOAL_CHAIN.map((g, i) => (
          <span key={g} className="flex items-center gap-1 whitespace-nowrap">
            {g}
            {i < GOAL_CHAIN.length - 1 && <span className="text-muted-foreground/50">→</span>}
          </span>
        ))}
      </div>

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
          {([30, 60, 90] as const).map(h => (
            <TabsContent key={h} value={String(h)} className="flex flex-col gap-3">
              {byHorizon(h).length === 0 ? (
                <EmptyState title={`No initiatives in the ${h}-day view`} />
              ) : (
                byHorizon(h).map(init => (
                  <Card key={init.id} className="shadow-none">
                    <CardHeader className="pb-2">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <CardTitle className="text-sm">{init.objective}</CardTitle>
                        <div className="flex items-center gap-1.5">
                          <Badge variant={CLASSIFICATION_VARIANT[init.classification]}>
                            {CLASSIFICATION_LABEL[init.classification]}
                          </Badge>
                          <StatusBadge status={init.status} />
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
                      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2 text-[11px] text-muted-foreground">
                        <span>{init.responsiblePerson}</span>
                        <span>Target: {init.targetDate}</span>
                        <span>KPI: {init.kpi}</span>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  )
}
