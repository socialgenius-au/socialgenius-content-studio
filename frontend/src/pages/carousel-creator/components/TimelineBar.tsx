import type { AudioTrack, PostDocument } from '../../../lib/postDocument'
import { audibleWindow } from '../../../lib/carousel/audio'
import { buildTimeline } from '../../../lib/carousel/animation'
import { previewDocFor, type PreviewScope } from './MotionPreview'

const secs = (ms: number) => (ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 1)

/** The tick spacing (ms) that keeps the ruler readable. */
export function tickStep(totalMs: number): number {
  for (const s of [500, 1000, 2000, 5000, 10000, 15000, 30000, 60000, 120000, 300000]) if (totalMs / s <= 12) return s
  return 600000
}

export interface TimelineBarProps {
  doc: PostDocument
  scope: PreviewScope
  activePageId: string
  /** Playhead, ms. */
  t: number
  onSeek: (ms: number) => void
  onSelectSlide: (id: string) => void
  audio?: AudioTrack
}

/**
 * A timeline of the animation: a ruler, one block per slide (width = how long it is shown, with the overlap of each transition marked), the background music's audible span, and the
 * playhead. Click anywhere to move the playhead; a slide block also opens that slide. Everything is also reachable with the keyboard (each block is a button).
 */
export default function TimelineBar({ doc, scope, activePageId, t, onSeek, onSelectSlide, audio }: TimelineBarProps) {
  const d = previewDocFor(doc, scope, activePageId)
  const tl = buildTimeline(d)
  const total = Math.max(1, tl.totalMs)
  const w = audio ? audibleWindow(audio, total) : null
  const pct = (ms: number) => `${Math.max(0, Math.min(100, (ms / total) * 100))}%`
  const step = tickStep(total)
  const ticks: number[] = []
  for (let ms = 0; ms <= total; ms += step) ticks.push(ms)
  const seekFromPointer = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    onSeek(Math.round(Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width))) * (total - 1)))
  }
  return (
    <section aria-label="Timeline" data-testid="timeline" className="space-y-1">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Timeline</h3>
      <div className="relative select-none" onClick={seekFromPointer} data-testid="timeline-track">
        <div className="relative h-4 border-b border-border text-[10px] text-muted-foreground" aria-hidden>
          {ticks.map(ms => <span key={ms} className="absolute top-0 -translate-x-1/2 whitespace-nowrap" style={{ left: pct(ms) }}>{secs(ms)}s</span>)}
        </div>
        <div className="relative mt-1 h-9">
          {tl.slides.map(s => {
            const page = d.pages[s.index]
            const slideNo = doc.pages.findIndex(p => p.id === page.id) + 1
            return (
              <button key={page.id} type="button" onClick={e => { e.stopPropagation(); onSelectSlide(page.id); onSeek(Math.round(s.start)) }} data-testid="timeline-slide" data-slide-id={page.id} data-start={s.start} data-duration={s.duration}
                aria-label={`Slide ${slideNo}, ${secs(s.duration)} seconds${s.transition.durationMs ? `, ${s.transition.kind} transition of ${secs(s.transition.durationMs)} seconds` : ''}`}
                className={`absolute top-0 h-9 overflow-hidden rounded border px-1 text-left text-[10px] ${page.id === activePageId ? 'border-primary bg-primary/20' : 'border-border bg-muted'}`} style={{ left: pct(s.start), width: pct(s.duration) }}>
                {s.transition.durationMs > 0 && <span className="absolute inset-y-0 left-0 bg-amber-400/40" style={{ width: `${(s.transition.durationMs / s.duration) * 100}%` }} title={`${s.transition.kind} transition`} />}
                <span className="relative font-semibold">{slideNo}</span>
              </button>
            )
          })}
        </div>
        <div className="relative mt-1 h-5" data-testid="timeline-audio-row">
          {audio && w && <div className="absolute top-0 h-5 truncate rounded bg-sky-500/30 px-1 text-[10px] leading-5 text-sky-900 dark:text-sky-100" style={{ left: pct(w.startMs), width: `${((w.endMs - w.startMs) / total) * 100}%` }} data-testid="timeline-audio" title={audio.name}>♪ {audio.name}</div>}
          {audio && !w && <p className="text-[10px] text-muted-foreground" data-testid="timeline-audio-silent">{audio.muted ? 'Music is muted.' : 'The music falls outside this timeline.'}</p>}
        </div>
        <div className="pointer-events-none absolute inset-y-0 w-px bg-red-500" style={{ left: pct(t) }} data-testid="timeline-playhead" />
      </div>
    </section>
  )
}
