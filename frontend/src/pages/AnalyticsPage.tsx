import { useEffect, useState } from 'react'
import { Eye, Target, LineChart, AlertTriangle, Sparkles, ArrowUpRight, ArrowDownRight } from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { LoadingState } from '@/components/common/LoadingState'
import { MetricCard } from '@/components/common/MetricCard'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { useClient } from '@/contexts/ClientContext'
import { useAICompanionContext } from '@/contexts/AICompanionContext'
import { analyticsService } from '@/services/analyticsService'
import { knowledgeService } from '@/services/knowledgeService'
import type { AnalyticsSnapshot, KnowledgeItem } from '@/types/domain'

const SENTIMENT_VARIANT = { positive: 'success', neutral: 'secondary', negative: 'destructive' } as const

function trendFor(current: number, previous: number | undefined): { value: string; direction: 'up' | 'down' | 'flat' } | undefined {
  if (previous === undefined || previous === 0) return undefined
  const pct = Math.round(((current - previous) / previous) * 100)
  if (pct === 0) return { value: 'flat vs last period', direction: 'flat' }
  return { value: `${pct > 0 ? '+' : ''}${pct}% vs last period`, direction: pct > 0 ? 'up' : 'down' }
}

export default function AnalyticsPage() {
  const { client, loading: clientLoading } = useClient()
  useAICompanionContext(client ? `Analytics • ${client.name}` : 'Analytics')

  const [snapshot, setSnapshot] = useState<AnalyticsSnapshot | undefined>(undefined)
  const [industryLearning, setIndustryLearning] = useState<KnowledgeItem[]>([])
  const [globalLearning, setGlobalLearning] = useState<KnowledgeItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!client) return
    setLoading(true)
    Promise.all([
      analyticsService.get(client.id),
      knowledgeService.list('industry'),
      knowledgeService.list('global'),
    ]).then(([snap, industry, global]) => {
      setSnapshot(snap)
      setIndustryLearning(industry.filter(k => k.type === 'hook'))
      setGlobalLearning(global.filter(k => k.type === 'positioning_pattern'))
      setLoading(false)
    })
  }, [client])

  if (clientLoading || loading) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="Analytics" />
        <LoadingState rows={4} />
      </div>
    )
  }

  if (!client) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="Analytics" />
        <EmptyState title="No client selected" description="Pick a client to see attention, positioning and business performance." />
      </div>
    )
  }

  if (!snapshot) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="Analytics" description={client.name} />
        <EmptyState icon={LineChart} title="No analytics yet" description="Nothing has been published for this client yet, so there's no performance to report." />
      </div>
    )
  }

  const { attention, positioning, business, previousPeriod } = snapshot
  const driftIsConcerning = positioning.alignmentScore > 0 && positioning.alignmentScore < 70
  const alignmentTrend = trendFor(positioning.alignmentScore, previousPeriod?.alignmentScore)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Analytics" description={`${client.name} — attention, positioning and business results, in that order of proof.`} />

      <section className="flex flex-col gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground"><Eye className="h-3.5 w-3.5" /> Attention</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <MetricCard label="Views" value={attention.views.toLocaleString()} trend={trendFor(attention.views, previousPeriod?.views)} />
          <MetricCard label="Watch time" value={attention.watchTime} />
          <MetricCard label="Retention" value={`${attention.retention}%`} trend={trendFor(attention.retention, previousPeriod?.retention)} />
          <MetricCard label="Completion" value={`${attention.completion}%`} />
          <MetricCard label="Engagement rate" value={`${attention.engagementRate}%`} trend={trendFor(attention.engagementRate, previousPeriod?.engagementRate)} />
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground"><Target className="h-3.5 w-3.5" /> Positioning</h2>
        <Card>
          <CardContent className="flex flex-col gap-4 p-4">
            <div className="flex flex-wrap items-center gap-6">
              <div className="flex min-w-[160px] flex-col gap-1.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Alignment score (est.)</span>
                  <span className="flex items-center gap-1">
                    <span className="text-xl font-bold tabular-nums text-foreground">{positioning.alignmentScore}%</span>
                    {alignmentTrend && (
                      <span className={`inline-flex items-center gap-0.5 text-[11px] font-medium ${alignmentTrend.direction === 'up' ? 'text-success' : alignmentTrend.direction === 'down' ? 'text-destructive' : 'text-muted-foreground'}`}>
                        {alignmentTrend.direction === 'up' && <ArrowUpRight className="h-3 w-3" />}
                        {alignmentTrend.direction === 'down' && <ArrowDownRight className="h-3 w-3" />}
                        {alignmentTrend.value}
                      </span>
                    )}
                  </span>
                </div>
                <Progress value={positioning.alignmentScore} className="h-1.5" indicatorClassName={driftIsConcerning ? 'bg-warning' : 'bg-sg-lime'} />
              </div>
              <Badge variant={SENTIMENT_VARIANT[positioning.sentiment]}>Customer sentiment: {positioning.sentiment}</Badge>
            </div>

            {positioning.drift && (
              <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${driftIsConcerning ? 'border-warning/30 bg-warning/10 text-warning' : 'border-border bg-muted/40 text-muted-foreground'}`}>
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{positioning.drift}</span>
              </div>
            )}

            {positioning.dominantCustomerLanguage.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Dominant customer language</span>
                <div className="flex flex-wrap gap-1.5">
                  {positioning.dominantCustomerLanguage.map(word => (
                    <Badge key={word} variant="outline">{word}</Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground"><LineChart className="h-3.5 w-3.5" /> Business</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <MetricCard label="Clicks" value={business.clicks.toLocaleString()} trend={trendFor(business.clicks, previousPeriod?.clicks)} />
          <MetricCard label="Enquiries" value={business.enquiries} trend={trendFor(business.enquiries, previousPeriod?.enquiries)} />
          <MetricCard label="Qualified leads" value={business.qualifiedLeads} tone="accent" trend={trendFor(business.qualifiedLeads, previousPeriod?.qualifiedLeads)} />
          <MetricCard label="Appointments" value={business.appointments} trend={trendFor(business.appointments, previousPeriod?.appointments)} />
          <MetricCard label="Sales" value={business.sales} tone="accent" trend={trendFor(business.sales, previousPeriod?.sales)} />
        </div>
        <p className="text-[11px] text-muted-foreground">
          Revenue: {business.revenue != null ? `$${business.revenue.toLocaleString()}` : 'Not yet available'}
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground"><Sparkles className="h-3.5 w-3.5" /> Learning</h2>
        <p className="max-w-2xl text-xs text-muted-foreground">
          Learning from connected-platform and customer-response data — shown as a pattern, not a guaranteed causal fact.
        </p>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Connected-handle learning</CardTitle>
              <CardDescription>Patterns observed across this industry's connected accounts</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {industryLearning.length === 0 ? (
                <EmptyState title="No industry learning yet" description="Nothing validated for this industry yet." />
              ) : (
                industryLearning.map(item => (
                  <div key={item.id} className="rounded-lg border border-border p-2.5">
                    <p className="text-xs font-semibold text-foreground">{item.title}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{item.detail}</p>
                    {item.performanceEvidence && (
                      <p className="mt-1 text-[11px] font-medium text-sg-forest dark:text-sg-lime">Estimated impact: {item.performanceEvidence}</p>
                    )}
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Customer response learning</CardTitle>
              <CardDescription>Cross-client positioning patterns from customer language</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {globalLearning.length === 0 ? (
                <EmptyState title="No global learning yet" description="Nothing validated globally yet." />
              ) : (
                globalLearning.map(item => (
                  <div key={item.id} className="rounded-lg border border-border p-2.5">
                    <p className="text-xs font-semibold text-foreground">{item.title}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{item.detail}</p>
                    {item.performanceEvidence && (
                      <p className="mt-1 text-[11px] font-medium text-sg-forest dark:text-sg-lime">Estimated impact: {item.performanceEvidence}</p>
                    )}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  )
}
