// M4 + M5 -- "What was found on screen" review panel (preview, flag ?m2=visual). Reads the reference once (the existing GET endpoint), builds the visual elements (M4: class, confidence, reasons, evidence, readiness),
// lets a person correct a class, and shows what became of each element in the draft (M5: faithful / approximate / your own content / needs your image / not included / unsupported). Nothing here detects anything new,
// writes to the analysis, calls an AI provider or touches the editor; the account it builds leaves through `onElementPlan` and is saved by the existing draft save as one extra record.
import { useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { referenceVideosApi } from '../../../api/client'
import type { ReferenceVideo } from '../../../types'
import type { BlueprintPlan } from '../../video-studio-v2/blueprint/blueprintPlan'
import { STALE_ANALYSIS_MESSAGE } from '../textlayers/loadEvidence'
import { errorMessage } from '../useDeconstructor'
import { planElementReconstruction, STATUS_LABEL, type ElementReconstructionPlan, type GeneratedLayers, type ReconstructionStatus } from '../reconstruction'
import { buildVisualElements, type BarEvidence } from './build'
import type { ManualRegion } from '../imagelayers/candidates'
import { manualRegionFromElement } from '../reconstruction'
import { CLASS_LABEL, type ClassCorrections, type VisualClass, type VisualElement } from './contract'

const defaultNow = () => new Date()
const defaultGetReference = async (id: number) => (await referenceVideosApi.get(id)).data as ReferenceVideo
const box = 'rounded-xl border bg-card p-4'
const sub = 'text-xs text-muted-foreground'
const ALL_CLASSES = Object.keys(CLASS_LABEL) as VisualClass[]
const secs = (n: number) => `${n.toFixed(1)}s`
const STATUS_VARIANT: Record<ReconstructionStatus, 'outline' | 'warning' | 'default'> = { faithful: 'default', approximate: 'outline', user_supplied: 'default', placeholder: 'warning', missing_asset: 'warning', not_included: 'outline', unsupported: 'warning' }

export interface VisualElementsReviewProps {
  plan: BlueprintPlan
  /** The layers the other panels have approved so far, so the account reflects the real draft. */
  generated: GeneratedLayers
  onElementPlan: (plan: ElementReconstructionPlan | null) => void
  /** Background bars as measured on the stills (from the background panel), so they appear here with their evidence. Absent = none shown. */
  background?: readonly BarEvidence[]
  /** Receives the image slots a person asked for from elements they classified as a logo or graphic. */
  onSlotRegions?: (regions: ManualRegion[]) => void
  /** Whether the image panel is on (the slots live there). */
  imagePanelOn?: boolean
  getReference?: (id: number) => Promise<ReferenceVideo>
  now?: () => Date
}

type State = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; ref: ReferenceVideo }

const GRAPHICAL: readonly VisualClass[] = ['LOGO_MARK', 'ICON_GRAPHIC']
const pctBox = (b: { x: number; y: number; w: number; h: number }) => `at ${Math.round(b.x * 100)}%, ${Math.round(b.y * 100)}% · ${Math.round(b.w * 100)}% × ${Math.round(b.h * 100)}% of the frame`

