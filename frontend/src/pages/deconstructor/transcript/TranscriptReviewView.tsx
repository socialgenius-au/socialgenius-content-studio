// M2.5a -- presentational review panel for the reference's transcript. No state, no I/O: the container owns both. It shows what the recogniser wrote, how it rated it, whether the
// words are safe to use as they are, and what will become subtitles and a per-scene script. Nothing here claims the words are correct or the voice recovered.
import { AlertTriangle, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { SpeechCandidate, SpeechFlagCode } from './candidates'
import { SCRIPT_LABEL, unsupportedScript } from './contract'
import type { ResolvedSpeech, SpeechCorrection, TimeMap } from './corrections'
import type { SpeechItemStatus, SpeechPlan } from './materialize'

const box = 'rounded-xl border bg-card p-4'
const sub = 'text-xs text-muted-foreground'
const field = 'h-8 w-full rounded-md border bg-background px-2 text-xs'
const button = 'rounded-md border bg-background px-2 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50'

export type ReviewState = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'none' } | { kind: 'ready' }

export interface TranscriptReviewViewProps {
  state: ReviewState
  rightsStatus: string | null
  candidates: readonly SpeechCandidate[]
  resolved: readonly ResolvedSpeech[]
  plan: SpeechPlan
  timeMap: TimeMap
  onCorrect: (id: string, patch: Partial<Record<keyof SpeechCorrection, unknown>>) => void
  onIncludeAll: (include: boolean) => void
  onTimeMode: (mode: TimeMap['mode']) => void
}

const STATUS: Record<SpeechItemStatus, { label: string; variant: 'success' | 'warning' | 'destructive' | 'outline' }> = {
  included: { label: 'Will be added', variant: 'success' }, excluded_default: { label: 'Left out by default', variant: 'outline' }, excluded_user: { label: 'Left out', variant: 'outline' },
  outside_timeline: { label: 'After the draft ends', variant: 'warning' }, duplicate: { label: 'Already represented', variant: 'outline' }, invalid: { label: 'Needs wording', variant: 'destructive' },
}
const FLAG_LABEL: Record<SpeechFlagCode, string> = {
  third_party_words: 'Their words', machine_transcript: 'Machine transcript', low_quality: 'Poor rating', maybe_not_speech: 'Maybe not speech', repetitive: 'Repetitive', very_short: 'Very short', very_long: 'Very long', script_unsupported: 'Export script issue',
}
const RIGHTS: Record<string, string> = { unknown_third_party: 'someone else’s video (rights unknown)', owned: 'your own video', licensed: 'a licensed video' }
const secs = (n: number) => `${n.toFixed(1)}s`

