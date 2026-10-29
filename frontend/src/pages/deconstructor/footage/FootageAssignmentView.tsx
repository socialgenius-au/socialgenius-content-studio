// M1 / Stage 2 -- presentational Footage Assignment panel (rendered inside the existing "Create" step). No state, no I/O: the container owns both.
// Business language only. It shows what the Stage-1 engine decided; it decides nothing itself.
import { useRef } from 'react'
import { AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, Loader2, Trash2, Upload } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { Asset } from '../../../types'
import { ALLOWED_SPEEDS, ELEMENT_CLASSES, type Editability, type UnderfilledPolicy } from '../assembly'
import { fmtRange, fmtSeconds } from '../viewModel'
import { coverageHeadline, type AssemblyView, type ClipEdit, type LibraryEntry, type RowStatus, type SceneEdits } from './footageModel'

const box = 'rounded-xl border bg-card p-4'
const sub = 'text-xs text-muted-foreground'
const field = 'h-8 w-full rounded-md border bg-background px-2 text-xs'

const STATUS: Record<RowStatus, { label: string; variant: 'success' | 'warning' | 'destructive' | 'outline' }> = {
  filled: { label: 'Covered', variant: 'success' },
  partial: { label: 'Partly covered', variant: 'warning' },
  empty: { label: 'No footage yet', variant: 'outline' },
  invalid: { label: 'Needs attention', variant: 'destructive' },
  pending: { label: 'Waiting for a fix', variant: 'outline' },
}

const EDITABILITY: Record<Editability, { title: string; blurb: string }> = {
  automatic: { title: 'Rebuilt as editable elements', blurb: 'Real elements you can change in Video Studio.' },
  partial: { title: 'Partly editable — you finish these in the editor', blurb: 'Video Studio can hold them, but they are not generated for you.' },
  unsupported: { title: 'Not recreated', blurb: 'These are baked into the reference video’s pixels. They are never copied and never presented as editable.' },
}

export interface SavedInfo { draftId: number; name: string; clips: number; stale: boolean }

export interface FootageAssignmentViewProps {
  view: AssemblyView
  edits: SceneEdits
  library: ReadonlyMap<string, LibraryEntry>
  assets: Asset[]                                   // the person's videos, already in picker order
  referenceAssetIds: ReadonlySet<number>
  libraryLoading: boolean
  libraryError: string | null
  uploadError: string | null
  uploading: boolean
  underfilled: UnderfilledPolicy
  saved: SavedInfo | null
  saving: boolean
  saveMessage: string | null
  openMessage: string | null
  onUnderfilled: (p: UnderfilledPolicy) => void
  onUpload: (file: File) => void
  onAdd: (sceneNumber: number, assetId: number) => void
  onUpdate: (sceneNumber: number, uid: string, patch: Partial<Omit<ClipEdit, 'uid'>>) => void
  onRemove: (sceneNumber: number, uid: string) => void
  onMove: (sceneNumber: number, uid: string, by: -1 | 1) => void
  onRetry: (footageKey: string) => void
  onSave: () => void
  onOpen: () => void
}

