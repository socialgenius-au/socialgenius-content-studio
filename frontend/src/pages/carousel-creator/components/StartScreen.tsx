import { useMemo, useState } from 'react'
import { FilePlus2, Trash2 } from 'lucide-react'
import { platformsFor } from '../../../lib/platformFormats'
import { createCarouselDocument, INSTAGRAM_CAROUSEL } from '../../../lib/carousel/document'
import { CAROUSEL_THEMES, DEFAULT_THEME_ID } from '../../../lib/carousel/layouts'
import type { CarouselSummary } from '../../../lib/carousel/storage'
import type { PostDocument } from '../../../lib/postDocument'
import PlanPanel from './PlanPanel'

export interface StartScreenProps {
  saved: CarouselSummary[]
  storageAvailable: boolean
  onOpen: (id: string) => void
  onDelete: (id: string) => void
  onCreate: (doc: PostDocument, themeId: string) => void
}

const when = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) }

export default function StartScreen({ saved, storageAvailable, onOpen, onDelete, onCreate }: StartScreenProps) {
  const [tab, setTab] = useState<'new' | 'plan'>('new')
  const [title, setTitle] = useState('')
  const [format, setFormat] = useState(`${INSTAGRAM_CAROUSEL.platformKey}/${INSTAGRAM_CAROUSEL.formatKey}`)
  const [themeId, setThemeId] = useState(DEFAULT_THEME_ID)
  const options = useMemo(() => platformsFor('carousel').flatMap(p => p.placements.filter(pl => pl.mediaTypes.includes('carousel')).map(pl => ({ value: `${p.key}/${pl.key}`, label: `${p.label} · ${pl.label} (${pl.ratio})` }))), [])

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6" data-testid="carousel-start">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Carousel Creator</h1>
        <p className="text-sm text-muted-foreground">Build a swipeable carousel slide by slide. Edit text, pictures and backgrounds, then export every slide as images or one PDF.</p>
      </header>
      {!storageAvailable && <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100" data-testid="no-storage">Your browser is blocking site storage, so carousels cannot be saved between visits. You can still create and export one in this tab.</p>}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="rounded-lg border border-border bg-card p-4">
          <div role="tablist" aria-label="How to start" className="mb-4 flex gap-1 rounded-md bg-muted p-1 text-sm">
            <button role="tab" aria-selected={tab === 'new'} type="button" onClick={() => setTab('new')} className={`flex-1 rounded px-3 py-1.5 font-medium ${tab === 'new' ? 'bg-card shadow-sm' : 'text-muted-foreground'}`} data-testid="tab-new">Start from scratch</button>
            <button role="tab" aria-selected={tab === 'plan'} type="button" onClick={() => setTab('plan')} className={`flex-1 rounded px-3 py-1.5 font-medium ${tab === 'plan' ? 'bg-card shadow-sm' : 'text-muted-foreground'}`} data-testid="tab-plan">Plan from a blueprint</button>
          </div>

          {tab === 'new' ? (
            <form className="space-y-3" onSubmit={e => { e.preventDefault(); const [platformKey, formatKey] = format.split('/'); onCreate(createCarouselDocument({ title, platformKey, formatKey, themeId }), themeId) }} data-testid="new-form">
              <label className="block space-y-1 text-xs"><span className="text-muted-foreground">Carousel name</span><input className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. 5 tile mistakes to avoid" data-testid="new-title" /></label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block space-y-1 text-xs"><span className="text-muted-foreground">Format</span><select className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm" value={format} onChange={e => setFormat(e.target.value)} data-testid="new-format">{options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
                <label className="block space-y-1 text-xs"><span className="text-muted-foreground">Colour theme</span><select className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm" value={themeId} onChange={e => setThemeId(e.target.value)} data-testid="new-theme">{CAROUSEL_THEMES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}</select></label>
              </div>
              <button type="submit" className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90" data-testid="new-create"><FilePlus2 className="h-4 w-4" />Create carousel</button>
              <p className="text-xs text-muted-foreground">Starts with a cover, an explanation slide and a call to action. Add, remove and reorder slides in the editor.</p>
            </form>
          ) : (
            <PlanPanel onCreate={doc => onCreate(doc, themeId)} />
          )}
        </section>

        <section aria-label="Your carousels" className="rounded-lg border border-border bg-card p-4" data-testid="saved-list">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your carousels</h2>
          {saved.length === 0 && <p className="text-sm text-muted-foreground">Nothing saved yet. Carousels you create are saved automatically in this browser.</p>}
          <ul className="space-y-2">
            {saved.map(s => (
              <li key={s.id} className="flex items-center gap-2 rounded-md border border-border p-2" data-testid="saved-item">
                <button type="button" onClick={() => onOpen(s.id)} className="min-w-0 flex-1 text-left" aria-label={`Open ${s.title}`}>
                  <span className="block truncate text-sm font-medium">{s.title}</span>
                  <span className="block text-xs text-muted-foreground">{s.slideCount} slide{s.slideCount === 1 ? '' : 's'} · {when(s.updatedAt)}</span>
                </button>
                <button type="button" className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive" aria-label={`Delete ${s.title}`} onClick={() => { if (window.confirm(`Delete "${s.title}"? This cannot be undone.`)) onDelete(s.id) }}><Trash2 className="h-4 w-4" /></button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}
