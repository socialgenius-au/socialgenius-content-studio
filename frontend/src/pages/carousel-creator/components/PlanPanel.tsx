import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { deconstructorApi, referenceVideosApi } from '../../../api/client'
import type { Blueprint, BlueprintResponse } from '../../../types/deconstructor'
import { carouselFromPlan, planCarouselFromBlueprint, type CarouselPlan } from '../../../lib/carousel/blueprintPlan'
import { LAYOUTS } from '../../../lib/carousel/layouts'
import type { PostDocument } from '../../../lib/postDocument'

interface RefRow { id: number; original_filename?: string; filename?: string; asset_id?: number }

const layoutLabel = (id: string) => LAYOUTS.find(l => l.id === id)?.label ?? id

/** Plans a carousel from a Deconstructor blueprint: choose a reference, review how its sections and mechanisms map to slides, then create the document. No AI call is made. */
export default function PlanPanel({ onCreate }: { onCreate: (doc: PostDocument) => void }) {
  const [refs, setRefs] = useState<RefRow[] | null>(null)
  const [refId, setRefId] = useState<number | ''>('')
  const [state, setState] = useState<{ kind: 'idle' } | { kind: 'loading' } | { kind: 'none'; reason: string } | { kind: 'ready'; bp: Blueprint; status: string; plan: CarouselPlan } | { kind: 'error'; text: string }>({ kind: 'idle' })

  useEffect(() => {
    let live = true
    referenceVideosApi.list().then(r => { if (live) setRefs(r.data as RefRow[]) }).catch(() => { if (live) setRefs([]) })
    return () => { live = false }
  }, [])

  const choose = async (id: number | '') => {
    setRefId(id)
    if (id === '') { setState({ kind: 'idle' }); return }
    setState({ kind: 'loading' })
    try {
      const res = await deconstructorApi.blueprint(id)
      const data = res.data as BlueprintResponse
      if (!data.blueprint) { setState({ kind: 'none', reason: 'This reference has no blueprint yet. Build one in Reconstruct (New content, then Blueprint), then come back.' }); return }
      setState({ kind: 'ready', bp: data.blueprint, status: data.status, plan: planCarouselFromBlueprint(data.blueprint, { referenceVideoId: id }) })
    } catch { setState({ kind: 'error', text: 'Could not load that blueprint. Check your connection and try again.' }) }
  }

  return (
    <section aria-label="Plan from a Deconstructor blueprint" className="space-y-3" data-testid="plan-panel">
      <p className="text-sm text-muted-foreground">Use a reference you have already deconstructed. Its blueprint (the structure for your new content) becomes a slide-by-slide plan. No AI call is made, and nothing from the reference itself is copied.</p>
      <label className="block space-y-1 text-xs"><span className="text-muted-foreground">Reference</span>
        <select className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm" value={refId} onChange={e => choose(e.target.value === '' ? '' : Number(e.target.value))} data-testid="plan-reference">
          <option value="">{refs === null ? 'Loading…' : refs.length === 0 ? 'No references yet' : 'Choose a reference…'}</option>
          {(refs ?? []).map(r => <option key={r.id} value={r.id}>{r.original_filename ?? r.filename ?? `Reference ${r.id}`} (#{r.id})</option>)}
        </select>
      </label>

      {state.kind === 'loading' && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading blueprint…</p>}
      {state.kind === 'none' && <p role="status" className="rounded-md border border-border bg-muted/50 p-3 text-sm" data-testid="plan-none">{state.reason} <Link to={`/deconstructor/${refId}`} className="font-medium underline">Open Reconstruct</Link></p>}
      {state.kind === 'error' && <p role="alert" className="text-sm text-destructive">{state.text}</p>}

      {state.kind === 'ready' && (
        <div className="space-y-3" data-testid="plan-ready">
          {state.status !== 'current' && <p role="status" className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">This blueprint is {state.status.replace(/_/g, ' ')}: the analysis it was built from has changed since. You can still plan from it; review it in Reconstruct first if accuracy matters.</p>}
          <div className="rounded-md border border-border bg-card p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">How the new content is structured</p>
            <p className="mt-1 text-sm">{state.plan.structuralApproach}</p>
          </div>
          <ol className="space-y-2" data-testid="plan-slides">
            {state.plan.slides.map((s, i) => (
              <li key={s.sectionNumber} className="rounded-md border border-border bg-card p-2.5 text-sm" data-testid="plan-slide">
                <div className="flex items-baseline justify-between gap-2"><span className="font-semibold">Slide {i + 1}: {s.headline}</span><span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px]">{layoutLabel(s.layout)}</span></div>
                <p className="mt-0.5 text-xs text-muted-foreground">{s.role.replace(/_/g, ' ')} · from blueprint section {s.sectionNumber} · confidence {s.confidence}</p>
                {s.mechanisms.length > 0 && <ul className="mt-1.5 flex flex-wrap gap-1">{s.mechanisms.map(m => <li key={m.id} title={m.principle} className="rounded-full border border-border px-2 py-0.5 text-[11px]">{m.id} · {m.type.replace(/_/g, ' ')}</li>)}</ul>}
              </li>
            ))}
          </ol>
          {state.plan.notes.map((n, i) => <p key={i} className="text-xs text-muted-foreground">{n}</p>)}
          {state.plan.doNotReproduce.length > 0 && (
            <details className="rounded-md border border-border p-2 text-xs"><summary className="cursor-pointer font-medium">Do not reproduce ({state.plan.doNotReproduce.length})</summary>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">{state.plan.doNotReproduce.map((d, i) => <li key={i}>{d.description}</li>)}</ul></details>
          )}
          <p className="text-xs text-muted-foreground">Slide copy starts as clearly marked PLACEHOLDER guidance. You write the real wording; the export check flags any that is left.</p>
          <button type="button" className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90" onClick={() => onCreate(carouselFromPlan(state.plan, state.bp))} data-testid="plan-create">Create this carousel ({state.plan.slides.length} slides)</button>
        </div>
      )}
    </section>
  )
}
