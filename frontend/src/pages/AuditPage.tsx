import { useEffect, useState } from 'react'
import { ClipboardCheck } from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { LoadingState } from '@/components/common/LoadingState'
import { MetricCard } from '@/components/common/MetricCard'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { useClient } from '@/contexts/ClientContext'
import { useAICompanionContext } from '@/contexts/AICompanionContext'
import { auditService } from '@/services/auditService'
import type { AuditDimension } from '@/types/domain'

const IMPORTANCE_VARIANT: Record<AuditDimension['strategicImportance'], 'destructive' | 'warning' | 'secondary'> = {
  high: 'destructive',
  medium: 'warning',
  low: 'secondary',
}

export default function AuditPage() {
  const { client } = useClient()
  useAICompanionContext(client ? `Social Audit • ${client.name}` : 'Social Audit')

  const [dimensions, setDimensions] = useState<AuditDimension[] | null>(null)

  useEffect(() => {
    if (!client) return
    setDimensions(null)
    auditService.list(client.id).then(setDimensions)
  }, [client])

  if (!client || dimensions === null) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="Social Audit" description="Current reality vs. required position, across nine dimensions." />
        <LoadingState rows={4} />
      </div>
    )
  }

  if (dimensions.length === 0) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="Social Audit" description="Current reality vs. required position, across nine dimensions." />
        <EmptyState
          icon={ClipboardCheck}
          title="No audit run yet"
          description="Once a Social Audit runs for this client, dimension scores and gaps will appear here."
        />
      </div>
    )
  }

  const avgScore = Math.round(dimensions.reduce((sum, d) => sum + d.currentScore, 0) / dimensions.length)
  const highPriorityGaps = dimensions.filter(d => d.strategicImportance === 'high' && d.impact === 'high').length

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Social Audit" description="Current reality vs. required position, across nine dimensions." />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricCard label="Average score" value={`${avgScore}/100`} />
        <MetricCard label="Dimensions audited" value={dimensions.length} />
        <MetricCard
          label="High-priority gaps"
          value={highPriorityGaps}
          tone={highPriorityGaps > 0 ? 'warning' : 'default'}
        />
        <MetricCard label="High-importance areas" value={dimensions.filter(d => d.strategicImportance === 'high').length} />
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {dimensions.map(d => (
          <Card key={d.id} className="shadow-none">
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="text-sm">{d.name}</CardTitle>
                <Badge variant={IMPORTANCE_VARIANT[d.strategicImportance]}>{d.strategicImportance} priority</Badge>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-2.5 pt-0">
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Current score</span>
                  <span className="font-medium tabular-nums text-foreground">{d.currentScore}/100</span>
                </div>
                <Progress value={d.currentScore} />
              </div>
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Gap: </span>
                {d.gap}
              </p>
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Evidence: </span>
                {d.evidence}
              </p>
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Recommended: </span>
                {d.recommendedAction}
              </p>
              <div className="flex items-center justify-between border-t border-border pt-2 text-[11px] text-muted-foreground">
                <span>Impact: {d.impact}</span>
                <span>
                  {d.owner} · {d.timeline}
                </span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
