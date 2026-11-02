// M2.4a -- presentational review panel for reconstructed transitions. No state, no I/O: the container owns both. It shows the measured cuts, the estimated type with its reasons,
// the scene join each one lines up with, and lets the person decide. Nothing here claims the original effect or its settings were recovered.
import { Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { TransitionCandidate, TransitionFlagCode } from './candidates'
import { KIND_LABEL, MAX_DURATION, MIN_DURATION, TRANSITION_KINDS, type TransitionKind } from './contract'
import type { ResolvedTransition, TransitionCorrection, TimeMap } from './corrections'
import type { TransitionItemStatus, TransitionPlan } from './materialize'

const box = 'rounded-xl border bg-card p-4'
const sub = 'text-xs text-muted-foreground'
const field = 'h-8 w-full rounded-md border bg-background px-2 text-xs'

export type ReviewState = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'none' } | { kind: 'ready' }

export interface TransitionsReviewViewProps {
  state: ReviewState
  candidates: readonly TransitionCandidate[]
  resolved: readonly ResolvedTransition[]
  plan: TransitionPlan
  timeMap: TimeMap
  sceneCount: number
  onCorrect: (id: string, patch: Partial<Record<keyof TransitionCorrection, unknown>>) => void
  onTimeMode: (mode: TimeMap['mode']) => void
}

const STATUS: Record<TransitionItemStatus, { label: string; variant: 'success' | 'warning' | 'outline' }> = {
  included: { label: 'Will be applied', variant: 'success' }, excluded_default: { label: 'Left out by default', variant: 'outline' },
  excluded_user: { label: 'Left out', variant: 'outline' }, no_join: { label: 'No scene join near it', variant: 'warning' },
}
const FLAG_LABEL: Record<TransitionFlagCode, string> = { low_confidence: 'No clear signature', possible_motion: 'Could be motion', white_look: 'Looks like white', single_boundary: 'Only cut found', timing_mapped: 'Time stretched' }
const secs = (n: number) => `${n.toFixed(2)}s`

