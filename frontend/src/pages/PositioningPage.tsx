import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, ShieldCheck, GitCompareArrows, Clock } from 'lucide-react'
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
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose,
} from '@/components/ui/dialog'
import { useClient } from '@/contexts/ClientContext'
import { useAICompanionContext } from '@/contexts/AICompanionContext'
import { positioningService } from '@/services/positioningService'
import type {
  PositioningProfile, PositioningFramework, CapabilityMapItem, ExperienceStage, FrameworkComparison,
} from '@/types/domain'

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

const today = () => new Date().toISOString().slice(0, 10)

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

function DeltaRow({ label, value }: { label: string; value: number }) {
  const sign = value > 0 ? '+' : ''
  const tone = value > 2 ? 'text-success' : value < -2 ? 'text-destructive' : 'text-muted-foreground'
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-foreground">{label}</span>
      <span className={`font-semibold tabular-nums ${tone}`}>{sign}{value}</span>
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

type ApprovalAction = 'approved' | 'approved_with_conditions' | 'changes_requested'
const APPROVAL_ACTION_LABEL: Record<ApprovalAction, string> = {
  approved: 'Approved',
  approved_with_conditions: 'Approved with conditions',
  changes_requested: 'Changes requested',
}

export default function PositioningPage() {
  const { client } = useClient()
  useAICompanionContext(client ? `Positioning • ${client.name}` : 'Positioning')

  const [profile, setProfile] = useState<PositioningProfile | null | undefined>(undefined)
  const [frameworks, setFrameworks] = useState<PositioningFramework[]>([])
  const [capabilityMap, setCapabilityMap] = useState<CapabilityMapItem[]>([])
  const [experienceMap, setExperienceMap] = useState<ExperienceStage[]>([])

  const [compareOpen, setCompareOpen] = useState(false)
  const [compareTargetId, setCompareTargetId] = useState<string | undefined>(undefined)
  const [comparison, setComparison] = useState<FrameworkComparison | null | undefined>(undefined)
  const [switchReason, setSwitchReason] = useState('')

  const [approvalDialog, setApprovalDialog] = useState<ApprovalAction | null>(null)
  const [approvalNote, setApprovalNote] = useState('')

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
    })
  }, [client])

  const currentFramework = useMemo(
    () => frameworks.find(f => f.id === profile?.frameworkId),
    [frameworks, profile?.frameworkId]
  )
  const otherFrameworks = useMemo(
    () => frameworks.filter(f => f.id !== profile?.frameworkId),
    [frameworks, profile?.frameworkId]
  )

  const runComparison = (frameworkBId: string) => {
    if (!client) return
    setCompareTargetId(frameworkBId)
    setComparison(undefined)
    positioningService.compareFrameworks(client.id, frameworkBId).then(c => setComparison(c ?? null))
  }

  const openCompareDialog = () => {
    setSwitchReason('')
    setComparison(undefined)
    setCompareTargetId(undefined)
    setCompareOpen(true)
  }

  const confirmSwitch = () => {
    if (!profile || !comparison || !switchReason.trim()) return
    const from = currentFramework?.name ?? profile.frameworkId
    setProfile({
      ...profile,
      frameworkId: comparison.frameworkB.id,
      frameworkChangeLog: [
        { date: today(), from, to: comparison.frameworkB.name, reason: switchReason.trim() },
        ...profile.frameworkChangeLog,
      ],
    })
    setCompareOpen(false)
  }

  const applyApprovalAction = (action: ApprovalAction, note: string) => {
    if (!profile) return
    setProfile({
      ...profile,
      approvalStatus: action,
      approvalHistory: [
        { date: today(), actor: 'You (Staff)', action: APPROVAL_ACTION_LABEL[action], ...(note.trim() ? { note: note.trim() } : {}) },
        ...profile.approvalHistory,
      ],
    })
    setApprovalDialog(null)
    setApprovalNote('')
  }

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
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Framework in use</span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">{currentFramework?.name ?? profile.frameworkId}</span>
                    {currentFramework && <Badge variant="outline">v{currentFramework.version}</Badge>}
                    {currentFramework && <Badge variant={currentFramework.status === 'active' ? 'success' : 'secondary'}>{currentFramework.status}</Badge>}
                  </div>
                  {currentFramework && <span className="text-xs text-muted-foreground">{currentFramework.changeSummary}</span>}
                </div>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={openCompareDialog} disabled={otherFrameworks.length === 0}>
                  <GitCompareArrows className="h-3.5 w-3.5" />
                  Compare / switch framework
                </Button>
              </div>

              {profile.frameworkChangeLog.length > 0 && (
                <div className="flex flex-col gap-1 rounded-md bg-muted/40 px-3 py-2">
                  {profile.frameworkChangeLog.slice(0, 2).map((h, i) => (
                    <div key={i} className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                      <Clock className="mt-0.5 h-3 w-3 shrink-0" />
                      <span><span className="font-medium text-foreground">{h.date}</span> — switched {h.from} → {h.to}: {h.reason}</span>
                    </div>
                  ))}
                </div>
              )}

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
                <Button size="sm" onClick={() => applyApprovalAction('approved', '')}>
                  Approve
                </Button>
                <Button size="sm" variant="outline" onClick={() => setApprovalDialog('approved_with_conditions')}>
                  Approve with Conditions
                </Button>
                <Button size="sm" variant="outline" onClick={() => setApprovalDialog('changes_requested')}>
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

      {/* Approve with conditions / Request changes — requires a note */}
      <Dialog open={approvalDialog !== null} onOpenChange={o => !o && setApprovalDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{approvalDialog && APPROVAL_ACTION_LABEL[approvalDialog]}</DialogTitle>
            <DialogDescription>
              {approvalDialog === 'approved_with_conditions'
                ? 'What conditions apply before this is fully approved?'
                : 'What needs to change before this can be approved?'}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="approval-note">Note (required)</Label>
            <Textarea id="approval-note" value={approvalNote} onChange={e => setApprovalNote(e.target.value)} rows={4} autoFocus />
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" size="sm">Cancel</Button>
            </DialogClose>
            <Button
              size="sm"
              disabled={!approvalNote.trim()}
              onClick={() => approvalDialog && applyApprovalAction(approvalDialog, approvalNote)}
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Compare / switch framework */}
      <Dialog open={compareOpen} onOpenChange={setCompareOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Compare positioning frameworks</DialogTitle>
            <DialogDescription>
              Currently using <span className="font-medium text-foreground">{currentFramework?.name}</span>. Switching never happens silently — a reason is logged.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <Label>Compare against</Label>
            <Select value={compareTargetId} onValueChange={runComparison}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a framework to compare" />
              </SelectTrigger>
              <SelectContent>
                {otherFrameworks.map(fw => (
                  <SelectItem key={fw.id} value={fw.id}>
                    {fw.name} · v{fw.version} ({fw.status})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {compareTargetId && comparison === undefined && <LoadingState rows={2} />}

          {comparison && (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-md bg-muted/40 p-3">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Agreements</span>
                  <ul className="mt-1 flex flex-col gap-1 text-xs text-foreground">
                    {comparison.agreements.map((a, i) => <li key={i}>• {a}</li>)}
                  </ul>
                </div>
                <div className="rounded-md bg-muted/40 p-3">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Disagreements</span>
                  <ul className="mt-1 flex flex-col gap-1 text-xs text-foreground">
                    {comparison.disagreements.map((a, i) => <li key={i}>• {a}</li>)}
                  </ul>
                </div>
              </div>

              <div className="rounded-md border border-border p-3">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Score delta ({comparison.frameworkB.name} vs. current)
                </span>
                <div className="mt-2 flex flex-col gap-1.5">
                  <DeltaRow label="Desirability" value={comparison.scoreDeltas.desirability} />
                  <DeltaRow label="Differentiation" value={comparison.scoreDeltas.differentiation} />
                  <DeltaRow label="Deliverability" value={comparison.scoreDeltas.deliverability} />
                  <DeltaRow label="Sustainability" value={comparison.scoreDeltas.sustainability} />
                </div>
              </div>

              <p className="rounded-md bg-sg-lime/10 px-3 py-2 text-xs text-foreground">{comparison.recommendation}</p>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="switch-reason">Reason to switch (required to confirm)</Label>
                <Textarea
                  id="switch-reason"
                  value={switchReason}
                  onChange={e => setSwitchReason(e.target.value)}
                  placeholder="Why switch frameworks now, for the record…"
                  rows={2}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" size="sm">Keep current framework</Button>
            </DialogClose>
            <Button size="sm" disabled={!comparison || !switchReason.trim()} onClick={confirmSwitch}>
              Switch to {comparison?.frameworkB.name ?? 'selected framework'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
