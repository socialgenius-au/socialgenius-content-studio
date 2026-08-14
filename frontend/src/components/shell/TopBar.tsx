import { useState } from 'react'
import { Search, Bell, Sparkles, Sun, Moon, Monitor, LogOut, User as UserIcon } from 'lucide-react'
import { ClientSwitcher } from './ClientSwitcher'
import { Breadcrumbs } from './Breadcrumbs'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useClient } from '@/contexts/ClientContext'
import { useAuth } from '@/contexts/AuthContext'
import { useTheme } from '@/contexts/ThemeContext'
import { useAICompanion } from '@/contexts/AICompanionContext'
import { StatusBadge } from '@/components/common/StatusBadge'
import { MOCK_CAMPAIGNS } from '@/mocks/campaigns'

const MOCK_NOTIFICATIONS = [
  { id: 'n1', text: 'Angle B reel is awaiting your approval', time: '12m ago' },
  { id: 'n2', text: 'Positioning statement pending client sign-off', time: '2h ago' },
  { id: 'n3', text: 'Warranty claims SLA task is overdue', time: '1d ago' },
]

export function TopBar() {
  const { client } = useClient()
  const { user, logout } = useAuth()
  const { mode, resolvedTheme, setMode } = useTheme()
  const { open: openCompanion, contextLabel } = useAICompanion()
  const [search, setSearch] = useState('')

  const activeCampaign = client?.activeCampaignId
    ? (MOCK_CAMPAIGNS[client.id] ?? []).find(c => c.id === client.activeCampaignId)
    : null

  const cycleTheme = () => setMode(mode === 'light' ? 'dark' : mode === 'dark' ? 'auto' : 'light')
  const ThemeIcon = mode === 'auto' ? Monitor : resolvedTheme === 'dark' ? Moon : Sun

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card px-4">
      <ClientSwitcher />

      <div className="hidden items-center gap-1.5 lg:flex">
        {client && <Badge variant="outline">{client.industry}</Badge>}
        {activeCampaign && <Badge variant="accent">{activeCampaign.name}</Badge>}
        {client && client.positioningStatus !== 'not_started' && (
          <StatusBadge status={client.positioningStatus} />
        )}
      </div>

      <div className="ml-auto flex items-center gap-2">
        <Breadcrumbs />

        <div className="relative hidden sm:block">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…" className="h-8 w-48 pl-8" />
        </div>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="relative h-8 w-8">
              <Bell className="h-4 w-4" />
              <span className="absolute -right-0.5 -top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-destructive text-[9px] font-bold text-destructive-foreground">
                {MOCK_NOTIFICATIONS.length}
              </span>
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 p-2">
            <p className="px-1 py-1 text-xs font-semibold text-muted-foreground">Notifications</p>
            <div className="flex flex-col gap-1">
              {MOCK_NOTIFICATIONS.map(n => (
                <div key={n.id} className="rounded-md px-2 py-1.5 text-xs hover:bg-muted">
                  <p className="text-foreground">{n.text}</p>
                  <p className="text-[10px] text-muted-foreground">{n.time}</p>
                </div>
              ))}
            </div>
          </PopoverContent>
        </Popover>

        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={cycleTheme} title={`Theme: ${mode}`}>
          <ThemeIcon className="h-4 w-4" />
        </Button>

        <Button size="sm" className="h-8 gap-1.5 bg-sg-forest text-sg-ivory hover:bg-sg-forest/90" onClick={openCompanion}>
          <Sparkles className="h-3.5 w-3.5" />
          <span className="hidden md:inline">AI Companion</span>
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button>
              <Avatar className="h-8 w-8">
                <AvatarFallback>{(user?.username ?? 'U').slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel>
              <div className="flex flex-col">
                <span className="text-xs font-semibold">{user?.username}</span>
                <span className="text-[10px] font-normal text-muted-foreground">{user?.role ?? 'staff'} · {contextLabel}</span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="gap-2">
              <UserIcon className="h-3.5 w-3.5" /> Profile
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2" onClick={logout}>
              <LogOut className="h-3.5 w-3.5" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
