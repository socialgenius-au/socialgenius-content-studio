import { useEffect, useState } from 'react'
import {
  Share2, Video, Briefcase, MessageCircle, Plug, AlertTriangle, HardDrive, MapPin,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/common/PageHeader'
import { LoadingState } from '@/components/common/LoadingState'
import { EmptyState } from '@/components/common/EmptyState'
import { StatusBadge } from '@/components/common/StatusBadge'
import { DisconnectedIntegration } from '@/components/common/ErrorState'
import { useClient } from '@/contexts/ClientContext'
import { useAICompanionContext } from '@/contexts/AICompanionContext'
import { connectionService } from '@/services/connectionService'
import type { PlatformConnection } from '@/types/domain'

const PLATFORM_ICON: Record<string, typeof Plug> = {
  Instagram: Share2, Facebook: Share2, YouTube: Video, LinkedIn: Briefcase,
  'WhatsApp Business': MessageCircle, TikTok: Video, 'Google Business Profile': MapPin, 'Google Drive': HardDrive,
}

const DRIVE_STRUCTURE = [
  { label: 'Brand Assets', children: [] },
  { label: 'Raw Footage', children: [] },
  { label: 'Images', children: [] },
  { label: 'Audio', children: [] },
  { label: 'Projects', children: [] },
  { label: 'Approved Content', children: [] },
  { label: 'Published Content', children: [] },
  { label: 'Blogs', children: [] },
  { label: 'Press Releases', children: [] },
  { label: 'Thumbnails', children: [] },
  { label: 'Archive', children: [] },
]

function formatSynced(iso: string | null) {
  if (!iso) return 'Never synced'
  return `Synced ${new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
}

export default function ConnectionsPage() {
  const { client, loading } = useClient()
  useAICompanionContext(`Connections${client ? ' • ' + client.name : ''}`)

  const [connections, setConnections] = useState<PlatformConnection[] | null>(null)

  useEffect(() => {
    if (!client) return
    setConnections(null)
    connectionService.list(client.id).then(setConnections)
  }, [client])

  if (loading || !client) return <LoadingState rows={4} />

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Connections" description={`Platform and storage connections for ${client.name}. No new OAuth is wired up yet — this is the management surface it will plug into.`} />

      {connections === null ? (
        <LoadingState rows={4} />
      ) : connections.length === 0 ? (
        <EmptyState icon={Plug} title="No connections configured" description="This client has no platform connections set up yet." />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {connections.map(conn => {
            const Icon = PLATFORM_ICON[conn.platform] ?? Plug
            return (
              <Card key={conn.id}>
                <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 pb-2">
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <CardTitle>{conn.platform}</CardTitle>
                  </div>
                  <StatusBadge status={conn.status} />
                </CardHeader>
                <CardContent className="flex flex-col gap-2 pt-0 text-xs">
                  <p className="text-foreground">{conn.accountName ?? 'Not connected'}</p>
                  {conn.permissions.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {conn.permissions.map(p => <Badge key={p} variant="outline">{p}</Badge>)}
                    </div>
                  )}
                  <p className="text-muted-foreground">{formatSynced(conn.lastSynced)}</p>
                  {conn.status === 'warning' && (
                    <p className="flex items-center gap-1 text-warning"><AlertTriangle className="h-3 w-3" /> Permissions may have expired — reconnect recommended.</p>
                  )}
                  {conn.status === 'disconnected' && (
                    <Button size="sm" variant="outline" disabled title="OAuth integration not built yet — Phase 2">
                      Connect
                    </Button>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Google Drive storage</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 pt-0 md:grid-cols-2">
          <div className="flex flex-col gap-2 text-xs text-muted-foreground">
            <p><span className="font-semibold text-foreground">Client Google Drive</span> — long-term client asset storage. Owns approved/published content and archives.</p>
            <p><span className="font-semibold text-foreground">Social Genius working storage</span> — temporary editing/rendering cache, cleared after export.</p>
            <DisconnectedIntegration integration="Google Drive connection" className="mt-1" />
          </div>
          <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs">
            <p className="mb-1.5 font-semibold text-foreground">Social Genius Content</p>
            <ul className="ml-4 list-disc space-y-0.5 text-muted-foreground">
              {DRIVE_STRUCTURE.map(f => <li key={f.label}>{f.label}</li>)}
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
