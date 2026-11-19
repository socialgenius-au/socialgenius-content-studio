import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { ChevronDown, ChevronsLeft, ChevronsRight, X } from 'lucide-react'
import { NAV_GROUPS, resolveNavPath, isNavItemVisible } from '@/config/navigation'
import { useClient } from '@/contexts/ClientContext'
import { useAuth } from '@/contexts/AuthContext'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip'

const COLLAPSE_KEY = 'sg.sidebarCollapsed'
const GROUPS_KEY = 'sg.sidebarCollapsedGroups'

interface SidebarProps {
  /** Narrow viewport (< 768px): the navigation is an off-canvas drawer, closed unless `open`. */
  narrow?: boolean
  open?: boolean
  onClose?: () => void
}

export function Sidebar({ narrow = false, open = false, onClose }: SidebarProps = {}) {
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
  // The icon-only rail is a desktop preference; the drawer always shows full labels.
  const compact = collapsed && !narrow

  useEffect(() => {
    if (!narrow || !open || !onClose) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [narrow, open, onClose])

  if (narrow && !open) return null

  return (
    <TooltipProvider delayDuration={200}>
      {narrow && <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} aria-hidden="true" data-testid="nav-backdrop" />}
      <aside
        aria-label="Main navigation"
        className={cn(
          'flex flex-col border-r border-border bg-card',
          narrow ? 'fixed inset-y-0 left-0 z-50 w-60 max-w-[85vw] shadow-xl' : 'h-full shrink-0 transition-[width] duration-150',
          !narrow && (compact ? 'w-[60px]' : 'w-60')
        )}
      >
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-sg-forest text-xs font-extrabold text-sg-ivory">
            SG
          </div>
          {!compact && (
            <div className="flex flex-col leading-tight">
              <span className="text-[13px] font-extrabold tracking-tight">Social Genius</span>
              <span className="text-[10px] font-medium text-muted-foreground">The Positioning People</span>
            </div>
          )}
          {narrow && (
            <button type="button" onClick={onClose} aria-label="Close navigation" className="ml-auto flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-3">
          {NAV_GROUPS.map(group => {
            const visibleItems = group.items.filter(item => isNavItemVisible(item, role))
            if (visibleItems.length === 0) return null
            const groupCollapsed = collapsedGroups.includes(group.id)
            return (
              <div key={group.id} className="mb-1">
                {!compact && (
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
                          onClick={e => { if (disabled) e.preventDefault(); else if (narrow) onClose?.() }}
                          className={({ isActive }) =>
                            cn(
                              'flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] font-medium transition-colors',
                              compact && 'justify-center px-0 py-2',
                              disabled && 'pointer-events-none opacity-40',
                              isActive
                                ? 'bg-primary text-primary-foreground'
                                : 'text-foreground/80 hover:bg-muted hover:text-foreground'
                            )
                          }
                        >
                          <item.icon className="h-4 w-4 shrink-0" />
                          {!compact && <span className="truncate">{item.label}</span>}
                        </NavLink>
                      )
                      return (
                        <li key={item.id}>
                          {compact ? (
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

        {!narrow && (
          <button
            onClick={toggleCollapsed}
            className="flex h-10 shrink-0 items-center justify-center gap-1.5 border-t border-border text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {compact ? <ChevronsRight className="h-3.5 w-3.5" /> : <><ChevronsLeft className="h-3.5 w-3.5" /> Collapse</>}
          </button>
        )}
      </aside>
    </TooltipProvider>
  )
}
