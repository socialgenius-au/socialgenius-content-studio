import type { LucideIcon } from 'lucide-react'
import {
  LayoutDashboard, Users, Radar, Target, ClipboardCheck, Map, Megaphone, Sparkles,
  Clapperboard, Scissors, Palette, Library, Send, Calendar, Plug, TrendingUp,
  MessagesSquare, ListChecks, SlidersHorizontal, BarChart3, BookOpen, Settings,
} from 'lucide-react'
import type { StaffRole } from '@/types/domain'

export interface NavItem {
  id: string
  label: string
  icon: LucideIcon
  /** Use {clientId} as a placeholder — resolved against the active client. */
  path: string
  roles: StaffRole[] | 'all'
  clientScoped: boolean
}

export interface NavGroup {
  id: string
  label: string
  items: NavItem[]
}

const ALL: StaffRole[] | 'all' = 'all'

export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'command',
    label: 'Command',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, path: '/dashboard', roles: ALL, clientScoped: false },
      { id: 'clients', label: 'Clients', icon: Users, path: '/clients', roles: ALL, clientScoped: false },
    ],
  },
  {
    id: 'intelligence',
    label: 'Intelligence',
    items: [
      { id: 'intelligence', label: 'Strategic Intelligence', icon: Radar, path: '/clients/{clientId}/intelligence', roles: ['admin', 'strategist'], clientScoped: true },
      { id: 'positioning', label: 'Positioning', icon: Target, path: '/clients/{clientId}/positioning', roles: ['admin', 'strategist'], clientScoped: true },
      { id: 'audit', label: 'Social Audit', icon: ClipboardCheck, path: '/clients/{clientId}/audit', roles: ['admin', 'strategist'], clientScoped: true },
      { id: 'strategy', label: 'Strategy & Roadmap', icon: Map, path: '/clients/{clientId}/strategy', roles: ['admin', 'strategist'], clientScoped: true },
    ],
  },
  {
    id: 'growth',
    label: 'Growth',
    items: [
      { id: 'campaigns', label: 'Campaigns', icon: Megaphone, path: '/clients/{clientId}/campaigns', roles: ['admin', 'strategist', 'content_creator'], clientScoped: true },
      { id: 'post-creator', label: 'Post Creator', icon: Sparkles, path: '/post-creator-v2', roles: ['admin', 'content_creator'], clientScoped: false },
      { id: 'studio', label: 'Video Studio', icon: Clapperboard, path: '/clients/{clientId}/studio', roles: ['admin', 'content_creator'], clientScoped: true },
      { id: 'repurpose', label: 'Repurpose', icon: Scissors, path: '/clients/{clientId}/repurpose', roles: ['admin', 'content_creator'], clientScoped: true },
      { id: 'brand-kit', label: 'Brand Kit', icon: Palette, path: '/clients/{clientId}/brand-kit', roles: ['admin', 'content_creator', 'strategist'], clientScoped: true },
      { id: 'library', label: 'Library', icon: Library, path: '/clients/{clientId}/library', roles: ['admin', 'content_creator', 'strategist'], clientScoped: true },
    ],
  },
  {
    id: 'distribution',
    label: 'Distribution',
    items: [
      { id: 'publish', label: 'Publish', icon: Send, path: '/clients/{clientId}/publish', roles: ['admin', 'content_creator', 'operations'], clientScoped: true },
      { id: 'calendar', label: 'Content Calendar', icon: Calendar, path: '/clients/{clientId}/calendar', roles: ['admin', 'content_creator', 'operations'], clientScoped: true },
      { id: 'connections', label: 'Connections', icon: Plug, path: '/connections', roles: ['admin', 'operations'], clientScoped: false },
    ],
  },
  {
    id: 'revenue',
    label: 'Revenue',
    items: [
      { id: 'leads', label: 'Leads & Sales', icon: TrendingUp, path: '/clients/{clientId}/leads', roles: ['admin', 'sales'], clientScoped: true },
      { id: 'inbox', label: 'Inbox & Nurture', icon: MessagesSquare, path: '/clients/{clientId}/inbox', roles: ['admin', 'sales'], clientScoped: true },
    ],
  },
  {
    id: 'operations',
    label: 'Operations',
    items: [
      { id: 'tasks', label: 'Tasks & Delivery', icon: ListChecks, path: '/clients/{clientId}/tasks', roles: ['admin', 'operations'], clientScoped: true },
      { id: 'service-config', label: 'Service Configurator', icon: SlidersHorizontal, path: '/clients/{clientId}/service-config', roles: ['admin', 'operations'], clientScoped: true },
    ],
  },
  {
    id: 'learning',
    label: 'Learning',
    items: [
      { id: 'analytics', label: 'Analytics', icon: BarChart3, path: '/clients/{clientId}/analytics', roles: ALL, clientScoped: true },
      { id: 'knowledge', label: 'Knowledge Library', icon: BookOpen, path: '/knowledge', roles: ALL, clientScoped: false },
    ],
  },
  {
    id: 'system',
    label: 'System',
    items: [
      { id: 'settings', label: 'Admin / Settings', icon: Settings, path: '/settings', roles: ['admin'], clientScoped: false },
    ],
  },
]

export function resolveNavPath(item: NavItem, clientId: string | null): string {
  if (!item.clientScoped) return item.path
  return item.path.replace('{clientId}', clientId ?? '')
}

export function isNavItemVisible(item: NavItem, role: string): boolean {
  if (item.roles === 'all') return true
  return (item.roles as string[]).includes(role)
}
