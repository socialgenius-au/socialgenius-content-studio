// M2.1a -- presentational review panel for reconstructed text. No state, no I/O: the container owns both. It shows what the engine proposed and what the
// person changed; it decides nothing itself. Business language only; nothing here claims the original text was removed or its font recovered.
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { Flag } from './contract'
import type { TextCandidate } from './candidates'
import type { Corrections, ResolvedText, TextCorrection, TimeMap } from './corrections'
import type { ItemStatus, PlanItem, TextLayerPlan } from './materialize'

const box = 'rounded-xl border bg-card p-4'
const sub = 'text-xs text-muted-foreground'
const field = 'h-8 w-full rounded-md border bg-background px-2 text-xs'

export type ReviewState = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'empty' } | { kind: 'ready' }

export interface TextLayersReviewViewProps {
  state: ReviewState
  candidates: readonly TextCandidate[]
  resolved: readonly ResolvedText[]
  plan: TextLayerPlan
  corrections: Corrections
  timeMap: TimeMap
  readingColours: boolean
  placeholdersLeft: number
  onCorrect: (id: string, patch: Partial<Record<keyof TextCorrection, unknown>>) => void
  onTimeMode: (mode: TimeMap['mode']) => void
  onReplaceAllBlocked: () => void
}

const STATUS: Record<ItemStatus, { label: string; variant: 'success' | 'warning' | 'destructive' | 'outline' }> = {
  included: { label: 'Will be added', variant: 'success' },
  excluded_default: { label: 'Left out by default', variant: 'outline' },
  excluded_user: { label: 'Left out', variant: 'outline' },
  blocked_conflict: { label: 'Needs a decision', variant: 'warning' },
  duplicate: { label: 'Already represented', variant: 'outline' },
  outside_timeline: { label: 'After the draft ends', variant: 'warning' },
  invalid: { label: 'Needs wording', variant: 'destructive' },
}

const FLAG_LABEL: Record<Flag['code'], string> = {
  low_confidence: 'Low confidence', fragment: 'Fragment', third_party_branding: 'Branding', timing_uncertain: 'Timing uncertain', alternate_readings: 'Other readings',
  colour_unknown: 'Colour not read', frame_size_assumed: 'Size assumed', single_observation: 'Seen once', duplicate_candidate: 'Duplicate', placeholder_conflict: 'Placeholder', outside_timeline: 'Outside', duplicate_of_existing: 'Duplicate',
}

const secs = (n: number) => `${n.toFixed(1)}s`
const pct = (n: number | null) => (n === null ? 'no confidence reported' : `${Math.round(n * 100)}% sure`)

function Banner({ children, testId }: { children: React.ReactNode; testId?: string }) {
  return <div role="note" data-testid={testId} className="flex gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-xs"><div className="min-w-0">{children}</div></div>
}

