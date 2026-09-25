// C5 -- presentational stage panels of the Deconstructor workspace. Business language only: no raw JSON, no technical stage numbers.
// Technical provenance sits behind an explicit "View evidence / methodology" disclosure.
import { Fragment, useRef } from 'react'
import { AlertTriangle, CheckCircle2, Film, Loader2, Sparkles, Upload } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorState } from '@/components/common/ErrorState'
import { LoadingState } from '@/components/common/LoadingState'
import { assetsApi } from '../../api/client'
import type { ReferenceVideo } from '../../types'
import type { Anatomy, BlueprintResponse, MechanismSet } from '../../types/deconstructor'
import { checkBlueprintUsable } from '../video-studio-v2/blueprint/blueprintPlan'
import type { DeconProgress } from './viewModel'
import {
  anatomyCard, anatomyOverview, anatomyReady, blueprintSectionCards, blueprintSummary, derivedStatusNote, fmtSeconds, fmtTime, mechanismsView, referenceCard,
} from './viewModel'
import { type IntentErrors, type IntentForm } from './intentForm'
import type { Loadable } from './useDeconstructor'

const box = 'rounded-xl border bg-card p-4'
const sub = 'text-xs text-muted-foreground'
const AI_NOTE = 'uses AI and may incur usage cost'

function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn'; children: React.ReactNode }) {
  return (
    <div role="note" className={`flex gap-2 rounded-lg border px-3 py-2 text-xs ${tone === 'warn' ? 'border-amber-500/40 bg-amber-500/10' : 'bg-muted/40'}`}>
      {tone === 'warn' ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" /> : <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
      <div>{children}</div>
    </div>
  )
}

function Disclosure({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <details className="rounded-lg border bg-muted/20 px-3 py-2 text-xs">
      <summary className="cursor-pointer font-medium">{label}</summary>
      <div className="mt-2 space-y-1 text-muted-foreground">{children}</div>
    </details>
  )
}

// ── 1. Reference ─────────────────────────────────────────────────────────────────────────────
export function ReferenceStage(p: {
  references: Loadable<ReferenceVideo[]>; selectedId: number | null; onSelect: (id: number) => void
  progress: DeconProgress; busy: string | null; anatomyAvailable: boolean
  onDeconstruct: () => void; onAdd: (f: File) => void; onRetry: () => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const cards = (p.references.data ?? []).map(referenceCard)
  const sel = cards.find(c => c.id === p.selectedId) ?? null
  const running = p.progress.state === 'running' || p.busy === 'deconstruct'
  return (
    <div className="space-y-4" data-testid="stage-reference">
      <div className="flex items-center justify-between gap-2">
        <div><h2 className="text-base font-semibold">Choose a reference video</h2><p className={sub}>The video whose structure you want to learn from.</p></div>
        <div>
          <input ref={fileRef} type="file" accept="video/*" hidden onChange={e => { const f = e.target.files?.[0]; if (f) p.onAdd(f); e.target.value = '' }} />
          <Button variant="outline" size="sm" disabled={p.busy === 'upload'} onClick={() => fileRef.current?.click()}>
            {p.busy === 'upload' ? <Loader2 className="animate-spin" /> : <Upload />} Add a reference video
          </Button>
        </div>
      </div>

      {p.references.loading && <LoadingState rows={3} />}
      {p.references.error && <ErrorState title="Could not load references" description={p.references.error} onRetry={p.onRetry} />}
      {!p.references.loading && !p.references.error && cards.length === 0 && (
        <EmptyState icon={Film} title="No reference videos yet" description="Add a reference video to start learning from its structure." />
      )}

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map(c => (
          <li key={c.id}>
            <button
              onClick={() => p.onSelect(c.id)} data-testid={`reference-${c.id}`}
              className={`flex w-full gap-3 rounded-xl border bg-card p-3 text-left transition hover:border-primary/60 ${c.id === p.selectedId ? 'border-primary ring-1 ring-primary' : ''}`}
            >
              <div className="h-16 w-12 shrink-0 overflow-hidden rounded-md bg-muted">
                {c.thumbnailPath ? <img src={assetsApi.previewUrl(c.thumbnailPath)} alt="" className="h-full w-full object-cover" /> : <Film className="m-auto mt-5 h-5 w-5 text-muted-foreground" />}
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{c.title}</div>
                <div className={sub}>{c.durationSeconds != null ? fmtSeconds(c.durationSeconds) : 'Duration unknown'} · {c.statusLabel}</div>
              </div>
            </button>
          </li>
        ))}
      </ul>

      {sel && (
        <div className={`${box} space-y-3`} data-testid="deconstruct-panel">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold">{sel.title}</div>
              <div className={sub}>{p.anatomyAvailable ? 'Deconstructed — the structure is ready to explore.' : p.progress.headline}</div>
            </div>
            <Button onClick={p.onDeconstruct} disabled={running} data-testid="deconstruct-button">
              {running ? <Loader2 className="animate-spin" /> : null} {p.anatomyAvailable ? 'Deconstruct again' : 'Deconstruct'}
            </Button>
          </div>
          {running && (
            <div className="space-y-1" data-testid="deconstruct-progress">
              <Progress value={p.progress.percent} />
              <div className={sub}>{p.progress.done} of {p.progress.total || '…'} steps done{p.progress.current ? ` · ${p.progress.current}` : ''}</div>
            </div>
          )}
          {p.progress.failures.length > 0 && (
            <Notice tone="warn">
              Some steps did not finish:
              <ul className="ml-4 list-disc">{p.progress.failures.map(f => <li key={f.label}>{f.label}: {f.error}</li>)}</ul>
            </Notice>
          )}
          <Notice>Deconstruction analyses the video (speech, text, shots, pacing). Where an AI provider is configured, some steps {AI_NOTE}. Steps already completed are skipped.</Notice>
        </div>
      )}
    </div>
  )
}

