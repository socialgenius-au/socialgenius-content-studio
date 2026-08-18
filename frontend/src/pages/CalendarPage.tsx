import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Play, CalendarClock, Pause, Copy, Inbox, AlertTriangle } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PageHeader } from '@/components/common/PageHeader'
import { FilterBar } from '@/components/common/FilterBar'
import { LoadingState } from '@/components/common/LoadingState'
import { EmptyState } from '@/components/common/EmptyState'
import { DisconnectedIntegration } from '@/components/common/ErrorState'
import { useClient } from '@/contexts/ClientContext'
import { useAICompanionContext } from '@/contexts/AICompanionContext'
import { campaignService } from '@/services/campaignService'
import { connectionService } from '@/services/connectionService'
import { findConnection, isPlatformLive } from '@/lib/platformConnection'
import type { PlatformConnection, PlatformVersion } from '@/types/domain'

interface CalendarItem extends PlatformVersion {
  assetTitle: string
}

const STATUS_DOT: Record<string, string> = {
  draft: 'bg-secondary-foreground/30',
  review: 'bg-warning',
  approved: 'bg-success',
  scheduled: 'bg-accent',
  publishing: 'bg-accent',
  published: 'bg-success',
  failed: 'bg-destructive',
}

function toDatetimeLocal(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function CalendarPage() {
  const { client, loading } = useClient()
  useAICompanionContext(`Content Calendar • ${client?.name ?? '…'}`)

  const [items, setItems] = useState<CalendarItem[] | null>(null)
  const [connections, setConnections] = useState<PlatformConnection[]>([])
  const [platformFilter, setPlatformFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!client) return
    setItems(null)
    connectionService.list(client.id).then(setConnections)
    campaignService.list(client.id).then(async campaigns => {
      const assets = campaigns.flatMap(c => c.assets)
      const versionLists = await Promise.all(
        assets.map(a => connectionService.platformVersions(a.id).then(versions => versions.map(v => ({ ...v, assetTitle: a.title }))))
      )
      setItems(versionLists.flat())
    })
  }, [client])

  const updateItem = (id: string, patch: Partial<CalendarItem>) => {
    setItems(prev => (prev ? prev.map(i => (i.id === id ? { ...i, ...patch } : i)) : prev))
  }

  const duplicateItem = (item: CalendarItem) => {
    setItems(prev => (prev ? [...prev, { ...item, id: `${item.id}-copy-${Date.now()}`, status: 'draft' }] : prev))
  }

  const platforms = useMemo(() => Array.from(new Set((items ?? []).map(i => i.platform))), [items])

  const filtered = useMemo(() => {
    return (items ?? []).filter(i => {
      if (platformFilter !== 'all' && i.platform !== platformFilter) return false
      if (statusFilter !== 'all' && i.status !== statusFilter) return false
      if (search && !i.title.toLowerCase().includes(search.toLowerCase())) return false
      return true
    })
  }, [items, platformFilter, statusFilter, search])

  const today = new Date()
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()

  const scheduled = filtered.filter(i => {
    if (!i.scheduledFor) return false
    const d = new Date(i.scheduledFor)
    return d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth()
  })
  const awaitingSchedule = filtered.filter(i => !i.scheduledFor)

  if (loading || !client || items === null) return <LoadingState rows={4} />

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
        <>
          <div className="grid grid-cols-7 gap-1.5">
            {Array.from({ length: daysInMonth }).map((_, idx) => {
              const day = idx + 1
              const dayItems = scheduled.filter(i => new Date(i.scheduledFor!).getDate() === day)
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
                      <PopoverContent className="w-64 p-2">
                        <p className="mb-1 text-xs font-semibold">{item.title}</p>
                        <p className="mb-2 text-[11px] text-muted-foreground">{item.platform} · {item.status}</p>
                        <div className="mb-2 flex flex-col gap-1">
                          <label className="text-[10px] font-medium text-muted-foreground">Scheduled for</label>
                          <Input
                            type="datetime-local"
                            className="h-7 text-[11px]"
                            value={toDatetimeLocal(item.scheduledFor)}
                            onChange={e => updateItem(item.id, { scheduledFor: e.target.value ? new Date(e.target.value).toISOString() : null, status: 'scheduled' })}
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <Button variant="ghost" size="sm" className="h-7 justify-start gap-2 text-xs" onClick={() => updateItem(item.id, { status: 'published' })}>
                            <Play className="h-3 w-3" /> Publish now
                          </Button>
                          <Button variant="ghost" size="sm" className="h-7 justify-start gap-2 text-xs" onClick={() => updateItem(item.id, { status: 'draft', scheduledFor: null })}>
                            <Pause className="h-3 w-3" /> Pause (unschedule)
                          </Button>
                          <Button variant="ghost" size="sm" className="h-7 justify-start gap-2 text-xs" onClick={() => duplicateItem(item)}>
                            <Copy className="h-3 w-3" /> Duplicate
                          </Button>
                        </div>
                      </PopoverContent>
                    </Popover>
                  ))}
                </div>
              )
            })}
          </div>

          {awaitingSchedule.length > 0 && (
            <div className="flex flex-col gap-2">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                <Inbox className="h-3.5 w-3.5" /> Awaiting schedule
              </h2>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {awaitingSchedule.map(item => {
                  const live = isPlatformLive(findConnection(item.platform, connections))
                  return (
                    <div key={item.id} className="flex items-center justify-between gap-2 rounded-lg border border-border p-2.5">
                      <div className="flex flex-col">
                        <span className="text-xs font-semibold text-foreground">{item.title}</span>
                        <span className="text-[11px] text-muted-foreground">{item.platform} · {item.status}</span>
                        {!live && (
                          <span className="mt-0.5 flex items-center gap-1 text-[10px] text-warning">
                            <AlertTriangle className="h-2.5 w-2.5" /> Not connected —{' '}
                            <Link to={`/clients/${client.id}/connections`} className="underline">connect it</Link>
                          </span>
                        )}
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 gap-1 text-[11px]"
                        disabled={!live}
                        title={live ? undefined : `${item.platform} isn't connected for this client`}
                        onClick={() => updateItem(item.id, { scheduledFor: new Date().toISOString(), status: 'scheduled' })}
                      >
                        <CalendarClock className="h-3 w-3" /> Schedule today
                      </Button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
