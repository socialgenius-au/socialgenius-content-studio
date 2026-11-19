import { useMemo, useState } from 'react'
import { Copy, FilePlus2, Loader2, Trash2 } from 'lucide-react'
import { platformsFor } from '../../../lib/platformFormats'
import { createCarouselDocument, INSTAGRAM_CAROUSEL } from '../../../lib/carousel/document'
import { CAROUSEL_THEMES, DEFAULT_THEME_ID } from '../../../lib/carousel/layouts'
import type { ServerCarouselSummary } from '../../../lib/carousel/serverStore'
import type { ImportOutcome, LocalEntry } from '../../../lib/carousel/migration'
import type { PostDocument } from '../../../lib/postDocument'
import PlanPanel from './PlanPanel'

export interface StartScreenProps {
  items: ServerCarouselSummary[]
  listState: 'loading' | 'ready' | 'error'
  listError?: string
  onRetryList: () => void
  busy: boolean
  actionError?: string | null
  onOpen: (id: string) => void
  onDuplicate: (id: string) => void
  onDelete: (id: string) => void
  onCreate: (doc: PostDocument, themeId: string) => void
  /** Carousels that exist only in this browser (saved before accounts stored them). Empty/omitted = nothing to bring over. */
  local?: LocalEntry[]
  importResults?: Record<string, ImportOutcome>
  importing?: boolean
  onImportAll?: () => void
  onImportOne?: (id: string, asCopy: boolean) => void
  onRemoveLocal?: (id: string) => void
}

const when = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) }

const outcomeText = (o: ImportOutcome): string => {
  switch (o.status) {
    case 'imported': return 'Copied to your account.'
    case 'already-in-account': return 'Already in your account (identical). Nothing changed.'
    case 'exists-different': return o.message
    case 'unreadable': return `Could not read this one: ${o.message} It was left as it is.`
    case 'failed': return `Not copied: ${o.message} It is still saved in this browser.`
  }
}

