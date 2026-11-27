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
          'flex flex-col border-r border-[#e8ddf2] bg-white text-[#322342] shadow-[3px_0_24px_rgba(79,37,112,0.04)] dark:border-purple-900 dark:bg-[#21132f] dark:text-white',
          narrow ? 'fixed inset-y-0 left-0 z-50 w-64 max-w-[85vw] shadow-xl' : 'h-full shrink-0 transition-[width] duration-150',
          !narrow && (compact ? 'w-[76px]' : 'w-[248px]')
        )}
      >
        <div className="flex min-h-[94px] shrink-0 items-center gap-3 border-b border-[#eee4f5] px-4 py-3 dark:border-white/15">
          <img src="/social-genius-official-logo.svg" alt="Social Genius" className="h-11 w-11 shrink-0 object-contain" />
          {!compact && <div className="min-w-0 flex flex-col leading-tight"><span className="text-[15px] font-bold tracking-tight text-[#3d2354] dark:text-white">Social Genius</span><span className="mt-1 text-[11px] font-medium text-[#7950a3] dark:text-amber-300">Content Studio</span><span className="mt-1 text-[10px] text-[#8c7a9d] dark:text-purple-200">The Positioning People</span></div>}
          {narrow && <button type="button" onClick={onClose} aria-label="Close navigation" className="ml-auto flex h-9 w-9 items-center justify-center rounded-md text-[#563a71] hover:bg-purple-50 dark:text-white dark:hover:bg-white/10"><X className="h-4 w-4" /></button>}
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
                    className="flex w-full items-center justify-between px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[#9684a5] hover:text-[#65318c] dark:text-purple-200 dark:hover:text-amber-300"
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
                              'flex items-center gap-2.5 rounded-lg px-2 py-2 text-[13px] font-medium transition-colors',
                              compact && 'justify-center px-0 py-2',
                              disabled && 'pointer-events-none opacity-40',
                              isActive
                                ? 'bg-[#f0e5fa] text-[#62348b] shadow-sm ring-1 ring-[#e3d2f0] dark:bg-[#7440a3] dark:text-white'
                                : 'text-[#5d4d6d] hover:bg-[#f7f0fc] hover:text-[#65318c] dark:text-purple-100 dark:hover:bg-white/10 dark:hover:text-white'
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
