import { useMemo, useRef, useState, type Dispatch, type ReactNode } from 'react'
import { AlertTriangle, Film, Loader2, X } from 'lucide-react'
import type { EasingName, ElementAnimation, MotionDirection, PostDocument, PostElement, PostPage, SlideSequence, SlideTransition } from '../../../lib/postDocument'
import {
  DEFAULT_SEQUENCE, DEFAULT_SLIDE_MS, DEFAULT_TRANSITION, EASINGS, EMPHASIS_KINDS, ENTRANCE_KINDS, EXIT_KINDS, TRANSITION_KINDS, buildTimeline, defaultAnimation, hasMotion, slideDuration,
} from '../../../lib/carousel/animation'
import { browserBackend, downloadBytes } from '../../../lib/carousel/browserBackend'
import { slug } from '../../../lib/carousel/exporter'
import { videoAdvice } from '../../../lib/carousel/resources'
import { createHttpVideoSink } from '../../../lib/carousel/videoSink'
import { VIDEO_FPS_CHOICES, exportAnimatedVideo, frameCount, videoSize, type VideoFormat, type VideoSink } from '../../../lib/carousel/videoRender'
import { useBrandTokens } from '../../../lib/carousel/brandContext'
import { withMediaToken } from '../../../api/mediaAccess'
import { carouselVideoApi } from '../../../api/client'
import type { EditorAction } from '../editorState'
import MotionPreview from './MotionPreview'

const field = 'h-8 w-full rounded-md border border-border bg-background px-2 text-sm'
const btn = 'inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs font-medium hover:bg-muted disabled:opacity-50'
const DIRS: { id: MotionDirection; label: string }[] = [{ id: 'left', label: 'Left' }, { id: 'right', label: 'Right' }, { id: 'up', label: 'Top' }, { id: 'down', label: 'Bottom' }]
const DIRECTIONAL_TRANSITIONS = ['slide', 'push', 'wipe', 'flip']

function Row({ label, children }: { label: string; children: ReactNode }) {
  return <label className="grid grid-cols-[6.5rem_1fr] items-center gap-2 text-xs"><span className="text-muted-foreground">{label}</span><span className="min-w-0">{children}</span></label>
}
const sec = (ms: number) => Math.round(ms) / 1000
const ms = (s: number) => Math.max(0, Math.round(s * 1000))

/** One of an element's three animation phases. */
function PhaseEditor({ phase, el, onChange, idFor }: { phase: ElementAnimation['phase']; el: PostElement; onChange: (a: ElementAnimation | null) => void; idFor: () => string }) {
  const kinds = phase === 'entrance' ? ENTRANCE_KINDS : phase === 'exit' ? EXIT_KINDS : EMPHASIS_KINDS
  const anim = el.animations?.find(a => a.phase === phase)
  const label = phase === 'entrance' ? 'Entrance' : phase === 'exit' ? 'Exit' : 'Emphasis'
  const set = (patch: Partial<ElementAnimation>) => anim && onChange({ ...anim, ...patch })
  return (
    <fieldset className="space-y-1.5 rounded-md border border-border p-2" data-testid={`phase-${phase}`}>
      <legend className="px-1 text-xs font-semibold">{label}</legend>
      <Row label="Effect">
        <select className={field} aria-label={`${label} effect`} value={anim?.kind ?? ''} onChange={e => onChange(e.target.value ? { ...defaultAnimation(phase, e.target.value, anim?.id ?? idFor()), ...(anim ? { durationMs: anim.durationMs, delayMs: anim.delayMs } : {}) } : null)} data-testid={`${phase}-kind`}>
          <option value="">None</option>
          {kinds.map(k => <option key={k} value={k}>{k === 'typewriter' && el.type !== 'text' ? 'Typewriter (text only)' : k.charAt(0).toUpperCase() + k.slice(1)}</option>)}
        </select>
      </Row>
      {anim && (
        <>
          <Row label="Duration (s)"><input type="number" min={0.05} max={60} step={0.1} className={field} aria-label={`${label} duration in seconds`} value={sec(anim.durationMs)} onChange={e => e.target.value !== '' && set({ durationMs: Math.max(50, ms(Number(e.target.value))) })} data-testid={`${phase}-duration`} /></Row>
          <Row label={phase === 'exit' ? 'Leave earlier (s)' : 'Delay (s)'}><input type="number" min={0} max={60} step={0.1} className={field} aria-label={`${label} delay in seconds`} value={sec(anim.delayMs)} onChange={e => e.target.value !== '' && set({ delayMs: ms(Number(e.target.value)) })} data-testid={`${phase}-delay`} /></Row>
          <Row label="Easing"><select className={field} aria-label={`${label} easing`} value={anim.easing} onChange={e => set({ easing: e.target.value as EasingName })}>{EASINGS.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}</select></Row>
          {anim.kind === 'slide' && <Row label={phase === 'exit' ? 'Leaves towards' : 'Comes from'}><select className={field} aria-label={`${label} direction`} value={anim.direction ?? 'left'} onChange={e => set({ direction: e.target.value as MotionDirection })}>{DIRS.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}</select></Row>}
          {phase === 'emphasis' && <Row label="Repeats"><input type="number" min={1} max={20} step={1} className={field} aria-label="Emphasis repeats" value={anim.repeat ?? 1} onChange={e => e.target.value !== '' && set({ repeat: Math.max(1, Math.min(20, Math.round(Number(e.target.value)))) })} /></Row>}
        </>
      )}
    </fieldset>
  )
}

