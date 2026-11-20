import { useCallback, useEffect, useRef, useState } from 'react'
import { Pause, Play, RotateCcw, Volume2, VolumeX } from 'lucide-react'
import type { AudioTrack, PostDocument } from '../../../lib/postDocument'
import { browserBackend } from '../../../lib/carousel/browserBackend'
import { buildTimeline } from '../../../lib/carousel/animation'
import { audibleWindow, sourceTimeAt, volumeAt } from '../../../lib/carousel/audio'
import { drawFrame, prepareFrameContext, type FrameContext } from '../../../lib/carousel/videoRender'
import { useBrandTokens } from '../../../lib/carousel/brandContext'
import { withMediaToken } from '../../../api/mediaAccess'

const PREVIEW_WIDTH = 360
export type PreviewScope = 'slide' | 'all'

/** The document the preview plays: the whole carousel, or just the open slide (which has nothing to arrive from). */
export function previewDocFor(doc: PostDocument, scope: PreviewScope, activePageId: string): PostDocument {
  if (scope === 'all') return doc
  const page = doc.pages.find(p => p.id === activePageId) ?? doc.pages[0]
  return { ...doc, pages: [{ ...page, transition: undefined }] }
}

export interface MotionPreviewProps {
  doc: PostDocument
  activePageId: string
  scope: PreviewScope
  onScope: (s: PreviewScope) => void
  /** Playhead (ms), owned by the parent so the timeline and the preview stay together. */
  t: number
  onT: (ms: number) => void
  playing: boolean
  onPlaying: (p: boolean) => void
  /** Background music, played in step with the picture (whole-carousel preview only). */
  audio?: AudioTrack
}

/**
 * The motion a viewer would see, drawn by the SAME frame renderer as the video export, with the background music (if any) playing in step. Preview the open slide on its own or the whole
 * carousel with its transitions. Music is heard only when previewing the whole carousel, because that is the timeline the music is placed on.
 */
