import { SlidersHorizontal, ListChecks, Eye } from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { LoadingState } from '@/components/common/LoadingState'
import { MetricCard } from '@/components/common/MetricCard'
import { Card, CardContent } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useClient } from '@/contexts/ClientContext'
import { useAICompanionContext } from '@/contexts/AICompanionContext'
import { useEntitlements } from '@/contexts/EntitlementContext'
import type { ServiceEntitlement, ServiceFrequency } from '@/types/domain'
import { cn } from '@/lib/utils'

const FREQUENCIES: ServiceFrequency[] = ['weekly', 'fortnightly', 'monthly', 'quarterly', 'custom']
const SERVICE_LEVELS: ServiceEntitlement['serviceLevel'][] = ['standard', 'priority', 'white_glove']

function frequencyLabel(f: ServiceFrequency) {
  return f.charAt(0).toUpperCase() + f.slice(1)
}
function levelLabel(l: ServiceEntitlement['serviceLevel']) {
  return l === 'white_glove' ? 'White Glove' : l.charAt(0).toUpperCase() + l.slice(1)
}

function EntitlementRow({ entitlement, onChange }: { entitlement: ServiceEntitlement; onChange: (patch: Partial<ServiceEntitlement>) => void }) {
  const { enabled, quantity, frequency, serviceLevel, clientFacing } = entitlement

  return (
    <Card className={cn('shadow-none transition-opacity', !enabled && 'opacity-50')}>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-foreground">{entitlement.label}</span>
            <span className="text-[11px] text-muted-foreground">
              {enabled
                ? `${entitlement.label} — Enabled, ${quantity}/${frequency === 'custom' ? 'custom' : frequency.replace('ly', '')}, ${levelLabel(serviceLevel)}`
                : `${entitlement.label} — Disabled`}
            </span>
          </div>
          <Switch checked={enabled} onCheckedChange={v => onChange({ enabled: v })} />
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="flex flex-col gap-1">
            <Label>Quantity</Label>
            <Input
              type="number"
              min={0}
              value={quantity}
              disabled={!enabled}
              onChange={e => onChange({ quantity: Number(e.target.value) })}
              className="h-8"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Frequency</Label>
            <Select value={frequency} onValueChange={v => onChange({ frequency: v as ServiceFrequency })} disabled={!enabled}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                {FREQUENCIES.map(f => (
                  <SelectItem key={f} value={f}>{frequencyLabel(f)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label>Service level</Label>
            <Select value={serviceLevel} onValueChange={v => onChange({ serviceLevel: v as ServiceEntitlement['serviceLevel'] })} disabled={!enabled}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SERVICE_LEVELS.map(l => (
                  <SelectItem key={l} value={l}>{levelLabel(l)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label>Client-facing</Label>
            <div className="flex h-8 items-center">
              <Switch checked={clientFacing} onCheckedChange={v => onChange({ clientFacing: v })} disabled={!enabled} />
            </div>
          </div>
        </div>

        {entitlement.usageLimit != null && (
          <span className="text-[10px] text-muted-foreground">Usage limit: {entitlement.usageLimit}</span>
        )}
      </CardContent>
    </Card>
  )
}

export default function ServiceConfiguratorPage() {
  const { client, loading: clientLoading } = useClient()
  const { entitlements, planName, loading, updateEntitlement } = useEntitlements()

  useAICompanionContext(client ? `Service Configurator • ${client.name}` : 'Service Configurator')

  if (clientLoading || !client || loading) return <LoadingState rows={3} />

  const enabledCount = entitlements.filter(e => e.enabled).length
  const clientFacingCount = entitlements.filter(e => e.enabled && e.clientFacing).length

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Service Configurator"
        description={`Plan → entitlements → quantity → frequency → service level for ${client.name}. Nothing here is a fixed package — every row below is configured individually, and changes apply live across the workspace (see Create Hub's content-type picker).`}
      />

      {entitlements.length === 0 ? (
        <EmptyState icon={SlidersHorizontal} title="No service plan configured" description="This client doesn't have a service plan set up yet." />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <MetricCard label="Services enabled" value={`${enabledCount}/${entitlements.length}`} icon={ListChecks} />
            <MetricCard label="Client-facing" value={clientFacingCount} icon={Eye} />
            <MetricCard label="Plan" value={planName || '—'} />
          </div>

          <div className="flex flex-col gap-3">
            {entitlements.map(e => (
              <EntitlementRow key={e.key} entitlement={e} onChange={patch => updateEntitlement(e.key, patch)} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
