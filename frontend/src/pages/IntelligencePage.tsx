import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Sparkles, Radar, Compass, ClipboardCheck } from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { LoadingState } from '@/components/common/LoadingState'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { useClient } from '@/contexts/ClientContext'
import { useAICompanion, useAICompanionContext } from '@/contexts/AICompanionContext'
import { intelligenceService } from '@/services/intelligenceService'
import { strategyService } from '@/services/strategyService'
import { auditService } from '@/services/auditService'
import type { IntelligenceArea, IntelligenceFinding, Confidence, EvidenceType, ClassificationCIA } from '@/types/domain'

const AREAS: IntelligenceArea[] = [
  'Macro & Economic',
  'Industry',
  'Technology & Disruption',
  'Customer & Demand',
  'Competitive Intelligence',
  'Business Intelligence',
  'Government / Local Environment',
  'Signals / Opportunities / Risks',
]

const CONFIDENCE_VARIANT: Record<Confidence, 'success' | 'warning' | 'outline'> = {
  high: 'success',
  medium: 'warning',
  low: 'outline',
}
const EVIDENCE_LABEL: Record<EvidenceType, string> = {
  fact: 'Fact',
  inference: 'Inference',
  hypothesis: 'Hypothesis',
}
const CLASSIFICATION_LABEL: Record<ClassificationCIA, string> = {
  control: 'Control',
  influence: 'Influence',
  adapt: 'Adapt',
}

interface AppliedBy {
  initiatives: { id: string; objective: string }[]
  dimensions: { id: string; name: string }[]
}

function FindingCard({ finding, appliedBy, clientId }: { finding: IntelligenceFinding; appliedBy: AppliedBy; clientId: string }) {
  const isApplied = appliedBy.initiatives.length > 0 || appliedBy.dimensions.length > 0
  return (
    <Card className="shadow-none">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-sm">{finding.title}</CardTitle>
          <Badge variant={CONFIDENCE_VARIANT[finding.confidence]}>{finding.confidence} confidence</Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 pt-0">
        <p className="text-xs text-muted-foreground">{finding.detail}</p>
        <div className="flex flex-wrap gap-1.5 pt-1">
          <Badge variant="outline">{EVIDENCE_LABEL[finding.evidenceType]}</Badge>
          <Badge variant="secondary">{CLASSIFICATION_LABEL[finding.classification]}</Badge>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2 text-[11px] text-muted-foreground">
          <span>Source: {finding.source}</span>
          <span>{finding.date}</span>
        </div>
        <div className="text-[11px] text-muted-foreground">Refresh due: {finding.refreshDate}</div>
        {isApplied ? (
          <div className="flex flex-col gap-1 border-t border-border pt-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Applied in</span>
            {appliedBy.initiatives.map(i => (
              <Link key={i.id} to={`/clients/${clientId}/strategy`} className="flex items-center gap-1 text-[11px] text-primary hover:underline">
                <Compass className="h-3 w-3 shrink-0" /> {i.objective}
              </Link>
            ))}
            {appliedBy.dimensions.map(d => (
              <Link key={d.id} to={`/clients/${clientId}/audit`} className="flex items-center gap-1 text-[11px] text-primary hover:underline">
                <ClipboardCheck className="h-3 w-3 shrink-0" /> {d.name} (Social Audit)
              </Link>
            ))}
          </div>
        ) : (
          <div className="border-t border-border pt-2 text-[11px] text-muted-foreground">Not yet applied in Strategy or Social Audit.</div>
        )}
      </CardContent>
    </Card>
  )
}

export default function IntelligencePage() {
  const { client } = useClient()
  const { open } = useAICompanion()
  useAICompanionContext(client ? `Strategic Intelligence • ${client.name}` : 'Strategic Intelligence')

  const [findings, setFindings] = useState<IntelligenceFinding[] | null>(null)
  const [appliedByFinding, setAppliedByFinding] = useState<Record<string, AppliedBy>>({})

  useEffect(() => {
    if (!client) return
    setFindings(null)
    Promise.all([intelligenceService.list(client.id), strategyService.list(client.id), auditService.list(client.id)]).then(
      ([intel, initiatives, dimensions]) => {
        const applied: Record<string, AppliedBy> = {}
        for (const f of intel) applied[f.id] = { initiatives: [], dimensions: [] }
        for (const i of initiatives) {
          for (const id of i.supportingIntelligenceIds) {
            applied[id]?.initiatives.push({ id: i.id, objective: i.objective })
          }
        }
        for (const d of dimensions) {
          for (const id of d.relatedIntelligenceIds) {
            applied[id]?.dimensions.push({ id: d.id, name: d.name })
          }
        }
        setAppliedByFinding(applied)
        setFindings(intel)
      }
    )
  }, [client])

  if (!client || findings === null) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="Strategic Intelligence" description="Macro to micro research feeding positioning and strategy." />
        <LoadingState rows={4} />
      </div>
    )
  }

  if (findings.length === 0) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="Strategic Intelligence" description="Macro to micro research feeding positioning and strategy." />
        <EmptyState
          icon={Radar}
          title="No intelligence gathered yet"
          description="Once a Strategic Intelligence pass runs for this client, findings will appear here grouped by area."
        />
      </div>
    )
  }

  const byArea = (area: IntelligenceArea) => findings.filter(f => f.area === area)
  const populatedAreas = AREAS.filter(a => byArea(a).length > 0)

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Strategic Intelligence"
        description="Macro to micro research — economy, industry, competitors, customers and signals feeding positioning and strategy."
        actions={
          <Button size="sm" className="gap-1.5" onClick={open}>
            <Sparkles className="h-3.5 w-3.5" /> Ask Intelligence
          </Button>
        }
      />

      <Tabs defaultValue={populatedAreas[0]}>
        <TabsList className="h-auto flex-wrap">
          {populatedAreas.map(area => (
            <TabsTrigger key={area} value={area}>
              {area} ({byArea(area).length})
            </TabsTrigger>
          ))}
        </TabsList>
        {populatedAreas.map(area => (
          <TabsContent key={area} value={area} className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {byArea(area).map(f => (
              <FindingCard
                key={f.id}
                finding={f}
                appliedBy={appliedByFinding[f.id] ?? { initiatives: [], dimensions: [] }}
                clientId={client.id}
              />
            ))}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