export function VisualElementsReview({ plan, generated, onElementPlan, background, onSlotRegions, imagePanelOn, getReference = defaultGetReference, now = defaultNow }: VisualElementsReviewProps) {
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [corrections, setCorrections] = useState<ClassCorrections>({})
  const [slotFor, setSlotFor] = useState<ReadonlySet<string>>(new Set())
  const key = `${plan.referenceVideoId}:${plan.videoAnalysisId}`
  useEffect(() => {
    let cancelled = false
    setState({ kind: 'loading' }); setCorrections({})
    void (async () => {
      try {
        const ref = await getReference(plan.referenceVideoId)
        if (cancelled) return
        if (ref.latest_analysis && ref.latest_analysis.id !== plan.videoAnalysisId) setState({ kind: 'error', message: STALE_ANALYSIS_MESSAGE.replace('its text no longer matches', 'what it found no longer matches') })
        else setState({ kind: 'ready', ref })
      } catch (e) { if (!cancelled) setState({ kind: 'error', message: `Could not read the reference. ${errorMessage(e, 'Please try again.')}` }) }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const elements = useMemo<VisualElement[]>(() => (state.kind === 'ready' ? buildVisualElements(state.ref, { videoAnalysisId: plan.videoAnalysisId, corrections, background }) : []), [state, plan.videoAnalysisId, corrections, background])
  // image slots a person asked for: only from a class THEY set (logo or icon), prefilled with the analysis's own box; the image must be theirs
  const regions = useMemo(() => elements.filter(e => e.classification.basis === 'user' && GRAPHICAL.includes(e.classification.class) && slotFor.has(e.id)).flatMap(e => {
    const r = manualRegionFromElement(e)
    return r ? [{ ...r, source: { elementId: e.id, classLabel: CLASS_LABEL[e.classification.class], summary: e.text ? e.text.best.slice(0, 40) : e.detectorLabel ?? e.id, evidence: e.classification.evidence.filter(x => x.kind !== 'user_correction').map(x => ({ kind: x.kind, id: x.id, certainty: x.certainty })) } }] : []
  }), [elements, slotFor])
  useEffect(() => { onSlotRegions?.(regions) }, [regions, onSlotRegions])
  useEffect(() => () => onSlotRegions?.([]), [onSlotRegions])
  const account = useMemo(() => (elements.length ? planElementReconstruction(elements, generated, { referenceVideoId: plan.referenceVideoId, videoAnalysisId: plan.videoAnalysisId, createdAt: now().toISOString() }) : null), [elements, generated, plan.referenceVideoId, plan.videoAnalysisId, now])
  useEffect(() => { onElementPlan(account) }, [account, onElementPlan])
  useEffect(() => () => onElementPlan(null), [onElementPlan])

  const byId = new Map((account?.items ?? []).map(i => [i.elementId, i] as const))
  const counts = account?.record.counts
  return (
    <section className={`${box} space-y-3`} data-testid="visual-elements-review" aria-label="What was found on screen">
      <div>
        <h3 className="text-sm font-semibold">What was found on screen, and what became of it <Badge variant="outline">Preview</Badge></h3>
        <p className={sub}>Groups the text and boxes the analysis already found into elements, says what each most likely is and why, and what could be rebuilt. These are judgments from a few small stills, not visual recognition; a class you set yourself is the only statement of fact.</p>
      </div>
      <div role="note" data-testid="visual-honesty" className="rounded-lg border bg-muted/40 px-3 py-2 text-xs">
        <strong>What this does not do.</strong> It never decides that text is a logo, never recovers the reference’s own pictures or fonts, and never inserts the reference’s footage. A person in the footage is not a graphic.
      </div>
      {state.kind === 'loading' && <p className={`${sub} flex items-center gap-2`} role="status"><Loader2 className="h-3.5 w-3.5 animate-spin" />Reading what the analysis found…</p>}
      {state.kind === 'error' && <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs" data-testid="visual-error">{state.message}</div>}
      {state.kind === 'ready' && elements.length === 0 && <p className={sub} data-testid="visual-none">The analysis has no text or detected objects to work from.</p>}
      {state.kind === 'ready' && counts && (
        <>
          <p className="text-xs" data-testid="visual-summary">
            <strong>{counts.elements}</strong> elements · {(Object.keys(STATUS_LABEL) as ReconstructionStatus[]).filter(s => counts[s] > 0).map(s => `${counts[s]} ${STATUS_LABEL[s].toLowerCase()}`).join(' · ')}
          </p>
          <ul className="space-y-2" data-testid="visual-list">
            {elements.map(e => {
              const item = byId.get(e.id)
              const c = e.classification
              return (
                <li key={e.id} className="rounded-lg border p-3 text-xs space-y-1" data-testid="visual-item" data-element={e.id} data-class={c.class} data-status={item?.status ?? ''} data-readiness={e.readiness.state}>
                  <div className="flex flex-wrap items-center gap-2">
                    <strong>{CLASS_LABEL[c.class]}</strong>
                    <Badge variant="outline" data-testid="visual-confidence">{c.basis === 'user' ? 'Set by you' : `${c.confidence.level} confidence (${Math.round(c.confidence.score * 100)}%)`}</Badge>
                    {item && <Badge variant={STATUS_VARIANT[item.status]} data-testid="visual-status">{STATUS_LABEL[item.status]}</Badge>}
                    <span className={sub}>{pctBox(e.box)} · {secs(e.first)}–{secs(e.last)} · {e.track.movement.kind.replace('_', ' ')} · {e.track.observations.length} sighting{e.track.observations.length === 1 ? '' : 's'}{e.track.linkage.crossesShotBoundary ? ' · across shots' : ''}</span>
                    <label className={`${sub} ml-auto flex items-center gap-1`}>Class
                      <select className="h-6 rounded border bg-background px-1 text-xs" value={c.class} data-testid="visual-class" onChange={ev => { setCorrections(cs => ({ ...cs, [e.id]: { class: ev.target.value as VisualClass } })); setSlotFor(s => { const n = new Set(s); n.delete(e.id); return n }) }}>
                        {ALL_CLASSES.map(k => <option key={k} value={k}>{CLASS_LABEL[k]}</option>)}
                      </select>
                    </label>
                    {corrections[e.id] && <button type="button" className="rounded-md border px-2 py-0.5 text-xs hover:bg-muted" onClick={() => setCorrections(cs => { const { [e.id]: _drop, ...rest } = cs; return rest })} data-testid="visual-class-reset">Use the analysis’s class</button>}
                  </div>
                  {e.classification.basis === 'user' && GRAPHICAL.includes(e.classification.class) && (
                    <div className="rounded-md border bg-muted/40 px-2 py-1.5" data-testid="visual-slot-offer">
                      <p>You classified this as {CLASS_LABEL[e.classification.class].toLowerCase()}. That is your statement: the analysis only saw {e.text ? 'its text' : 'a box'} here and cannot tell what the mark looks like, so an image slot needs <strong>your own image</strong>.</p>
                      {!imagePanelOn ? <p className={sub} data-testid="visual-slot-needs-panel">Turn on the image panel (add <code>image-layers</code> to the m2 flags) to fill a slot.</p>
                        : <button type="button" className="mt-1 rounded-md border px-2 py-0.5 text-xs hover:bg-muted" data-testid="visual-slot-toggle" onClick={() => setSlotFor(s => { const n = new Set(s); if (n.has(e.id)) n.delete(e.id); else n.add(e.id); return n })}>{slotFor.has(e.id) ? 'Remove the image slot' : 'Add an image slot here'}</button>}
                      {slotFor.has(e.id) && imagePanelOn && <p className={sub} data-testid="visual-slot-added">Added in the images panel at this place. Choose your own image there.</p>}
                    </div>
                  )}
                  {e.text && <p>“{e.text.best.slice(0, 80)}”{e.text.readings.length > 1 ? <span className={sub}> ({e.text.readings.length} different readings)</span> : null}</p>}
                  {e.detectorLabel && <p className={sub}>Detector label “{e.detectorLabel}” (a box, not an outline)</p>}
                  <details>
                    <summary className="cursor-pointer text-muted-foreground">Why, and what could be rebuilt</summary>
                    <ul className="ml-4 mt-1 list-disc space-y-0.5" data-testid="visual-explanation">{c.explanation.map(t => <li key={t}>{t}</li>)}</ul>
                    <p className="mt-1 font-medium">Readiness: {e.readiness.state.replace(/_/g, ' ')}</p>
                    <ul className="ml-4 list-disc space-y-0.5">{[...e.readiness.reasons, ...e.readiness.limitations].map(t => <li key={t}>{t}</li>)}</ul>
                    <p className={`${sub} mt-1`}>Evidence: {c.evidence.map(x => `${x.kind.replace(/_/g, ' ')} ${x.id} (${x.certainty})`).join(', ') || 'none'}</p>
                    {item && item.layers.length > 0 && <p className={sub}>Layers in the draft: {item.layers.map(l => `${l.kind} ${l.id}`).join(', ')}</p>}
                  </details>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </section>
  )
}
