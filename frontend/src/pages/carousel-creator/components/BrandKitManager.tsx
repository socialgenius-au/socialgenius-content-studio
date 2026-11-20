import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Copy, Loader2, Plus, Trash2, Upload } from 'lucide-react'
import type { BrandKit, BrandKitData, BrandKitSummary } from '../../../lib/carousel/brandKit'
import { emptyKit } from '../../../lib/carousel/brandKit'
import type { BrandKitStore } from '../../../lib/carousel/assetsStore'
import { CarouselServerError } from '../../../lib/carousel/serverStore'
import { withMediaToken } from '../../../api/mediaAccess'
import ImagePicker from './ImagePicker'

const field = 'h-8 w-full rounded-md border border-border bg-background px-2 text-sm'
const btn = 'inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs font-medium hover:bg-muted disabled:opacity-50'
const COLOR_FIELDS = [['primary', 'Primary'], ['secondary', 'Secondary'], ['accent', 'Accent'], ['background', 'Background'], ['text', 'Text']] as const
const newId = (p: string) => `${p}_${Math.random().toString(36).slice(2, 10)}`
const messageOf = (e: unknown) => (e instanceof CarouselServerError ? e.message : e instanceof Error ? e.message : String(e))

export const FONT_FILE_ACCEPT = '.ttf,.otf,.woff,.woff2'
export const MAX_FONT_FILE_BYTES = 8 * 1024 * 1024
export function validateFontFile(f: { name: string; size: number }): string | null {
  if (!/\.(ttf|otf|woff2?)$/i.test(f.name)) return `"${f.name}" is not a font file (.ttf, .otf, .woff or .woff2).`
  if (f.size > MAX_FONT_FILE_BYTES) return `"${f.name}" is larger than 8 MB.`
  return null
}