export default function MotionPreview({ doc, activePageId, scope, onScope, t, onT, playing, onPlaying, audio }: MotionPreviewProps) {
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [soundOn, setSoundOn] = useState(true)
  const tokens = useBrandTokens()
  const canvas = useRef<HTMLCanvasElement>(null)
  const fc = useRef<FrameContext | null>(null)
  const drawing = useRef(false)
  const wanted = useRef(0)
  const total = useRef(0)
  const el = useRef<HTMLAudioElement | null>(null)
  const tRef = useRef(t)
  tRef.current = t

  const paint = useCallback(async (ms: number) => {
    const c = fc.current
    const cv = canvas.current
    if (!c || !cv) return
    wanted.current = ms
    if (drawing.current) return                                              // one frame at a time; the latest requested time is drawn next
    drawing.current = true
    try {
      let last = -1
      while (last !== wanted.current) {
        last = wanted.current
        await drawFrame(c, last)
        const ctx = cv.getContext('2d')
        if (ctx) ctx.drawImage(c.main.image as CanvasImageSource, 0, 0, cv.width, cv.height)
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'The preview could not be drawn.') } finally { drawing.current = false }
  }, [])

  // (Re)build the frame context when the document, scope or open slide changes (after a short pause so typing does not rebuild it every key).
  useEffect(() => {
    let live = true
    setReady(false)
    const h = setTimeout(() => {
      const d = previewDocFor(doc, scope, activePageId)
      prepareFrameContext(d, browserBackend(), { scale: PREVIEW_WIDTH / d.format.width, resolveUrl: withMediaToken, tokens }).then(ctx => {
        if (!live) return
        fc.current = ctx; total.current = buildTimeline(d).totalMs; setReady(true); setError(null)
        void paint(Math.min(tRef.current, Math.max(0, total.current - 1)))
      }).catch(e => { if (live) setError(e instanceof Error ? e.message : 'The preview could not be prepared.') })
    }, 250)
    return () => { live = false; clearTimeout(h) }
  }, [doc, scope, activePageId, tokens, paint])

  // Playback: advance the playhead with the clock and loop at the end.
  useEffect(() => {
    if (!playing || !ready) return
    let raf = 0
    let prev = performance.now()
    let cur = tRef.current
    const tick = (now: number) => {
      const dt = now - prev
      prev = now
      cur = total.current > 0 ? (cur + dt) % total.current : 0
      onT(cur)
      void paint(cur)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, ready, paint, onT])

  // Music: play the file in step with the playhead (whole carousel only), with the same volume and fades the export will have.
  const musicUrl = audio ? withMediaToken(audio.url) : null
  useEffect(() => {
    const a = el.current
    if (!a) return
    const w = audio && scope === 'all' && soundOn ? audibleWindow(audio, total.current) : null
    if (!playing || !w || !audio) { a.pause(); return }
    if (t >= w.startMs && t < w.endMs) {
      const want = sourceTimeAt(audio, t)
      if (a.paused || Math.abs(a.currentTime - want) > 0.35) { try { a.currentTime = want } catch { /* not seekable yet */ } }
      a.volume = Math.max(0, Math.min(1, volumeAt(audio, t, total.current)))
      if (a.paused) void a.play().catch(() => undefined)
    } else a.pause()
  }, [t, playing, audio, scope, soundOn])

  const seek = (ms: number) => { onT(ms); void paint(ms) }
  const d = previewDocFor(doc, scope, activePageId)
  const cw = PREVIEW_WIDTH
  const ch = Math.round((PREVIEW_WIDTH * d.format.height) / d.format.width)
  const secs = (ms: number) => (ms / 1000).toFixed(1)
  const btn = 'inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card hover:bg-muted disabled:opacity-50'

  return (
    <section aria-label="Motion preview" data-testid="motion-preview" className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Preview</h3>
        <div role="tablist" aria-label="Preview scope" className="flex gap-1 rounded-md bg-muted p-0.5 text-xs">
          {(['slide', 'all'] as const).map(s => <button key={s} type="button" role="tab" aria-selected={scope === s} onClick={() => { onScope(s); onPlaying(false); onT(0) }} className={`rounded px-2 py-1 font-medium ${scope === s ? 'bg-card shadow-sm' : 'text-muted-foreground'}`} data-testid={`preview-${s}`}>{s === 'slide' ? 'This slide' : 'Whole carousel'}</button>)}
        </div>
      </div>
      <div className="overflow-hidden rounded-md border border-border bg-black" style={{ maxWidth: cw }}>
        <canvas ref={canvas} width={cw} height={ch} className="block h-auto w-full" data-testid="preview-canvas" aria-label="Motion preview of the carousel" />
      </div>
      {musicUrl && <audio ref={el} src={musicUrl} preload="auto" className="hidden" data-testid="preview-audio" />}
      {error && <p role="alert" className="text-xs text-destructive" data-testid="preview-error">{error}</p>}
      <div className="flex items-center gap-2">
        <button type="button" className={btn} disabled={!ready} onClick={() => onPlaying(!playing)} aria-label={playing ? 'Pause preview' : 'Play preview'} data-testid="preview-play">{playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}</button>
        <button type="button" className={btn} disabled={!ready} onClick={() => { onPlaying(false); seek(0) }} aria-label="Back to the start" data-testid="preview-restart"><RotateCcw className="h-4 w-4" /></button>
        <input type="range" className="min-w-0 flex-1" min={0} max={Math.max(1, total.current - 1)} step={20} value={Math.round(t)} disabled={!ready} onChange={e => { onPlaying(false); seek(Number(e.target.value)) }} aria-label="Preview position" data-testid="preview-scrub" />
        {audio && <button type="button" className={btn} onClick={() => setSoundOn(v => !v)} aria-pressed={soundOn} aria-label={soundOn ? 'Mute preview sound' : 'Unmute preview sound'} data-testid="preview-sound">{soundOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}</button>}
        <span className="w-20 shrink-0 text-right text-xs tabular-nums text-muted-foreground" data-testid="preview-time">{secs(t)} / {secs(total.current)} s</span>
      </div>
      {audio && scope === 'slide' && <p className="text-[11px] text-muted-foreground">Music plays when you preview the whole carousel.</p>}
    </section>
  )
}
