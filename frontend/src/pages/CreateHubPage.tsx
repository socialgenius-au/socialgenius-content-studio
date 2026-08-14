import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Sparkles, Eye, Radio, ShieldCheck, GraduationCap, Diff, MessageSquare, CalendarCheck,
  DollarSign, Tag, HeartHandshake, Star, Share2, ChevronRight, ChevronLeft, Check,
} from 'lucide-react'
import { useClient } from '@/contexts/ClientContext'
import { useAICompanionContext } from '@/contexts/AICompanionContext'
import { contentService } from '@/services/contentService'
import type { CreativeOption, CreativeOutcome, PositioningGateCheck } from '@/types/domain'
import type { StructureOption, CtaOption } from '@/mocks/creative'
import { PageHeader } from '@/components/common/PageHeader'
import { LoadingState } from '@/components/common/LoadingState'
import { StatusBadge } from '@/components/common/StatusBadge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
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

export default function CreateHubPage() {
  const { client } = useClient()
  const navigate = useNavigate()
  useAICompanionContext(`Create Hub${client ? ` • ${client.name}` : ''}`)

  const [step, setStep] = useState(0)
  const [outcome, setOutcome] = useState<CreativeOutcome>('Enquiry')

  const [angles, setAngles] = useState<CreativeOption[] | null>(null)
  const [angleId, setAngleId] = useState<string | null>(null)

  const [structures, setStructures] = useState<StructureOption[] | null>(null)
  const [structureId, setStructureId] = useState<string | null>(null)

  const [ctas, setCtas] = useState<CtaOption[] | null>(null)
  const [ctaId, setCtaId] = useState<string | null>(null)

  const [gate, setGate] = useState<PositioningGateCheck | null>(null)
  const [gateLoading, setGateLoading] = useState(false)
  const [exceptionApproved, setExceptionApproved] = useState(false)

  useEffect(() => {
    if (step === 1 && angles === null) contentService.getAngleOptions().then(setAngles)
    if (step === 2 && structures === null) contentService.getStructureOptions().then(setStructures)
    if (step === 3 && ctas === null) contentService.getCtaOptions().then(setCtas)
    if (step === 4 && angleId && gate === null) {
      setGateLoading(true)
      contentService.checkPositioningGate(angleId).then(g => {
        setGate(g)
        setGateLoading(false)
      })
    }
  }, [step, angles, structures, ctas, angleId, gate])

  const selectedAngle = angles?.find(a => a.id === angleId) ?? null
  const selectedStructure = structures?.find(s => s.id === structureId) ?? null
  const selectedCta = ctas?.find(c => c.id === ctaId) ?? null

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
      )}

      {/* Step 1 — Angle */}
      {step === 1 && (
        angles === null ? <LoadingState rows={3} /> : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {angles.map(a => (
              <Card key={a.id} className={cn('flex flex-col', angleId === a.id && 'border-primary ring-1 ring-primary')}>
                <CardHeader>
                  <CardTitle>{a.label}</CardTitle>
                  <p className="pt-1 text-sm font-medium italic text-foreground">"{a.pitch}"</p>
                </CardHeader>
                <CardContent className="flex flex-1 flex-col gap-3">
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

                  <div className="mt-auto flex flex-wrap gap-1.5 pt-2">
                    <Button size="sm" onClick={() => setAngleId(a.id)}>
                      {angleId === a.id ? <><Check className="h-3.5 w-3.5" /> Chosen</> : 'Choose'}
                    </Button>
                    <Button size="sm" variant="outline">Modify</Button>
                    <Button size="sm" variant="outline">Ask AI for more</Button>
                    <Button size="sm" variant="ghost">Write my own</Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )
      )}

      {/* Step 2 — Structure */}
      {step === 2 && (
        structures === null ? <LoadingState rows={3} /> : (
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
                  <div className="flex flex-col gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3">
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
            <Field label="Angle" value={selectedAngle ? `${selectedAngle.label} — "${selectedAngle.pitch}"` : '—'} />
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
    </div>
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
