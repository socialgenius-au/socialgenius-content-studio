import { useEffect, useState } from 'react'
import { Sparkles, Radar } from 'lucide-react'
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

function FindingCard({ finding }: { finding: IntelligenceFinding }) {
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
      </CardContent>
    </Card>
  )
}

export default function IntelligencePage() {
  const { client } = useClient()
  const { open } = useAICompanion()
  useAICompanionContext(client ? `Strategic Intelligence • ${client.name}` : 'Strategic Intelligence')

  const [findings, setFindings] = useState<IntelligenceFinding[] | null>(null)

  useEffect(() => {
    if (!client) return
    setFindings(null)
    intelligenceService.list(client.id).then(setFindings)
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
              <FindingCard key={f.id} finding={f} />
            ))}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