export function TransitionsReviewView(props: TransitionsReviewViewProps) {
  const { state, resolved, plan, timeMap } = props
  const items = new Map(plan.items.map(i => [i.candidateId, i] as const))
  const c = plan.record.counts
  return (
    <section className={`${box} space-y-3`} data-testid="transitions-review" aria-label="Rebuild the reference's transitions">
      <div>
        <h3 className="text-sm font-semibold">Rebuild the reference’s transitions <Badge variant="outline">Preview</Badge></h3>
        <p className={sub}>Looks at how the picture changed around each cut in the reference and suggests the matching transition for the scene join closest to it.</p>
      </div>
      <div role="note" data-testid="transitions-honesty" className="rounded-lg border bg-muted/40 px-3 py-2 text-xs">
        <strong>What this does not do.</strong> The analysis keeps measurements around each cut, not the effect that was used, so the type below is an estimate and the original effect and its settings are not recovered.
        Only a hard cut, a dissolve and a fade through black can be told apart (a flash or fade of white is noticed too, but the editor can only do it as a cut or a dissolve); whip pan and zoom punch are never guessed. Scene joins with no cut near them stay hard cuts.
      </div>

      {state.kind === 'loading' && <p className={`${sub} flex items-center gap-2`} role="status"><Loader2 className="h-3.5 w-3.5 animate-spin" />Reading the analysis…</p>}
      {state.kind === 'error' && <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs" data-testid="transitions-error">{state.message}</div>}
      {state.kind === 'none' && <p className={sub} data-testid="transitions-none">The analysis has no measured cuts for this reference (it may be one continuous shot), so there is nothing to rebuild.</p>}

      {state.kind === 'ready' && (
        <>
          <p className="text-xs" data-testid="transitions-summary">
            <strong>{c.measured}</strong> measured {c.measured === 1 ? 'cut' : 'cuts'} · <strong>{c.applied}</strong> will be applied · {c.noJoin} with no scene join near {c.noJoin === 1 ? 'it' : 'them'} · {c.excluded} left out · the blueprint has {props.sceneCount} {props.sceneCount === 1 ? 'scene' : 'scenes'}
          </p>
          {timeMap.referenceSeconds !== null && Math.abs(timeMap.referenceSeconds - timeMap.planSeconds) > 0.01 * timeMap.planSeconds && (
            <fieldset className="flex flex-wrap items-center gap-3 text-xs" data-testid="transitions-timing-mode">
              <legend className="sr-only">How reference timing maps onto the draft</legend>
              <label className="flex items-center gap-1"><input type="radio" name="tr-time-mode" checked={timeMap.mode === 'fit'} onChange={() => props.onTimeMode('fit')} />Fit to the blueprint length ({secs(timeMap.referenceSeconds)} → {secs(timeMap.planSeconds)})</label>
              <label className="flex items-center gap-1"><input type="radio" name="tr-time-mode" checked={timeMap.mode === 'identity'} onChange={() => props.onTimeMode('identity')} />Keep the reference’s own seconds</label>
            </fieldset>
          )}
          <ul className="space-y-2">
            {resolved.map(r => {
              const cand = r.candidate, item = items.get(cand.id)!, st = STATUS[item.status], k = cand.id.replace(/[^a-z0-9]+/gi, '-')
              const set = (patch: Partial<Record<keyof TransitionCorrection, unknown>>) => props.onCorrect(cand.id, patch)
              return (
                <li key={cand.id} className={`space-y-2 rounded-lg border p-3 ${r.include ? 'bg-muted/20' : 'bg-muted/5 opacity-90'}`} data-testid={`transition-item-${k}`} data-status={item.status} data-candidate={cand.id}>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-2 text-xs font-medium">
                      <input type="checkbox" checked={r.include} onChange={e => set({ include: e.target.checked })} aria-label={`Use the cut at ${secs(cand.boundary.boundary)}`} data-testid={`transition-include-${k}`} />Use this cut
                    </label>
                    <Badge variant={st.variant} data-testid={`transition-status-${k}`}>{st.label}</Badge>
                    <Badge variant="outline" data-testid={`transition-estimate-${k}`}>Estimated: {KIND_LABEL[cand.classification.kind]} · {cand.classification.confidence} confidence</Badge>
                    {cand.flags.map(f => <Badge key={f.code} variant={f.severity === 'warning' ? 'warning' : 'outline'} title={f.message}>{FLAG_LABEL[f.code]}</Badge>)}
                  </div>
                  <p className={sub} data-testid={`transition-evidence-${k}`}>
                    Measured cut at {secs(cand.boundary.boundary)} in the reference{timeMap.mode === 'fit' && Math.abs(timeMap.factor - 1) > 0.005 ? `, ${secs(cand.planTime)} on the draft` : ''} · window {secs(cand.boundary.windowStart)}–{secs(cand.boundary.windowEnd)} · {cand.boundary.diff.values.length} frame pairs
                  </p>
                  <ul className={`${sub} list-disc pl-4`} data-testid={`transition-reasons-${k}`}>{cand.classification.reasons.map((x, i) => <li key={i}>{x}</li>)}</ul>
                  <p className="text-xs" data-testid={`transition-join-${k}`}>
                    {cand.join ? <>Closest scene join: <strong>scene {cand.join.sceneNumber} → {cand.join.nextSceneNumber}</strong> at {secs(cand.join.time)} ({secs(cand.join.distance)} away)</> : <span className="text-amber-700">No scene join in the blueprint is close enough to this cut.</span>}
                  </p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <label className="space-y-1"><span className={sub}>Transition {r.kind.basis === 'user' ? '(your choice)' : '(estimated)'}</span>
                      <select className={field} value={r.kind.value} onChange={e => set({ kind: e.target.value as TransitionKind })} data-testid={`transition-kind-${k}`}>
                        {TRANSITION_KINDS.map(t => <option key={t} value={t}>{KIND_LABEL[t]}</option>)}
                      </select></label>
                    <label className="space-y-1"><span className={sub}>Duration (s)</span>
                      <input type="number" step="0.1" min={MIN_DURATION} max={MAX_DURATION} className={field} value={r.duration.value} disabled={r.kind.value === 'cut'} onChange={e => set({ duration: e.target.value.trim() === '' ? undefined : Number(e.target.value) })} data-testid={`transition-duration-${k}`} /></label>
                  </div>
                  <p className={sub}>{item.message}</p>
                </li>
              )
            })}
          </ul>
          <p className={sub} data-testid="transitions-footer">The transitions above are saved into the draft when you use “Save draft” below. Joins not listed stay hard cuts.</p>
        </>
      )}
    </section>
  )
}