export interface AnimatePanelProps {
  doc: PostDocument
  page: PostPage
  pageIndex: number
  /** The single selected element, if exactly one is selected. */
  selected: PostElement | undefined
  dispatch: Dispatch<EditorAction>
  /** Where animated video frames are encoded. Defaults to the server; tests pass a fake. */
  videoSink?: VideoSink
}

/**
 * Motion for the open carousel: how each slide arrives (transition), how long it is held, how its elements enter, leave and draw attention, a live preview, and the animated MP4 / GIF export.
 * All of it is stored with the slides and elements; the static PNG / JPEG / PDF exports ignore it completely.
 */
export default function AnimatePanel({ doc, page, pageIndex, selected, dispatch, videoSink }: AnimatePanelProps) {
  const tokens = useBrandTokens()
  const sink = useMemo(() => videoSink ?? createHttpVideoSink(carouselVideoApi), [videoSink])
  const tr: SlideTransition = page.transition ?? DEFAULT_TRANSITION
  const seq: SlideSequence = page.sequence ?? DEFAULT_SEQUENCE
  const [quick, setQuick] = useState('slide')
  const [fmt, setFmt] = useState<VideoFormat>('mp4')
  const [scale, setScale] = useState(0.5)
  const [fps, setFps] = useState<number>(24)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ stage: string; done: number; total: number } | null>(null)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const abort = useRef<AbortController | null>(null)
  const counter = useRef(0)
  const newAnimId = () => `anim_${Date.now().toString(36)}_${counter.current++}`

  const timeline = useMemo(() => buildTimeline(doc), [doc])
  const size = videoSize(doc, scale)
  const frames = frameCount(timeline, fps)
  const advice = videoAdvice(timeline.totalMs / 1000, size.width, size.height, fps)
  const animated = hasMotion(doc)
  const patchSlide = (patch: { transition?: SlideTransition | null; durationMs?: number | null; sequence?: SlideSequence | null }) => dispatch({ type: 'slideMotion', id: page.id, patch })
  const setTransition = (p: Partial<SlideTransition>) => patchSlide({ transition: { ...tr, ...p } })

  const exportVideo = async () => {
    setBusy(true); setMessage(null); setProgress(null)
    const ctl = new AbortController()
    abort.current = ctl
    try {
      if (typeof document !== 'undefined' && document.fonts?.ready) await document.fonts.ready
      const file = await exportAnimatedVideo(doc, browserBackend(), sink, { fps, scale, format: fmt, tokens, resolveUrl: withMediaToken, signal: ctl.signal, onProgress: (stage, done, total) => setProgress({ stage, done, total }) })
      downloadBytes(`${slug(doc.title)}-animated.${fmt}`, file.mime, file.bytes)
      setMessage({ tone: 'ok', text: `Downloaded ${slug(doc.title)}-animated.${fmt} (${(file.bytes.length / 1024 / 1024).toFixed(2)} MB, ${size.width} × ${size.height}, ${(timeline.totalMs / 1000).toFixed(1)} s).` })
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') setMessage({ tone: 'ok', text: 'Export cancelled. Nothing was downloaded.' })
      else setMessage({ tone: 'error', text: e instanceof Error ? e.message : 'The video export failed.' })
    } finally { setBusy(false); setProgress(null); abort.current = null }
  }

  return (
    <div className="space-y-4" data-testid="animate-panel">
      <MotionPreview doc={doc} activePageId={page.id} />

      <section aria-label="Slide motion" className="space-y-2 border-t border-border pt-3" data-testid="slide-motion">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Slide {pageIndex + 1}</h3>
        <Row label="Arrives with">
          <select className={field} aria-label="Transition into this slide" value={pageIndex === 0 ? 'none' : tr.kind} disabled={pageIndex === 0} onChange={e => setTransition({ kind: e.target.value as SlideTransition['kind'] })} data-testid="transition-kind">
            {TRANSITION_KINDS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </Row>
        {pageIndex === 0 && <p className="text-[11px] text-muted-foreground">The first slide has nothing to arrive from. Set transitions on the later slides.</p>}
        {pageIndex > 0 && tr.kind !== 'none' && (
          <>
            <p className="text-[11px] text-muted-foreground">{TRANSITION_KINDS.find(t => t.id === tr.kind)?.hint}.</p>
            <Row label="Duration (s)"><input type="number" min={0.1} max={10} step={0.1} className={field} aria-label="Transition duration in seconds" value={sec(tr.durationMs)} onChange={e => e.target.value !== '' && setTransition({ durationMs: Math.min(10000, Math.max(100, ms(Number(e.target.value)))) })} data-testid="transition-duration" /></Row>
            <Row label="Easing"><select className={field} aria-label="Transition easing" value={tr.easing} onChange={e => setTransition({ easing: e.target.value as EasingName })}>{EASINGS.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}</select></Row>
            {DIRECTIONAL_TRANSITIONS.includes(tr.kind) && <Row label={tr.kind === 'flip' ? 'Axis' : 'Comes from'}><select className={field} aria-label="Transition direction" value={tr.direction ?? 'left'} onChange={e => setTransition({ direction: e.target.value as MotionDirection })}>{DIRS.map(d => <option key={d.id} value={d.id}>{tr.kind === 'flip' ? (d.id === 'left' || d.id === 'right' ? 'Horizontal' : 'Vertical') + ' (' + d.label + ')' : d.label}</option>)}</select></Row>}
            <button type="button" className={btn} onClick={() => dispatch({ type: 'transitionForAll', transition: tr })} data-testid="transition-all">Use this transition on every slide</button>
          </>
        )}
        <Row label="Shown for (s)"><input type="number" min={0.5} max={60} step={0.5} className={field} aria-label="How long this slide is shown, in seconds" value={sec(slideDuration(page))} onChange={e => e.target.value !== '' && patchSlide({ durationMs: Math.min(60000, Math.max(500, ms(Number(e.target.value)))) })} data-testid="slide-duration" /></Row>
        <Row label="Elements enter">
          <select className={field} aria-label="How element entrances are sequenced" value={seq.mode} onChange={e => patchSlide({ sequence: { ...seq, mode: e.target.value as SlideSequence['mode'] } })} data-testid="sequence-mode">
            <option value="together">All together</option><option value="stagger">Staggered (one after another, overlapping)</option><option value="one-by-one">One by one (each waits)</option>
          </select>
        </Row>
        {seq.mode === 'stagger' && <Row label="Stagger (s)"><input type="number" min={0} max={10} step={0.05} className={field} aria-label="Stagger in seconds" value={sec(seq.staggerMs)} onChange={e => e.target.value !== '' && patchSlide({ sequence: { ...seq, staggerMs: Math.min(10000, ms(Number(e.target.value))) } })} data-testid="stagger" /></Row>}
        <div className="flex flex-wrap items-center gap-1.5">
          <select className="h-8 rounded-md border border-border bg-background px-2 text-xs" aria-label="Entrance for every element" value={quick} onChange={e => setQuick(e.target.value)} data-testid="quick-kind">{ENTRANCE_KINDS.map(k => <option key={k} value={k}>{k.charAt(0).toUpperCase() + k.slice(1)}</option>)}</select>
          <button type="button" className={btn} onClick={() => dispatch({ type: 'animateAll', kind: quick, staggerMs: 150, direction: quick === 'slide' ? 'down' : undefined })} data-testid="animate-all">Animate every element in</button>
          <button type="button" className={btn} onClick={() => dispatch({ type: 'clearAnimations' })} data-testid="clear-animations">Remove animations</button>
        </div>
      </section>

      <section aria-label="Element animation" className="space-y-2 border-t border-border pt-3" data-testid="element-motion">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{selected ? selected.name : 'Element'}</h3>
        {!selected && <p className="text-xs text-muted-foreground" data-testid="no-motion-selection">Select one element on the slide to give it an entrance, an exit or an emphasis.</p>}
        {selected && (['entrance', 'emphasis', 'exit'] as const).map(ph => <PhaseEditor key={`${selected.id}:${ph}`} phase={ph} el={selected} idFor={newAnimId} onChange={a => dispatch({ type: 'elementAnimation', id: selected.id, phase: ph, anim: a })} />)}
      </section>

      <section aria-label="Animated export" className="space-y-2 border-t border-border pt-3" data-testid="video-export">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Animated video</h3>
        <div className="grid grid-cols-3 gap-2 text-xs">
          <label className="space-y-1"><span className="text-muted-foreground">Format</span><select className={field} value={fmt} onChange={e => setFmt(e.target.value as VideoFormat)} data-testid="video-format"><option value="mp4">MP4 video</option><option value="gif">GIF</option></select></label>
          <label className="space-y-1"><span className="text-muted-foreground">Size</span><select className={field} value={scale} onChange={e => setScale(Number(e.target.value))} data-testid="video-scale"><option value={1}>Full</option><option value={0.75}>75%</option><option value={0.5}>50%</option><option value={0.25}>25%</option></select></label>
          <label className="space-y-1"><span className="text-muted-foreground">Frames/s</span><select className={field} value={fps} onChange={e => setFps(Number(e.target.value))} data-testid="video-fps">{VIDEO_FPS_CHOICES.map(f => <option key={f} value={f}>{f}</option>)}</select></label>
        </div>
        <p className="text-xs text-muted-foreground" data-testid="video-summary">{(timeline.totalMs / 1000).toFixed(1)} seconds · {size.width} × {size.height} px · {frames.toLocaleString()} frames{fmt === 'gif' ? ' (GIF plays at up to 15 frames/s)' : ''}. Static PNG, JPEG and PDF exports are not affected.</p>
        {!animated && <p className="text-xs text-amber-800 dark:text-amber-200" role="status" data-testid="video-no-motion">This carousel has no transitions or animations yet, so the video would just show each slide for its time. Add some above.</p>}
        {advice.messages.length > 0 && <div role="status" className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100" data-testid="video-advice" data-level={advice.level}><p className="mb-1 flex items-center gap-1 font-semibold"><AlertTriangle className="h-3.5 w-3.5" />Large export</p><ul className="list-disc pl-4">{advice.messages.map((m, i) => <li key={i}>{m}</li>)}</ul></div>}
        <button type="button" className={`${btn} w-full`} disabled={busy} onClick={() => void exportVideo()} data-testid="export-video">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Film className="h-4 w-4" />}Export animated {fmt.toUpperCase()}</button>
        {busy && (
          <div className="space-y-1" role="status" data-testid="video-progress">
            <div className="h-2 overflow-hidden rounded bg-muted"><div className="h-full bg-primary transition-[width]" style={{ width: progress ? `${progress.stage === 'rendering' ? Math.round((progress.done / Math.max(1, progress.total)) * 90) : progress.stage === 'encoding' ? 95 : 99}%` : '3%' }} /></div>
            <div className="flex items-center justify-between text-xs text-muted-foreground"><span>{progress ? (progress.stage === 'rendering' ? `Rendering frame ${progress.done} of ${progress.total}…` : progress.stage === 'encoding' ? 'Encoding on the server…' : 'Downloading…') : 'Starting…'}</span><button type="button" className="inline-flex items-center gap-1 underline" onClick={() => abort.current?.abort()} data-testid="video-cancel"><X className="h-3 w-3" />Cancel</button></div>
          </div>
        )}
        {message && <p role={message.tone === 'error' ? 'alert' : 'status'} className={message.tone === 'error' ? 'text-xs text-destructive' : 'text-xs text-emerald-700 dark:text-emerald-400'} data-testid="video-message">{message.text}</p>}
      </section>
    </div>
  )
}

export { DEFAULT_SLIDE_MS }
