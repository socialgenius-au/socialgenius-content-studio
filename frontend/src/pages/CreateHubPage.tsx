import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Sparkles, Eye, Radio, ShieldCheck, GraduationCap, Diff, MessageSquare, CalendarCheck,
  DollarSign, Tag, HeartHandshake, Star, Share2, ChevronRight, ChevronLeft, Check, Plus, Wand2, PenLine, Lock,
} from 'lucide-react'
import { useClient } from '@/contexts/ClientContext'
import { useAICompanionContext } from '@/contexts/AICompanionContext'
import { useEntitlements } from '@/contexts/EntitlementContext'
import { contentService } from '@/services/contentService'
import { campaignService } from '@/services/campaignService'
import type { Campaign, CreativeOption, CreativeOutcome, PositioningGateCheck } from '@/types/domain'
import type { StructureOption, CtaOption } from '@/mocks/creative'
import { PageHeader } from '@/components/common/PageHeader'
import { LoadingState } from '@/components/common/LoadingState'
import { StatusBadge } from '@/components/common/StatusBadge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

const OUTCOMES: { id: CreativeOutcome; icon: typeof Eye }[] = [
  { id: 'Attention', icon: Eye },
  { id: 'Reach', icon: Radio },
  { id: 'Trust', icon: ShieldCheck },
  { id: 'Authority', icon: GraduationCap },
  { id: 'Education', icon: GraduationCap },
  { id: 'Differentiation', icon: Diff },
  { id: 'Enquiry', icon: MessageSquare },
  { id: 'Booking', icon: CalendarCheck },
  { id: 'Sale', icon: DollarSign },
  { id: 'Offer promotion', icon: Tag },
  { id: 'Belief change', icon: HeartHandshake },
  { id: 'Reputation', icon: Star },
  { id: 'Referral', icon: Share2 },
]

const STEPS = ['Outcome', 'Angle', 'Structure', 'CTA', 'Positioning Gate', 'Done'] as const

// entitlementKey ties a content type to the client's Service Configurator
// plan (spec §21 content types x §55 capability checks) — types without a
// mapped key are always available since not every content type is a billed
// entitlement (e.g. long-form video ships with every plan).
const CONTENT_TYPES: { id: string; label: string; entitlementKey?: string }[] = [
  { id: 'reel', label: 'Reel / Short', entitlementKey: 'content.reels' },
  { id: 'video', label: 'Long-form video' },
  { id: 'post', label: 'Social post', entitlementKey: 'content.posts' },
  { id: 'carousel', label: 'Carousel', entitlementKey: 'content.carousels' },
  { id: 'blog', label: 'Blog', entitlementKey: 'content.blog' },
  { id: 'pr', label: 'Press release', entitlementKey: 'content.press_release' },
  { id: 'email', label: 'Email / Newsletter' },
  { id: 'whatsapp', label: 'WhatsApp', entitlementKey: 'leads.whatsapp' },
  { id: 'gbp', label: 'Google Business Profile' },
  { id: 'landing_page', label: 'Landing page copy' },
  { id: 'ad', label: 'Ad copy' },
]

const emptyCustomAngle = (): CreativeOption => ({
  id: `custom-${crypto.randomUUID()}`,
  label: 'Custom angle',
  pitch: '',
  attentionScore: 0,
  positioningScore: 0,
  outcomeScore: 0,
  why: 'User-written — no AI assessment available.',
  perceptionCreated: '—',
  proofRequired: '—',
  risk: '—',
  isCustom: true,
})

