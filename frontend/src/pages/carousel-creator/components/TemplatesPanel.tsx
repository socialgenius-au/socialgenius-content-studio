import { useState } from 'react'
import { Copy, Pencil, Trash2 } from 'lucide-react'
import type { InsertMode, TemplateSummary } from '../../../lib/carousel/templates'

export interface TemplatesPanelProps {
  templates: TemplateSummary[] | null
  error?: string | null
  busy?: boolean
  message?: string | null
  onSave: (scope: 'carousel' | 'slide', name: string, description: string) => void
  onApply: (id: number, mode: InsertMode) => void
  onDuplicate: (id: number) => void
  onRename: (id: number, name: string) => void
  onUpdateFrom: (id: number, scope: 'carousel' | 'slide') => void
  onDelete: (id: number) => void
}

const btn = 'inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs font-medium hover:bg-muted disabled:opacity-50'

/** Save the open carousel (or just the open slide) as a reusable template, and apply, duplicate, rename, update or delete saved templates. Applying always inserts a COPY. */
export default function TemplatesPanel(p: TemplatesPanelProps) {
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [renaming, setRenaming] = useState<number | null>(null)
  const [renameTo, setRenameTo] = useState('')
  const ready = name.trim().length > 0 && !p.busy

  return (
    <section aria-label="Templates" data-testid="templates-panel" className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Templates</h3>
      {p.error && <p role="alert" className="text-xs text-destructive" data-testid="templates-error">{p.error}</p>}
      {p.message && <p role="status" className="text-xs text-emerald-700 dark:text-emerald-400" data-testid="templates-message">{p.message}</p>}

      <div className="space-y-1.5 rounded-md border border-border p-2" data-testid="save-template">
        <p className="text-xs font-medium">Save as a template</p>
        <input className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm" placeholder="Template name" aria-label="Template name" value={name} onChange={e => setName(e.target.value)} data-testid="template-name" />
        <input className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm" placeholder="Description (optional)" aria-label="Template description" value={desc} onChange={e => setDesc(e.target.value)} />
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className={btn} disabled={!ready} onClick={() => { p.onSave('carousel', name.trim(), desc.trim()); setName(''); setDesc('') }} data-testid="save-carousel-template">Whole carousel</button>
          <button type="button" className={btn} disabled={!ready} onClick={() => { p.onSave('slide', name.trim(), desc.trim()); setName(''); setDesc('') }} data-testid="save-slide-template">This slide as a layout</button>
        </div>
      </div>

      {p.templates === null && !p.error && <p className="text-xs text-muted-foreground">Loading your templates…</p>}
      {p.templates !== null && p.templates.length === 0 && <p className="text-xs text-muted-foreground" data-testid="no-templates">No templates yet. Save a carousel or a slide above to reuse it.</p>}
      <ul className="space-y-2">
        {(p.templates ?? []).map(t => (
          <li key={t.id} className="space-y-1.5 rounded-md border border-border p-2 text-xs" data-testid="template-item" data-template-id={t.id}>
            {renaming === t.id ? (
              <form className="flex gap-1.5" onSubmit={e => { e.preventDefault(); if (renameTo.trim()) p.onRename(t.id, renameTo.trim()); setRenaming(null) }}>
                <input className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-sm" aria-label="New template name" value={renameTo} onChange={e => setRenameTo(e.target.value)} autoFocus />
                <button type="submit" className={btn}>Save</button>
              </form>
            ) : (
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0"><p className="truncate text-sm font-medium">{t.name}</p><p className="text-muted-foreground">{t.kind === 'layout' ? 'Layout' : 'Carousel'} · {t.slideCount} slide{t.slideCount === 1 ? '' : 's'}{t.description ? ` · ${t.description}` : ''}</p></div>
                <div className="flex shrink-0 gap-0.5">
                  <button type="button" className="rounded p-1.5 hover:bg-muted" aria-label={`Rename ${t.name}`} onClick={() => { setRenaming(t.id); setRenameTo(t.name) }}><Pencil className="h-3.5 w-3.5" /></button>
                  <button type="button" className="rounded p-1.5 hover:bg-muted" aria-label={`Duplicate ${t.name}`} disabled={p.busy} onClick={() => p.onDuplicate(t.id)} data-testid="template-duplicate"><Copy className="h-3.5 w-3.5" /></button>
                  <button type="button" className="rounded p-1.5 text-destructive hover:bg-muted" aria-label={`Delete ${t.name}`} disabled={p.busy} onClick={() => { if (window.confirm(`Delete the template "${t.name}"? Carousels made from it are not affected.`)) p.onDelete(t.id) }} data-testid="template-delete"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              </div>
            )}
            <div className="flex flex-wrap gap-1.5">
              <button type="button" className={btn} disabled={p.busy} onClick={() => p.onApply(t.id, 'after')} data-testid="template-apply-after">Insert after this slide</button>
              <button type="button" className={btn} disabled={p.busy} onClick={() => p.onApply(t.id, 'end')} data-testid="template-apply-end">Add to the end</button>
              <button type="button" className={btn} disabled={p.busy} onClick={() => { if (window.confirm('Replace the open slide with this template? You can undo this.')) p.onApply(t.id, 'replace') }} data-testid="template-apply-replace">Replace this slide</button>
            </div>
            <div className="flex flex-wrap gap-1.5 text-[11px]">
              <button type="button" className="underline" disabled={p.busy} onClick={() => { if (window.confirm(`Overwrite "${t.name}" with this whole carousel?`)) p.onUpdateFrom(t.id, 'carousel') }} data-testid="template-update-carousel">Update from this carousel</button>
              <button type="button" className="underline" disabled={p.busy} onClick={() => { if (window.confirm(`Overwrite "${t.name}" with the open slide?`)) p.onUpdateFrom(t.id, 'slide') }}>Update from this slide</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
