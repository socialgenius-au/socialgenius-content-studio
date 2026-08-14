import { useEffect, useState } from 'react'
import { ArrowRight, ShieldCheck } from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { LoadingState } from '@/components/common/LoadingState'
import { StatusBadge } from '@/components/common/StatusBadge'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { useClient } from '@/contexts/ClientContext'
import { useAICompanionContext } from '@/contexts/AICompanionContext'
import { positioningService } from '@/services/positioningService'
import type { PositioningProfile, PositioningFramework, CapabilityMapItem, ExperienceStage } from '@/types/domain'

const GAP_VARIANT: Record<ExperienceStage['gap'], 'success' | 'warning' | 'destructive'> = {
  none: 'success',
  minor: 'warning',
  major: 'destructive',
}
const GAP_LABEL: Record<ExperienceStage['gap'], string> = {
  none: 'No gap',
  minor: 'Minor gap',
  major: 'Major gap',
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-foreground">{label}</span>
        <span className="tabular-nums text-muted-foreground">{value}/100</span>
      </div>
      <Progress value={value} />
    </div>
  )
}

function LabeledList({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-foreground">{label}</span>
      <ul className="mt-1 flex flex-col gap-1">
        {items.map(i => (
          <li key={i}>• {i}</li>
        ))}
      </ul>
    </div>
  )
}

