import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Lock, Unlock, Send, CheckCircle2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
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
  const isApproved = version.status === 'approved' || version.status === 'scheduled' || version.status === 'published'

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle>{version.platform}</CardTitle>
        <div className="flex items-center gap-1.5">
          <StatusBadge status={version.status} />
          <Button
            size="sm"
            variant={isApproved ? 'outline' : 'default'}
            className="h-7 gap-1 text-[11px]"
            disabled={isApproved}
            onClick={() => onChange({ ...version, status: 'approved' })}
          >
            <CheckCircle2 className="h-3 w-3" /> {isApproved ? 'Approved' : 'Approve'}
          </Button>
        </div>
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
  const [assetId, setAssetId] = useState<string | null>(null)
  const [versions, setVersions] = useState<PlatformVersion[] | null>(null)
  const [justSent, setJustSent] = useState(false)

  useEffect(() => {
    if (!client) return
    campaignService.list(client.id).then(setCampaigns)
  }, [client])

  const assets: CampaignAsset[] = useMemo(() => campaigns?.flatMap(c => c.assets) ?? [], [campaigns])

  useEffect(() => {
    if (!campaigns) return
    setAssetId(prev => prev ?? assets[0]?.id ?? null)
  }, [campaigns, assets])

  useEffect(() => {
    setJustSent(false)
    if (!assetId) {
      setVersions([])
      return
    }
    let cancelled = false
    setVersions(null)
    connectionService.platformVersions(assetId).then(v => {
      if (!cancelled) setVersions(v)
    })
    return () => {
      cancelled = true
    }
  }, [assetId])

  const updateVersion = (updated: PlatformVersion) => {
    setVersions(prev => (prev ? prev.map(v => (v.id === updated.id ? updated : v)) : prev))
  }

  const approvedUnscheduled = (versions ?? []).filter(v => v.status === 'approved' && !v.scheduledFor)
  const approvedCount = (versions ?? []).filter(v => v.status === 'approved' || v.status === 'scheduled').length

  const sendToCalendar = () => {
    const sendAt = new Date()
    sendAt.setDate(sendAt.getDate() + 1)
    sendAt.setHours(9, 0, 0, 0)
    setVersions(prev =>
      prev
        ? prev.map(v => (v.status === 'approved' && !v.scheduledFor ? { ...v, status: 'scheduled', scheduledFor: sendAt.toISOString() } : v))
        : prev
    )
    setJustSent(true)
  }

  const asset = assets.find(a => a.id === assetId) ?? null

  if (loading || !client || campaigns === null) return <LoadingState rows={4} />

  if (assets.length === 0) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="Publish" description="Prepare one master project into platform-specific versions." />
        <EmptyState icon={Send} title="No content ready to publish yet" description="Create and approve content in Create Hub or Video Studio first." />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Publish"
        description={asset ? `Master content project: "${asset.title}"` : 'Prepare one master project into platform-specific versions.'}
        actions={
          <Select value={assetId ?? undefined} onValueChange={setAssetId}>
            <SelectTrigger className="h-9 w-64"><SelectValue placeholder="Choose a master project" /></SelectTrigger>
            <SelectContent>
              {assets.map(a => (
                <SelectItem key={a.id} value={a.id}>{a.title} — {a.status}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      {versions === null ? (
        <LoadingState rows={3} />
      ) : versions.length === 0 ? (
        <EmptyState icon={Send} title="No platform versions yet for this asset" description="Platform-specific versions will appear here once generated for this master project." />
      ) : (
        <>
          <MasterFlow platforms={versions.map(v => v.platform)} />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {versions.map(v => (
              <PlatformVersionCard key={v.id} version={v} onChange={updateVersion} />
            ))}
          </div>
          <div className="flex items-center justify-end gap-2">
            {justSent && approvedUnscheduled.length === 0 && (
              <span className="text-[11px] text-muted-foreground">Sent to Calendar — scheduled for tomorrow 9:00am.</span>
            )}
            <Button className="gap-1.5" disabled={approvedCount === 0 || approvedUnscheduled.length === 0} onClick={sendToCalendar}>
              <Send className="h-3.5 w-3.5" /> Send approved versions to Calendar
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
