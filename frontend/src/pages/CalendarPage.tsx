import { useEffect, useMemo, useState } from 'react'
import { Play, CalendarClock, Pause, Copy } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PageHeader } from '@/components/common/PageHeader'
import { FilterBar } from '@/components/common/FilterBar'
import { LoadingState } from '@/components/common/LoadingState'
import { EmptyState } from '@/components/common/EmptyState'
import { DisconnectedIntegration } from '@/components/common/ErrorState'
import { useClient } from '@/contexts/ClientContext'
import { useAICompanionContext } from '@/contexts/AICompanionContext'
import { campaignService } from '@/services/campaignService'
import type { Campaign, CampaignAsset } from '@/types/domain'

interface ScheduledItem extends CampaignAsset {
  day: number // day-of-month
  platform: string
}

const STATUS_DOT: Record<string, string> = {
  draft: 'bg-secondary-foreground/30',
  review: 'bg-warning',
  approved: 'bg-success',
  scheduled: 'bg-accent',
  published: 'bg-success',
}

function buildScheduledItems(campaigns: Campaign[]): ScheduledItem[] {
  const today = new Date()
  let i = 0
  const items: ScheduledItem[] = []
  for (const c of campaigns) {
    for (const a of c.assets) {
      const day = ((today.getDate() + i * 2 - 1) % 28) + 1
      items.push({ ...a, day, platform: c.platforms[i % Math.max(c.platforms.length, 1)] ?? 'Instagram' })
      i++
    }
  }
  return items
}

export default function CalendarPage() {
  const { client, loading } = useClient()
  useAICompanionContext(`Content Calendar • ${client?.name ?? '…'}`)

  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null)
  const [platformFilter, setPlatformFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!client) return
    campaignService.list(client.id).then(setCampaigns)
  }, [client])

  const items = useMemo(() => (campaigns ? buildScheduledItems(campaigns) : []), [campaigns])

  const platforms = useMemo(() => Array.from(new Set(items.map(i => i.platform))), [items])

  const filtered = useMemo(() => {
    return items.filter(i => {
      if (platformFilter !== 'all' && i.platform !== platformFilter) return false
      if (statusFilter !== 'all' && i.status !== statusFilter) return false
      if (search && !i.title.toLowerCase().includes(search.toLowerCase())) return false
      return true
    })
  }, [items, platformFilter, statusFilter, search])

  const today = new Date()
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()

  if (loading || !client || campaigns === null) return <LoadingState rows={4} />

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Content Calendar" description={today.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })} />

      <DisconnectedIntegration integration="SocialProFlow scheduling" />

      <FilterBar searchValue={search} onSearchChange={setSearch} searchPlaceholder="Search content…">
        <Select value={platformFilter} onValueChange={setPlatformFilter}>
          <SelectTrigger className="h-9 w-40"><SelectValue placeholder="Platform" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All platforms</SelectItem>
            {platforms.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-9 w-40"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {Object.keys(STATUS_DOT).map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </FilterBar>

      {filtered.length === 0 ? (
        <EmptyState title="Nothing scheduled" description="No content matches these filters yet." />
      ) : (
        <div className="grid grid-cols-7 gap-1.5">
          {Array.from({ length: daysInMonth }).map((_, idx) => {
            const day = idx + 1
            const dayItems = filtered.filter(i => i.day === day)
            const isToday = day === today.getDate()
            return (
              <div key={day} className={`flex min-h-[92px] flex-col gap-1 rounded-lg border p-1.5 ${isToday ? 'border-primary' : 'border-border'}`}>
                <span className="text-[10px] font-semibold text-muted-foreground">{day}</span>
                {dayItems.map(item => (
                  <Popover key={item.id}>
                    <PopoverTrigger asChild>
                      <button className="flex items-center gap-1 rounded-md bg-muted px-1.5 py-1 text-left text-[10px] font-medium hover:bg-muted/70">
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[item.status] ?? 'bg-muted-foreground'}`} />
                        <span className="truncate">{item.title}</span>
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-56 p-2">
                      <p className="mb-2 text-xs font-semibold">{item.title}</p>
                      <p className="mb-2 text-[11px] text-muted-foreground">{item.platform} · {item.type} · {item.status}</p>
                      <div className="flex flex-col gap-1">
                        <Button variant="ghost" size="sm" className="h-7 justify-start gap-2 text-xs"><Play className="h-3 w-3" /> Publish now</Button>
                        <Button variant="ghost" size="sm" className="h-7 justify-start gap-2 text-xs"><CalendarClock className="h-3 w-3" /> Reschedule</Button>
                        <Button variant="ghost" size="sm" className="h-7 justify-start gap-2 text-xs"><Pause className="h-3 w-3" /> Pause</Button>
                        <Button variant="ghost" size="sm" className="h-7 justify-start gap-2 text-xs"><Copy className="h-3 w-3" /> Duplicate</Button>
                      </div>
                    </PopoverContent>
                  </Popover>
                ))}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
