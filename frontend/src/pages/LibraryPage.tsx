import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/common/PageHeader'
import { FilterBar } from '@/components/common/FilterBar'
import { LoadingState } from '@/components/common/LoadingState'
import { EmptyState } from '@/components/common/EmptyState'
import { FolderOpen } from 'lucide-react'
import { useClient } from '@/contexts/ClientContext'
import { useAICompanionContext } from '@/contexts/AICompanionContext'
import { knowledgeService } from '@/services/knowledgeService'
import type { KnowledgeItem, KnowledgeScope } from '@/types/domain'

function KnowledgeTab({ scope }: { scope: KnowledgeScope }) {
  const [items, setItems] = useState<KnowledgeItem[] | null>(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    setItems(null)
    knowledgeService.list(scope).then(setItems)
  }, [scope])

  const filtered = useMemo(() => {
    if (!items) return []
    const q = search.trim().toLowerCase()
    if (!q) return items
    return items.filter(i => i.title.toLowerCase().includes(q) || i.detail.toLowerCase().includes(q))
  }, [items, search])

  if (items === null) return <LoadingState rows={3} />

  return (
    <div className="flex flex-col gap-3">
      <FilterBar searchValue={search} onSearchChange={setSearch} searchPlaceholder="Search knowledge…" />
      {filtered.length === 0 ? (
        <EmptyState title="Nothing here yet" description={`No ${scope} knowledge items recorded for this context yet.`} />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {filtered.map(item => (
            <Card key={item.id}>
              <CardHeader className="flex-row items-start justify-between gap-2 space-y-0 pb-2">
                <CardTitle>{item.title}</CardTitle>
                <Badge variant="outline">{item.type.replace(/_/g, ' ')}</Badge>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 pt-0 text-xs">
                <p className="text-sm text-foreground">{item.detail}</p>
                <div className="flex flex-wrap gap-1.5">
                  {item.industry && <Badge variant="secondary">{item.industry}</Badge>}
                  {item.audience && <Badge variant="secondary">{item.audience}</Badge>}
                  <Badge variant={item.confidence === 'high' ? 'success' : item.confidence === 'medium' ? 'warning' : 'outline'}>
                    {item.confidence} confidence
                  </Badge>
                  <Badge variant={item.status === 'validated' ? 'success' : item.status === 'retired' ? 'secondary' : 'outline'}>{item.status}</Badge>
                </div>
                <p className="text-muted-foreground">Source: {item.source}</p>
                <p className="text-muted-foreground">Evidence: {item.evidence}</p>
                <p className="text-muted-foreground">Recorded {item.date} · last validated {item.lastValidated}</p>
                {item.performanceEvidence && <p className="font-medium text-success">{item.performanceEvidence}</p>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

export default function LibraryPage() {
  const { client, loading } = useClient()
  const navigate = useNavigate()
  useAICompanionContext(`Library • ${client?.name ?? '…'}`)

  if (loading || !client) return <LoadingState rows={5} />

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Library" description="Client-private knowledge, reusable industry patterns, Social Genius global methodology, and raw assets — all in one place." />

      <Tabs defaultValue="client">
        <TabsList>
          <TabsTrigger value="client">Client Library</TabsTrigger>
          <TabsTrigger value="industry">Industry Library</TabsTrigger>
          <TabsTrigger value="global">Global Library</TabsTrigger>
          <TabsTrigger value="assets">Asset Library</TabsTrigger>
        </TabsList>

        <TabsContent value="client"><KnowledgeTab scope="client" /></TabsContent>
        <TabsContent value="industry"><KnowledgeTab scope="industry" /></TabsContent>
        <TabsContent value="global"><KnowledgeTab scope="global" /></TabsContent>
        <TabsContent value="assets">
          <EmptyState
            icon={FolderOpen}
            title="Asset Library lives at /assets"
            description="Reuses the existing Asset Library — see the full asset manager (video, B-roll, audio, graphics, templates) rather than a duplicate here."
            actionLabel="Open Asset Library"
            onAction={() => navigate('/assets')}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
