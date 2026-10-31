// M2.2a -- presentational review panel for reconstructed images. No state, no I/O: the container owns both. It shows what the engine proposed, what the person
// changed and what they chose to put in each slot; it decides nothing itself. Business language only; nothing here claims anything was extracted,
// isolated or removed from the reference.
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { ImageFlag, Rect } from './contract'
import type { ImageCandidate } from './candidates'
import type { ImageCorrection, ResolvedImage, TimeMap } from './corrections'
import type { ImageEvidence } from './evidence'
import { FramePreview } from './FramePreview'
import type { PickedImage } from './imageFiles'
import type { ImageItemStatus, ImageLayerPlan, ImagePlanItem } from './materialize'

const box = 'rounded-xl border bg-card p-4'
const sub = 'text-xs text-muted-foreground'
const field = 'h-8 w-full rounded-md border bg-background px-2 text-xs'
const button = 'rounded-md border bg-background px-2 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50'

export type ReviewState = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'no_frames' } | { kind: 'ready' }

export interface ImageLayersReviewViewProps {
  state: ReviewState
  evidence: ImageEvidence | null
  candidates: readonly ImageCandidate[]
  resolved: readonly ResolvedImage[]
  plan: ImageLayerPlan
  corrections: Readonly<Record<string, ImageCorrection>>
  picks: Readonly<Record<string, PickedImage>>
  timeMap: TimeMap
  busy: boolean
  message: string | null
  /** The frame currently shown in the "Mark a region" picker (null = the first). */
  frameId: number | null
  frameUrl: (path: string) => string
  onPickFrame: (frameId: number) => void
  onCorrect: (id: string, patch: Partial<Record<keyof ImageCorrection, unknown>>) => void
  onTimeMode: (mode: TimeMap['mode']) => void
  onAddRegion: (frameId: number, region: Rect) => void
  onRemoveRegion: (id: string) => void
  onChooseFile: (id: string, file: File) => void
  onCrop: (id: string) => void
  onClearImage: (id: string) => void
  onApply: () => void
}

const STATUS: Record<ImageItemStatus, { label: string; variant: 'success' | 'warning' | 'destructive' | 'outline' }> = {
  included: { label: 'Will be added', variant: 'success' },
  ready_to_upload: { label: 'Ready to add', variant: 'warning' },
  needs_image: { label: 'Needs an image', variant: 'warning' },
  needs_rights: { label: 'Needs your confirmation', variant: 'warning' },
  crop_outdated: { label: 'Crop out of date', variant: 'warning' },
  excluded_default: { label: 'Left out by default', variant: 'outline' },
  excluded_user: { label: 'Left out', variant: 'outline' },
  duplicate: { label: 'Already represented', variant: 'outline' },
  outside_timeline: { label: 'After the draft ends', variant: 'warning' },
  invalid: { label: 'Cannot be used', variant: 'destructive' },
}

const FLAG_LABEL: Record<ImageFlag['code'], string> = {
  person_detected: 'Person', low_confidence: 'Low confidence', box_only: 'Box only', single_frame: 'Seen once', timing_inferred: 'Timing guessed', region_too_small: 'Too small', frame_size_assumed: 'Size not reported',
}

const RIGHTS: Record<string, string> = { unknown_third_party: 'someone else’s video (rights unknown)', owned: 'your own video', licensed: 'a licensed video' }
const secs = (n: number) => `${n.toFixed(n < 1 ? 2 : 1)}s`            // a frame at 0.15 s must not read as 0.1 s
const pct = (n: number | null) => (n === null ? '' : `${Math.round(n * 100)}% sure`)
const slug = (id: string) => id.replace(/[^a-z0-9]+/gi, '-')

function Banner({ children, testId }: { children: React.ReactNode; testId?: string }) {
  return <div role="note" data-testid={testId} className="flex gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-xs"><div className="min-w-0">{children}</div></div>
}