function BrowserCopies({ local, results, importing, onImportAll, onImportOne, onRemoveLocal }: { local: LocalEntry[]; results: Record<string, ImportOutcome>; importing: boolean; onImportAll?: () => void; onImportOne?: (id: string, asCopy: boolean) => void; onRemoveLocal?: (id: string) => void }) {
  const notYet = local.filter(l => !l.imported)
  return (
    <section aria-label="Saved only in this browser" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-50" data-testid="browser-copies">
      <h2 className="text-sm font-semibold">Saved only in this browser</h2>
      <p className="mt-1 text-xs">These carousels were saved before your account stored them, so they are not on your other devices. Copy them to your account when you are ready. Nothing is deleted from this browser, and nothing in your account is overwritten.</p>
      {notYet.length > 1 && <button type="button" disabled={importing} onClick={onImportAll} className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-60" data-testid="import-all">{importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Copy className="h-3.5 w-3.5" />}Copy all {notYet.length} to my account</button>}
      <ul className="mt-3 space-y-2">
        {local.map(l => {
          const r = results[l.id]
          return (
            <li key={l.id} className="rounded-md border border-amber-300/70 bg-card p-2 text-foreground dark:border-amber-700/70" data-testid="browser-copy" data-imported={l.imported ? 'true' : 'false'}>
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{l.title}</span><span className="block text-xs text-muted-foreground">{l.slideCount} slide{l.slideCount === 1 ? '' : 's'} · {when(l.updatedAt)}</span></div>
                {!l.imported && <button type="button" disabled={importing} onClick={() => onImportOne?.(l.id, false)} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs font-medium hover:bg-muted disabled:opacity-60" aria-label={`Copy ${l.title} to my account`} data-testid="import-one">Copy to my account</button>}
                {l.imported && <button type="button" onClick={() => onRemoveLocal?.(l.id)} className="inline-flex h-8 items-center rounded-md border border-border bg-card px-2.5 text-xs hover:bg-muted" aria-label={`Remove ${l.title} from this browser`} data-testid="remove-local">Remove from this browser</button>}
              </div>
              {l.imported && !r && <p className="mt-1 text-xs text-muted-foreground" data-testid="import-state">In your account{l.imported.asCopy ? ' (as a separate copy)' : ''}. Still kept here until you remove it.</p>}
              {r && <p className={`mt-1 text-xs ${r.status === 'imported' || r.status === 'already-in-account' ? 'text-emerald-700 dark:text-emerald-300' : 'text-destructive'}`} role="status" data-testid="import-result" data-status={r.status}>{outcomeText(r)}{r.status === 'exists-different' && <button type="button" onClick={() => onImportOne?.(l.id, true)} className="ml-2 underline" data-testid="import-as-copy">Import as a separate copy</button>}</p>}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

export default function StartScreen(p: StartScreenProps) {
  const [tab, setTab] = useState<'new' | 'plan'>('new')
  const [title, setTitle] = useState('')
  const [format, setFormat] = useState(`${INSTAGRAM_CAROUSEL.platformKey}/${INSTAGRAM_CAROUSEL.formatKey}`)
  const [themeId, setThemeId] = useState(DEFAULT_THEME_ID)
  const options = useMemo(() => platformsFor('carousel').flatMap(pl => pl.placements.filter(x => x.mediaTypes.includes('carousel')).map(x => ({ value: `${pl.key}/${x.key}`, label: `${pl.label} · ${x.label} (${x.ratio})` }))), [])

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6" data-testid="carousel-start">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Carousel Creator</h1>
        <p className="text-sm text-muted-foreground">Build a swipeable carousel slide by slide. Edit text, pictures and backgrounds, then export every slide as images or one PDF. Your carousels are saved to your account.</p>
      </header>
      {p.actionError && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive" data-testid="action-error">{p.actionError}</p>}
      {p.local && p.local.length > 0 && <BrowserCopies local={p.local} results={p.importResults ?? {}} importing={!!p.importing} onImportAll={p.onImportAll} onImportOne={p.onImportOne} onRemoveLocal={p.onRemoveLocal} />}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="rounded-lg border border-border bg-card p-4">
          <div role="tablist" aria-label="How to start" className="mb-4 flex gap-1 rounded-md bg-muted p-1 text-sm">
            <button role="tab" aria-selected={tab === 'new'} type="button" onClick={() => setTab('new')} className={`flex-1 rounded px-3 py-1.5 font-medium ${tab === 'new' ? 'bg-card shadow-sm' : 'text-muted-foreground'}`} data-testid="tab-new">Start from scratch</button>
            <button role="tab" aria-selected={tab === 'plan'} type="button" onClick={() => setTab('plan')} className={`flex-1 rounded px-3 py-1.5 font-medium ${tab === 'plan' ? 'bg-card shadow-sm' : 'text-muted-foreground'}`} data-testid="tab-plan">Plan from a blueprint</button>
          </div>

          {tab === 'new' ? (
            <form className="space-y-3" onSubmit={e => { e.preventDefault(); const [platformKey, formatKey] = format.split('/'); p.onCreate(createCarouselDocument({ title, platformKey, formatKey, themeId }), themeId) }} data-testid="new-form">
              <label className="block space-y-1 text-xs"><span className="text-muted-foreground">Carousel name</span><input className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. 5 tile mistakes to avoid" data-testid="new-title" /></label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block space-y-1 text-xs"><span className="text-muted-foreground">Format</span><select className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm" value={format} onChange={e => setFormat(e.target.value)} data-testid="new-format">{options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
                <label className="block space-y-1 text-xs"><span className="text-muted-foreground">Colour theme</span><select className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm" value={themeId} onChange={e => setThemeId(e.target.value)} data-testid="new-theme">{CAROUSEL_THEMES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}</select></label>
              </div>
              <button type="submit" disabled={p.busy} className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60" data-testid="new-create">{p.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FilePlus2 className="h-4 w-4" />}Create carousel</button>
              <p className="text-xs text-muted-foreground">Starts with a cover, an explanation slide and a call to action. Add, remove and reorder slides in the editor.</p>
            </form>
          ) : (
            <PlanPanel onCreate={doc => p.onCreate(doc, themeId)} />
          )}
        </section>

        <section aria-label="Your carousels" className="rounded-lg border border-border bg-card p-4" data-testid="saved-list" data-state={p.listState}>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your carousels</h2>
          {p.listState === 'loading' && <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><Loader2 className="h-4 w-4 animate-spin" />Loading your carousels…</p>}
          {p.listState === 'error' && <p className="text-sm text-destructive" role="alert" data-testid="list-error">{p.listError ?? 'Could not load your carousels.'} <button type="button" className="underline" onClick={p.onRetryList} data-testid="retry-list">Try again</button></p>}
          {p.listState === 'ready' && p.items.length === 0 && <p className="text-sm text-muted-foreground" data-testid="empty-list">Nothing saved yet. Carousels you create are saved to your account automatically.</p>}
          <ul className="space-y-2">
            {p.items.map(s => (
              <li key={s.id} className="flex items-center gap-1 rounded-md border border-border p-2" data-testid="saved-item" data-doc-id={s.id}>
                <button type="button" onClick={() => p.onOpen(s.id)} className="min-w-0 flex-1 text-left" aria-label={`Open ${s.title}`}>
                  <span className="block truncate text-sm font-medium">{s.title}</span>
                  <span className="block text-xs text-muted-foreground">{s.slideCount} slide{s.slideCount === 1 ? '' : 's'} · {when(s.updatedAt)}</span>
                </button>
                <button type="button" disabled={p.busy} className="rounded p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-50" aria-label={`Duplicate ${s.title}`} title="Duplicate" onClick={() => p.onDuplicate(s.id)} data-testid="duplicate-item"><Copy className="h-4 w-4" /></button>
                <button type="button" disabled={p.busy} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive disabled:opacity-50" aria-label={`Delete ${s.title}`} title="Delete" onClick={() => { if (window.confirm(`Delete "${s.title}"? This cannot be undone.`)) p.onDelete(s.id) }} data-testid="delete-item"><Trash2 className="h-4 w-4" /></button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}
