import { useState } from 'react'
import { UploadCloud, Scissors, Play, Check, X, Pencil, Film, CheckCircle2 } from 'lucide-react'
import { useClient } from '@/contexts/ClientContext'
import { useAICompanionContext } from '@/contexts/AICompanionContext'
import { PageHeader } from '@/components/common/PageHeader'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

interface CandidateClip {
  id: string
  range: string
  title: string
  hook: string
  whySelected: string
  completeness: number
  attentionPotential: number
  positioningAlignment: number
  businessObjective: string
  score: number
}

const CANDIDATE_CLIPS: CandidateClip[] = [
  { id: 'clip-1', range: '0:12–0:34', title: 'The 3-point inspection, explained fast', hook: '"Here\'s what we check before any car leaves this yard."', whySelected: 'Self-contained proof moment with a clear opening and close.', completeness: 92, attentionPotential: 81, positioningAlignment: 88, businessObjective: 'Trust', score: 87 },
  { id: 'clip-2', range: '2:05–2:29', title: 'Customer reacting to the warranty terms', hook: '"Wait, that\'s actually included?"', whySelected: 'Genuine surprised reaction — strong pattern-interrupt for Reels.', completeness: 78, attentionPotential: 90, positioningAlignment: 74, businessObjective: 'Attention', score: 83 },
  { id: 'clip-3', range: '4:40–5:10', title: 'Owner explaining the finance pre-approval', hook: '"You\'ll know what you can afford before you even visit."', whySelected: 'Directly answers a top researched objection (affordability).', completeness: 85, attentionPotential: 68, positioningAlignment: 91, businessObjective: 'Enquiry', score: 81 },
  { id: 'clip-4', range: '7:52–8:15', title: 'Walkaround — undercarriage check', hook: '"Most buyers never see this part of the car."', whySelected: 'Visually novel, demonstrates the differentiator literally.', completeness: 64, attentionPotential: 77, positioningAlignment: 80, businessObjective: 'Differentiation', score: 74 },
  { id: 'clip-5', range: '11:20–11:38', title: 'Quick review read-aloud', hook: '"212 reviews, 4.8 stars — here\'s one of them."', whySelected: 'Short, proof-led, easy caption overlay candidate.', completeness: 70, attentionPotential: 58, positioningAlignment: 66, businessObjective: 'Reputation', score: 65 },
]

const TREATMENT_CHECKLIST = ['9:16 reframe', 'Speaker tracking', 'Silence removal', 'Jump cuts', 'B-roll', 'Captions', 'CTA', 'Safe zones'] as const

type ClipDecision = 'selected' | 'rejected' | null