export function TranscriptReviewView(props: TranscriptReviewViewProps) {
  const { state, resolved, plan, timeMap } = props
  const items = new Map(plan.items.map(i => [i.candidateId, i] as const))
  const c = plan.record.counts
  const thirdParty = props.rightsStatus === 'unknown_third_party'
  const ids = props.candidates.map(x => x.id)
  return (
    <section className={`${box} space-y-3`} data-testid="transcript-review" aria-label="Rebuild the reference's speech as subtitles and a script">
      <div>
        <h3 className="text-sm font-semibold">Rebuild the reference’s speech as subtitles and a script <Badge variant="outline">Preview</Badge></h3>
        <p className={sub}>Turns the words the analysis heard in the reference into editable subtitles in Video Studio and a scene-by-scene script you can rewrite or record over.</p>
      </div>
      <div role="note" data-testid="transcript-honesty" className="rounded-lg border bg-muted/40 px-3 py-2 text-xs">
        <strong>What this does not do.</strong> This is a machine transcript: the words can be wrong and were not checked against the audio, and the times are the recogniser’s. The speaker’s voice, music and
        sound effects are not recovered: you supply your own narration, music and effects. These are the reference speaker’s words, so treat them as a draft to rewrite.
      </div>
      {thirdParty && <div role="note" data-testid="transcript-rights" className="flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" /><span>The reference is {RIGHTS.unknown_third_party}. Its words are left out by default; include the ones you want as a starting point.</span></div>}
      {state.kind === 'loading' && <p className={`${sub} flex items-center gap-2`} role="status"><Loader2 className="h-3.5 w-3.5 animate-spin" />Reading the analysis…</p>}
      {state.kind === 'error' && <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs" data-testid="transcript-error">{state.message}</div>}
      {state.kind === 'none' && <p className={sub} data-testid="transcript-none">The analysis found no speech in this reference, so there is nothing to rebuild.</p>}
      {state.kind === 'ready' && (
        <>
          <p className="text-xs" data-testid="transcript-summary">
            <strong>{c.transcribed}</strong> transcript {c.transcribed === 1 ? 'segment' : 'segments'} · <strong>{c.included}</strong> will be added · {c.excluded} left out
            {c.unsupportedScript > 0 && <> · <strong className="text-amber-700">{c.unsupportedScript} in a script the exporter cannot draw correctly yet</strong></>}
            {c.outside + c.invalid + c.duplicates > 0 && <> · {c.outside + c.invalid + c.duplicates} cannot be added as they are</>}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={button} onClick={() => props.onIncludeAll(true)} data-testid="transcript-include-all">Include all</button>
            <button type="button" className={button} onClick={() => props.onIncludeAll(false)} data-testid="transcript-include-none">Include none</button>
            <span className={sub}>({ids.length} segments{thirdParty ? '; their words, so this is your choice' : ''})</span>
          </div>
          {timeMap.referenceSeconds !== null && Math.abs(timeMap.referenceSeconds - timeMap.planSeconds) > 0.01 * timeMap.planSeconds && (
            <fieldset className="flex flex-wrap items-center gap-3 text-xs" data-testid="transcript-timing-mode">
              <legend className="sr-only">How reference timing maps onto the draft</legend>
              <label className="flex items-center gap-1"><input type="radio" name="sp-time-mode" checked={timeMap.mode === 'fit'} onChange={() => props.onTimeMode('fit')} />Fit to the blueprint length ({secs(timeMap.referenceSeconds)} → {secs(timeMap.planSeconds)})</label>
              <label className="flex items-center gap-1"><input type="radio" name="sp-time-mode" checked={timeMap.mode === 'identity'} onChange={() => props.onTimeMode('identity')} />Keep the reference’s own seconds</label>
            </fieldset>
          )}
          <ul className="space-y-2">
            {resolved.map(r => {
              const cand = r.candidate, item = items.get(cand.id)!, st = STATUS[item.status], k = cand.id.replace(/[^a-z0-9]+/gi, '-')
              const set = (patch: Partial<Record<keyof SpeechCorrection, unknown>>) => props.onCorrect(cand.id, patch)
              const num = (v: string) => (v.trim() === '' ? undefined : Number(v))
              const scriptNow = unsupportedScript(r.text.value)                     // judged on the wording as it stands now, so rewording into a supported script clears it
              return (
                <li key={cand.id} className={`space-y-2 rounded-lg border p-3 ${r.include ? 'bg-muted/20' : 'bg-muted/5 opacity-90'}`} data-testid={`speech-item-${k}`} data-status={item.status} data-candidate={cand.id}>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-2 text-xs font-medium">
                      <input type="checkbox" checked={r.include} onChange={e => set({ include: e.target.checked })} aria-label={`Use the line at ${secs(cand.segment.start)} as a subtitle`} data-testid={`speech-include-${k}`} />Use as a subtitle
                    </label>
                    <Badge variant={st.variant} data-testid={`speech-status-${k}`}>{st.label}</Badge>
                    {scriptNow && <Badge variant="warning">{FLAG_LABEL.script_unsupported}</Badge>}
                    {cand.flags.filter(f => f.code !== 'machine_transcript' && f.code !== 'script_unsupported').map(f => <Badge key={f.code} variant={f.severity === 'warning' ? 'warning' : 'outline'} title={f.message}>{FLAG_LABEL[f.code]}</Badge>)}
                  </div>
                  <p className={sub} data-testid={`speech-evidence-${k}`}>Heard at {secs(cand.segment.start)}–{secs(cand.segment.end)} in the reference{cand.segment.language ? ` · language “${cand.segment.language}”` : ''}{cand.segment.diagnostics.avgLogprob !== null ? ` · recogniser rating ${cand.segment.diagnostics.avgLogprob.toFixed(2)}` : ''}</p>
                  <label className="block space-y-1"><span className={sub}>Wording {r.text.basis === 'user' ? '(your edit)' : '(as transcribed — check it)'}</span>
                    <input className={field} dir="auto" value={r.text.value} onChange={e => set({ text: e.target.value })} data-testid={`speech-text-${k}`} /></label>
                  {r.text.basis === 'user' && <button type="button" className={button} onClick={() => set({ text: undefined })}>Back to what was transcribed</button>}
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <label className="space-y-1"><span className={sub}>Starts (s)</span><input type="number" step="0.1" min="0" className={field} value={r.start.value} onChange={e => set({ start: num(e.target.value) })} data-testid={`speech-start-${k}`} /></label>
                    <label className="space-y-1"><span className={sub}>Ends (s)</span><input type="number" step="0.1" min="0" className={field} value={r.end.value} onChange={e => set({ end: num(e.target.value) })} data-testid={`speech-end-${k}`} /></label>
                  </div>
                  {cand.flags.filter(f => ['low_quality', 'maybe_not_speech', 'repetitive'].includes(f.code)).map(f => (
                    <p key={f.code} role="alert" className="flex items-start gap-2 text-xs text-amber-700" data-testid={`speech-warning-${f.code}-${k}`}><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />{f.message}</p>
                  ))}
                  {scriptNow && <p role="alert" className="flex items-start gap-2 text-xs text-amber-700" data-testid={`speech-warning-script_unsupported-${k}`}><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />This text is in {SCRIPT_LABEL[scriptNow]}. It looks right in the editor, but the exporter cannot lay it out correctly yet, so the exported subtitle would be wrong.</p>}
                  <p className={sub}>{item.message}</p>
                </li>
              )
            })}
          </ul>
          <div className="space-y-1" data-testid="transcript-script">
            <h4 className="text-xs font-semibold">Script by scene (what you kept, to rewrite or record over)</h4>
            {plan.script.every(s => s.lines.length === 0)
              ? <p className={sub} data-testid="transcript-script-empty">Nothing is kept yet, so the script is empty.</p>
              : <ol className="space-y-1 text-xs">{plan.script.filter(s => s.lines.length > 0).map(s => (
                  <li key={s.sceneNumber} data-testid={`script-scene-${s.sceneNumber}`}><strong>Scene {s.sceneNumber}</strong> <span className={sub}>({secs(s.startTime)}–{secs(s.endTime)})</span>
                    <div dir="auto" className="whitespace-pre-wrap rounded border bg-background/60 px-2 py-1">{s.lines.map(l => l.text).join('\n')}</div></li>))}</ol>}
          </div>
          <p className={sub} data-testid="transcript-footer">The subtitles and the script are saved into the draft when you use “Save draft” below.</p>
        </>
      )}
    </section>
  )
}