function Item({ r, item, props }: { r: ResolvedText; item: PlanItem; props: TextLayersReviewViewProps }) {
  const c = r.candidate
  const id = c.id
  const set = (patch: Partial<Record<keyof TextCorrection, unknown>>) => props.onCorrect(id, patch)
  const num = (v: string) => (v.trim() === '' ? undefined : Number(v))
  const st = STATUS[item.status]
  const uncertain = Math.max(c.timing.startUncertainty, c.timing.endUncertainty)
  const mapped = props.timeMap.mode === 'fit' ? ' (stretched to the blueprint length)' : ''
  return (
    <li className={`space-y-2 rounded-lg border p-3 ${r.include ? 'bg-muted/20' : 'bg-muted/5 opacity-90'}`} data-testid={`text-item-${c.group.id}`} data-status={item.status}>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-xs font-medium">
          <input type="checkbox" checked={r.include} onChange={e => set({ include: e.target.checked })} aria-label={`Use "${c.sourceText}" as an editable text layer`} data-testid={`text-include-${c.group.id}`} />
          Use as an editable text layer
        </label>
        <Badge variant={st.variant} data-testid={`text-status-${c.group.id}`}>{st.label}</Badge>
        {c.flags.filter(f => f.code !== 'frame_size_assumed').map(f => (
          <Badge key={f.code} variant={f.severity === 'warning' ? 'warning' : 'outline'} title={f.message}>{FLAG_LABEL[f.code]}</Badge>
        ))}
      </div>

      <p className={sub} data-testid={`text-evidence-${c.group.id}`}>
        Read by OCR (item {c.group.id}) · {pct(c.sourceConfidence)} · seen {c.group.observations.length || 1}× between {secs(c.timing.observedFirst)} and {secs(c.timing.observedLast)} in the reference
      </p>

      <label className="block space-y-1">
        <span className={sub}>Wording {r.text.basis === 'user' ? '(your edit)' : '(as read — check it)'}</span>
        <input className={field} value={r.text.value} onChange={e => set({ text: e.target.value })} data-testid={`text-wording-${c.group.id}`} />
      </label>
      {c.alternatives.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 text-xs" data-testid={`text-alternatives-${c.group.id}`}>
          <span className={sub}>Other readings:</span>
          {c.alternatives.map(a => (
            <button key={a.observationId} type="button" className="rounded border px-1.5 py-0.5 hover:bg-muted" onClick={() => set({ text: a.text })} title={pct(a.confidence)}>{a.text}</button>
          ))}
          {r.text.value !== c.sourceText && <button type="button" className="rounded border px-1.5 py-0.5 hover:bg-muted" onClick={() => set({ text: undefined })}>Back to what was read</button>}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="space-y-1"><span className={sub}>Starts (s)</span>
          <input type="number" step="0.1" min="0" className={field} value={r.start.value} onChange={e => set({ start: num(e.target.value) })} data-testid={`text-start-${c.group.id}`} /></label>
        <label className="space-y-1"><span className={sub}>Ends (s)</span>
          <input type="number" step="0.1" min="0" className={field} value={r.end.value} onChange={e => set({ end: num(e.target.value) })} data-testid={`text-end-${c.group.id}`} /></label>
        <label className="space-y-1"><span className={sub}>Text colour</span>
          <span className="flex items-center gap-1"><input type="color" className="h-8 w-9 rounded border bg-background" value={r.color.value} onChange={e => set({ color: e.target.value })} data-testid={`text-color-${c.group.id}`} aria-label="Text colour" />
            <span className={sub}>{r.color.basis === 'user' ? 'yours' : r.color.basis === 'default' ? 'default' : `estimated (${r.color.confidence})`}</span></span></label>
        <label className="space-y-1"><span className={sub}>Size</span>
          <input type="number" min="6" max="300" className={field} value={r.fontSize.value} onChange={e => set({ fontSize: num(e.target.value) })} data-testid={`text-size-${c.group.id}`} /></label>
      </div>
      <p className={sub}>Timing is a guess between sampled frames{mapped}: it could be off by up to about {uncertain.toFixed(1)} s. Size and position are estimated from the detected box.</p>

      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground">Position</summary>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {(['x', 'y', 'width'] as const).map(k => (
            <label key={k} className="space-y-1"><span className={sub}>{k === 'x' ? 'Left' : k === 'y' ? 'Top' : 'Width'} (%)</span>
              <input type="number" step="0.5" className={field} value={r[k].value} onChange={e => set({ [k]: num(e.target.value) })} data-testid={`text-${k}-${c.group.id}`} /></label>
          ))}
        </div>
      </details>

      {item.status === 'blocked_conflict' && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs" data-testid={`text-conflict-${c.group.id}`}>
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" />
          <span className="min-w-0 flex-1">{item.message}</span>
          <label className="flex items-center gap-1 font-medium"><input type="checkbox" checked={r.replacePlaceholder} onChange={e => set({ replacePlaceholder: e.target.checked })} data-testid={`text-replace-${c.group.id}`} />Replace the placeholder</label>
        </div>
      )}
      {item.status === 'included' && item.replaces && <p className="text-xs text-emerald-700" data-testid={`text-replaces-${c.group.id}`}>{item.message}</p>}
      {['duplicate', 'outside_timeline', 'invalid'].includes(item.status) && <p className="text-xs text-amber-700">{item.message}</p>}
      {item.status === 'excluded_default' && <p className={sub}>{item.message}</p>}
    </li>
  )
}

