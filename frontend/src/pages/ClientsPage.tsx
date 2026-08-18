import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, UserPlus, Users } from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { FilterBar } from '@/components/common/FilterBar'
import { EmptyState } from '@/components/common/EmptyState'
import { LoadingState } from '@/components/common/LoadingState'
import { StatusBadge } from '@/components/common/StatusBadge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useClient } from '@/contexts/ClientContext'
import { opsService } from '@/services/opsService'
import { leadService } from '@/services/leadService'

interface Attention {
  overdueTasks: number
  newLeads: number
}

export default function ClientsPage() {
  const { clients, loading } = useClient()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [attention, setAttention] = useState<Record<string, Attention>>({})

  useEffect(() => {
    if (clients.length === 0) return
    let cancelled = false
    Promise.all(
      clients.map(async c => {
        const [tasks, leads] = await Promise.all([opsService.list(c.id), leadService.list(c.id)])
        return [c.id, { overdueTasks: tasks.filter(t => t.overdue).length, newLeads: leads.filter(l => l.stage === 'new').length }] as const
      })
    ).then(pairs => {
      if (!cancelled) setAttention(Object.fromEntries(pairs))
    })
    return () => {
      cancelled = true
    }
  }, [clients])

  const filtered = useMemo(
    () => clients.filter(c => c.name.toLowerCase().includes(search.toLowerCase()) || c.industry.toLowerCase().includes(search.toLowerCase())),
    [clients, search]
  )

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Clients" description="Every client workspace Social Genius manages." />

      <FilterBar searchValue={search} onSearchChange={setSearch} searchPlaceholder="Search clients or industry…" />

      {loading ? (
        <LoadingState rows={3} />
      ) : filtered.length === 0 ? (
        <EmptyState icon={Users} title="No clients found" description="Try a different search term." />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map(c => (
            <Card
              key={c.id}
              className="cursor-pointer transition-colors hover:border-primary/50"
              onClick={() => navigate(`/clients/${c.id}/overview`)}
            >
              <CardHeader className="flex-row items-center gap-2.5 space-y-0">
                <div
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white"
                  style={{ background: c.color }}
                >
                  {c.logoInitial}
                </div>
                <div className="flex flex-col leading-tight">
                  <CardTitle>{c.name}</CardTitle>
                  <span className="text-[11px] text-muted-foreground">{c.industry} · {c.location}</span>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 pt-0">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-muted-foreground">{c.contact.name}</span>
                  {c.positioningStatus !== 'not_started' ? (
                    <StatusBadge status={c.positioningStatus} />
                  ) : (
                    <Badge variant="secondary">Positioning not started</Badge>
                  )}
                </div>
                <div className="flex flex-wrap gap-1">
                  {c.goals.slice(0, 2).map(g => (
                    <Badge key={g} variant="outline" className="font-normal">{g}</Badge>
                  ))}
                </div>
                {(attention[c.id]?.overdueTasks ?? 0) > 0 || (attention[c.id]?.newLeads ?? 0) > 0 ? (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {(attention[c.id]?.overdueTasks ?? 0) > 0 && (
                      <Badge variant="destructive" className="gap-1 font-normal">
                        <AlertTriangle className="h-3 w-3" /> {attention[c.id].overdueTasks} overdue
                      </Badge>
                    )}
                    {(attention[c.id]?.newLeads ?? 0) > 0 && (
                      <Badge variant="accent" className="gap-1 font-normal">
                        <UserPlus className="h-3 w-3" /> {attention[c.id].newLeads} new lead{attention[c.id].newLeads === 1 ? '' : 's'}
                      </Badge>
                    )}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
