import { useState } from 'react'
import { ChevronLeft, ChevronRight, Copy, Plus, Trash2 } from 'lucide-react'
import type { PostDocument } from '../../../lib/postDocument'
import { LAYOUTS, type LayoutId } from '../../../lib/carousel/layouts'
import { MAX_SLIDES } from '../../../lib/carousel/ops'
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

const btn = 'inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40'

/** The slide strip: a vertical column on desktop, a horizontal scroller on phones. Reorder by dragging a thumbnail, or with the move buttons (which also work by touch and keyboard). */
export default function Filmstrip({ doc, activeId, onSelect, onAdd, onDuplicate, onDelete, onMove }: FilmstripProps) {
  const [dragId, setDragId] = useState<string | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)
  const [layout, setLayout] = useState<LayoutId>('title_body')
  const atMax = doc.pages.length >= MAX_SLIDES
  const activeIndex = doc.pages.findIndex(p => p.id === activeId)
  const only = doc.pages.length <= 1

  return (
    <section aria-label="Slides" data-testid="filmstrip" className="flex min-h-0 flex-col gap-2 rounded-lg border border-border bg-card p-2 md:h-full">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Slides <span data-testid="slide-count">{doc.pages.length}</span>/{MAX_SLIDES}</h2>
        <div className="flex items-center gap-1">
          <button type="button" className={btn} aria-label="Move slide earlier" title="Move earlier" disabled={activeIndex <= 0} onClick={() => onMove(activeId, activeIndex - 1)} data-testid="slide-move-earlier"><ChevronLeft className="h-4 w-4" /></button>
          <button type="button" className={btn} aria-label="Move slide later" title="Move later" disabled={activeIndex < 0 || activeIndex >= doc.pages.length - 1} onClick={() => onMove(activeId, activeIndex + 1)} data-testid="slide-move-later"><ChevronRight className="h-4 w-4" /></button>
          <button type="button" className={btn} aria-label="Duplicate slide" title="Duplicate slide" disabled={atMax} onClick={() => onDuplicate(activeId)} data-testid="slide-duplicate"><Copy className="h-4 w-4" /></button>
          <button type="button" className={btn} aria-label="Delete slide" title={only ? 'A carousel needs at least one slide' : 'Delete slide'} disabled={only} onClick={() => onDelete(activeId)} data-testid="slide-delete"><Trash2 className="h-4 w-4" /></button>
        </div>
      </div>

      <ol className="flex min-h-0 flex-1 gap-2 overflow-x-auto pb-1 md:flex-col md:overflow-x-hidden md:overflow-y-auto md:pb-0" data-testid="slide-list">
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
            className={cn('w-24 shrink-0 cursor-pointer rounded-md border-2 p-1 md:w-full', p.id === activeId ? 'border-primary bg-primary/5' : 'border-transparent hover:bg-muted', overIndex === i && dragId !== p.id && 'ring-2 ring-primary/60', dragId === p.id && 'opacity-50')}
          >
            <button type="button" onClick={() => onSelect(p.id)} className="block w-full text-left" aria-label={`Open slide ${i + 1}${p.name ? `: ${p.name}` : ''}`} aria-current={p.id === activeId ? 'true' : undefined}>
              <div className="pointer-events-none overflow-hidden rounded border border-border shadow-sm"><SlideView doc={doc} pageId={p.id} /></div>
              <div className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground"><span className="font-semibold text-foreground" data-testid="slide-number">{i + 1}</span><span className="truncate">{p.name?.replace(/^\d+\.\s*/, '') ?? 'Slide'}</span></div>
            </button>
          </li>
        ))}
      </ol>

      <div className="flex items-center gap-1.5">
        <select aria-label="Layout for the new slide" value={layout} onChange={e => setLayout(e.target.value as LayoutId)} className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs" data-testid="new-slide-layout">
          {LAYOUTS.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
        </select>
        <button type="button" disabled={atMax} onClick={() => onAdd(layout)} className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-2.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50" data-testid="slide-add"><Plus className="h-3.5 w-3.5" />Add</button>
      </div>
      {atMax && <p className="text-[11px] text-muted-foreground">Instagram allows at most {MAX_SLIDES} slides.</p>}
    </section>
  )
}