function Banner({ tone, children, testId }: { tone: 'warn' | 'error' | 'info'; children: React.ReactNode; testId?: string }) {
  const cls = tone === 'error' ? 'border-destructive/40 bg-destructive/5' : tone === 'warn' ? 'border-amber-500/40 bg-amber-500/10' : 'bg-muted/40'
  return (
    <div role={tone === 'error' ? 'alert' : 'note'} data-testid={testId} className={`flex gap-2 rounded-lg border px-3 py-2 text-xs ${cls}`}>
      {tone !== 'info' && <AlertTriangle className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${tone === 'error' ? 'text-destructive' : 'text-amber-600'}`} />}
      <div className="min-w-0">{children}</div>
    </div>
  )
}

function ClipRow(p: { sceneNumber: number; index: number; count: number; clip: ClipEdit; entry: LibraryEntry | undefined; props: FootageAssignmentViewProps }) {
  const { clip, entry, props } = p
  const name = entry?.name ?? 'Unavailable footage'
  const length = entry?.state === 'ready' ? fmtSeconds(entry.clip.duration) : null
  const id = `${p.sceneNumber}-${clip.uid}`
  return (
    <li className="space-y-2 rounded-lg border bg-muted/20 p-2" data-testid={`clip-${p.sceneNumber}-${p.index}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 text-xs">
          <span className="font-medium">{name}</span>
          {length && <span className="text-muted-foreground"> · {length} long</span>}
          {entry?.state === 'probing' && <span className="text-muted-foreground"> · reading length… <Loader2 className="inline h-3 w-3 animate-spin" /></span>}
          {entry?.state === 'failed' && (
            <span className="text-destructive"> · {entry.reason} <button className="underline" onClick={() => props.onRetry(entry.key)}>Try again</button></span>
          )}
        </div>
        <div className="flex shrink-0 gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Move clip earlier" disabled={p.index === 0} onClick={() => props.onMove(p.sceneNumber, clip.uid, -1)}><ArrowUp /></Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Move clip later" disabled={p.index === p.count - 1} onClick={() => props.onMove(p.sceneNumber, clip.uid, 1)}><ArrowDown /></Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Remove ${name} from scene ${p.sceneNumber}`} data-testid={`remove-${p.sceneNumber}-${p.index}`} onClick={() => props.onRemove(p.sceneNumber, clip.uid)}><Trash2 /></Button>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <label className="space-y-0.5 text-[11px]" htmlFor={`trim-${id}`}>Start at (s)
          <Input id={`trim-${id}`} className="h-8 text-xs" inputMode="decimal" placeholder="0" value={clip.trimIn} onChange={e => props.onUpdate(p.sceneNumber, clip.uid, { trimIn: e.target.value })} data-testid={`trim-${p.sceneNumber}-${p.index}`} />
        </label>
        <label className="space-y-0.5 text-[11px]" htmlFor={`len-${id}`}>Length (s)
          <Input id={`len-${id}`} className="h-8 text-xs" inputMode="decimal" placeholder="auto" value={clip.useDuration} onChange={e => props.onUpdate(p.sceneNumber, clip.uid, { useDuration: e.target.value })} data-testid={`length-${p.sceneNumber}-${p.index}`} />
        </label>
        <label className="space-y-0.5 text-[11px]" htmlFor={`speed-${id}`}>Speed
          <select id={`speed-${id}`} className={field} value={clip.speed} onChange={e => props.onUpdate(p.sceneNumber, clip.uid, { speed: e.target.value })}>
            <option value="">Automatic</option>
            {ALLOWED_SPEEDS.map(s => <option key={s} value={String(s)}>{s}×</option>)}
          </select>
        </label>
      </div>
    </li>
  )
}

export function FootageAssignmentView(props: FootageAssignmentViewProps) {
  const { view } = props
  const fileRef = useRef<HTMLInputElement>(null)
  const errorsExist = view.blockers.length > 0
  return (
    <section className={`${box} space-y-4`} data-testid="footage-assignment" aria-labelledby="footage-heading">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="footage-heading" className="text-base font-semibold">Assign your footage</h2>
          <p className={sub}>Choose or upload your own videos and place them on each scene. They become real clips in Video Studio that you can still trim, move and change.</p>
        </div>
        <div>
          <input ref={fileRef} type="file" accept="video/*" hidden data-testid="footage-upload-input" onChange={e => { const f = e.target.files?.[0]; if (f) props.onUpload(f); e.target.value = '' }} />
          <Button variant="outline" size="sm" disabled={props.uploading} onClick={() => fileRef.current?.click()} data-testid="footage-upload-button">
            {props.uploading ? <Loader2 className="animate-spin" /> : <Upload />} Upload footage
          </Button>
        </div>
      </div>

      <Banner tone="info">
        Footage must be <b>your own new media</b>. The reference video itself can’t be used, so it isn’t offered here. Text on each scene starts as a <b>placeholder</b> — replace it in Video Studio before exporting, otherwise the placeholder wording is part of the video.
      </Banner>

      {props.libraryError && <Banner tone="error" testId="library-error">{props.libraryError}</Banner>}
      {props.uploadError && <Banner tone="error" testId="upload-error">{props.uploadError}</Banner>}
      {!props.libraryLoading && !props.libraryError && props.assets.length === 0 && (
        <Banner tone="info" testId="no-footage">You have no videos yet. Use “Upload footage” to add one.</Banner>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm" data-testid="coverage-headline"><b>{coverageHeadline(view)}</b>
          {view.result.ok && <span className={sub}> · {fmtSeconds(view.result.snapshot.assembly.summary.filledSeconds)} of {fmtSeconds(view.result.snapshot.assembly.summary.plannedSeconds)} covered</span>}
        </div>
        <label className="flex items-center gap-2 text-xs">If footage is shorter than its scene
          <select className={`${field} w-auto`} value={props.underfilled} onChange={e => props.onUnderfilled(e.target.value as UnderfilledPolicy)} data-testid="underfilled-policy">
            <option value="gap">Leave a gap (show the missing seconds)</option>
            <option value="stretch">Slow it down to fill, if possible</option>
          </select>
        </label>
      </div>

      <ol className="space-y-3">
        {view.rows.map(r => {
          const clips = props.edits[r.sceneNumber] ?? []
          const st = STATUS[r.status]
          return (
            <li key={r.sceneNumber} className="space-y-2 rounded-xl border p-3" data-testid={`scene-row-${r.sceneNumber}`} data-status={r.status}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium">Scene {r.sceneNumber} <span className="font-normal text-muted-foreground">· {fmtRange(r.startTime, r.endTime)} · {fmtSeconds(r.duration)}</span></div>
                  <div className={`${sub} line-clamp-2`}>{r.purpose}</div>
                </div>
                <Badge variant={st.variant} data-testid={`scene-status-${r.sceneNumber}`}>{st.label}</Badge>
              </div>

              {clips.length > 0 && (
                <ul className="space-y-2">
                  {clips.map((c, i) => <ClipRow key={c.uid} sceneNumber={r.sceneNumber} index={i} count={clips.length} clip={c} entry={props.library.get(c.footageKey)} props={props} />)}
                </ul>
              )}

              {r.gapSeconds != null && clips.length > 0 && (
                <div className={sub} data-testid={`coverage-${r.sceneNumber}`}>
                  {r.gapSeconds > 0.0005 ? <>Covers {fmtSeconds(r.filledSeconds ?? 0)} of {fmtSeconds(r.duration)} — <b>{fmtSeconds(r.gapSeconds)} uncovered</b> at the end.</> : <><CheckCircle2 className="mr-1 inline h-3 w-3 text-success" />Covers the whole scene.</>}
                </div>
              )}

              {r.problems.map((m, i) => <div key={`p${i}`} role="alert" className="text-xs text-destructive" data-testid={`scene-issue-${r.sceneNumber}`}>{m}</div>)}
              {r.issues.map((x, i) => (
                <div key={`i${i}`} role={x.severity === 'error' ? 'alert' : 'note'} className={`text-xs ${x.severity === 'error' ? 'text-destructive' : 'text-amber-700 dark:text-amber-400'}`} data-testid={`scene-issue-${r.sceneNumber}`}>{x.message}</div>
              ))}

              <label className="block text-[11px]">
                <span className="sr-only">Add footage to scene {r.sceneNumber}</span>
                <select className={field} value="" onChange={e => { if (e.target.value) props.onAdd(r.sceneNumber, Number(e.target.value)) }} data-testid={`add-footage-${r.sceneNumber}`} disabled={props.assets.length === 0}>
                  <option value="">{clips.length === 0 ? '+ Add footage to this scene…' : '+ Add another clip to this scene…'}</option>
                  {props.assets.map(a => {
                    const isRef = props.referenceAssetIds.has(a.id)
                    return <option key={a.id} value={a.id} disabled={isRef}>{a.original_filename}{isRef ? ' — reference video (can’t be used)' : ''}</option>
                  })}
                </select>
              </label>
            </li>
          )
        })}
      </ol>

      {errorsExist && (
        <Banner tone="error" testId="blockers">
          <div className="font-medium">Fix these before saving:</div>
          <ul className="ml-4 list-disc">{view.blockers.map((b, i) => <li key={i}>{b}</li>)}</ul>
        </Banner>
      )}
      {view.warnings.length > 0 && (
        <Banner tone="warn" testId="warnings">
          <ul className="ml-4 list-disc">{view.warnings.map((w, i) => <li key={i}>{w.message}</li>)}</ul>
        </Banner>
      )}

      <details className="rounded-lg border bg-muted/20 px-3 py-2 text-xs" data-testid="element-classes">
        <summary className="cursor-pointer font-medium">What will and won’t be editable</summary>
        <div className="mt-2 space-y-3">
          {(['automatic', 'partial', 'unsupported'] as const).map(kind => (
            <div key={kind} data-testid={`elements-${kind}`}>
              <div className="font-medium">{EDITABILITY[kind].title}</div>
              <div className="text-muted-foreground">{EDITABILITY[kind].blurb}</div>
              <ul className="ml-4 list-disc text-muted-foreground">
                {ELEMENT_CLASSES.filter(c => c.editability === kind).map(c => <li key={c.kind}>{c.reason}</li>)}
              </ul>
            </div>
          ))}
        </div>
      </details>

      {view.notes.length > 0 && (
        <details className="rounded-lg border bg-muted/20 px-3 py-2 text-xs">
          <summary className="cursor-pointer font-medium">Notes ({view.notes.length})</summary>
          <ul className="ml-4 mt-2 list-disc text-muted-foreground">{view.notes.map((n, i) => <li key={i}>{n.message}</li>)}</ul>
        </details>
      )}

      <div className="space-y-2 border-t pt-3">
        {props.saveMessage && <Banner tone="error" testId="save-error">{props.saveMessage}</Banner>}
        {props.openMessage && <Banner tone="warn" testId="open-message">{props.openMessage}</Banner>}
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={props.onSave} disabled={!view.canSave || props.saving} data-testid="save-assembled-button">
            {props.saving ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} {props.saved ? 'Save changes to the draft' : 'Save draft'}
          </Button>
          <Button variant="outline" onClick={props.onOpen} disabled={!props.saved || props.saved.stale || props.saving} data-testid="open-assembled-button">
            Open in Video Studio
          </Button>
        </div>
        {props.saved && !props.saved.stale && (
          <div className={sub} data-testid="saved-info">Saved as “{props.saved.name}” with {props.saved.clips} {props.saved.clips === 1 ? 'clip' : 'clips'}. It is in your Video Studio drafts.</div>
        )}
        {props.saved?.stale && <div className={sub} data-testid="saved-stale">You changed the assignment after saving. Save again to update the draft before opening it.</div>}
        {!props.saved && !errorsExist && <div className={sub}>Nothing is created until you press Save draft.</div>}
      </div>
    </section>
  )
}