export default function CreateHubPage() {
  const { client } = useClient()
  const navigate = useNavigate()
  const { can } = useEntitlements()
  useAICompanionContext(`Create Hub${client ? ` • ${client.name}` : ''}`)

  const [step, setStep] = useState(0)
  const [outcome, setOutcome] = useState<CreativeOutcome>('Enquiry')
  const [contentType, setContentType] = useState('reel')

  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [campaignId, setCampaignId] = useState<string | undefined>(undefined)

  const [angles, setAngles] = useState<CreativeOption[] | null>(null)
  const [angleId, setAngleId] = useState<string | null>(null)
  const [loadingMoreAngles, setLoadingMoreAngles] = useState(false)
  const [angleDialog, setAngleDialog] = useState<{ mode: 'write' | 'modify'; targetId?: string } | null>(null)
  const [dialogLabel, setDialogLabel] = useState('')
  const [dialogPitch, setDialogPitch] = useState('')

  const [structures, setStructures] = useState<StructureOption[] | null>(null)
  const [structureId, setStructureId] = useState<string | null>(null)
  const [customStructureOpen, setCustomStructureOpen] = useState(false)

  const [ctas, setCtas] = useState<CtaOption[] | null>(null)
  const [ctaId, setCtaId] = useState<string | null>(null)
  const [customCtaOpen, setCustomCtaOpen] = useState(false)

  const [gate, setGate] = useState<PositioningGateCheck | null>(null)
  const [gateLoading, setGateLoading] = useState(false)
  const [exceptionApproved, setExceptionApproved] = useState(false)

  useEffect(() => {
    if (!client) return
    campaignService.list(client.id).then(list => {
      setCampaigns(list)
      setCampaignId(prev => prev ?? client.activeCampaignId ?? list[0]?.id)
    })
  }, [client])

  useEffect(() => {
    if (step === 1 && angles === null) contentService.getAngleOptions().then(setAngles)
    if (step === 2 && structures === null) contentService.getStructureOptions().then(setStructures)
    if (step === 3 && ctas === null) contentService.getCtaOptions().then(setCtas)
  }, [step, angles, structures, ctas])

  const selectedAngle = angles?.find(a => a.id === angleId) ?? null
  const selectedStructure = structures?.find(s => s.id === structureId) ?? null
  const selectedCta = ctas?.find(c => c.id === ctaId) ?? null
  const selectedCampaign = useMemo(() => campaigns.find(c => c.id === campaignId) ?? null, [campaigns, campaignId])

  // Re-run the gate whenever the entering angle changes (including edits to a
  // custom/modified pitch), not just once — a "Write my own" or "Modify"
  // pass should get freshly evaluated, not reuse a stale green/amber result.
  useEffect(() => {
    if (step !== 4 || !angleId) return
    setGateLoading(true)
    setGate(null)
    setExceptionApproved(false)
    contentService.checkPositioningGate(angleId, selectedAngle?.pitch).then(g => {
      setGate(g)
      setGateLoading(false)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, angleId])

  const askAiForMoreAngles = () => {
    if (!angles) return
    setLoadingMoreAngles(true)
    contentService.getMoreAngleOptions(angles.map(a => a.id)).then(more => {
      setAngles(prev => [...(prev ?? []), ...more])
      setLoadingMoreAngles(false)
    })
  }

  const openWriteOwnAngle = () => {
    setDialogLabel('My own angle')
    setDialogPitch('')
    setAngleDialog({ mode: 'write' })
  }
  const openModifyAngle = (a: CreativeOption) => {
    setDialogLabel(a.label)
    setDialogPitch(a.pitch)
    setAngleDialog({ mode: 'modify', targetId: a.id })
  }
  const confirmAngleDialog = () => {
    if (!angleDialog || !dialogPitch.trim()) return
    if (angleDialog.mode === 'write') {
      const newAngle: CreativeOption = { ...emptyCustomAngle(), label: dialogLabel.trim() || 'Custom angle', pitch: dialogPitch.trim() }
      setAngles(prev => [...(prev ?? []), newAngle])
      setAngleId(newAngle.id)
    } else if (angleDialog.targetId) {
      setAngles(prev => prev && prev.map(a => (a.id === angleDialog.targetId ? { ...a, label: dialogLabel.trim() || a.label, pitch: dialogPitch.trim(), isCustom: true } : a)))
    }
    setAngleDialog(null)
  }

  const addCustomStructure = (label: string, description: string) => {
    const opt: StructureOption = { id: `custom-struct-${crypto.randomUUID()}`, label: label || 'Custom structure', description: description || 'Written by staff.' }
    setStructures(prev => [...(prev ?? []), opt])
    setStructureId(opt.id)
    setCustomStructureOpen(false)
  }
  const addCustomCta = (label: string, description: string) => {
    const opt: CtaOption = { id: `custom-cta-${crypto.randomUUID()}`, label: label || 'Custom CTA', description: description || 'Written by staff.' }
    setCtas(prev => [...(prev ?? []), opt])
    setCtaId(opt.id)
    setCustomCtaOpen(false)
  }

  const canAdvance =
    (step === 0 && !!outcome) ||
    (step === 1 && !!angleId) ||
    (step === 2 && !!structureId) ||
    (step === 3 && !!ctaId) ||
    (step === 4 && !!gate && (gate.result === 'green' || exceptionApproved)) ||
    step === 5

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Create Hub"
        description="Every creative workflow starts with what outcome you want — AI proposes alternatives, you decide."
      />

      <div className="flex items-center gap-1.5 overflow-x-auto rounded-lg border border-border bg-card p-2">
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center gap-1.5">
            <button
              onClick={() => i < step && setStep(i)}
              disabled={i > step}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors',
                i === step ? 'bg-primary text-primary-foreground' : i < step ? 'text-foreground hover:bg-muted' : 'text-muted-foreground'
              )}
            >
              <span className={cn('flex h-4 w-4 items-center justify-center rounded-full text-[10px]', i <= step ? 'bg-background/20' : 'bg-muted')}>
                {i < step ? <Check className="h-2.5 w-2.5" /> : i + 1}
              </span>
              {label}
            </button>
            {i < STEPS.length - 1 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
          </div>
        ))}
      </div>

      {/* Step 0 — Outcome */}
      {step === 0 && (
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>What outcome do you want?</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {OUTCOMES.map(o => (
                  <button
                    key={o.id}
                    onClick={() => setOutcome(o.id)}
                    className={cn(
                      'flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm font-medium transition-colors',
                      outcome === o.id ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-muted'
                    )}
                  >
                    <o.icon className="h-4 w-4 shrink-0" />
                    {o.id}
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>What are you creating?</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {CONTENT_TYPES.map(t => {
                  const allowed = t.entitlementKey ? can(t.entitlementKey) : true
                  return (
                    <button
                      key={t.id}
                      onClick={() => allowed && setContentType(t.id)}
                      disabled={!allowed}
                      title={allowed ? undefined : "Not included in this client's plan — enable it in Service Configurator"}
                      className={cn(
                        'flex items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-left text-sm font-medium transition-colors',
                        !allowed
                          ? 'cursor-not-allowed border-border text-muted-foreground/50'
                          : contentType === t.id
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border hover:bg-muted'
                      )}
                    >
                      {t.label}
                      {!allowed && <Lock className="h-3 w-3 shrink-0" />}
                    </button>
                  )
                })}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Which campaign is this for?</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <Select value={campaignId} onValueChange={setCampaignId}>
                <SelectTrigger className="w-full max-w-sm">
                  <SelectValue placeholder="No campaign — standalone content" />
                </SelectTrigger>
                <SelectContent>
                  {campaigns.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedCampaign && (
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Audience: </span>{selectedCampaign.audience}
                  <span className="mx-1.5">·</span>
                  <span className="font-medium text-foreground">Message: </span>{selectedCampaign.coreMessage}
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Step 1 — Angle */}
      {step === 1 && (
        angles === null ? <LoadingState rows={3} /> : (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              {angles.map(a => (
                <Card key={a.id} className={cn('flex flex-col', angleId === a.id && 'border-primary ring-1 ring-primary')}>
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle>{a.label}</CardTitle>
                      {a.isCustom && <Badge variant="secondary">Custom</Badge>}
                    </div>
                    <p className="pt-1 text-sm font-medium italic text-foreground">{a.pitch || 'Not written yet.'}</p>
                  </CardHeader>
                  <CardContent className="flex flex-1 flex-col gap-3">
                    {a.isCustom ? (
                      <p className="text-[11px] text-muted-foreground">{a.why}</p>
                    ) : (
                      <>
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">AI assessment — estimated, not guaranteed</p>
                        <ScoreRow label="Attention" value={a.attentionScore} />
                        <ScoreRow label="Positioning Alignment" value={a.positioningScore} />
                        <ScoreRow label="Business Outcome" value={a.outcomeScore} />
                        <div className="flex flex-col gap-1.5 border-t border-border pt-2 text-xs text-muted-foreground">
                          <p><span className="font-semibold text-foreground">Why: </span>{a.why}</p>
                          <p><span className="font-semibold text-foreground">Perception created: </span>{a.perceptionCreated}</p>
                          <p><span className="font-semibold text-foreground">Proof required: </span>{a.proofRequired}</p>
                          <p><span className="font-semibold text-foreground">Risk: </span>{a.risk}</p>
                        </div>
                      </>
                    )}

                    <div className="mt-auto flex flex-wrap gap-1.5 pt-2">
                      <Button size="sm" onClick={() => setAngleId(a.id)} disabled={!a.pitch}>
                        {angleId === a.id ? <><Check className="h-3.5 w-3.5" /> Chosen</> : 'Choose'}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => openModifyAngle(a)}>
                        <PenLine className="h-3.5 w-3.5" /> Modify
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" className="gap-1.5" onClick={askAiForMoreAngles} disabled={loadingMoreAngles}>
                <Wand2 className="h-3.5 w-3.5" /> {loadingMoreAngles ? 'Thinking…' : 'Ask AI for more'}
              </Button>
              <Button size="sm" variant="ghost" className="gap-1.5" onClick={openWriteOwnAngle}>
                <Plus className="h-3.5 w-3.5" /> Write my own
              </Button>
            </div>
          </div>
        )
      )}

      {/* Step 2 — Structure */}
      {step === 2 && (
        structures === null ? <LoadingState rows={3} /> : (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              {structures.map(s => (
                <button key={s.id} onClick={() => setStructureId(s.id)} className="text-left">
                  <Card className={cn('h-full transition-colors', structureId === s.id ? 'border-primary ring-1 ring-primary' : 'hover:border-primary/40')}>
                    <CardHeader>
                      <CardTitle className="flex items-center justify-between gap-2">
                        {s.label}
                        {structureId === s.id && <Check className="h-4 w-4 text-primary" />}
                      </CardTitle>
                    </CardHeader>
                    <CardContent><p className="text-xs text-muted-foreground">{s.description}</p></CardContent>
                  </Card>
                </button>
              ))}
              <CustomOptionCard open={customStructureOpen} onOpen={() => setCustomStructureOpen(true)} onCancel={() => setCustomStructureOpen(false)} onSave={addCustomStructure} noun="structure" />
            </div>
          </div>
        )
      )}

      {/* Step 3 — CTA */}
      {step === 3 && (
        ctas === null ? <LoadingState rows={3} /> : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {ctas.map(c => (
              <button key={c.id} onClick={() => setCtaId(c.id)} className="text-left">
                <Card className={cn('h-full transition-colors', ctaId === c.id ? 'border-primary ring-1 ring-primary' : 'hover:border-primary/40')}>
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between gap-2">
                      {c.label}
                      {ctaId === c.id && <Check className="h-4 w-4 text-primary" />}
                    </CardTitle>
                  </CardHeader>
                  <CardContent><p className="text-xs text-muted-foreground">{c.description}</p></CardContent>
                </Card>
              </button>
            ))}
            <CustomOptionCard open={customCtaOpen} onOpen={() => setCustomCtaOpen(true)} onCancel={() => setCustomCtaOpen(false)} onSave={addCustomCta} noun="CTA" />
          </div>
        )
      )}

      {/* Step 4 — Positioning Impact Gate */}
      {step === 4 && (
        <Card>
          <CardHeader>
            <CardTitle>What will this communication make the market believe about this business?</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {gateLoading || !gate ? (
              <LoadingState rows={2} />
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <StatusBadge status={gate.result} />
                  <p className="text-sm text-foreground">{gate.reason}</p>
                </div>
                {gate.result !== 'green' && (
                  <div className={cn('flex flex-col gap-2 rounded-lg border p-3', gate.result === 'red' ? 'border-destructive/30 bg-destructive/5' : 'border-warning/30 bg-warning/5')}>
                    <p className="text-xs font-semibold text-foreground">Correction options</p>
                    <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
                      {gate.corrections.map(c => <li key={c}>• {c}</li>)}
                    </ul>
                    <Button
                      size="sm"
                      variant={exceptionApproved ? 'secondary' : 'outline'}
                      className="mt-1 w-fit"
                      onClick={() => setExceptionApproved(true)}
                    >
                      {exceptionApproved ? <><Check className="h-3.5 w-3.5" /> Tactical exception approved</> : 'Tactical exception — approve anyway'}
                    </Button>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Step 5 — Done */}
      {step === 5 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-sg-lime" /> Ready for production</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Field label="Outcome" value={outcome} />
            <Field label="Content type" value={CONTENT_TYPES.find(t => t.id === contentType)?.label ?? contentType} />
            <Field label="Campaign" value={selectedCampaign?.name ?? 'Standalone — no campaign selected'} />
            <Field label="Angle" value={selectedAngle ? `${selectedAngle.label} — ${selectedAngle.pitch}` : '—'} />
            <Field label="Structure" value={selectedStructure?.label ?? '—'} />
            <Field label="CTA" value={selectedCta?.label ?? '—'} />
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Positioning gate</span>
              {gate && <StatusBadge status={gate.result} />}
              {exceptionApproved && <Badge variant="warning">Tactical exception</Badge>}
            </div>
            <Button className="mt-2 w-fit gap-1.5" onClick={() => client && navigate(`/clients/${client.id}/studio`)}>
              Send to Video Studio <ChevronRight className="h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-between">
        <Button variant="outline" size="sm" className="gap-1" disabled={step === 0} onClick={() => setStep(s => Math.max(0, s - 1))}>
          <ChevronLeft className="h-3.5 w-3.5" /> Back
        </Button>
        {step < STEPS.length - 1 && (
          <Button size="sm" className="gap-1" disabled={!canAdvance} onClick={() => setStep(s => Math.min(STEPS.length - 1, s + 1))}>
            Next <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      <Dialog open={angleDialog !== null} onOpenChange={o => !o && setAngleDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{angleDialog?.mode === 'write' ? 'Write your own angle' : 'Modify angle'}</DialogTitle>
            <DialogDescription>{angleDialog?.mode === 'write' ? 'This skips AI scoring — it still goes through the Positioning Gate.' : 'Editing marks this as a custom angle; AI scores no longer apply.'}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="angle-label">Label</Label>
              <Input id="angle-label" value={dialogLabel} onChange={e => setDialogLabel(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="angle-pitch">Pitch / hook</Label>
              <Textarea id="angle-pitch" value={dialogPitch} onChange={e => setDialogPitch(e.target.value)} rows={3} autoFocus placeholder="The cheapest SUV could cost you the most…" />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline" size="sm">Cancel</Button></DialogClose>
            <Button size="sm" disabled={!dialogPitch.trim()} onClick={confirmAngleDialog}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function CustomOptionCard({
  open, onOpen, onCancel, onSave, noun,
}: {
  open: boolean
  onOpen: () => void
  onCancel: () => void
  onSave: (label: string, description: string) => void
  noun: string
}) {
  const [label, setLabel] = useState('')
  const [description, setDescription] = useState('')

  if (!open) {
    return (
      <button onClick={onOpen} className="text-left">
        <Card className="flex h-full min-h-[104px] items-center justify-center border-dashed transition-colors hover:border-primary/40">
          <CardContent className="flex items-center gap-1.5 p-4 text-xs font-medium text-muted-foreground">
            <Plus className="h-3.5 w-3.5" /> Write your own {noun}
          </CardContent>
        </Card>
      </button>
    )
  }

  return (
    <Card className="border-primary/40">
      <CardContent className="flex flex-col gap-2 p-4">
        <Input placeholder="Label" value={label} onChange={e => setLabel(e.target.value)} className="h-8 text-sm" autoFocus />
        <Textarea placeholder="Description" value={description} onChange={e => setDescription(e.target.value)} rows={2} className="text-xs" />
        <div className="flex gap-1.5">
          <Button size="sm" disabled={!label.trim()} onClick={() => onSave(label, description)}>Add</Button>
          <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
        </div>
      </CardContent>
    </Card>
  )
}

function ScoreRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold text-foreground">{value}</span>
      </div>
      <Progress value={value} />
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm text-foreground">{value}</p>
    </div>
  )
}
