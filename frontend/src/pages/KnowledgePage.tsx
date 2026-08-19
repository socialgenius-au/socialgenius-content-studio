import { useEffect, useState } from 'react'
import { Info, BookOpen, ArrowUpCircle, Globe2 } from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { LoadingState } from '@/components/common/LoadingState'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { useClient } from '@/contexts/ClientContext'
import { useAICompanionContext } from '@/contexts/AICompanionContext'
import { knowledgeService } from '@/services/knowledgeService'
import type { KnowledgeItem, KnowledgeScope, KnowledgeType, Confidence } from '@/types/domain'

const KNOWLEDGE_STATUSES: { id: KnowledgeItem['status']; label: string }[] = [
  { id: 'proposed', label: 'Proposed' },
  { id: 'validated', label: 'Validated' },
  { id: 'retired', label: 'Retired' },
]

function StatusSelect({ item, onChange }: { item: KnowledgeItem; onChange: (status: KnowledgeItem['status']) => void }) {
  return (
    <Select value={item.status} onValueChange={v => onChange(v as KnowledgeItem['status'])}>
      <SelectTrigger className="h-6 w-auto gap-1 border-none bg-transparent p-0 shadow-none [&>svg]:h-3 [&>svg]:w-3">
        <SelectValue>
          <Badge variant={item.status === 'validated' ? 'success' : item.status === 'retired' ? 'secondary' : 'warning'}>
            {item.status.charAt(0).toUpperCase() + item.status.slice(1)}
          </Badge>
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {KNOWLEDGE_STATUSES.map(s => (
          <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

const SCOPES: { id: KnowledgeScope; label: string }[] = [
  { id: 'global', label: 'Global' },
  { id: 'industry', label: 'Industry' },
  { id: 'client', label: 'Client' },
]

const TYPES: KnowledgeType[] = [
  'pain_point', 'expectation', 'hook', 'objection', 'cta', 'lead_source',
  'positioning_pattern', 'proof_mechanism', 'campaign_structure',
  'experience_standard', 'audit_rule', 'successful_pattern',
]

const CONFIDENCE_VARIANT: Record<Confidence, 'success' | 'warning' | 'secondary'> = {
  high: 'success',
  medium: 'warning',
  low: 'secondary',
}

function toTitle(s: string) {
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export default function KnowledgePage() {
  const { client } = useClient()
  useAICompanionContext('Knowledge Library')

  const [items, setItems] = useState<KnowledgeItem[]>([])
  const [loading, setLoading] = useState(true)
  const [typeFilter, setTypeFilter] = useState<KnowledgeType | 'all'>('all')

  useEffect(() => {
    setLoading(true)
    knowledgeService.list().then(list => {
      setItems(list)
      setLoading(false)
    })
  }, [])

  const setItemStatus = (id: string, status: KnowledgeItem['status']) =>
    setItems(prev => prev.map(k => (k.id === id ? { ...k, status } : k)))

  const promote = (id: string, target: 'industry' | 'global') =>
    setItems(prev => prev.map(k => (k.id === id ? { ...k, scope: target, clientId: null, industry: target === 'global' ? null : k.industry } : k)))

  const renderList = (scope: KnowledgeScope) => {
    const filtered = items.filter(k => k.scope === scope && (typeFilter === 'all' || k.type === typeFilter))
    if (filtered.length === 0) {
      return <EmptyState icon={BookOpen} title={`No ${scope} knowledge yet`} description="Nothing has been captured for this scope/type combination yet." />
    }
    return (
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {filtered.map(item => (
          <Card key={item.id}>
            <CardContent className="flex flex-col gap-2 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-foreground">{item.title}</p>
                <div className="flex items-center gap-1.5">
                  <Badge variant="outline">{toTitle(item.type)}</Badge>
                  <Badge variant={CONFIDENCE_VARIANT[item.confidence]}>{item.confidence} confidence</Badge>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">{item.detail}</p>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                {item.industry && <span>Industry: {item.industry}</span>}
                {item.audience && <span>Audience: {item.audience}</span>}
                <span>Source: {item.source}</span>
                <span>Evidence: {item.evidence}</span>
                <span>Captured: {item.date}</span>
                <span>Last validated: {item.lastValidated}</span>
              </div>
              {item.performanceEvidence && (
                <p className="text-[11px] font-medium text-sg-forest dark:text-sg-lime">Performance evidence: {item.performanceEvidence}</p>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2">
                <StatusSelect item={item} onChange={status => setItemStatus(item.id, status)} />
                {item.scope === 'client' && item.status === 'validated' && (
                  <div className="flex gap-1.5">
                    <Button size="sm" variant="outline" className="h-7 gap-1 text-[11px]" onClick={() => promote(item.id, 'industry')}>
                      <ArrowUpCircle className="h-3 w-3" /> Promote to Industry
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 gap-1 text-[11px]" onClick={() => promote(item.id, 'global')}>
                      <Globe2 className="h-3 w-3" /> Promote to Global
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Knowledge Library"
        description={client ? `Reusable knowledge across every client — currently viewing alongside ${client.name}.` : 'Reusable knowledge across every client.'}
      />

      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>Client knowledge is never automatically promoted to Industry or Global — promotion requires explicit staff approval.</span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Select value={typeFilter} onValueChange={v => setTypeFilter(v as KnowledgeType | 'all')}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Filter by type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {TYPES.map(t => (
              <SelectItem key={t} value={t}>{toTitle(t)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <LoadingState rows={4} />
      ) : (
        <Tabs defaultValue="global">
          <TabsList>
            {SCOPES.map(s => (
              <TabsTrigger key={s.id} value={s.id}>{s.label}</TabsTrigger>
            ))}
          </TabsList>
          {SCOPES.map(s => (
            <TabsContent key={s.id} value={s.id}>
              {renderList(s.id)}
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  )
}
