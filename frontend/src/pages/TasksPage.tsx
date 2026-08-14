import { useEffect, useMemo, useState } from 'react'
import { CalendarClock, AlertTriangle, ClipboardCheck, Repeat, ListChecks } from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { MetricCard } from '@/components/common/MetricCard'
import { FilterBar } from '@/components/common/FilterBar'
import { EmptyState } from '@/components/common/EmptyState'
import { LoadingState } from '@/components/common/LoadingState'
import { StatusBadge } from '@/components/common/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { useClient } from '@/contexts/ClientContext'
import { useAICompanionContext } from '@/contexts/AICompanionContext'
import { opsService } from '@/services/opsService'
import type { OpsTask } from '@/types/domain'

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

export default function TasksPage() {
  const { client, loading: clientLoading } = useClient()
  const [tasks, setTasks] = useState<OpsTask[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [assigneeFilter, setAssigneeFilter] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<string | null>(null)

  useAICompanionContext(client ? `Tasks & Delivery • ${client.name}` : 'Tasks & Delivery')

  useEffect(() => {
    if (!client) return
    setLoading(true)
    opsService.list(client.id).then(t => {
      setTasks(t)
      setLoading(false)
    })
  }, [client])

  const assignees = useMemo(() => Array.from(new Set(tasks.map(t => t.assignee))), [tasks])
  const statuses = useMemo(() => Array.from(new Set(tasks.map(t => t.status))), [tasks])

  const metrics = useMemo(() => {
    const today = todayISO()
    return {
      dueToday: tasks.filter(t => t.dueDate === today).length,
      overdue: tasks.filter(t => t.overdue).length,
      awaitingApproval: tasks.filter(t => t.status === 'awaiting_approval').length,
      recurring: tasks.filter(t => t.recurring).length,
    }
  }, [tasks])

  const filtered = useMemo(
    () =>
      tasks
        .filter(t => t.title.toLowerCase().includes(search.toLowerCase()))
        .filter(t => !assigneeFilter || t.assignee === assigneeFilter)
        .filter(t => !statusFilter || t.status === statusFilter)
        .sort((a, b) => Number(b.overdue) - Number(a.overdue)),
    [tasks, search, assigneeFilter, statusFilter]
  )

  if (clientLoading || !client) return <LoadingState rows={3} />

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Tasks & Delivery" description={`Delivery pipeline for ${client.name} — surfaced from OpsGenius, no separate login needed.`} />

      {loading ? (
        <LoadingState rows={3} />
      ) : tasks.length === 0 ? (
        <EmptyState icon={ListChecks} title="No tasks yet" description="Tasks assigned to this client will appear here." />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <MetricCard label="Due today" value={metrics.dueToday} icon={CalendarClock} />
            <MetricCard label="Overdue" value={metrics.overdue} icon={AlertTriangle} tone={metrics.overdue > 0 ? 'destructive' : 'default'} />
            <MetricCard label="Awaiting approval" value={metrics.awaitingApproval} icon={ClipboardCheck} tone="warning" />
            <MetricCard label="Recurring" value={metrics.recurring} icon={Repeat} />
          </div>

          <FilterBar searchValue={search} onSearchChange={setSearch} searchPlaceholder="Search tasks…">
            <Badge variant={assigneeFilter === null ? 'default' : 'outline'} className="cursor-pointer" onClick={() => setAssigneeFilter(null)}>
              All assignees
            </Badge>
            {assignees.map(a => (
              <Badge key={a} variant={assigneeFilter === a ? 'default' : 'outline'} className="cursor-pointer" onClick={() => setAssigneeFilter(a)}>
                {a}
              </Badge>
            ))}
            <span className="mx-1 h-4 w-px bg-border" />
            <Badge variant={statusFilter === null ? 'default' : 'outline'} className="cursor-pointer" onClick={() => setStatusFilter(null)}>
              All statuses
            </Badge>
            {statuses.map(s => (
              <Badge key={s} variant={statusFilter === s ? 'default' : 'outline'} className="cursor-pointer" onClick={() => setStatusFilter(s)}>
                {s.replace(/_/g, ' ')}
              </Badge>
            ))}
          </FilterBar>

          {filtered.length === 0 ? (
            <EmptyState icon={ListChecks} title="No matching tasks" description="Try a different search term or filter." />
          ) : (
            <div className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border">
              {filtered.map(task => (
                <div key={task.id} className="flex flex-wrap items-center gap-3 bg-card px-4 py-2.5 text-xs">
                  <div className="flex min-w-[200px] flex-1 items-center gap-1.5">
                    {task.overdue && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" />}
                    <span className="font-semibold text-foreground">{task.title}</span>
                    {task.recurring && (
                      <Badge variant="outline" className="gap-1">
                        <Repeat className="h-2.5 w-2.5" /> recurring
                      </Badge>
                    )}
                  </div>
                  <span className="w-32 shrink-0 text-muted-foreground">{task.assignee}</span>
                  <span className={`w-24 shrink-0 ${task.overdue ? 'font-semibold text-destructive' : 'text-muted-foreground'}`}>
                    {new Date(task.dueDate).toLocaleDateString('en-AU')}
                  </span>
                  <StatusBadge status={task.status} className="shrink-0" />
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