function Item({ r, item, props }: { r: ResolvedImage; item: ImagePlanItem; props: ImageLayersReviewViewProps }) {
  const c = r.candidate
  const id = c.id, k = slug(id)
  const set = (patch: Partial<Record<keyof ImageCorrection, unknown>>) => props.onCorrect(id, patch)
  const st = STATUS[item.status]
  const pick = props.picks[id]
  const uncertain = Math.max(c.timing.startUncertainty, c.timing.endUncertainty)
  const rightsLabel = RIGHTS[props.evidence?.rightsStatus ?? ''] ?? 'a video whose rights are not recorded'
  const num = (v: string) => (v.trim() === '' ? undefined : Number(v))
  const region = r.region.value
  const setRegion = (key: keyof Rect, v: string) => { const n = num(v); if (n !== undefined && Number.isFinite(n)) set({ region: { ...region, [key]: n / 100 } }) }
  const frame = c.frame
  return (
    <li className={`space-y-2 rounded-lg border p-3 ${r.include ? 'bg-muted/20' : 'bg-muted/5 opacity-90'}`} data-testid={`image-item-${k}`} data-status={item.status} data-candidate={id}>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-xs font-medium">
          <input type="checkbox" checked={r.include} onChange={e => set({ include: e.target.checked })} aria-label={`Use ${c.label} as an image layer`} data-testid={`image-include-${k}`} />
          Use as an image layer
        </label>
        <Badge variant={st.variant} data-testid={`image-status-${k}`}>{st.label}</Badge>
        {c.flags.filter(f => f.code !== 'frame_size_assumed').map(f => <Badge key={f.code} variant={f.severity === 'warning' ? 'warning' : 'outline'} title={f.message}>{FLAG_LABEL[f.code]}</Badge>)}
        {c.origin === 'user_region' && <button type="button" className={`${button} ml-auto`} onClick={() => props.onRemoveRegion(id)} data-testid={`image-remove-region-${k}`} aria-label="Remove this region"><Trash2 className="inline h-3 w-3" /> Remove region</button>}
      </div>

      <div className="flex gap-3">
        <FramePreview src={props.frameUrl(frame.path)} alt={`Reference frame at ${secs(frame.timestamp)}`} testId={`image-frame-${k}`} maxWidth={110}
          rects={[{ rect: region, kind: 'selected' }]} />
        <div className="min-w-0 flex-1 space-y-1">
          <p className={sub} data-testid={`image-evidence-${k}`}>
            {c.origin === 'detected_region'
              ? <>Detector label “{c.label.replace(' (detector label)', '')}” (item {c.evidence[0].id}) · {pct(c.sourceConfidence)} · one box on the frame at {secs(frame.timestamp)}</>
              : <>A region you marked on the frame at {secs(frame.timestamp)}</>}
          </p>
          <p className={sub}>Only a rectangle is known. Nothing in the reference has been cut out or separated from its background.</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="space-y-1"><span className={sub}>Starts (s)</span>
          <input type="number" step="0.1" min="0" className={field} value={r.start.value} onChange={e => set({ start: num(e.target.value) })} data-testid={`image-start-${k}`} /></label>
        <label className="space-y-1"><span className={sub}>Ends (s)</span>
          <input type="number" step="0.1" min="0" className={field} value={r.end.value} onChange={e => set({ end: num(e.target.value) })} data-testid={`image-end-${k}`} /></label>
        <div className="col-span-2 flex items-end">
          <button type="button" className={button} data-testid={`image-whole-scene-${k}`}
            onClick={() => set({ start: round(c.timing.shotStart * props.timeMap.factor), end: round(c.timing.shotEnd * props.timeMap.factor) })}>Show for the whole scene</button>
        </div>
      </div>
      <p className={sub}>Timing is a guess between sampled frames: it could be off by up to about {uncertain.toFixed(1)} s, and one sighting does not say how long it stayed.</p>

      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground">Region on the frame</summary>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(['x', 'y', 'w', 'h'] as const).map(key => (
            <label key={key} className="space-y-1"><span className={sub}>{key === 'x' ? 'Left' : key === 'y' ? 'Top' : key === 'w' ? 'Width' : 'Height'} (%)</span>
              <input type="number" step="0.5" className={field} value={Math.round(region[key] * 1000) / 10} onChange={e => setRegion(key, e.target.value)} data-testid={`image-region-${key}-${k}`} /></label>
          ))}
        </div>
      </details>

      <div className="space-y-2 rounded-lg border bg-background/60 p-2" data-testid={`image-source-${k}`}>
        {pick ? (
          <div className="flex items-center gap-3">
            <div className="flex h-14 w-20 shrink-0 items-center justify-center overflow-hidden rounded border" style={{ backgroundImage: 'repeating-conic-gradient(#e5e7eb 0% 25%, #fff 0% 50%)', backgroundSize: '12px 12px' }}>
              <img src={pick.previewUrl} alt="" className="max-h-full max-w-full" data-testid={`image-thumb-${k}`} />
            </div>
            <div className="min-w-0 flex-1 text-xs">
              <p className="truncate font-medium" data-testid={`image-name-${k}`}>{pick.fileName}</p>
              <p className={sub}>{pick.width}×{pick.height}px · {pick.source === 'user_upload' ? 'your image' : 'rectangular crop of the reference frame'}{pick.hasAlpha === true ? ' · has transparency' : pick.hasAlpha === false ? ' · no transparency' : ''}
                {item.scale !== undefined && <> · drawn {item.scale.toFixed(2)}× its size{pick.source === 'reference_frame_crop' && item.scale > 1.5 ? ' (it will look soft)' : ''}</>}</p>
            </div>
            <button type="button" className={button} onClick={() => props.onClearImage(id)} data-testid={`image-clear-${k}`}>Remove image</button>
          </div>
        ) : <p className={sub}>No image chosen yet.</p>}
        <div className="flex flex-wrap items-center gap-2">
          <label className={`${button} cursor-pointer`}>
            {pick?.source === 'user_upload' ? 'Choose a different image' : 'Choose your image'}
            <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" data-testid={`image-file-${k}`}
              onChange={e => { const f = e.target.files?.[0]; if (f) props.onChooseFile(id, f); e.target.value = '' }} />
          </label>
          <span className={sub}>PNG (transparent works), JPG or WebP</span>
        </div>
        <details className="text-xs" data-testid={`image-crop-box-${k}`}>
          <summary className="cursor-pointer text-muted-foreground">Or use a crop of the reference frame</summary>
          <div className="mt-2 space-y-2">
            <p className={sub}>This copies a plain rectangle of the reference’s own low-resolution still, background included. It is not a cleaned-up or isolated image, and it is enlarged to fit, so it will look soft. The reference is {rightsLabel}.</p>
            <label className="flex items-start gap-2 text-xs font-medium">
              <input type="checkbox" checked={r.rightsAcknowledged} onChange={e => set({ rightsAcknowledged: e.target.checked ? true : undefined })} data-testid={`image-rights-${k}`} className="mt-0.5" />
              <span>I have the right to use this part of the reference video.</span>
            </label>
            <button type="button" className={button} disabled={!r.rightsAcknowledged || props.busy} onClick={() => props.onCrop(id)} data-testid={`image-crop-${k}`}>Crop this region</button>
          </div>
        </details>
      </div>

      {['needs_rights', 'crop_outdated', 'outside_timeline', 'invalid', 'duplicate'].includes(item.status) && (
        <div role="alert" className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs" data-testid={`image-note-${k}`}><AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" /><span>{item.message}</span></div>
      )}
      {item.status === 'excluded_default' && <p className={sub}>{item.message}</p>}
    </li>
  )
}
const round = (n: number) => Math.round(n * 1000) / 1000

