import { useState } from 'react'
import { Search, Bell, Sparkles, Sun, Moon, Monitor, LogOut, User as UserIcon, Menu } from 'lucide-react'
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

interface TopBarProps {
  /** Narrow viewport: show the button that opens the navigation drawer. */
  showMenuButton?: boolean
  onOpenMenu?: () => void
}

export function TopBar({ showMenuButton = false, onOpenMenu }: TopBarProps = {}) {
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
    <header className="flex min-h-16 shrink-0 flex-wrap items-center gap-2 border-b border-purple-200/50 bg-gradient-to-r from-[#f4eafb] via-white to-[#f9f4ff] px-3 py-2 shadow-sm sm:gap-3 sm:px-4 dark:border-purple-900 dark:from-[#2b153e] dark:via-[#231032] dark:to-[#321847]">
      {showMenuButton && (
        <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={onOpenMenu} aria-label="Open navigation">
          <Menu className="h-5 w-5" />
        </Button>
      )}
      <ClientSwitcher />

      <div className="hidden items-center gap-1.5 lg:flex">
        {client && <Badge variant="outline">{client.industry}</Badge>}
        {activeCampaign && <Badge variant="accent">{activeCampaign.name}</Badge>}
        {client && client.positioningStatus !== 'not_started' && (
          <StatusBadge status={client.positioningStatus} />
        )}
      </div>

      <div className="ml-auto flex min-w-0 items-center gap-2">
        <div className="hidden lg:block"><Breadcrumbs /></div>

        <div className="relative hidden sm:block">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search projects, templates, assets…" className="h-9 w-40 rounded-full border-purple-200 bg-white/85 pl-8 lg:w-64 dark:border-purple-700 dark:bg-purple-950/50" />
        </div>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="relative h-8 w-8 shrink-0">
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

        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={cycleTheme} title={`Theme: ${mode}`}>
          <ThemeIcon className="h-4 w-4" />
        </Button>

        <Button size="sm" className="h-9 shrink-0 gap-1.5 bg-[#68318e] text-white hover:bg-[#8246a9]" onClick={openCompanion}>
          <Sparkles className="h-3.5 w-3.5" />
          <span className="hidden lg:inline">AI Companion</span>
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="shrink-0">
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
