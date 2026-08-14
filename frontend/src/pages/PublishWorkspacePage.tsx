import { useEffect, useState } from 'react'
import { ArrowRight, Lock, Unlock, Send } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { PageHeader } from '@/components/common/PageHeader'
import { LoadingState } from '@/components/common/LoadingState'
import { EmptyState } from '@/components/common/EmptyState'
import { StatusBadge } from '@/components/common/StatusBadge'
import { useClient } from '@/contexts/ClientContext'
import { useAICompanionContext } from '@/contexts/AICompanionContext'
import { campaignService } from '@/services/campaignService'
import { connectionService } from '@/services/connectionService'
import type { Campaign, CampaignAsset, PlatformVersion } from '@/types/domain'

function MasterFlow({ platforms }: { platforms: string[] }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-muted/30 p-3">
      <Badge className="bg-sg-forest text-sg-ivory">Master Project</Badge>
      {platforms.map(p => (
        <span key={p} className="flex items-center gap-2">
          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
          <Badge variant="outline">{p}</Badge>
        </span>
      ))}
    </div>
  )
}

function PlatformVersionCard({ version, onChange }: { version: PlatformVersion; onChange: (v: PlatformVersion) => void }) {
  const toggleLock = (field: string) => {
    onChange({ ...version, locked: { ...version.locked, [field]: !version.locked[field] } })
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle>{version.platform}</CardTitle>
        <StatusBadge status={version.status} />
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-0">
        <div>
          <div className="mb-1 flex items-center justify-between">
            <Label>Title</Label>
            <button onClick={() => toggleLock('title')} className="text-muted-foreground hover:text-foreground" title={version.locked.title ? 'Locked — regeneration will preserve this' : 'Unlocked — AI may overwrite this'}>
              {version.locked.title ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
            </button>
          </div>
          <Input value={version.title} onChange={e => onChange({ ...version, title: e.target.value })} />
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between">
            <Label>Caption</Label>
            <button onClick={() => toggleLock('caption')} className="text-muted-foreground hover:text-foreground" title={version.locked.caption ? 'Locked — regeneration will preserve this' : 'Unlocked — AI may overwrite this'}>
              {version.locked.caption ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
            </button>
          </div>
          <Textarea value={version.caption} onChange={e => onChange({ ...version, caption: e.target.value })} />
        </div>
        <div>
          <Label>Hashtags</Label>
          <Input value={version.hashtags} onChange={e => onChange({ ...version, hashtags: e.target.value })} className="mt-1" />
        </div>
        <div>
          <Label>CTA</Label>
          <Input value={version.cta} onChange={e => onChange({ ...version, cta: e.target.value })} className="mt-1" />
        </div>
        {version.scheduledFor && (
          <p className="text-[11px] text-muted-foreground">Scheduled for {new Date(version.scheduledFor).toLocaleString()}</p>
        )}
      </CardContent>
    </Card>
  )
}

export default function PublishWorkspacePage() {
  const { client, loading } = useClient()
  useAICompanionContext(`Publish • ${client?.name ?? '…'}`)

  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null)
  const [asset, setAsset] = useState<CampaignAsset | null>(null)
  const [versions, setVersions] = useState<PlatformVersion[] | null>(null)

  useEffect(() => {
    if (!client) return
    campaignService.list(client.id).then(setCampaigns)
  }, [client])

  useEffect(() => {
    if (!campaigns) return
    const firstAsset = campaigns.flatMap(c => c.assets)[0] ?? null
    setAsset(firstAsset)
    if (firstAsset) {
      connectionService.platformVersions(firstAsset.id).then(setVersions)
    } else {
      setVersions([])
    }
  }, [campaigns])

  const updateVersion = (updated: PlatformVersion) => {
    setVersions(prev => (prev ? prev.map(v => (v.id === updated.id ? updated : v)) : prev))
  }

  if (loading || !client || campaigns === null) return <LoadingState rows={4} />

  if (!asset || versions === null) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="Publish" description="Prepare one master project into platform-specific versions." />
        <EmptyState icon={Send} title="No content ready to publish yet" description="Create and approve content in Create Hub or Video Studio first." />
      </div>
    )
  }

  if (versions.length === 0) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="Publish" description={`Master content project: "${asset.title}"`} />
        <EmptyState icon={Send} title="No platform versions yet for this asset" description="Platform-specific versions will appear here once generated for this master project." />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Publish" description={`Master content project: "${asset.title}"`} />
      <MasterFlow platforms={versions.map(v => v.platform)} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {versions.map(v => (
          <PlatformVersionCard key={v.id} version={v} onChange={updateVersion} />
        ))}
      </div>
      <div className="flex justify-end">
        <Button className="gap-1.5">
          <Send className="h-3.5 w-3.5" /> Send approved versions to Calendar
        </Button>
      </div>
    </div>
  )
}