export function ImageLayersReviewView(props: ImageLayersReviewViewProps) {
  const { state, resolved, plan, timeMap, evidence } = props
  const items = new Map(plan.items.map(i => [i.candidateId, i] as const))
  const c = plan.record.counts
  return (
    <section className={`${box} space-y-3`} data-testid="image-layers-review" aria-label="Rebuild the reference's images as editable layers">
      <div>
        <h3 className="text-sm font-semibold">Rebuild the reference’s images as editable layers <Badge variant="outline">Preview</Badge></h3>
        <p className={sub}>Mark where an image, logo or graphic stood in the reference and put your own picture there as a real image layer in Video Studio that you can move, resize, retime or delete.</p>
      </div>
      <Banner testId="image-layers-honesty">
        <strong>What this does not do.</strong> The reference is a flattened video: nothing is cut out, isolated or removed, and whatever stood in a region is still in its pixels.
        A detected region is only a labelled rectangle from a general object detector, not a logo finder. Your own image is the normal way to fill a slot; a crop of the reference is a plain,
        soft rectangle you must confirm you may use. People detected in the reference are left out unless you choose them.
      </Banner>

      {state.kind === 'loading' && <p className={`${sub} flex items-center gap-2`} role="status"><Loader2 className="h-3.5 w-3.5 animate-spin" />Reading the analysis…</p>}
      {state.kind === 'error' && <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs" data-testid="image-layers-error">{state.message}</div>}
      {state.kind === 'no_frames' && <p className={sub} data-testid="image-layers-empty">The analysis has no sampled frames for this reference yet, so there is nothing to mark a region on.</p>}

      {state.kind === 'ready' && evidence && (
        <>
          <MarkRegion props={props} />
          <p className="text-xs" data-testid="image-layers-summary">
            <strong>{c.detected}</strong> detected {c.detected === 1 ? 'region' : 'regions'} · <strong>{c.drawn}</strong> marked by you · <strong>{c.included}</strong> will be added
            {c.waitingForUpload > 0 && <> · <strong className="text-amber-700">{c.waitingForUpload} ready to add</strong></>}
            {c.waitingForDecision > 0 && <> · {c.waitingForDecision} need an image or a decision</>}
            {c.excluded > 0 && <> · {c.excluded} left out</>}
          </p>
          {timeMap.referenceSeconds !== null && Math.abs(timeMap.referenceSeconds - timeMap.planSeconds) > 0.01 * timeMap.planSeconds && (
            <fieldset className="flex flex-wrap items-center gap-3 text-xs" data-testid="image-timing-mode">
              <legend className="sr-only">How reference timing maps onto the draft</legend>
              <label className="flex items-center gap-1"><input type="radio" name="image-time-mode" checked={timeMap.mode === 'fit'} onChange={() => props.onTimeMode('fit')} />Fit to the blueprint length ({secs(timeMap.referenceSeconds)} → {secs(timeMap.planSeconds)})</label>
              <label className="flex items-center gap-1"><input type="radio" name="image-time-mode" checked={timeMap.mode === 'identity'} onChange={() => props.onTimeMode('identity')} />Keep the reference’s own seconds</label>
            </fieldset>
          )}
          {resolved.length === 0 && <p className={sub} data-testid="image-layers-none">Nothing was detected here. Drag on a frame above to mark where an image stood.</p>}
          <ul className="space-y-2">
            {resolved.map(r => <Item key={r.candidate.id} r={r} item={items.get(r.candidate.id)!} props={props} />)}
          </ul>
          <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2 text-xs" data-testid="image-layers-apply">
            <span className="min-w-0 flex-1">
              {c.waitingForUpload > 0
                ? <><strong>{c.waitingForUpload}</strong> {c.waitingForUpload === 1 ? 'image is' : 'images are'} not in your library yet and will <strong>not</strong> be in the saved draft until you add {c.waitingForUpload === 1 ? 'it' : 'them'}.</>
                : c.included > 0 ? <>{c.included} image {c.included === 1 ? 'layer is' : 'layers are'} saved into the draft when you use “Save draft” below.</> : <>Nothing is uploaded until you add images here.</>}
            </span>
            <button type="button" className={button} disabled={c.waitingForUpload === 0 || props.busy} onClick={props.onApply} data-testid="image-apply">
              {props.busy ? 'Adding…' : `Add ${c.waitingForUpload || ''} ${c.waitingForUpload === 1 ? 'image' : 'images'} to the draft`.replace('  ', ' ')}
            </button>
          </div>
          {props.message && <p role="status" className="text-xs text-amber-700" data-testid="image-layers-message">{props.message}</p>}
        </>
      )}
    </section>
  )
}

// ── mark a region on a frame ─────────────────────────────────────────────────────────────

function MarkRegion({ props }: { props: ImageLayersReviewViewProps }) {
  const frames = props.evidence!.frames
  const sel = props.frameId ?? frames[0].id
  const frame = frames.find(f => f.id === sel) ?? frames[0]
  return (
    <div className="space-y-2 rounded-lg border p-3" data-testid="image-mark-region">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <strong>Mark a region</strong>
        <label className="flex items-center gap-1"><span className={sub}>Frame</span>
          <select className="h-8 rounded-md border bg-background px-2 text-xs" value={frame.id} onChange={e => props.onPickFrame(Number(e.target.value))} data-testid="image-frame-select">
            {frames.map(f => <option key={f.id} value={f.id}>{secs(f.timestamp)}</option>)}
          </select></label>
        <span className={sub}>Drag on the frame over the place where an image, logo or graphic stood.</span>
      </div>
      <FramePreview src={props.frameUrl(frame.path)} alt={`Reference frame at ${secs(frame.timestamp)}`} testId="image-mark-frame" maxWidth={260} onDraw={r => props.onAddRegion(frame.id, r)}
        rects={props.resolved.filter(r => r.candidate.frame.id === frame.id).map(r => ({ rect: r.region.value, kind: r.candidate.origin === 'user_region' ? 'drawn' as const : 'detected' as const }))} />
    </div>
  )
}