// ── 2. Anatomy ───────────────────────────────────────────────────────────────────────────────
export function AnatomyStage({ anatomy }: { anatomy: Loadable<Anatomy> }) {
  if (anatomy.loading) return <LoadingState rows={4} />
  if (anatomy.error) return <ErrorState title="Could not load the content anatomy" description={anatomy.error} />
  if (!anatomyReady(anatomy.data)) return <EmptyState icon={Film} title="Not deconstructed yet" description="Deconstruct the reference video first — its structure will appear here." />
  const a = anatomy.data as Anatomy
  const ov = anatomyOverview(a)
  return (
    <div className="space-y-4" data-testid="stage-anatomy">
      <div>
        <h2 className="text-base font-semibold">What the reference did</h2>
        <p className={sub}>{ov.durationText} · {ov.sectionCount} sections · {ov.pacing}</p>
      </div>
      <div className={`${box} space-y-1 text-sm`}>
        {ov.hookNote && <div>{ov.hookNote}</div>}
        {ov.structuralSummary && <div>{ov.structuralSummary}</div>}
        <div className={sub}>{ov.retention}</div>
      </div>
      <ol className="space-y-3">
        {a.sections.map(s => {
          const c = anatomyCard(s)
          return (
            <li key={c.number} className={box} data-testid={`anatomy-section-${c.number}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="text-sm font-semibold">Section {c.number} <span className="font-normal text-muted-foreground">· {c.timeRange} ({c.duration})</span></div>
                <Badge variant="secondary">{c.role}</Badge>
              </div>
              <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm">{c.whatHappens.map(w => <li key={w}>{w}</li>)}</ul>
              <dl className="mt-3 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[max-content_1fr]">
                {c.transcript && (<><dt className="font-medium">Transcript</dt><dd className="text-muted-foreground">{c.transcript}</dd></>)}
                <dt className="font-medium">Visual</dt><dd className="text-muted-foreground">{c.visual}</dd>
                {c.onScreenText.length > 0 && (<><dt className="font-medium">On-screen text</dt><dd className="text-muted-foreground">{c.onScreenText.join(' · ')}</dd></>)}
                <dt className="font-medium">Audio</dt><dd className="text-muted-foreground">{c.audio}</dd>
                <dt className="font-medium">Pacing</dt><dd className="text-muted-foreground">{c.pacing}</dd>
                <dt className="font-medium">Retention evidence</dt><dd className="text-muted-foreground">{c.retention}</dd>
              </dl>
            </li>
          )
        })}
      </ol>
      {ov.gaps.length > 0 && (
        <Disclosure label={`What we could not establish (${ov.gaps.length})`}>
          <ul className="ml-4 list-disc">{ov.gaps.map(g => <li key={g}>{g}</li>)}</ul>
        </Disclosure>
      )}
    </div>
  )
}

// ── 3. Mechanisms ────────────────────────────────────────────────────────────────────────────
export function MechanismsStage(p: { mechanisms: Loadable<MechanismSet>; anatomyAvailable: boolean; busy: string | null; onDerive: () => void }) {
  if (p.mechanisms.loading) return <LoadingState rows={3} />
  if (p.mechanisms.error) return <ErrorState title="Could not load the mechanisms" description={p.mechanisms.error} />
  const v = mechanismsView(p.mechanisms.data)
  const deriving = p.busy === 'mechanisms'
  return (
    <div className="space-y-4" data-testid="stage-mechanisms">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h2 className="text-base font-semibold">Principles learned</h2><p className={sub}>The structural ideas that make the reference work — separated from the specifics you must not copy.</p></div>
        {p.anatomyAvailable && (
          <Button variant={v.state === 'none' ? 'default' : 'outline'} size="sm" onClick={p.onDerive} disabled={deriving} data-testid="derive-button">
            {deriving ? <Loader2 className="animate-spin" /> : <Sparkles />} {v.state === 'none' ? 'Derive mechanisms' : 'Derive again'}
          </Button>
        )}
      </div>
      {p.anatomyAvailable && <Notice>Deriving mechanisms {AI_NOTE}. You will be asked to confirm before it runs. Nothing is sent until you do.</Notice>}
      {v.message && <Notice tone="warn">{v.message}</Notice>}
      {v.state === 'none' && (
        <EmptyState icon={Sparkles} title="No mechanisms yet" description={p.anatomyAvailable ? 'Derive mechanisms to learn what this reference does structurally.' : 'Deconstruct the reference first.'} />
      )}
      <ul className="space-y-3">
        {v.cards.map(c => (
          <li key={c.id} className={box} data-testid={`mechanism-${c.id}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-semibold">{c.id} · {c.typeLabel}</div>
              <Badge variant={c.confidenceLevel === 'high' ? 'success' : c.confidenceLevel === 'low' ? 'warning' : 'secondary'}>{c.confidence}</Badge>
            </div>
            <p className="mt-1 text-sm"><span className="font-medium">Principle: </span>{c.principle}</p>
            <dl className="mt-3 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[max-content_1fr]">
              <dt className="font-medium">Why it is structural</dt><dd className="text-muted-foreground">{c.whyStructural}</dd>
              <dt className="font-medium">Where it appears</dt><dd className="text-muted-foreground">{c.whereItAppears}</dd>
              <dt className="font-medium">What can transfer</dt><dd className="text-muted-foreground">{c.canTransfer}</dd>
              <dt className="font-medium">What must not be copied</dt>
              <dd className="text-muted-foreground">{c.mustNotCopy.length ? <ul className="list-disc pl-4">{c.mustNotCopy.map(n => <li key={n.description}><b>{n.kind}:</b> {n.description}</li>)}</ul> : 'Nothing specific recorded'}</dd>
            </dl>
            {c.limitations.length > 0 && <Disclosure label="Limitations"><ul className="ml-4 list-disc">{c.limitations.map(l => <li key={l}>{l}</li>)}</ul></Disclosure>}
          </li>
        ))}
      </ul>
      {v.overallLimitations.length > 0 && <Disclosure label="Overall limitations"><ul className="ml-4 list-disc">{v.overallLimitations.map(l => <li key={l}>{l}</li>)}</ul></Disclosure>}
    </div>
  )
}

// ── 4. New content (intent) ──────────────────────────────────────────────────────────────────
function Field(p: { id: keyof IntentForm; label: string; required?: boolean; hint?: string; form: IntentForm; errors: IntentErrors; set: (k: keyof IntentForm, v: string) => void; multiline?: boolean; placeholder?: string }) {
  const err = p.errors[p.id]
  const common = { id: `intent-${p.id}`, value: p.form[p.id], placeholder: p.placeholder, 'aria-invalid': !!err, onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => p.set(p.id, e.target.value) }
  return (
    <div className="space-y-1">
      <Label htmlFor={`intent-${p.id}`}>{p.label}{p.required && <span className="text-destructive"> *</span>}</Label>
      {p.multiline ? <Textarea rows={3} {...common} /> : <Input {...common} />}
      {p.hint && !err && <p className={sub}>{p.hint}</p>}
      {err && <p className="text-xs text-destructive" role="alert">{err}</p>}
    </div>
  )
}

export function IntentStage(p: {
  form: IntentForm; errors: IntentErrors; set: (k: keyof IntentForm, v: string) => void
  mechanismsReady: boolean; busy: string | null; onBuild: () => void; hasExistingBlueprint: boolean
}) {
  const building = p.busy === 'blueprint'
  const f = { form: p.form, errors: p.errors, set: p.set }
  return (
    <div className="space-y-4" data-testid="stage-intent">
      <div><h2 className="text-base font-semibold">What we will apply</h2><p className={sub}>Tell us about the NEW content. Only what you enter is used — nothing is invented.</p></div>
      {p.hasExistingBlueprint && <Notice>A blueprint already exists for this reference (see the Blueprint step). Building here creates a NEW blueprint from the details below.</Notice>}
      <div className={`${box} grid gap-4 sm:grid-cols-2`}>
        <Field id="product" label="Product, service or topic" required {...f} placeholder="e.g. choosing tiles for a home renovation" />
        <Field id="audience" label="Target audience" required {...f} placeholder="e.g. homeowners planning a renovation" />
        <div className="sm:col-span-2"><Field id="objective" label="Objective" required {...f} multiline placeholder="What should this content achieve?" /></div>
        <Field id="business" label="Business or brand" {...f} />
        <Field id="cta" label="Desired call to action" {...f} />
        <Field id="tone" label="Tone / style" {...f} multiline hint="One per line." />
        <div className="grid gap-4">
          <Field id="platform" label="Platform" {...f} placeholder="e.g. short-form social video" />
          <Field id="durationSeconds" label="Target duration (seconds)" {...f} hint="3–600. Leave blank if there is no target." />
        </div>
        <div className="sm:col-span-2"><Field id="durationNotes" label="Duration / platform notes" {...f} /></div>
        <Field id="mandatory" label="Mandatory points" {...f} multiline hint="One per line. Every one must appear." />
        <Field id="prohibited" label="Prohibited claims or elements" {...f} multiline hint="One per line. Never used." />
      </div>
      <Notice>Building the blueprint {AI_NOTE}. You will be asked to confirm before anything is sent.</Notice>
      {!p.mechanismsReady && <Notice tone="warn">Derive the reference's mechanisms first (Mechanisms step) — the blueprint applies them.</Notice>}
      <Button onClick={p.onBuild} disabled={building || !p.mechanismsReady} data-testid="build-blueprint-button">
        {building ? <Loader2 className="animate-spin" /> : <Sparkles />} Build reconstruction blueprint
      </Button>
    </div>
  )
}

// ── 5. Blueprint ─────────────────────────────────────────────────────────────────────────────
export function BlueprintStage(p: {
  blueprint: Loadable<BlueprintResponse>; busy: string | null; onUse: () => void; onNew: () => void; useMessage: string | null
}) {
  if (p.blueprint.loading) return <LoadingState rows={4} />
  if (p.blueprint.error) return <ErrorState title="Could not load the blueprint" description={p.blueprint.error} />
  const r = p.blueprint.data
  if (!r || !r.blueprint) {
    return (
      <div className="space-y-3" data-testid="stage-blueprint">
        <EmptyState icon={Sparkles} title="No blueprint yet" description="Describe the new content, then build a reconstruction blueprint." actionLabel="Go to New content" onAction={p.onNew} />
      </div>
    )
  }
  const bp = r.blueprint
  const usable = checkBlueprintUsable(r)
  const sum = blueprintSummary(bp)
  const cards = blueprintSectionCards(bp)
  const staleNote = derivedStatusNote(r.status)
  return (
    <div className="space-y-4" data-testid="stage-blueprint">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h2 className="text-base font-semibold">How the new content will be built</h2><p className={sub}>{bp.intent_summary}</p></div>
        <Button onClick={p.onUse} disabled={!usable.ok || p.busy === 'use'} data-testid="use-blueprint-button">
          {p.busy === 'use' ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Use blueprint
        </Button>
      </div>
      {!usable.ok && <Notice tone="warn">{usable.message}{staleNote ? ` (${staleNote})` : ''}</Notice>}
      {p.useMessage && <Notice tone="warn">{p.useMessage}</Notice>}

      <div className={`${box} space-y-2 text-sm`} data-testid="blueprint-summary">
        <div><span className="font-medium">Structural approach: </span>{sum.structuralApproach}</div>
        <div className="text-xs text-muted-foreground">{sum.platform} · {sum.duration}</div>
        <div className="flex flex-wrap gap-1.5">
          {sum.mechanismsUsed.map(m => <Badge key={m.id} variant="success">Used: {m.label}</Badge>)}
          {sum.mechanismsNotUsed.map(m => <Badge key={m.id} variant="outline" title={m.reason}>Not used: {m.label}</Badge>)}
        </div>
        {sum.constraints.length > 0 && <div className="text-xs"><span className="font-medium">Constraints: </span><span className="text-muted-foreground">{sum.constraints.join(' · ')}</span></div>}
        {sum.doNotReproduce.length > 0 && <div className="text-xs"><span className="font-medium">Do not reproduce: </span><span className="text-muted-foreground">{sum.doNotReproduce.join(' · ')}</span></div>}
      </div>

      <ol className="space-y-3">
        {cards.map(c => (
          <li key={c.number} className={box} data-testid={`blueprint-section-${c.number}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="text-sm font-semibold">{c.number}. {c.purpose} <span className="font-normal text-muted-foreground">· {c.duration}</span></div>
              <div className="flex gap-1.5"><Badge variant="secondary">{c.role}</Badge>{c.cta && <Badge variant="accent">Call to action</Badge>}</div>
            </div>
            <p className="mt-1 text-sm">{c.contentInstruction}</p>
            <dl className="mt-3 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[max-content_1fr]">
              {c.directions.map(d => (<Fragment key={d.label}><dt className="font-medium">{d.label}</dt><dd className="text-muted-foreground">{d.text}</dd></Fragment>))}
              {c.cta && (<><dt className="font-medium">Call to action</dt><dd className="text-muted-foreground">{c.cta}</dd></>)}
              {c.mandatoryPoints.length > 0 && (<><dt className="font-medium">Must include</dt><dd className="text-muted-foreground">{c.mandatoryPoints.map(m => m.text).join(' · ')}</dd></>)}
              {c.mechanisms.length > 0 && (<><dt className="font-medium">Principles applied</dt><dd className="text-muted-foreground">{c.mechanisms.map(m => m.label).join(' · ')}</dd></>)}
              {c.requiredInformation.length > 0 && (<><dt className="font-medium">Still needed</dt><dd className="text-muted-foreground">{c.requiredInformation.join(' · ')}</dd></>)}
            </dl>
          </li>
        ))}
      </ol>

      {(sum.gaps.length > 0 || sum.qualityNotes.length > 0) && (
        <Disclosure label={`Limitations and review notes (${sum.gaps.length + sum.qualityNotes.length})`}>
          {sum.gaps.length > 0 && <ul className="ml-4 list-disc">{sum.gaps.map(g => <li key={g}>{g}</li>)}</ul>}
          {sum.qualityNotes.length > 0 && (<><div className="pt-1 font-medium text-foreground">For review</div><ul className="ml-4 list-disc">{sum.qualityNotes.map(g => <li key={g}>{g}</li>)}</ul></>)}
        </Disclosure>
      )}
      <Disclosure label="View evidence / methodology">
        <div>Blueprint {bp.blueprint_id} · version {bp.blueprint_version}</div>
        <div>Built from mechanisms attempt {r.input_pin.mechanism_attempt_id ?? '—'} and reference analysis {r.video_analysis_id}</div>
        {r.provenance && <div>Prompt {r.provenance.prompt_version ?? '—'} · {r.provenance.provider ?? '—'} / {r.provenance.model ?? '—'} · attempt {r.provenance.reasoning_attempt_id ?? '—'}</div>}
        <div>Status: {r.status}{r.reused ? ' (an identical blueprint already existed and was reused)' : ''}</div>
      </Disclosure>
    </div>
  )
}

// ── 6. Create ────────────────────────────────────────────────────────────────────────────────
export function CreateStage(p: { blueprint: Loadable<BlueprintResponse>; busy: string | null; onUse: () => void; sceneSummary: { n: number; seconds: number } | null; useMessage: string | null }) {
  const r = p.blueprint.data
  const usable = checkBlueprintUsable(r)
  return (
    <div className="space-y-4" data-testid="stage-create">
      <div><h2 className="text-base font-semibold">Create in Video Studio</h2><p className={sub}>Opens the existing Video Studio with one scene per blueprint section.</p></div>
      {!usable.ok && <Notice tone="warn">{usable.message}</Notice>}
      {p.useMessage && <Notice tone="warn">{p.useMessage}</Notice>}
      {usable.ok && p.sceneSummary && (
        <div className={`${box} space-y-1 text-sm`}>
          <div><b>{p.sceneSummary.n}</b> scenes · <b>{fmtSeconds(p.sceneSummary.seconds)}</b> in total</div>
          <div className={sub}>Each scene starts as a placeholder holding the blueprint's instruction — it is guidance to create from, not finished wording. You add the real footage, wording and voice.</div>
        </div>
      )}
      <Button onClick={p.onUse} disabled={!usable.ok || p.busy === 'use'} data-testid="open-studio-button">
        {p.busy === 'use' ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Use blueprint in Video Studio
      </Button>
    </div>
  )
}

export { fmtTime }
