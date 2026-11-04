// M2.3b/c -- presentational review panel for the background and the stacking order. No state, no I/O: the container owns both. It shows what was MEASURED on the reference's stills,
// lets the person include a plate or change its colour, and choose a stacking policy. Business language only; nothing here claims a background was recovered, removed or repainted.
import { Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { LIMITATIONS, VARIANCE_LABEL } from './contract'
import { reachFlag, type PlateCandidate } from './candidates'
import { clearSize, type SceneFootage } from './footageReach'
import { MIN_PLATE } from './contract'
import { DEFAULT_CANVAS } from '../textlayers/geometry'
import { BUCKET_LABEL, POLICY_LABEL, POLICY_RULES, layersByScene, type CompositionPlan, type OrderPolicy } from './composition'
import type { PlateCorrections } from './corrections'
import { resolvePlate } from './corrections'
import type { BackgroundEvidence } from './evidence'
import type { BackgroundPlan } from './materialize'
import { canvasColourChange, type CanvasColourOption } from './canvasColour'

const box = 'rounded-xl border bg-card p-4'
const sub = 'text-xs text-muted-foreground'

export type ReviewState = { kind: 'loading'; done?: number } | { kind: 'error'; message: string } | { kind: 'no_frames' } | { kind: 'ready' }

export interface BackgroundReviewViewProps {
  state: ReviewState
  evidence: BackgroundEvidence | null
  candidates: readonly PlateCandidate[]
  corrections: PlateCorrections
  plan: BackgroundPlan
  policy: OrderPolicy
  composition: CompositionPlan
  /** The draft's scenes, to group the generated layers by scene. */
  scenes: readonly { sceneNumber: number; startTime: number; endTime: number }[]
  /** What each scene's assigned clips are, so a size you set is checked against your footage too. */
  footage?: SceneFootage
  onCorrect: (id: string, patch: { include?: boolean; color?: string; size?: number; offset?: number; behindFootage?: boolean }) => void
  onPolicy: (p: OrderPolicy) => void
  /** Optional canvas colour: the distinct bar colours on offer, the one chosen (or null), and the setter. Absent = the control is not shown. */
  colourOptions?: readonly CanvasColourOption[]
  canvasColour?: string | null
  onCanvasColour?: (c: string | null) => void
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`

export function BackgroundReviewView(p: BackgroundReviewViewProps) {
  const { state, evidence, candidates, plan } = p
  const status = new Map(plan.items.map(i => [i.candidateId, i] as const))
  const c = plan.record.counts
  const scenesWithout = evidence ? evidence.scenes.filter(s => s.bars.length === 0) : []
  return (
    <section className={`${box} space-y-3`} data-testid="background-review" aria-label="Rebuild the reference's background">
      <div>
        <h3 className="text-sm font-semibold">Rebuild the reference’s background bars <Badge variant="outline">Preview</Badge></h3>
        <p className={sub}>Reads the colour of any flat band along the edges of the reference’s stills (such as a letterbox bar) and offers a matching, editable block for each, then lets you choose how the generated layers stack.</p>
      </div>
      <div role="note" data-testid="background-honesty" className="rounded-lg border bg-muted/40 px-3 py-2 text-xs">
        <strong>What this does not do.</strong> {LIMITATIONS[0]} {LIMITATIONS[1]} {LIMITATIONS[3]}
      </div>

      {state.kind === 'loading' && <p className={`${sub} flex items-center gap-2`} role="status"><Loader2 className="h-3.5 w-3.5 animate-spin" />Reading the stills…</p>}
      {state.kind === 'error' && <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs" data-testid="background-error">{state.message}</div>}
      {state.kind === 'no_frames' && <p className={sub} data-testid="background-none">The analysis has no stills for this reference, so there is nothing to measure.</p>}

      {state.kind === 'ready' && evidence && (
        <>
          <p className="text-xs" data-testid="background-summary">
            <strong>{c.measured}</strong> measured {candidates.some(x => x.part) ? (c.measured === 1 ? 'bar or gradient step' : 'bars and gradient steps') : (c.measured === 1 ? 'bar' : 'bars')} on {evidence.frameCount} {evidence.frameCount === 1 ? 'still' : 'stills'} · <strong>{c.included}</strong> will be added · {c.excluded} left out
            {evidence.scenes.some(s => s.framesUnreadable > 0) && <> · {evidence.scenes.reduce((n, s) => n + s.framesUnreadable, 0)} stills could not be read</>}
          </p>
          {(() => {
            const hiding = candidates.filter(cd => { const r = resolvePlate(cd, p.corrections[cd.id]); return r.include && reachFlag(cd.side, r.size.value, p.footage?.[cd.sceneNumber], DEFAULT_CANVAS, r.offset.value)?.code === 'footage_overlap' })
            return hiding.length > 0 ? (
              <p role="alert" className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300" data-testid="background-obscure-summary">
                <strong>{hiding.length}</strong> {hiding.length === 1 ? 'bar you have included may' : 'bars you have included may'} cover your footage (scene{hiding.length === 1 ? '' : 's'} {[...new Set(hiding.map(h => h.sceneNumber))].join(', ')}). A bar is drawn on top of the footage: shrink it, move it, leave it out, or use its colour as the canvas colour.
              </p>
            ) : null
          })()}
          {candidates.length === 0 && <p className={sub} data-testid="background-no-bars">No flat bar was measured in any scene, so no plate is offered. Nothing was invented.</p>}
          <ul className="space-y-2" data-testid="background-list">
            {candidates.map(cd => {
              const r = resolvePlate(cd, p.corrections[cd.id])
              const st = status.get(cd.id)
              return (
                <li key={cd.id} className="rounded-lg border p-3 text-xs space-y-1" data-testid="background-item" data-candidate={cd.id}>
                  <label className="flex items-center gap-2 font-medium">
                    <input type="checkbox" checked={r.include} onChange={e => p.onCorrect(cd.id, { include: e.target.checked })} data-testid="background-include" />
                    Scene {cd.sceneNumber}: {cd.side} {cd.part ? (cd.part === 'outer' ? 'gradient, outer step' : 'gradient, inner step') : 'bar'}, {pct(cd.size)} of the {cd.side === 'top' || cd.side === 'bottom' ? 'height' : 'width'}
                    <span className="inline-block h-4 w-4 rounded border" style={{ background: r.color.value }} aria-label={`colour ${r.color.value}`} />
                    <code>{r.color.value}</code>
                    <Badge variant="outline">{r.corrected.includes('color') ? 'Set by you' : 'Measured'}</Badge>
                    {(() => { const f = reachFlag(cd.side, r.size.value, p.footage?.[cd.sceneNumber], DEFAULT_CANVAS, r.offset.value); return !r.behind && f?.code === 'footage_overlap' ? <Badge variant="warning" data-testid="background-obscure-badge">May cover your footage</Badge> : null })()}
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={sub}>Measured on {cd.framesSeen} of {cd.framesMeasured} {cd.framesMeasured === 1 ? 'still' : 'stills'} · flatness {(cd.uniformity * 100).toFixed(0)}% · {cd.variance ? VARIANCE_LABEL[cd.variance] : ''}</span>
                    <label className={`${sub} flex items-center gap-1`}>Colour <input type="color" value={r.color.value} onChange={e => p.onCorrect(cd.id, { color: e.target.value })} data-testid="background-colour" /></label>
                    <label className={`${sub} flex items-center gap-1`}>Size
                      <input key={`${cd.id}:${r.size.value}`} type="number" min={3} max={45} step={0.5} defaultValue={+(r.size.value * 100).toFixed(1)} data-testid="background-size" className="h-6 w-16 rounded border bg-background px-1 text-xs"
                        onBlur={e => { const v = Number(e.currentTarget.value) / 100; if (Number.isFinite(v) && Math.abs(v - r.size.value) > 1e-6) p.onCorrect(cd.id, { size: v }) }}
                        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} />
                      % of the {cd.side === 'top' || cd.side === 'bottom' ? 'height' : 'width'} <Badge variant="outline">{r.corrected.includes('size') ? 'Size set by you' : 'Size measured'}</Badge>
                    </label>
                    <label className={`${sub} flex items-center gap-1`}>Distance from the {cd.side} edge
                      <input key={`${cd.id}:off:${r.offset.value}`} type="number" min={0} max={50} step={0.5} defaultValue={+(r.offset.value * 100).toFixed(1)} data-testid="background-offset" className="h-6 w-16 rounded border bg-background px-1 text-xs"
                        onBlur={e => { const v = Number(e.currentTarget.value) / 100; if (Number.isFinite(v) && Math.abs(v - r.offset.value) > 1e-6) p.onCorrect(cd.id, { offset: v }) }}
                        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} />
                      % <Badge variant="outline">{r.corrected.includes('offset') ? 'Position set by you' : 'Position measured'}</Badge>
                    </label>
                    <label className={`${sub} flex items-center gap-1`} title="The bar shows only around your video, never over it. If your video fills the whole frame, there is nothing to show.">
                      <input type="checkbox" checked={r.behind} onChange={e => p.onCorrect(cd.id, { behindFootage: e.target.checked })} data-testid="background-behind" />
                      Place behind footage {r.behind && <Badge variant="outline">Set by you</Badge>}
                    </label>
                    {p.corrections[cd.id]?.offset !== undefined && <button type="button" className="rounded-md border px-2 py-0.5 text-xs hover:bg-muted" onClick={() => p.onCorrect(cd.id, { offset: undefined })} data-testid="background-offset-reset">Use the measured position</button>}
                    {p.corrections[cd.id]?.size !== undefined && <button type="button" className="rounded-md border px-2 py-0.5 text-xs hover:bg-muted" onClick={() => p.onCorrect(cd.id, { size: undefined })}>Use the measured size</button>}
                    {p.corrections[cd.id]?.color && <button type="button" className="rounded-md border px-2 py-0.5 text-xs hover:bg-muted" onClick={() => p.onCorrect(cd.id, { color: undefined })}>Use the measured colour</button>}
                  </div>
                  {cd.flags.filter(f => !(r.behind && f.code === 'footage_overlap')).map(f => <p key={f.code} className={f.severity === 'warning' ? 'text-amber-700 dark:text-amber-400' : sub} data-testid="background-flag">{f.message}</p>)}
                  {(r.corrected.includes('size') || r.corrected.includes('offset')) && (() => { const f = reachFlag(cd.side, r.size.value, p.footage?.[cd.sceneNumber], DEFAULT_CANVAS, r.offset.value); return !r.behind && f?.code === 'footage_overlap' ? <p className="text-amber-700 dark:text-amber-400" data-testid="background-flag-size">{r.corrected.includes('offset') ? 'At the size and position you set' : 'At the size you set'}: {f.message}</p> : null })()}
                  {(() => {
                    const f = reachFlag(cd.side, r.size.value, p.footage?.[cd.sceneNumber], DEFAULT_CANVAS, r.offset.value)
                    if (r.behind || f?.code !== 'footage_overlap') return null
                    const room = clearSize(cd.side, r.offset.value, p.footage?.[cd.sceneNumber], DEFAULT_CANVAS)
                    return room !== null && room >= MIN_PLATE
                      ? <button type="button" className="rounded-md border px-2 py-0.5 text-xs hover:bg-muted" onClick={() => p.onCorrect(cd.id, { size: room })} data-testid="background-clear">Shrink to {(room * 100).toFixed(1)}% so it clears your footage</button>
                      : <p className={sub} data-testid="background-clear-none">Your footage fills this part of the canvas, so no bar here can sit clear of it: leave it out, or use its colour as the canvas colour.</p>
                  })()}
                  {r.behind && <p className={sub} data-testid="background-behind-note">Behind your footage: this bar shows only around your video and never covers it. Where your video fills the whole frame it will not be visible. You can untick this later in the editor (“Behind footage” on the shape).{r.include ? '' : ' It is only added once you tick the bar above.'}</p>}
                  {st && <p className={sub} data-testid="background-status">{st.message}</p>}
                </li>
              )
            })}
          </ul>
          {scenesWithout.length > 0 && candidates.length > 0 && (
            <p className={sub} data-testid="background-scenes-without">No flat bar measured in scene{scenesWithout.length === 1 ? '' : 's'} {scenesWithout.map(s => s.sceneNumber).join(', ')}.</p>
          )}
        </>
      )}

      {p.onCanvasColour && p.colourOptions && p.colourOptions.length > 0 && (() => {
        const change = canvasColourChange(p.canvasColour ?? null)
        return (
          <fieldset className="space-y-1 border-t pt-3 text-xs" data-testid="canvas-colour">
            <legend className="font-semibold">Canvas colour (optional)</legend>
            <p className={sub}>Use one of the measured bar colours as the editor’s canvas background — the colour behind a letterboxed video and in gaps. Nothing is changed unless you choose a colour here.</p>
            <label className="flex flex-wrap items-center gap-2">
              <select value={p.canvasColour ?? ''} onChange={e => p.onCanvasColour!(e.target.value || null)} data-testid="canvas-colour-select" className="h-7 rounded border bg-background px-1 text-xs">
                <option value="">Don’t change the canvas colour</option>
                {p.colourOptions.map(o => <option key={o.colour} value={o.colour}>{o.colour} — {o.bars.join(', ')}</option>)}
              </select>
              {p.canvasColour && <span className="inline-block h-4 w-4 rounded border" style={{ background: p.canvasColour }} aria-label={`canvas colour ${p.canvasColour}`} />}
            </label>
            <div data-testid="canvas-colour-change" className="rounded-lg border bg-muted/40 px-3 py-2">
              <p className="font-medium">{change.changes.length ? 'What will change' : 'Nothing will change'}</p>
              {change.changes.map(t => <p key={t} data-testid="canvas-colour-will-change">{t}</p>)}
              <p className="mt-1 font-medium">What stays as it is</p>
              <ul className="ml-4 list-disc">{change.unchanged.map(t => <li key={t}>{t}</li>)}</ul>
              {p.canvasColour && <p className={`${sub} mt-1`}>A bar you left included above is still added as a layer on top of your footage; untick it if you only want the colour behind it.</p>}
            </div>
          </fieldset>
        )
      })()}

      <fieldset className="space-y-1 border-t pt-3 text-xs" data-testid="composition-policy">
        <legend className="font-semibold">Stacking order of the layers generated here</legend>
        {(['as_generated', 'recommended'] as OrderPolicy[]).map(k => (
          <label key={k} className="flex items-start gap-2">
            <input type="radio" name="bg-policy" checked={p.policy === k} onChange={() => p.onPolicy(k)} data-testid={`composition-${k}`} />
            <span><strong>{POLICY_LABEL[k]}</strong> <span className={sub}>{POLICY_RULES[k].join(' ')}</span></span>
          </label>
        ))}
        <p className={sub} data-testid="composition-summary">
          {p.policy === 'as_generated' ? 'Nothing is reordered.' : p.composition.changes.length === 0 ? 'Nothing needs reordering with the layers approved so far.' : `${p.composition.changes.length} generated ${p.composition.changes.length === 1 ? 'layer' : 'layers'} will get an explicit stacking position when the draft is saved. You can still reorder anything in the editor afterwards.`}
          {p.composition.layers.length > 0 && <> Generated so far: {(['recovered', 'inferred', 'manual'] as const).map(b => `${p.composition.layers.filter(l => l.bucket === b).length} ${BUCKET_LABEL[b].toLowerCase()}`).join(', ')}.</>}
        </p>
      </fieldset>

      {(() => {
        const groups = layersByScene(p.composition, p.scenes)
        if (groups.length === 0) return null
        return (
          <div className="space-y-2 border-t pt-3 text-xs" data-testid="composition-by-scene">
            <h4 className="font-semibold">Generated layers by scene <span className={sub}>(bottom to top; “from → to” is the stacking position the policy above will write)</span></h4>
            {groups.map(g => (
              <div key={g.sceneNumber} data-testid="composition-scene" data-scene={g.sceneNumber}>
                <p className="font-medium">Scene {g.sceneNumber} <span className={sub}>{g.startTime.toFixed(1)}–{g.endTime.toFixed(1)} s</span></p>
                <ul className="ml-3 space-y-0.5">
                  {g.rows.map(row => (
                    <li key={row.id} data-testid="composition-row" data-moved={row.moved ? 'yes' : 'no'}>
                      {row.label} <Badge variant="outline">{BUCKET_LABEL[row.bucket]}</Badge>
                      <span className={sub}> {row.startTime?.toFixed(1)}–{row.endTime?.toFixed(1)} s · stacking {row.moved ? `${row.before} → ${row.after}` : row.after}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )
      })()}
    </section>
  )
}