/** Create, edit, duplicate and delete the account's Brand Kits: brand names, colours, logos, custom fonts and reusable brand pictures. */
export default function BrandKitManager({ store, onClose, onChanged }: { store: BrandKitStore; onClose: () => void; onChanged?: () => void }) {
  const [kits, setKits] = useState<BrandKitSummary[] | null>(null)
  const [current, setCurrent] = useState<{ id: number | null; name: string; kit: BrandKitData } | null>(null)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const fontInput = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async () => { try { setKits(await store.list()); setError(null) } catch (e) { setKits([]); setError(messageOf(e)) } }, [store])
  useEffect(() => { void refresh() }, [refresh])

  const open = async (id: number) => {
    if (dirty && !window.confirm('Discard the changes you have not saved?')) return
    setBusy(true)
    try { const k: BrandKit = await store.get(id); setCurrent({ id: k.id, name: k.name, kit: k.kit }); setDirty(false); setError(null); setNote(null) } catch (e) { setError(messageOf(e)) } finally { setBusy(false) }
  }
  const startNew = () => { if (dirty && !window.confirm('Discard the changes you have not saved?')) return; setCurrent({ id: null, name: '', kit: emptyKit() }); setDirty(false); setError(null); setNote(null) }
  const edit = (fn: (k: BrandKitData) => BrandKitData) => { setCurrent(c => (c ? { ...c, kit: fn(c.kit) } : c)); setDirty(true) }

  const save = async () => {
    if (!current) return
    if (!current.name.trim()) { setError('Give the Brand Kit a name.'); return }
    setBusy(true); setError(null); setNote(null)
    try {
      const saved = current.id === null ? await store.create(current.name.trim(), current.kit) : await store.update(current.id, current.name.trim(), current.kit)
      setCurrent({ id: saved.id, name: saved.name, kit: saved.kit }); setDirty(false); setNote('Saved.'); await refresh(); onChanged?.()
    } catch (e) { setError(messageOf(e)) } finally { setBusy(false) }
  }
  const duplicate = async () => { if (current?.id == null) return; setBusy(true); try { const k = await store.duplicate(current.id); setCurrent({ id: k.id, name: k.name, kit: k.kit }); setDirty(false); await refresh(); onChanged?.() } catch (e) { setError(messageOf(e)) } finally { setBusy(false) } }
  const remove = async () => {
    if (current?.id == null || !window.confirm(`Delete the Brand Kit "${current.name}"? Your uploaded pictures and fonts stay in your media library. Carousels keep how they look now.`)) return
    setBusy(true); try { await store.remove(current.id); setCurrent(null); setDirty(false); await refresh(); onChanged?.() } catch (e) { setError(messageOf(e)) } finally { setBusy(false) }
  }
  const uploadFonts = async (files: FileList | null) => {
    const list = files ? Array.from(files) : []
    for (const f of list) { const problem = validateFontFile(f); if (problem) { setError(problem); return } }
    setBusy(true); setError(null)
    try {
      for (const f of list) {
        const up = await store.uploadFont(f)
        edit(k => ({ ...k, fonts: [...k.fonts, { id: newId('font'), family: up.familyGuess, asset_id: up.assetId, url: up.url, weight: 400, italic: false }] }))
      }
    } catch (e) { setError(messageOf(e)) } finally { setBusy(false); if (fontInput.current) fontInput.current.value = '' }
  }

  const kit = current?.kit
  return (
    <div className="mx-auto w-full max-w-5xl space-y-4" data-testid="brand-manager">
      <header className="flex flex-wrap items-center gap-2">
        <button type="button" className={btn} onClick={() => { if (!dirty || window.confirm('Leave without saving your changes?')) onClose() }} data-testid="manager-back"><ArrowLeft className="h-4 w-4" />Back</button>
        <h1 className="text-xl font-bold tracking-tight">Brand Kits</h1>
      </header>
      {error && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive" data-testid="manager-error">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <aside className="space-y-2 rounded-lg border border-border bg-card p-3" aria-label="Your Brand Kits">
          <button type="button" className={`${btn} w-full`} onClick={startNew} data-testid="new-kit"><Plus className="h-3.5 w-3.5" />New Brand Kit</button>
          {kits === null && <p className="text-xs text-muted-foreground">Loading…</p>}
          {kits?.length === 0 && <p className="text-xs text-muted-foreground" data-testid="no-kits-yet">No Brand Kits yet.</p>}
          <ul className="space-y-1">
            {(kits ?? []).map(k => (
              <li key={k.id}><button type="button" className={`flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-sm hover:bg-muted ${current?.id === k.id ? 'border-primary bg-primary/5' : 'border-border'}`} onClick={() => void open(k.id)} data-testid="kit-row">
                <span className="h-4 w-4 shrink-0 rounded-full border border-border" style={{ background: k.primary ?? '#cccccc' }} /><span className="min-w-0 flex-1 truncate">{k.name}</span><span className="text-[10px] text-muted-foreground">{k.logoCount} logo{k.logoCount === 1 ? '' : 's'}</span>
              </button></li>
            ))}
          </ul>
        </aside>

        <section className="space-y-4 rounded-lg border border-border bg-card p-4" aria-label="Brand Kit editor">
          {!current && <p className="text-sm text-muted-foreground">Choose a Brand Kit to edit, or create a new one.</p>}
          {current && kit && (
            <>
              <label className="block space-y-1 text-xs"><span className="text-muted-foreground">Kit name</span><input className={field} value={current.name} onChange={e => { setCurrent({ ...current, name: e.target.value }); setDirty(true) }} placeholder="e.g. Acme Tiles" data-testid="kit-name" /></label>

              <fieldset className="space-y-2" data-testid="kit-colors"><legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Colours</legend>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                  {COLOR_FIELDS.map(([key, label]) => (
                    <label key={key} className="space-y-1 text-xs"><span className="text-muted-foreground">{label}</span>
                      <span className="flex items-center gap-1"><input type="color" aria-label={`${label} colour`} className="h-8 w-10 rounded border border-border p-0.5" value={kit.colors[key] ?? '#808080'} onChange={e => edit(k => ({ ...k, colors: { ...k.colors, [key]: e.target.value.toUpperCase() } }))} data-testid={`color-${key}`} />
                        {kit.colors[key] && <button type="button" className="text-[11px] underline" onClick={() => edit(k => { const { [key]: _x, ...rest } = k.colors; void _x; return { ...k, colors: rest } })}>clear</button>}</span></label>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {(kit.colors.extra ?? []).map((e, i) => (
                    <span key={i} className="inline-flex items-center gap-1 rounded border border-border p-1 text-xs">
                      <input type="color" aria-label={`${e.name} colour`} className="h-6 w-8 rounded border border-border p-0" value={e.hex} onChange={ev => edit(k => ({ ...k, colors: { ...k.colors, extra: (k.colors.extra ?? []).map((x, j) => (j === i ? { ...x, hex: ev.target.value.toUpperCase() } : x)) } }))} />
                      <input className="h-6 w-24 rounded border border-border bg-background px-1" aria-label="Colour name" value={e.name} onChange={ev => edit(k => ({ ...k, colors: { ...k.colors, extra: (k.colors.extra ?? []).map((x, j) => (j === i ? { ...x, name: ev.target.value } : x)) } }))} />
                      <button type="button" aria-label={`Remove colour ${e.name}`} className="px-1" onClick={() => edit(k => ({ ...k, colors: { ...k.colors, extra: (k.colors.extra ?? []).filter((_, j) => j !== i) } }))}>×</button>
                    </span>
                  ))}
                  <button type="button" className={btn} onClick={() => edit(k => ({ ...k, colors: { ...k.colors, extra: [...(k.colors.extra ?? []), { name: 'Colour', hex: '#808080' }] } }))} data-testid="add-extra-color"><Plus className="h-3.5 w-3.5" />Another colour</button>
                </div>
              </fieldset>

              <fieldset className="space-y-2" data-testid="kit-names-editor"><legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Brand names</legend>
                {kit.brand_names.map((n, i) => (
                  <div key={n.id} className="grid grid-cols-[8rem_minmax(0,1fr)_auto] gap-2">
                    <input className={field} aria-label="Name label" placeholder="Label" value={n.label} onChange={e => edit(k => ({ ...k, brand_names: k.brand_names.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) }))} />
                    <input className={field} aria-label="Brand name text" placeholder="e.g. Acme Tiles" value={n.text} onChange={e => edit(k => ({ ...k, brand_names: k.brand_names.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) }))} />
                    <button type="button" className={btn} aria-label="Remove brand name" onClick={() => edit(k => ({ ...k, brand_names: k.brand_names.filter((_, j) => j !== i) }))}><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                ))}
                <button type="button" className={btn} onClick={() => edit(k => ({ ...k, brand_names: [...k.brand_names, { id: newId('name'), label: k.brand_names.length === 0 ? 'Full name' : 'Short name', text: '' }] }))} data-testid="add-brand-name"><Plus className="h-3.5 w-3.5" />Add a name</button>
              </fieldset>

              <fieldset className="space-y-2" data-testid="kit-logos-editor"><legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Logos</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {kit.logos.map((l, i) => (
                    <div key={l.id} className="flex items-center gap-2 rounded border border-border p-2">
                      {l.url ? <img src={withMediaToken(l.url)} alt="" className="h-10 w-14 shrink-0 object-contain" /> : null}
                      <input className={field} aria-label="Logo label" value={l.label} onChange={e => edit(k => ({ ...k, logos: k.logos.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) }))} />
                      <button type="button" className={btn} aria-label={`Remove logo ${l.label}`} onClick={() => edit(k => ({ ...k, logos: k.logos.filter((_, j) => j !== i) }))}><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  ))}
                </div>
                <ImagePicker onPick={() => undefined} onPickMany={imgs => edit(k => ({ ...k, logos: [...k.logos, ...imgs.map(im => ({ id: newId('logo'), label: im.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 60) || 'Logo', asset_id: im.assetId, url: im.url }))] }))} />
              </fieldset>

              <fieldset className="space-y-2" data-testid="kit-fonts-editor"><legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Custom fonts</legend>
                {kit.fonts.map((f, i) => (
                  <div key={f.id} className="grid grid-cols-[minmax(0,1fr)_5rem_auto_auto] items-center gap-2">
                    <input className={field} aria-label="Font family name" value={f.family} onChange={e => edit(k => ({ ...k, fonts: k.fonts.map((x, j) => (j === i ? { ...x, family: e.target.value } : x)) }))} />
                    <select className={field} aria-label="Font weight" value={f.weight} onChange={e => edit(k => ({ ...k, fonts: k.fonts.map((x, j) => (j === i ? { ...x, weight: Number(e.target.value) } : x)) }))}>{[300, 400, 500, 600, 700, 800, 900].map(w => <option key={w} value={w}>{w}</option>)}</select>
                    <span className="flex gap-1">
                      <button type="button" className={`${btn} ${kit.font_roles.heading === f.family ? 'bg-primary text-primary-foreground hover:bg-primary' : ''}`} aria-pressed={kit.font_roles.heading === f.family} onClick={() => edit(k => ({ ...k, font_roles: { ...k.font_roles, heading: f.family } }))}>Headings</button>
                      <button type="button" className={`${btn} ${kit.font_roles.body === f.family ? 'bg-primary text-primary-foreground hover:bg-primary' : ''}`} aria-pressed={kit.font_roles.body === f.family} onClick={() => edit(k => ({ ...k, font_roles: { ...k.font_roles, body: f.family } }))}>Body</button>
                    </span>
                    <button type="button" className={btn} aria-label={`Remove font ${f.family}`} onClick={() => edit(k => ({ ...k, fonts: k.fonts.filter((_, j) => j !== i), font_roles: { heading: k.font_roles.heading === f.family ? undefined : k.font_roles.heading, body: k.font_roles.body === f.family ? undefined : k.font_roles.body } }))}><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                ))}
                <input ref={fontInput} type="file" accept={FONT_FILE_ACCEPT} multiple className="hidden" onChange={e => void uploadFonts(e.target.files)} data-testid="font-file-input" />
                <button type="button" className={btn} disabled={busy} onClick={() => fontInput.current?.click()} data-testid="upload-font"><Upload className="h-3.5 w-3.5" />Upload font files (.ttf .otf .woff .woff2)</button>
              </fieldset>

              <fieldset className="space-y-2" data-testid="kit-assets-editor"><legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Other brand pictures</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {kit.assets.map((a, i) => (
                    <div key={a.id} className="flex items-center gap-2 rounded border border-border p-2">
                      {a.url ? <img src={withMediaToken(a.url)} alt="" className="h-10 w-14 shrink-0 rounded object-cover" /> : null}
                      <input className={field} aria-label="Picture label" value={a.label} onChange={e => edit(k => ({ ...k, assets: k.assets.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) }))} />
                      <button type="button" className={btn} aria-label={`Remove picture ${a.label}`} onClick={() => edit(k => ({ ...k, assets: k.assets.filter((_, j) => j !== i) }))}><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  ))}
                </div>
                <ImagePicker onPick={() => undefined} onPickMany={imgs => edit(k => ({ ...k, assets: [...k.assets, ...imgs.map(im => ({ id: newId('asset'), label: im.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 60) || 'Picture', asset_id: im.assetId, url: im.url }))] }))} />
              </fieldset>

              <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
                <button type="button" className={`${btn} bg-primary text-primary-foreground hover:bg-primary/90`} disabled={busy || !dirty} onClick={() => void save()} data-testid="save-kit">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}{current.id === null ? 'Create Brand Kit' : 'Save changes'}</button>
                {current.id !== null && <button type="button" className={btn} disabled={busy} onClick={() => void duplicate()} data-testid="duplicate-kit"><Copy className="h-3.5 w-3.5" />Duplicate</button>}
                {current.id !== null && <button type="button" className={`${btn} text-destructive`} disabled={busy} onClick={() => void remove()} data-testid="delete-kit"><Trash2 className="h-3.5 w-3.5" />Delete</button>}
                {note && <span role="status" className="text-xs text-emerald-700 dark:text-emerald-400">{note}</span>}
                {dirty && <span className="text-xs text-muted-foreground">Unsaved changes</span>}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
