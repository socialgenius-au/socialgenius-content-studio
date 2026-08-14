import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { ChevronDown, ChevronsLeft, ChevronsRight } from 'lucide-react'
import { NAV_GROUPS, resolveNavPath, isNavItemVisible } from '@/config/navigation'
import { useClient } from '@/contexts/ClientContext'
import { useAuth } from '@/contexts/AuthContext'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip'

const COLLAPSE_KEY = 'sg.sidebarCollapsed'
const GROUPS_KEY = 'sg.sidebarCollapsedGroups'

export function Sidebar() {
  const { client } = useClient()
  const { user } = useAuth()
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === '1')
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(GROUPS_KEY) ?? '[]')
    } catch {
      return []
    }
  })

  const toggleCollapsed = () => {
    setCollapsed(prev => {
      localStorage.setItem(COLLAPSE_KEY, prev ? '0' : '1')
      return !prev
    })
  }

  const toggleGroup = (groupId: string) => {
    setCollapsedGroups(prev => {
      const next = prev.includes(groupId) ? prev.filter(g => g !== groupId) : [...prev, groupId]
      localStorage.setItem(GROUPS_KEY, JSON.stringify(next))
      return next
    })
  }

  const role = user?.role ?? 'admin'

  return (
    <TooltipProvider delayDuration={200}>
      <aside
        className={cn(
          'flex h-full shrink-0 flex-col border-r border-border bg-card transition-[width] duration-150',
          collapsed ? 'w-[60px]' : 'w-60'
        )}
      >
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-sg-forest text-xs font-extrabold text-sg-ivory">
            SG
          </div>
          {!collapsed && (
            <div className="flex flex-col leading-tight">
              <span className="text-[13px] font-extrabold tracking-tight">Social Genius</span>
              <span className="text-[10px] font-medium text-muted-foreground">The Positioning People</span>
            </div>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-3">
          {NAV_GROUPS.map(group => {
            const visibleItems = group.items.filter(item => isNavItemVisible(item, role))
            if (visibleItems.length === 0) return null
            const groupCollapsed = collapsedGroups.includes(group.id)
            return (
              <div key={group.id} className="mb-1">
                {!collapsed && (
                  <button
                    onClick={() => toggleGroup(group.id)}
                    className="flex w-full items-center justify-between px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground"
                  >
                    {group.label}
                    <ChevronDown className={cn('h-3 w-3 transition-transform', groupCollapsed && '-rotate-90')} />
                  </button>
                )}
                {!groupCollapsed && (
                  <ul className="flex flex-col gap-0.5">
                    {visibleItems.map(item => {
                      const path = resolveNavPath(item, client?.id ?? null)
                      const disabled = item.clientScoped && !client
                      const linkContent = (
                        <NavLink
                          to={disabled ? '#' : path}
                          onClick={e => disabled && e.preventDefault()}
                          className={({ isActive }) =>
                            cn(
                              'flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] font-medium transition-colors',
                              collapsed && 'justify-center px-0 py-2',
                              disabled && 'pointer-events-none opacity-40',
                              isActive
                                ? 'bg-primary text-primary-foreground'
                                : 'text-foreground/80 hover:bg-muted hover:text-foreground'
                            )
                          }
                        >
                          <item.icon className="h-4 w-4 shrink-0" />
                          {!collapsed && <span className="truncate">{item.label}</span>}
                        </NavLink>
                      )
                      return (
                        <li key={item.id}>
                          {collapsed ? (
                            <Tooltip>
                              <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
                              <TooltipContent side="right">{item.label}</TooltipContent>
                            </Tooltip>
                          ) : (
                            linkContent
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            )
          })}
        </nav>

        <button
          onClick={toggleCollapsed}
          className="flex h-10 shrink-0 items-center justify-center gap-1.5 border-t border-border text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {collapsed ? <ChevronsRight className="h-3.5 w-3.5" /> : <><ChevronsLeft className="h-3.5 w-3.5" /> Collapse</>}
        </button>
      </aside>
    </TooltipProvider>
  )
}