export function TextLayersReviewView(props: TextLayersReviewViewProps) {
  const { state, resolved, plan, timeMap } = props
  const items = new Map(plan.items.map(i => [i.candidateId, i] as const))
  const c = plan.record.counts
  return (
    <section className={`${box} space-y-3`} data-testid="text-layers-review" aria-label="Rebuild the reference's text as editable layers">
      <div>
        <h3 className="text-sm font-semibold">Rebuild the reference’s text as editable layers <Badge variant="outline">Preview</Badge></h3>
        <p className={sub}>Turns the text the analysis read in the reference into real text layers in Video Studio that you can reword, move, resize, restyle or delete.</p>
      </div>
      <Banner testId="text-layers-honesty">
        <strong>What this does not do.</strong> The original text stays burned into the reference video: nothing is removed or hidden. Fonts, outlines and shadows are not recovered —
        size, position, colour and timing are estimates from what the analysis saw. Handles, watermarks and other branding are left out unless you choose to include them.
      </Banner>

      {state.kind === 'loading' && <p className={`${sub} flex items-center gap-2`} role="status"><Loader2 className="h-3.5 w-3.5 animate-spin" />Reading the analysis…</p>}
      {state.kind === 'error' && <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs" data-testid="text-layers-error">{state.message}</div>}
      {state.kind === 'empty' && <p className={sub} data-testid="text-layers-empty">The analysis found no on-screen text in this reference, so there is nothing to rebuild.</p>}

      {state.kind === 'ready' && (
        <>
          <p className="text-xs" data-testid="text-layers-summary">
            <strong>{c.detected}</strong> text {c.detected === 1 ? 'item' : 'items'} found · <strong>{c.included}</strong> will be added · {c.excludedByDefault + c.excludedByUser} left out
            {c.blocked > 0 && <> · <strong className="text-amber-700">{c.blocked} need a decision</strong></>}
            {c.duplicates + c.outside + c.invalid > 0 && <> · {c.duplicates + c.outside + c.invalid} cannot be added as they are</>}
            {props.readingColours && <span className={`${sub} ml-2`}>(reading colours from the frames…)</span>}
          </p>
          {timeMap.referenceSeconds !== null && Math.abs(timeMap.referenceSeconds - timeMap.planSeconds) > 0.01 * timeMap.planSeconds && (
            <fieldset className="flex flex-wrap items-center gap-3 text-xs" data-testid="text-timing-mode">
              <legend className="sr-only">How reference timing maps onto the draft</legend>
              <label className="flex items-center gap-1"><input type="radio" name="text-time-mode" checked={timeMap.mode === 'fit'} onChange={() => props.onTimeMode('fit')} />Fit to the blueprint length ({secs(timeMap.referenceSeconds)} → {secs(timeMap.planSeconds)})</label>
              <label className="flex items-center gap-1"><input type="radio" name="text-time-mode" checked={timeMap.mode === 'identity'} onChange={() => props.onTimeMode('identity')} />Keep the reference’s own seconds</label>
            </fieldset>
          )}
          {c.blocked > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs" data-testid="text-replace-all">
              <span className="min-w-0 flex-1">{c.blocked} {c.blocked === 1 ? 'item sits' : 'items sit'} where a blueprint placeholder is. A captioned reference usually does this: its text is where the blueprint expects yours.</span>
              <button type="button" className="rounded-md border bg-background px-2 py-1 font-medium hover:bg-muted" onClick={props.onReplaceAllBlocked} data-testid="text-replace-all-button">Replace those placeholders</button>
            </div>
          )}
          <ul className="space-y-2">
            {resolved.map(r => <Item key={r.candidate.id} r={r} item={items.get(r.candidate.id)!} props={props} />)}
          </ul>
          <p className={sub} data-testid="text-layers-footer">
            {plan.removePlaceholderIds.length > 0 && <><CheckCircle2 className="mr-1 inline h-3 w-3 text-emerald-600" />{plan.removePlaceholderIds.length} placeholder{plan.removePlaceholderIds.length === 1 ? '' : 's'} will be replaced. </>}
            {props.placeholdersLeft > 0 && <>{props.placeholdersLeft} blueprint placeholder{props.placeholdersLeft === 1 ? '' : 's'} stay in the draft: replace or delete them in the editor before exporting. </>}
            The layers above are saved into the draft when you use “Save draft” below.
          </p>
        </>
      )}
    </section>
  )
}
