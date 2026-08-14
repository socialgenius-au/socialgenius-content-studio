import { ChevronsUpDown, Check, Building2 } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useClient } from '@/contexts/ClientContext'

export function ClientSwitcher() {
  const { client, clients, switchClient } = useClient()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5 text-left transition-colors hover:bg-muted">
          {client ? (
            <div
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[11px] font-bold text-white"
              style={{ background: client.color }}
            >
              {client.logoInitial}
            </div>
          ) : (
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <Building2 className="h-3.5 w-3.5" />
            </div>
          )}
          <div className="flex flex-col leading-tight">
            <span className="text-xs font-semibold">{client?.name ?? 'Select client'}</span>
            {client && <span className="text-[10px] text-muted-foreground">{client.industry}</span>}
          </div>
          <ChevronsUpDown className="ml-1 h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Switch client</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {clients.map(c => (
          <DropdownMenuItem key={c.id} onClick={() => switchClient(c.id)} className="gap-2">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[11px] font-bold text-white" style={{ background: c.color }}>
              {c.logoInitial}
            </div>
            <div className="flex flex-1 flex-col leading-tight">
              <span className="text-xs font-medium">{c.name}</span>
              <span className="text-[10px] text-muted-foreground">{c.industry}</span>
            </div>
            {client?.id === c.id && <Check className="h-3.5 w-3.5 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
