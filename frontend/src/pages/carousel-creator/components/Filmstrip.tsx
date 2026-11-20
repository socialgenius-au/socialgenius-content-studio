import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Copy, Plus, Trash2 } from 'lucide-react'
import type { PostDocument } from '../../../lib/postDocument'
import { LAYOUTS, type LayoutId } from '../../../lib/carousel/layouts'
import { cn } from '@/lib/utils'
import SlideView from './SlideView'

export interface FilmstripProps {
  doc: PostDocument
  activeId: string
  onSelect: (id: string) => void
  onAdd: (layout: LayoutId) => void
  onDuplicate: (id: string) => void
  onDelete: (id: string) => void
  onMove: (id: string, toIndex: number) => void
}

/**
 * A slide thumbnail that is only drawn while it is near the visible part of the strip. A carousel of hundreds of slides therefore keeps a handful of real thumbnails
 * in the page and a cheap, correctly sized placeholder for the rest. Without IntersectionObserver (old browsers, server rendering) every thumbnail is drawn.
 */
function LazyThumb({ doc, pageId }: { doc: PostDocument; pageId: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(entries => { for (const e of entries) setNear(e.isIntersecting) }, { rootMargin: '400px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return (
    <div ref={ref} className="pointer-events-none overflow-hidden rounded border border-border shadow-sm" data-thumb={near ? 'drawn' : 'placeholder'}>
      {near ? <SlideView doc={doc} pageId={pageId} /> : <div style={{ width: '100%', aspectRatio: `${doc.format.width} / ${doc.format.height}`, background: 'var(--muted, #eee)' }} />}
    </div>
  )
}

const btn = 'inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40'

/** The slide strip: a vertical column on desktop, a horizontal scroller on phones. Reorder by dragging a thumbnail, or with the move buttons (which also work by touch and keyboard). */
export default function Filmstrip({ doc, activeId, onSelect, onAdd, onDuplicate, onDelete, onMove }: FilmstripProps) {
  const [dragId, setDragId] = useState<string | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)
  const [layout, setLayout] = useState<LayoutId>('title_body')
  const activeIndex = doc.pages.findIndex(p => p.id === activeId)
  const only = doc.pages.length <= 1

  return (
    <section aria-label="Slides" data-testid="filmstrip" className="flex min-h-0 flex-col gap-2 rounded-lg border border-border bg-card p-2 xl:flex-1">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Slides <span data-testid="slide-count">{doc.pages.length}</span></h2>
        <div className="flex items-center gap-1">
          <button type="button" className={btn} aria-label="Move slide earlier" title="Move earlier" disabled={activeIndex <= 0} onClick={() => onMove(activeId, activeIndex - 1)} data-testid="slide-move-earlier"><ChevronLeft className="h-4 w-4" /></button>
          <button type="button" className={btn} aria-label="Move slide later" title="Move later" disabled={activeIndex < 0 || activeIndex >= doc.pages.length - 1} onClick={() => onMove(activeId, activeIndex + 1)} data-testid="slide-move-later"><ChevronRight className="h-4 w-4" /></button>
          <button type="button" className={btn} aria-label="Duplicate slide" title="Duplicate slide" onClick={() => onDuplicate(activeId)} data-testid="slide-duplicate"><Copy className="h-4 w-4" /></button>
          <button type="button" className={btn} aria-label="Delete slide" title={only ? 'A carousel needs at least one slide' : 'Delete slide'} disabled={only} onClick={() => onDelete(activeId)} data-testid="slide-delete"><Trash2 className="h-4 w-4" /></button>
        </div>
      </div>

      <ol className="flex min-h-0 flex-1 gap-2 overflow-x-auto pb-1 xl:flex-col xl:overflow-x-hidden xl:overflow-y-auto xl:overscroll-contain xl:pb-0" data-testid="slide-list">
        {doc.pages.map((p, i) => (
          <li
            key={p.id}
            draggable
            data-testid="slide-item"
            data-slide-id={p.id}
            data-active={p.id === activeId ? 'true' : undefined}
            onDragStart={e => { setDragId(p.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', p.id) }}
            onDragOver={e => { if (dragId) { e.preventDefault(); setOverIndex(i) } }}
            onDragLeave={() => setOverIndex(cur => (cur === i ? null : cur))}
            onDrop={e => { e.preventDefault(); if (dragId && dragId !== p.id) onMove(dragId, i); setDragId(null); setOverIndex(null) }}
            onDragEnd={() => { setDragId(null); setOverIndex(null) }}
            className={cn('w-24 shrink-0 cursor-pointer rounded-md border-2 p-1 xl:w-full', p.id === activeId ? 'border-primary bg-primary/5' : 'border-transparent hover:bg-muted', overIndex === i && dragId !== p.id && 'ring-2 ring-primary/60', dragId === p.id && 'opacity-50')}
          >
            <button type="button" onClick={() => onSelect(p.id)} className="block w-full text-left" aria-label={`Open slide ${i + 1}${p.name ? `: ${p.name}` : ''}`} aria-current={p.id === activeId ? 'true' : undefined}>
              <LazyThumb doc={doc} pageId={p.id} />
              <div className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground"><span className="font-semibold text-foreground" data-testid="slide-number">{i + 1}</span><span className="truncate">{p.name?.replace(/^\d+\.\s*/, '') ?? 'Slide'}</span></div>
            </button>
          </li>
        ))}
      </ol>

      <div className="flex items-center gap-1.5">
        <select aria-label="Layout for the new slide" value={layout} onChange={e => setLayout(e.target.value as LayoutId)} className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs" data-testid="new-slide-layout">
          {LAYOUTS.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
        </select>
        <button type="button" onClick={() => onAdd(layout)} className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-2.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50" data-testid="slide-add"><Plus className="h-3.5 w-3.5" />Add</button>
      </div>
    </section>
  )
}
