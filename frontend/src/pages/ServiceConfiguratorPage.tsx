import { useEffect, useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { LoadingState } from '@/components/common/LoadingState'
import { Card, CardContent } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useClient } from '@/contexts/ClientContext'
import { useAICompanionContext } from '@/contexts/AICompanionContext'
import { servicePlanService } from '@/services/servicePlanService'
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

function EntitlementRow({ entitlement }: { entitlement: ServiceEntitlement }) {
  const [enabled, setEnabled] = useState(entitlement.enabled)
  const [quantity, setQuantity] = useState(entitlement.quantity)
  const [frequency, setFrequency] = useState<ServiceFrequency>(entitlement.frequency)
  const [serviceLevel, setServiceLevel] = useState(entitlement.serviceLevel)
  const [clientFacing, setClientFacing] = useState(entitlement.clientFacing)

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
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="flex flex-col gap-1">
            <Label>Quantity</Label>
            <Input
              type="number"
              min={0}
              value={quantity}
              disabled={!enabled}
              onChange={e => setQuantity(Number(e.target.value))}
              className="h-8"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Frequency</Label>
            <Select value={frequency} onValueChange={v => setFrequency(v as ServiceFrequency)} disabled={!enabled}>
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
            <Select value={serviceLevel} onValueChange={v => setServiceLevel(v as ServiceEntitlement['serviceLevel'])} disabled={!enabled}>
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
              <Switch checked={clientFacing} onCheckedChange={setClientFacing} disabled={!enabled} />
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
  const [entitlements, setEntitlements] = useState<ServiceEntitlement[] | null>(null)
  const [planName, setPlanName] = useState('')
  const [loading, setLoading] = useState(true)

  useAICompanionContext(client ? `Service Configurator • ${client.name}` : 'Service Configurator')

  useEffect(() => {
    if (!client) return
    setLoading(true)
    servicePlanService.get(client.servicePlanId).then(plan => {
      setEntitlements(plan?.entitlements ?? null)
      setPlanName(plan?.name ?? '')
      setLoading(false)
    })
  }, [client])

  if (clientLoading || !client) return <LoadingState rows={3} />

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Service Configurator"
        description={`Plan → entitlements → quantity → frequency → service level for ${client.name}. Nothing here is a fixed package — every row below is configured individually.`}
      />

      {loading ? (
        <LoadingState rows={4} />
      ) : !entitlements || entitlements.length === 0 ? (
        <EmptyState icon={SlidersHorizontal} title="No service plan configured" description="This client doesn't have a service plan set up yet." />
      ) : (
        <div className="flex flex-col gap-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{planName}</span>
          {entitlements.map(e => (
            <EntitlementRow key={e.key} entitlement={e} />
          ))}
        </div>
      )}
    </div>
  )
}
