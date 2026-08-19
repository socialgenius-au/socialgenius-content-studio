import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Sun, Moon, Monitor, ShieldCheck, GitBranch, KeyRound } from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { LoadingState } from '@/components/common/LoadingState'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { useAuth } from '@/contexts/AuthContext'
import { useTheme, type ThemeMode } from '@/contexts/ThemeContext'
import { useClient } from '@/contexts/ClientContext'
import { useAICompanionContext } from '@/contexts/AICompanionContext'
import { positioningService } from '@/services/positioningService'
import { NAV_GROUPS } from '@/config/navigation'
import type { PositioningFramework, StaffRole } from '@/types/domain'
import { cn } from '@/lib/utils'

const ROLES: { id: StaffRole; label: string; description: string }[] = [
  { id: 'admin', label: 'Admin', description: 'Everything.' },
  { id: 'strategist', label: 'Strategist', description: 'Intelligence, Positioning, Audit, Strategy, Campaigns.' },
  { id: 'content_creator', label: 'Content Creator', description: 'Campaigns, Create, Video, Library, Publish.' },
  { id: 'operations', label: 'Operations', description: 'Clients, Tasks, Calendar, Delivery.' },
  { id: 'sales', label: 'Sales', description: 'Leads, Inbox, Pipeline.' },
]

const THEME_OPTIONS: { id: ThemeMode; label: string; icon: typeof Sun }[] = [
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
  { id: 'auto', label: 'Auto', icon: Monitor },
]

const FRAMEWORK_STATUS_VARIANT: Record<PositioningFramework['status'], 'success' | 'secondary' | 'warning' | 'outline'> = {
  active: 'success',
  draft: 'secondary',
  experimental: 'warning',
  deprecated: 'outline',
}

export default function SettingsPage() {
  const { user } = useAuth()
  const { mode, setMode } = useTheme()
  const { client } = useClient()
  useAICompanionContext('Settings')

  const [frameworks, setFrameworks] = useState<PositioningFramework[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    positioningService.listFrameworks().then(list => {
      setFrameworks(list)
      setLoading(false)
    })
  }, [])

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Admin / Settings" description="Account, role-based access, framework versions and entitlements reference." />

      <Tabs defaultValue="account">
        <TabsList>
          <TabsTrigger value="account">Account</TabsTrigger>
          <TabsTrigger value="roles">Roles & Access</TabsTrigger>
          <TabsTrigger value="frameworks">Frameworks</TabsTrigger>
          <TabsTrigger value="entitlements">Entitlements</TabsTrigger>
        </TabsList>

        <TabsContent value="account">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Signed in as</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-1.5 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Username</span><span className="font-medium text-foreground">{user?.username}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Email</span><span className="font-medium text-foreground">{user?.email || '—'}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Role</span><Badge variant="outline">{user?.role}</Badge></div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Appearance</CardTitle>
                <CardDescription>Theme applies across the whole platform, including Video Studio.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="inline-flex rounded-lg border border-border p-1">
                  {THEME_OPTIONS.map(opt => (
                    <button
                      key={opt.id}
                      onClick={() => setMode(opt.id)}
                      className={cn(
                        'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                        mode === opt.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                      )}
                    >
                      <opt.icon className="h-3.5 w-3.5" />
                      {opt.label}
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="roles">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {ROLES.map(role => {
              const visibleGroups = NAV_GROUPS.map(group => ({
                ...group,
                items: group.items.filter(item => item.roles === 'all' || item.roles.includes(role.id)),
              })).filter(group => group.items.length > 0)

              return (
                <Card key={role.id}>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5" /> {role.label}</CardTitle>
                    <CardDescription>{role.description}</CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-2">
                    {visibleGroups.map(group => (
                      <div key={group.id}>
                        <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{group.label}</p>
                        <ul className="mt-1 flex flex-col gap-0.5">
                          {group.items.map(item => (
                            <li key={item.id} className="text-xs text-foreground">{item.label}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </TabsContent>

        <TabsContent value="frameworks">
          {loading ? (
            <LoadingState rows={3} />
          ) : (
            <div className="flex flex-col gap-3">
              {frameworks.map(fw => (
                <Card key={fw.id}>
                  <CardContent className="flex flex-col gap-2 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-sm font-semibold text-foreground">{fw.name}</span>
                        <span className="text-xs text-muted-foreground">v{fw.version}</span>
                      </div>
                      <Badge variant={FRAMEWORK_STATUS_VARIANT[fw.status]}>{fw.status}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{fw.changeSummary}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {fw.applicableIndustries.map(ind => (
                        <Badge key={ind} variant="outline">{ind}</Badge>
                      ))}
                    </div>
                    <p className="text-[11px] text-muted-foreground">Created {fw.createdAt}</p>
                  </CardContent>
                </Card>
              ))}
              <p className="text-xs text-muted-foreground">Framework comparison — coming in a later phase.</p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="entitlements">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-1.5"><KeyRound className="h-3.5 w-3.5" /> How entitlements gate the UI</CardTitle>
              <CardDescription>Reference for how Service Configurator plans map to what staff and clients see.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-xs text-muted-foreground">
              <p>
                Every module reads visibility through capability checks rather than checking plan names directly, so a
                real entitlements backend can replace the mock provider without any component changing:
              </p>
              <div className="flex flex-col gap-1.5 rounded-lg bg-muted/50 p-3 font-mono text-[11px] text-foreground">
                <span>can(&apos;content.reels&apos;)</span>
                <span>limit(&apos;content.reels.per_week&apos;)</span>
                <span>can(&apos;intelligence.macro&apos;)</span>
                <span>can(&apos;leads.whatsapp&apos;)</span>
                <span>can(&apos;publish.linkedin&apos;)</span>
              </div>
              <p>
                Disabled entitlements should cause the related module or action to disappear from the client's
                workspace, not just show a locked state — see <code>EntitlementLocked</code> for the fallback the UI
                uses when a page needs to explain why a feature is missing.
              </p>
              {client ? (
                <Button asChild variant="outline" size="sm" className="w-fit">
                  <Link to={`/clients/${client.id}/service-config`}>
                    Manage {client.name}&apos;s entitlements in Service Configurator
                  </Link>
                </Button>
              ) : (
                <Button variant="outline" size="sm" className="w-fit" disabled title="Select a client first">
                  Manage in Service Configurator (per client)
                </Button>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
