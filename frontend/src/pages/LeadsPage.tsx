import { useEffect, useMemo, useState } from 'react'
import { TrendingUp, Wallet, Trophy, Percent } from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { MetricCard } from '@/components/common/MetricCard'
import { FilterBar } from '@/components/common/FilterBar'
import { EmptyState } from '@/components/common/EmptyState'
import { LoadingState } from '@/components/common/LoadingState'
import { StatusBadge } from '@/components/common/StatusBadge'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { useClient } from '@/contexts/ClientContext'
import { useAICompanionContext } from '@/contexts/AICompanionContext'
import { leadService } from '@/services/leadService'
import { LEAD_STAGES } from '@/mocks/leads'
import type { Lead } from '@/types/domain'

const currency = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 })

function LeadCard({ lead }: { lead: Lead }) {
  return (
    <Card className="shadow-none">
      <CardContent className="flex flex-col gap-1.5 p-3">
        <div className="flex items-start justify-between gap-2">
          <span className="text-xs font-semibold text-foreground">{lead.name}</span>
          <StatusBadge status={lead.stage} />
        </div>
        <div className="flex flex-wrap gap-1 text-[10px] text-muted-foreground">
          <span>{lead.source}</span>
          <span>·</span>
          <span>{lead.platform}</span>
        </div>
        <span className="text-[10px] text-muted-foreground">{lead.positioningTheme}</span>
        <div className="mt-1 flex items-center justify-between">
          <span className="text-xs font-bold tabular-nums text-foreground">{currency.format(lead.value)}</span>
          <span className="text-[10px] text-muted-foreground">{lead.owner}</span>
        </div>
        <span className="text-[10px] text-muted-foreground">{new Date(lead.createdAt).toLocaleDateString('en-AU')}</span>
      </CardContent>
    </Card>
  )
}

export default function LeadsPage() {
  const { client, loading: clientLoading } = useClient()
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sourceFilter, setSourceFilter] = useState<string | null>(null)

  useAICompanionContext(client ? `Leads & Sales • ${client.name}` : 'Leads & Sales')

  useEffect(() => {
    if (!client) return
    setLoading(true)
    leadService.list(client.id).then(l => {
      setLeads(l)
      setLoading(false)
    })
  }, [client])

  const sources = useMemo(() => Array.from(new Set(leads.map(l => l.source))), [leads])

  const filtered = useMemo(
    () =>
      leads.filter(l => {
        const matchesSearch = l.name.toLowerCase().includes(search.toLowerCase())
        const matchesSource = !sourceFilter || l.source === sourceFilter
        return matchesSearch && matchesSource
      }),
    [leads, search, sourceFilter]
  )

  const totals = useMemo(() => {
    const total = leads.length
    const won = leads.filter(l => l.stage === 'won').length
    const pipelineValue = leads.filter(l => l.stage !== 'won' && l.stage !== 'lost').reduce((sum, l) => sum + l.value, 0)
    const conversion = total > 0 ? Math.round((won / total) * 100) : 0
    return { total, won, pipelineValue, conversion }
  }, [leads])

  if (clientLoading || !client) return <LoadingState rows={3} />

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Leads & Sales" description={`Unified lead inbox and pipeline for ${client.name}.`} />

      {loading ? (
        <LoadingState rows={3} />
      ) : leads.length === 0 ? (
        <EmptyState icon={TrendingUp} title="No leads yet" description="Leads generated from campaigns and organic channels will appear here." />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <MetricCard label="Total leads" value={totals.total} icon={TrendingUp} />
            <MetricCard label="Pipeline value" value={currency.format(totals.pipelineValue)} icon={Wallet} tone="accent" />
            <MetricCard label="Won" value={totals.won} icon={Trophy} tone="accent" />
            <MetricCard label="Conversion rate" value={`${totals.conversion}%`} icon={Percent} />
          </div>

          <Tabs defaultValue="board">
            <TabsList>
              <TabsTrigger value="board">Pipeline Board</TabsTrigger>
              <TabsTrigger value="all">All Leads</TabsTrigger>
            </TabsList>

            <TabsContent value="board">
              <div className="grid grid-cols-1 gap-3 overflow-x-auto sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
                {LEAD_STAGES.map(stageDef => {
                  const stageLeads = leads.filter(l => l.stage === stageDef.id)
                  return (
                    <div key={stageDef.id} className="flex min-w-[180px] flex-col gap-2 rounded-lg bg-muted/30 p-2">
                      <div className="flex items-center justify-between px-1">
                        <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{stageDef.label}</span>
                        <Badge variant="outline">{stageLeads.length}</Badge>
                      </div>
                      <div className="flex flex-col gap-2">
                        {stageLeads.map(lead => (
                          <LeadCard key={lead.id} lead={lead} />
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </TabsContent>

            <TabsContent value="all">
              <div className="flex flex-col gap-3">
                <FilterBar searchValue={search} onSearchChange={setSearch} searchPlaceholder="Search leads…">
                  <Badge
                    variant={sourceFilter === null ? 'default' : 'outline'}
                    className="cursor-pointer"
                    onClick={() => setSourceFilter(null)}
                  >
                    All sources
                  </Badge>
                  {sources.map(source => (
                    <Badge
                      key={source}
                      variant={sourceFilter === source ? 'default' : 'outline'}
                      className="cursor-pointer"
                      onClick={() => setSourceFilter(source)}
                    >
                      {source}
                    </Badge>
                  ))}
                </FilterBar>

                {filtered.length === 0 ? (
                  <EmptyState icon={TrendingUp} title="No matching leads" description="Try a different search term or source filter." />
                ) : (
                  <div className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border">
                    {filtered.map(lead => (
                      <div key={lead.id} className="flex flex-wrap items-center gap-3 bg-card px-4 py-2.5 text-xs">
                        <span className="w-36 shrink-0 font-semibold text-foreground">{lead.name}</span>
                        <span className="w-28 shrink-0 text-muted-foreground">{lead.source}</span>
                        <span className="w-20 shrink-0 text-muted-foreground">{lead.platform}</span>
                        <span className="flex-1 min-w-[120px] text-muted-foreground">{lead.positioningTheme}</span>
                        <span className="w-24 shrink-0 text-right font-bold tabular-nums text-foreground">{currency.format(lead.value)}</span>
                        <span className="w-24 shrink-0 text-muted-foreground">{lead.owner}</span>
                        <span className="w-24 shrink-0 text-right text-muted-foreground">{new Date(lead.createdAt).toLocaleDateString('en-AU')}</span>
                        <StatusBadge status={lead.stage} className="shrink-0" />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  )
}