export default function PositioningPage() {
  const { client } = useClient()
  useAICompanionContext(client ? `Positioning • ${client.name}` : 'Positioning')

  const [profile, setProfile] = useState<PositioningProfile | null | undefined>(undefined)
  const [frameworks, setFrameworks] = useState<PositioningFramework[]>([])
  const [capabilityMap, setCapabilityMap] = useState<CapabilityMapItem[]>([])
  const [experienceMap, setExperienceMap] = useState<ExperienceStage[]>([])
  const [frameworkChoice, setFrameworkChoice] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (!client) return
    setProfile(undefined)
    Promise.all([
      positioningService.get(client.id),
      positioningService.listFrameworks(),
      positioningService.capabilityMap(client.id),
      positioningService.experienceMap(client.id),
    ]).then(([p, fw, cm, em]) => {
      setProfile(p ?? null)
      setFrameworks(fw)
      setCapabilityMap(cm)
      setExperienceMap(em)
      setFrameworkChoice(p?.frameworkId)
    })
  }, [client])

  if (!client || profile === undefined) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="Positioning" description="The claim the market should believe, and what backs it up." />
        <LoadingState rows={5} />
      </div>
    )
  }

  if (!profile) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="Positioning" description="The claim the market should believe, and what backs it up." />
        <EmptyState
          icon={ShieldCheck}
          title="Positioning not started"
          description="This client doesn't have a positioning profile yet. Positioning normally follows a Strategic Intelligence pass and Social Audit."
          actionLabel="Start Positioning"
          onAction={() => {}}
        />
      </div>
    )
  }

  const currentFramework = frameworks.find(f => f.id === frameworkChoice)

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Positioning"
        description="The claim the market should believe about this business, and what backs it up."
        actions={<StatusBadge status={profile.approvalStatus} />}
      />

      <Tabs defaultValue="overview">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="validation">Validation</TabsTrigger>
          <TabsTrigger value="proof">Proof & Claims</TabsTrigger>
          <TabsTrigger value="capability">Capability Map</TabsTrigger>
          <TabsTrigger value="experience">Experience Map</TabsTrigger>
          <TabsTrigger value="approval">Approval</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="flex flex-col gap-4">
          <Card>
            <CardContent className="flex flex-col gap-4 p-5">
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Framework</span>
                <Select value={frameworkChoice} onValueChange={setFrameworkChoice}>
                  <SelectTrigger className="w-72">
                    <SelectValue placeholder="Select a positioning framework" />
                  </SelectTrigger>
                  <SelectContent>
                    {frameworks.map(fw => (
                      <SelectItem key={fw.id} value={fw.id}>
                        {fw.name} · v{fw.version} ({fw.status})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {currentFramework && <span className="text-xs text-muted-foreground">{currentFramework.changeSummary}</span>}
              </div>

              <div className="grid grid-cols-1 items-center gap-3 md:grid-cols-[1fr_auto_1fr]">
                <div className="rounded-lg border border-border bg-muted/40 p-3">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Current position</span>
                  <p className="mt-1 text-sm text-foreground">{profile.currentPosition}</p>
                </div>
                <ArrowRight className="mx-auto hidden h-5 w-5 text-muted-foreground md:block" />
                <div className="rounded-lg border border-sg-lime/40 bg-sg-lime/10 p-3">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Target position</span>
                  <p className="mt-1 text-sm font-medium text-foreground">{profile.targetPosition}</p>
                </div>
              </div>

              <blockquote className="rounded-lg border-l-4 border-sg-forest bg-muted/30 px-4 py-3 text-sm italic text-foreground">
                &ldquo;{profile.positioningStatement}&rdquo;
              </blockquote>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Desired perception</span>
                  <p className="mt-1 text-sm text-foreground">{profile.desiredPerception}</p>
                </div>
                <div>
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Target customer</span>
                  <p className="mt-1 text-sm text-foreground">{profile.targetCustomer}</p>
                </div>
              </div>

              <div>
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Messaging pillars</span>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {profile.messagingPillars.map(p => (
                    <Badge key={p} variant="accent">
                      {p}
                    </Badge>
                  ))}
                </div>
              </div>

              <Separator />

              <div className="grid grid-cols-1 gap-4 text-xs md:grid-cols-2">
                <div>
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Category expectations</span>
                  <ul className="mt-1.5 flex flex-col gap-1 text-muted-foreground">
                    {profile.categoryExpectations.map(c => (
                      <li key={c}>• {c}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Competitor positions</span>
                  <ul className="mt-1.5 flex flex-col gap-1">
                    {profile.competitorPositions.map(c => (
                      <li key={c.name}>
                        <span className="font-medium text-foreground">{c.name}:</span>{' '}
                        <span className="text-muted-foreground">{c.position}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="validation" className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Positioning validation (DDDS)</CardTitle>
              <CardDescription>AI assessment — a decision-support indicator, not an objective score.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <ScoreBar label="Desirability — does the customer value this?" value={profile.scores.desirability} />
              <ScoreBar label="Differentiation — does it create meaningful distinction?" value={profile.scores.differentiation} />
              <ScoreBar label="Deliverability — can the business actually provide it?" value={profile.scores.deliverability} />
              <ScoreBar label="Sustainability — can it keep delivering this economically?" value={profile.scores.sustainability} />
              <p className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">{profile.scores.note}</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="proof" className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Promise</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              <p className="text-foreground">{profile.promise}</p>
              <LabeledList label="Reasons to believe" items={profile.reasonsToBelieve} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Differentiators & Proof Points</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-xs text-muted-foreground">
              <LabeledList label="Differentiators" items={profile.differentiators} />
              <LabeledList label="Proof points" items={profile.proofPoints} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Capabilities & Constraints</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-xs text-muted-foreground">
              <LabeledList label="Capabilities" items={profile.capabilities} />
              <LabeledList label="Constraints" items={profile.constraints} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Claims</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div>
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Approved claims</span>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {profile.approvedClaims.map(c => (
                    <Badge key={c} variant="success">
                      {c}
                    </Badge>
                  ))}
                </div>
              </div>
              <div>
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Not yet deliverable</span>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {profile.claimsNotYetDeliverable.map(c => (
                    <Badge key={c} variant="warning">
                      {c}
                    </Badge>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="capability" className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {capabilityMap.length === 0 ? (
            <EmptyState title="No capability map yet" className="md:col-span-2" />
          ) : (
            capabilityMap.map(item => (
              <Card key={item.id} className="shadow-none">
                <CardContent className="flex flex-col gap-1.5 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-foreground">{item.area}</span>
                    <StatusBadge status={item.status} />
                  </div>
                  <p className="text-xs text-muted-foreground">{item.note}</p>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="experience" className="flex flex-col gap-3">
          {experienceMap.length === 0 ? (
            <EmptyState title="No experience map yet" />
          ) : (
            experienceMap.map(stage => (
              <Card key={stage.stage} className="shadow-none">
                <CardContent className="flex flex-col gap-2 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-foreground">{stage.stage}</span>
                    <Badge variant={GAP_VARIANT[stage.gap]}>{GAP_LABEL[stage.gap]}</Badge>
                  </div>
                  <div className="grid grid-cols-1 gap-2 text-xs md:grid-cols-2">
                    <div>
                      <span className="font-medium text-foreground">Promised: </span>
                      <span className="text-muted-foreground">{stage.promisedExperience}</span>
                    </div>
                    <div>
                      <span className="font-medium text-foreground">Reality: </span>
                      <span className="text-muted-foreground">{stage.currentReality}</span>
                    </div>
                    <div>
                      <span className="font-medium text-foreground">Evidence: </span>
                      <span className="text-muted-foreground">{stage.evidence}</span>
                    </div>
                    <div>
                      <span className="font-medium text-foreground">Action: </span>
                      <span className="text-muted-foreground">{stage.requiredAction}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="approval" className="flex flex-col gap-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle>Approval status</CardTitle>
                <CardDescription>What Social Genius will communicate, and what the business commits to delivering.</CardDescription>
              </div>
              <StatusBadge status={profile.approvalStatus} />
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-2">
                <Button size="sm">Approve</Button>
                <Button size="sm" variant="outline">
                  Approve with Conditions
                </Button>
                <Button size="sm" variant="outline">
                  Request Changes
                </Button>
              </div>
              <Separator />
              <div className="flex flex-col gap-3">
                {profile.approvalHistory.map((h, i) => (
                  <div key={i} className="flex gap-3 text-xs">
                    <span className="w-24 shrink-0 text-muted-foreground">{h.date}</span>
                    <div>
                      <p className="text-foreground">
                        <span className="font-medium">{h.actor}</span> — {h.action}
                      </p>
                      {h.note && <p className="mt-0.5 text-muted-foreground">{h.note}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
