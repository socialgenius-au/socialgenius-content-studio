import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ClipboardCheck } from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { LoadingState } from '@/components/common/LoadingState'
import { MetricCard } from '@/components/common/MetricCard'
import { StatusBadge } from '@/components/common/StatusBadge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useClient } from '@/contexts/ClientContext'
import { useAICompanionContext } from '@/contexts/AICompanionContext'
import { auditService } from '@/services/auditService'
import { intelligenceService } from '@/services/intelligenceService'
import type { AuditDimension, IntelligenceFinding } from '@/types/domain'

const IMPORTANCE_VARIANT: Record<AuditDimension['strategicImportance'], 'destructive' | 'warning' | 'secondary'> = {
  high: 'destructive',
  medium: 'warning',
  low: 'secondary',
}
const ACTION_STATUS_OPTIONS: AuditDimension['actionStatus'][] = ['not_started', 'in_progress', 'done']
const IMPORTANCE_RANK = { high: 0, medium: 1, low: 2 }
const IMPACT_RANK = { high: 0, medium: 1, low: 2 }

type SortKey = 'gap' | 'importance' | 'impact'

function TargetProgress({ current, target }: { current: number; target: number }) {
  const behind = target - current
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Current reality vs. required position</span>
        <span className="font-medium tabular-nums text-foreground">
          {current} <span className="text-muted-foreground">/ target {target}</span>
        </span>
      </div>
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${current}%` }} />
        <div className="absolute top-0 h-full w-0.5 bg-foreground" style={{ left: `${target}%` }} title={`Target: ${target}`} />
      </div>
      {behind > 0 ? (
        <span className="text-[11px] text-warning">{behind} point{behind === 1 ? '' : 's'} behind required position</span>
      ) : (
        <span className="text-[11px] text-success">At or above required position</span>
      )}
    </div>
  )
}

export default function AuditPage() {
  const { client } = useClient()
  const navigate = useNavigate()
  useAICompanionContext(client ? `Social Audit • ${client.name}` : 'Social Audit')

  const [dimensions, setDimensions] = useState<AuditDimension[] | null>(null)
  const [intelligence, setIntelligence] = useState<IntelligenceFinding[]>([])
  const [sortKey, setSortKey] = useState<SortKey>('gap')

  useEffect(() => {
    if (!client) return
    setDimensions(null)
    Promise.all([auditService.list(client.id), intelligenceService.list(client.id)]).then(([d, intel]) => {
      setDimensions(d)
      setIntelligence(intel)
    })
  }, [client])

  const updateActionStatus = (id: string, actionStatus: AuditDimension['actionStatus']) => {
    setDimensions(prev => prev && prev.map(d => (d.id === id ? { ...d, actionStatus } : d)))
  }

  const sorted = useMemo(() => {
    if (!dimensions) return []
    const copy = [...dimensions]
    if (sortKey === 'gap') copy.sort((a, b) => (b.targetScore - b.currentScore) - (a.targetScore - a.currentScore))
    if (sortKey === 'importance') copy.sort((a, b) => IMPORTANCE_RANK[a.strategicImportance] - IMPORTANCE_RANK[b.strategicImportance])
    if (sortKey === 'impact') copy.sort((a, b) => IMPACT_RANK[a.impact] - IMPACT_RANK[b.impact])
    return copy
  }, [dimensions, sortKey])

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
  const avgGap = Math.round(dimensions.reduce((sum, d) => sum + (d.targetScore - d.currentScore), 0) / dimensions.length)
  const highPriorityGaps = dimensions.filter(d => d.strategicImportance === 'high' && d.impact === 'high').length
  const inProgress = dimensions.filter(d => d.actionStatus === 'in_progress').length
  const done = dimensions.filter(d => d.actionStatus === 'done').length

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Social Audit"
        description="Current reality vs. required position, across nine dimensions."
        actions={
          <Select value={sortKey} onValueChange={v => setSortKey(v as SortKey)}>
            <SelectTrigger className="h-8 w-48 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="gap">Sort: biggest gap first</SelectItem>
              <SelectItem value="importance">Sort: strategic importance</SelectItem>
              <SelectItem value="impact">Sort: impact</SelectItem>
            </SelectContent>
          </Select>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricCard label="Average score" value={`${avgScore}/100`} />
        <MetricCard label="Avg gap to target" value={avgGap > 0 ? `-${avgGap}` : '0'} tone={avgGap > 10 ? 'warning' : 'default'} hint="required position minus current" />
        <MetricCard
          label="High-priority gaps"
          value={highPriorityGaps}
          tone={highPriorityGaps > 0 ? 'warning' : 'default'}
        />
        <MetricCard label="Actions moving" value={`${inProgress} in progress`} hint={`${done} done · ${dimensions.length - inProgress - done} not started`} />
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {sorted.map(d => {
          const relatedFindings = intelligence.filter(f => d.relatedIntelligenceIds.includes(f.id))
          return (
            <Card key={d.id} className="shadow-none">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-sm">{d.name}</CardTitle>
                  <Badge variant={IMPORTANCE_VARIANT[d.strategicImportance]}>{d.strategicImportance} priority</Badge>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-2.5 pt-0">
                <TargetProgress current={d.currentScore} target={d.targetScore} />
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Gap: </span>
                  {d.gap}
                </p>
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Evidence: </span>
                  {d.evidence}
                </p>
                <div className="flex items-start justify-between gap-2 text-xs text-muted-foreground">
                  <p className="flex-1">
                    <span className="font-medium text-foreground">Recommended: </span>
                    {d.recommendedAction}
                  </p>
                  <Select value={d.actionStatus} onValueChange={v => updateActionStatus(d.id, v as AuditDimension['actionStatus'])}>
                    <SelectTrigger className="h-6 w-auto shrink-0 gap-1 border-none bg-transparent p-0 shadow-none [&>svg]:h-3 [&>svg]:w-3">
                      <SelectValue>
                        <StatusBadge status={d.actionStatus} className="cursor-pointer" />
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {ACTION_STATUS_OPTIONS.map(s => (
                        <SelectItem key={s} value={s}>{s.replace(/_/g, ' ')}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {(relatedFindings.length > 0 || d.positioningLink) && (
                  <div className="flex flex-col gap-1.5 border-t border-border pt-2">
                    {d.positioningLink && (
                      <button
                        onClick={() => navigate(`/clients/${client.id}/positioning`)}
                        className="rounded-md bg-sg-lime/10 px-2 py-1 text-left text-[11px] text-foreground hover:bg-sg-lime/20"
                      >
                        <span className="font-medium">Positioning: </span>{d.positioningLink}
                      </button>
                    )}
                    {relatedFindings.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {relatedFindings.map(f => (
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
                    )}
                  </div>
                )}

                <div className="flex items-center justify-between border-t border-border pt-2 text-[11px] text-muted-foreground">
                  <span>Impact: {d.impact}</span>
                  <span>
                    {d.owner} · {d.timeline}
                  </span>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