export default function RepurposePage() {
  const { client } = useClient()
  useAICompanionContext(`Repurpose${client ? ` • ${client.name}` : ''}`)

  const [clips, setClips] = useState<CandidateClip[]>(CANDIDATE_CLIPS)
  const [decisions, setDecisions] = useState<Record<string, ClipDecision>>({})
  const [created, setCreated] = useState<Record<string, string[]>>({})
  const [editingRange, setEditingRange] = useState<string | null>(null)
  const [previewClip, setPreviewClip] = useState<CandidateClip | null>(null)
  const [treatment, setTreatment] = useState<Record<string, boolean>>(
    Object.fromEntries(TREATMENT_CHECKLIST.map(t => [t, true]))
  )

  const sorted = [...clips].sort((a, b) => b.score - a.score)
  const activeTreatments = TREATMENT_CHECKLIST.filter(t => treatment[t])

  const setDecision = (id: string, decision: ClipDecision) =>
    setDecisions(prev => ({ ...prev, [id]: prev[id] === decision ? null : decision }))

  const updateRange = (id: string, range: string) =>
    setClips(prev => prev.map(c => (c.id === id ? { ...c, range } : c)))

  const createShort = (id: string) => setCreated(prev => ({ ...prev, [id]: activeTreatments as string[] }))

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Repurpose" description="Turn one long-form video into candidate short-form clips, ranked by attention and positioning fit." />

      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <UploadCloud className="h-5 w-5" />
          </div>
          <p className="text-sm font-semibold text-foreground">Upload or select a long-form video</p>
          <p className="max-w-sm text-xs text-muted-foreground">Showing sample candidates from a prior ABC Motors dealership walkthrough — upload isn't wired up yet.</p>
          <Button size="sm" variant="outline" className="mt-1" disabled>Select video</Button>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3">
        {sorted.map(clip => {
          const decision = decisions[clip.id] ?? null
          const appliedTreatments = created[clip.id]
          const isCreated = appliedTreatments !== undefined
          return (
            <Card key={clip.id} className={cn(decision === 'rejected' && !isCreated && 'opacity-50', decision === 'selected' && 'border-primary ring-1 ring-primary')}>
              <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-start md:justify-between">
                <div className="flex flex-1 flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {editingRange === clip.id ? (
                      <Input
                        autoFocus
                        defaultValue={clip.range}
                        className="h-6 w-28 font-mono text-[11px]"
                        onBlur={e => { updateRange(clip.id, e.target.value); setEditingRange(null) }}
                        onKeyDown={e => {
                          if (e.key === 'Enter') { updateRange(clip.id, e.currentTarget.value); setEditingRange(null) }
                          if (e.key === 'Escape') setEditingRange(null)
                        }}
                      />
                    ) : (
                      <Badge variant="outline" className="font-mono">{clip.range}</Badge>
                    )}
                    <span className="text-sm font-semibold text-foreground">{clip.title}</span>
                    <Badge variant="accent">{clip.businessObjective}</Badge>
                    {isCreated && <Badge variant="success" className="gap-1"><CheckCircle2 className="h-3 w-3" /> Short created</Badge>}
                  </div>
                  <p className="text-sm italic text-foreground/90">"{clip.hook}"</p>
                  <p className="text-xs text-muted-foreground">{clip.whySelected}</p>
                  <div className="flex flex-wrap gap-4 pt-1 text-[11px]">
                    <Metric label="Completeness" value={clip.completeness} />
                    <Metric label="Attention potential" value={clip.attentionPotential} />
                    <Metric label="Positioning alignment" value={clip.positioningAlignment} />
                    <Metric label="Overall score" value={clip.score} emphasis />
                  </div>
                  {isCreated && (
                    <p className="text-[11px] text-muted-foreground">
                      {appliedTreatments.length > 0 ? `Applied: ${appliedTreatments.join(', ')}` : 'No treatment options were enabled — created as a raw clip.'}
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 flex-wrap gap-1.5 md:flex-col">
                  <Button size="sm" variant="outline" className="gap-1" onClick={() => setPreviewClip(clip)}><Play className="h-3.5 w-3.5" /> Preview</Button>
                  <Button size="sm" variant={decision === 'selected' ? 'default' : 'outline'} className="gap-1" disabled={isCreated} onClick={() => setDecision(clip.id, 'selected')}>
                    <Check className="h-3.5 w-3.5" /> Select
                  </Button>
                  <Button size="sm" variant={decision === 'rejected' ? 'destructive' : 'outline'} className="gap-1" disabled={isCreated} onClick={() => setDecision(clip.id, 'rejected')}>
                    <X className="h-3.5 w-3.5" /> Reject
                  </Button>
                  <Button size="sm" variant="outline" className="gap-1" disabled={isCreated} onClick={() => setEditingRange(clip.id)}>
                    <Pencil className="h-3.5 w-3.5" /> Modify boundaries
                  </Button>
                  <Button
                    size="sm"
                    className="gap-1 bg-sg-forest text-sg-ivory hover:bg-sg-forest/90"
                    disabled={decision !== 'selected' || isCreated}
                    onClick={() => createShort(clip.id)}
                  >
                    <Scissors className="h-3.5 w-3.5" /> {isCreated ? 'Created' : 'Create Short'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Film className="h-4 w-4" /> Short-form treatment</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
          {TREATMENT_CHECKLIST.map(item => (
            <label key={item} className="flex items-center justify-between gap-2 text-xs">
              <span className="text-foreground">{item}</span>
              <Switch checked={treatment[item]} onCheckedChange={v => setTreatment(prev => ({ ...prev, [item]: v }))} />
            </label>
          ))}
        </CardContent>
      </Card>

      <Dialog open={previewClip !== null} onOpenChange={open => !open && setPreviewClip(null)}>
        <DialogContent>
          {previewClip && (
            <>
              <DialogHeader>
                <DialogTitle>{previewClip.title}</DialogTitle>
                <DialogDescription>{previewClip.range} · {previewClip.businessObjective}</DialogDescription>
              </DialogHeader>
              <div className="flex aspect-[9/16] max-h-72 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <Play className="h-8 w-8" />
              </div>
              <p className="text-sm italic text-foreground/90">"{previewClip.hook}"</p>
              <p className="text-xs text-muted-foreground">{previewClip.whySelected}</p>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Metric({ label, value, emphasis }: { label: string; value: number; emphasis?: boolean }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn('font-semibold', emphasis ? 'text-primary' : 'text-foreground')}>{value}</span>
    </div>
  )
}
