import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Megaphone, Users2, ListChecks } from 'lucide-react'
import { useClient } from '@/contexts/ClientContext'
import { useAICompanionContext } from '@/contexts/AICompanionContext'
import { campaignService } from '@/services/campaignService'
import { strategyService } from '@/services/strategyService'
import type { Campaign, CampaignAsset, ContentAssetType, StrategicInitiative } from '@/types/domain'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { LoadingState } from '@/components/common/LoadingState'
import { StatusBadge } from '@/components/common/StatusBadge'
import { MetricCard } from '@/components/common/MetricCard'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const ASSET_TYPE_LABEL: Record<ContentAssetType, string> = {
  video: 'Video', reel: 'Reels', post: 'Posts', carousel: 'Carousels', blog: 'Blog',
  pr: 'Press Release', email: 'Email', whatsapp: 'WhatsApp', gbp: 'Google Business Profile',
  ad: 'Ads', landing_page: 'Landing Pages',
}
const ASSET_STATUS_OPTIONS: CampaignAsset['status'][] = ['draft', 'review', 'approved', 'scheduled', 'published']
const READY_STATUSES: CampaignAsset['status'][] = ['approved', 'scheduled', 'published']

function readyCount(assets: CampaignAsset[]) {
  return assets.filter(a => READY_STATUSES.includes(a.status)).length
}

export default function CampaignsPage() {
  const { clientId, campaignId } = useParams<{ clientId: string; campaignId?: string }>()
  const { client } = useClient()
  const navigate = useNavigate()
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null)
  const [detail, setDetail] = useState<Campaign | null | undefined>(undefined)
  const [initiatives, setInitiatives] = useState<StrategicInitiative[]>([])

  useAICompanionContext(`Campaigns${client ? ` • ${client.name}` : ''}`)

  useEffect(() => {
    if (!clientId) return
    campaignService.list(clientId).then(setCampaigns)
    strategyService.list(clientId).then(setInitiatives)
  }, [clientId])

  useEffect(() => {
    if (!clientId || !campaignId) {
      setDetail(undefined)
      return
    }
    setDetail(undefined)
    campaignService.get(clientId, campaignId).then(c => setDetail(c ?? null))
  }, [clientId, campaignId])

  const linkedInitiative = useMemo(
    () => initiatives.find(i => i.id === detail?.strategicInitiativeId),
    [initiatives, detail?.strategicInitiativeId]
  )

  const updateAssetStatus = (assetId: string, status: CampaignAsset['status']) => {
    setDetail(prev => (prev ? { ...prev, assets: prev.assets.map(a => (a.id === assetId ? { ...a, status } : a)) } : prev))
  }

  if (!clientId) return null

  if (campaignId) {
    if (detail === undefined) return <LoadingState rows={4} />
    if (detail === null) {
      return <EmptyState icon={Megaphone} title="Campaign not found" description="It may have been removed or the link is out of date." />
    }
    const assetsByType = detail.assets.reduce<Record<string, typeof detail.assets>>((acc, a) => {
      ;(acc[a.type] ??= []).push(a)
      return acc
    }, {})
    const ready = readyCount(detail.assets)

    return (
      <div className="flex flex-col gap-5">
        <Link to={`/clients/${clientId}/campaigns`} className="inline-flex w-fit items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to campaigns
        </Link>

        <PageHeader
          title={detail.name}
          description={detail.objective}
          actions={<StatusBadge status={detail.status} />}
        />

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <MetricCard label="Leads generated" value={detail.leadsGenerated} icon={Users2} tone="accent" />
          <MetricCard label="Assets ready" value={`${ready}/${detail.assets.length}`} icon={ListChecks} hint="approved, scheduled or published" />
          <MetricCard label="Duration" value={detail.duration} />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Strategy</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              <Field label="Audience" value={detail.audience} />
              <Field label="Positioning objective" value={detail.positioningObjective} />
              <Field label="Core message" value={detail.coreMessage} />
              <Field label="Customer problem" value={detail.customerProblem} />
              <Field label="Desired outcome" value={detail.desiredOutcome} />
              <Field label="Success measure" value={detail.successMeasure} />
              <div>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Strategic initiative</p>
                {linkedInitiative ? (
                  <button
                    onClick={() => navigate(`/clients/${clientId}/strategy`)}
                    className="rounded-md bg-sg-lime/10 px-2 py-1 text-left text-sm text-foreground hover:bg-sg-lime/20"
                  >
                    {linkedInitiative.objective}
                  </button>
                ) : (
                  <p className="text-sm italic text-muted-foreground">Not linked to a strategic initiative.</p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Offer & Proof</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              <Field label="Proof" value={detail.proof} />
              <Field label="Offer" value={detail.offer} />
              <Field label="CTA" value={detail.cta} />
              <div>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Platforms</p>
                <div className="flex flex-wrap gap-1.5">
                  {detail.platforms.map(p => <Badge key={p} variant="outline">{p}</Badge>)}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader><CardTitle>Related assets</CardTitle></CardHeader>
          <CardContent>
            {detail.assets.length === 0 ? (
              <EmptyState icon={Megaphone} title="No assets yet" description="Content created for this campaign will appear here, grouped by type." />
            ) : (
              <div className="flex flex-col gap-4">
                {Object.entries(assetsByType).map(([type, assets]) => (
                  <div key={type}>
                    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {ASSET_TYPE_LABEL[type as ContentAssetType] ?? type}
                    </p>
                    <div className="flex flex-col gap-1.5">
                      {assets.map(a => (
                        <div key={a.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
                          <span>{a.title}</span>
                          <Select value={a.status} onValueChange={v => updateAssetStatus(a.id, v as CampaignAsset['status'])}>
                            <SelectTrigger className="h-6 w-auto gap-1 border-none bg-transparent p-0 shadow-none [&>svg]:h-3 [&>svg]:w-3">
                              <SelectValue>
                                <StatusBadge status={a.status} className="cursor-pointer" />
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              {ASSET_STATUS_OPTIONS.map(s => (
                                <SelectItem key={s} value={s}>{s}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Campaigns" description="The bridge between strategy and content — every campaign ties back to a positioning objective." />

      {campaigns === null ? (
        <LoadingState rows={3} />
      ) : campaigns.length === 0 ? (
        <EmptyState icon={Megaphone} title="No campaigns yet" description="Campaigns created for this client will appear here." />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {campaigns.map(c => (
            <Link key={c.id} to={`/clients/${clientId}/campaigns/${c.id}`}>
              <Card className="h-full transition-colors hover:border-primary/40">
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle>{c.name}</CardTitle>
                    <StatusBadge status={c.status} />
                  </div>
                  <p className="text-xs text-muted-foreground">{c.objective}</p>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <p className="text-xs text-foreground/80">{c.audience}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {c.platforms.map(p => <Badge key={p} variant="outline">{p}</Badge>)}
                  </div>
                  <div className="flex items-center justify-between border-t border-border pt-2 text-xs text-muted-foreground">
                    <span>{c.duration}</span>
                    <span>{readyCount(c.assets)}/{c.assets.length} assets ready</span>
                    <span className="font-semibold text-foreground">{c.leadsGenerated} leads</span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-foreground">{value}</p>
    </div>
  )
}
