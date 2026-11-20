import { useCallback, useEffect, useRef, useState } from 'react'
import { Pause, Play, RotateCcw } from 'lucide-react'
import type { PostDocument } from '../../../lib/postDocument'
import { browserBackend } from '../../../lib/carousel/browserBackend'
import { buildTimeline } from '../../../lib/carousel/animation'
import { drawFrame, prepareFrameContext, type FrameContext } from '../../../lib/carousel/videoRender'
import { useBrandTokens } from '../../../lib/carousel/brandContext'
import { withMediaToken } from '../../../api/mediaAccess'

const PREVIEW_WIDTH = 360

/** The motion a viewer would see, drawn by the SAME frame renderer as the video export. Preview the open slide on its own or the whole carousel with its transitions. */
export default function MotionPreview({ doc, activePageId }: { doc: PostDocument; activePageId: string }) {
  const [scope, setScope] = useState<'slide' | 'all'>('slide')
  const [playing, setPlaying] = useState(false)
  const [t, setT] = useState(0)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const tokens = useBrandTokens()
  const canvas = useRef<HTMLCanvasElement>(null)
  const fc = useRef<FrameContext | null>(null)
  const drawing = useRef(false)
  const wanted = useRef(0)
  const total = useRef(0)

  const previewDoc = useCallback((): PostDocument => {
    if (scope === 'all') return doc
    const page = doc.pages.find(p => p.id === activePageId) ?? doc.pages[0]
    return { ...doc, pages: [{ ...page, transition: undefined }] }          // a single slide has nothing to arrive from
  }, [doc, scope, activePageId])

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
      const d = previewDoc()
      prepareFrameContext(d, browserBackend(), { scale: PREVIEW_WIDTH / d.format.width, resolveUrl: withMediaToken, tokens }).then(ctx => {
        if (!live) return
        fc.current = ctx; total.current = buildTimeline(d).totalMs; setReady(true); setError(null)
        setT(cur => Math.min(cur, Math.max(0, total.current - 1)))
        void paint(Math.min(wanted.current, Math.max(0, total.current - 1)))
      }).catch(e => { if (live) setError(e instanceof Error ? e.message : 'The preview could not be prepared.') })
    }, 250)
    return () => { live = false; clearTimeout(h) }
  }, [previewDoc, tokens, paint])

  // Playback: advance the playhead with the clock and loop at the end.
  useEffect(() => {
    if (!playing || !ready) return
    let raf = 0
    let prev = performance.now()
    const tick = (now: number) => {
      const dt = now - prev
      prev = now
      setT(cur => { const next = total.current > 0 ? (cur + dt) % total.current : 0; void paint(next); return next })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, ready, paint])

  const seek = (ms: number) => { setT(ms); void paint(ms) }
  const d = previewDoc()
  const cw = PREVIEW_WIDTH
  const ch = Math.round((PREVIEW_WIDTH * d.format.height) / d.format.width)
  const secs = (ms: number) => (ms / 1000).toFixed(1)
  const btn = 'inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card hover:bg-muted disabled:opacity-50'

  return (
    <section aria-label="Motion preview" data-testid="motion-preview" className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Preview</h3>
        <div role="tablist" aria-label="Preview scope" className="flex gap-1 rounded-md bg-muted p-0.5 text-xs">
          {(['slide', 'all'] as const).map(s => <button key={s} type="button" role="tab" aria-selected={scope === s} onClick={() => { setScope(s); setPlaying(false); setT(0) }} className={`rounded px-2 py-1 font-medium ${scope === s ? 'bg-card shadow-sm' : 'text-muted-foreground'}`} data-testid={`preview-${s}`}>{s === 'slide' ? 'This slide' : 'Whole carousel'}</button>)}
        </div>
      </div>
      <div className="overflow-hidden rounded-md border border-border bg-black" style={{ maxWidth: cw }}>
        <canvas ref={canvas} width={cw} height={ch} className="block h-auto w-full" data-testid="preview-canvas" aria-label="Motion preview of the carousel" />
      </div>
      {error && <p role="alert" className="text-xs text-destructive" data-testid="preview-error">{error}</p>}
      <div className="flex items-center gap-2">
        <button type="button" className={btn} disabled={!ready} onClick={() => setPlaying(p => !p)} aria-label={playing ? 'Pause preview' : 'Play preview'} data-testid="preview-play">{playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}</button>
        <button type="button" className={btn} disabled={!ready} onClick={() => { setPlaying(false); seek(0) }} aria-label="Back to the start" data-testid="preview-restart"><RotateCcw className="h-4 w-4" /></button>
        <input type="range" className="min-w-0 flex-1" min={0} max={Math.max(1, total.current - 1)} step={20} value={Math.round(t)} disabled={!ready} onChange={e => { setPlaying(false); seek(Number(e.target.value)) }} aria-label="Preview position" data-testid="preview-scrub" />
        <span className="w-20 shrink-0 text-right text-xs tabular-nums text-muted-foreground" data-testid="preview-time">{secs(t)} / {secs(total.current)} s</span>
      </div>
    </section>
  )
}
