import { useEffect, useState, type Dispatch } from 'react'
import { Trash2 } from 'lucide-react'
import type { PostDocument, PostElement, PostPage } from '../../../lib/postDocument'
import { validateLinkUrl } from '../../../lib/postDocument'
import type { CarouselTheme } from '../../../lib/carousel/layouts'
import { GRADIENT_PRESETS, SOLID_PRESETS, gradientBackground, newAddressText, newDynamicText, newLocationText, newMapImage, newQr, newShape, patternBackground, DYNAMIC_NAMES } from '../../../lib/carousel/designLibrary'
import { PATTERNS, type PatternId } from '../../../lib/carousel/patterns'
import { PLAIN_SHAPES, SHAPES, SHAPE_CATEGORIES, svgPoints } from '../../../lib/carousel/shapes'
import { QrError, qrFor } from '../../../lib/carousel/qr'
import { instantiateElements, type LibraryStore, type LibrarySummary } from '../../../lib/carousel/libraryStore'
import { CarouselServerError } from '../../../lib/carousel/serverStore'
import type { DynamicKind } from '../../../lib/postDocument'
import type { EditorAction } from '../editorState'
import { AdjustControls } from './ElementControls'
import { LinkMessage } from './InfoControls'

const btn = 'inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs font-medium hover:bg-muted disabled:opacity-50'
const messageOf = (e: unknown) => (e instanceof CarouselServerError ? e.message : e instanceof Error ? e.message : String(e))

export interface DesignPanelProps {
  doc: PostDocument
  page: PostPage
  theme: CarouselTheme
  selectedIds: string[]
  dispatch: Dispatch<EditorAction>
  libraryStore: LibraryStore
}

function ShapeGlyph({ kind }: { kind: string }) {
  const def = SHAPES.find(s => s.id === kind)
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden>
      {def ? <polygon points={svgPoints(def.points, 22, 22)} transform="translate(1 1)" fill="currentColor" /> : kind === 'ellipse' ? <ellipse cx="12" cy="12" rx="10" ry="10" fill="currentColor" /> : kind === 'line' ? <rect x="1" y="11" width="22" height="2" fill="currentColor" /> : <rect x="2" y="4" width="20" height="16" rx="2" fill="currentColor" />}
    </svg>
  )
}

/**
 * Design library: backgrounds (colours, gradients, patterns and textures, picture effects), shapes, information elements (dates, countdowns, location, address, map, QR code), and the
 * account's saved library items.
 */
export default function DesignPanel({ doc, page, theme, selectedIds, dispatch, libraryStore }: DesignPanelProps) {
  const bg = page.background
  const [qrText, setQrText] = useState('https://')
  const [items, setItems] = useState<LibrarySummary[] | null>(null)
  const [name, setName] = useState('')
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { let live = true; libraryStore.list().then(l => { if (live) setItems(l) }).catch(e => { if (live) { setItems([]); setMsg({ tone: 'error', text: messageOf(e) }) } }); return () => { live = false } }, [libraryStore])

  const add = (el: PostElement) => dispatch({ type: 'addPrepared', element: el })
  const qrCheck = validateLinkUrl(qrText)
  const qrReady = qrCheck.ok && !(qrFor(qrCheck.url) instanceof QrError)
  const selectedEls = page.elements.filter(e => selectedIds.includes(e.id))
  const run = async (fn: () => Promise<string | void>) => { setBusy(true); setMsg(null); try { const m = await fn(); if (m) setMsg({ tone: 'ok', text: m }) } catch (e) { setMsg({ tone: 'error', text: messageOf(e) }) } finally { setBusy(false) } }
  const reload = async () => setItems(await libraryStore.list())

  return (
    <div className="space-y-4" data-testid="design-panel">
      <section aria-label="Backgrounds" className="space-y-2" data-testid="design-backgrounds">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Backgrounds for this slide</h3>
        <div className="flex flex-wrap gap-1.5" aria-label="Solid colours">
          {SOLID_PRESETS.map(c => <button key={c} type="button" className="h-6 w-6 rounded-full border border-border" style={{ background: c }} title={c} aria-label={`Background colour ${c}`} onClick={() => dispatch({ type: 'setBackground', background: { kind: 'solid', color: c } })} />)}
        </div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Gradients</p>
        <div className="grid grid-cols-4 gap-1.5" data-testid="gradient-presets">
          {GRADIENT_PRESETS.map(g => <button key={g.id} type="button" className="h-9 rounded border border-border text-[10px] font-medium text-white" style={{ background: `linear-gradient(${g.angle}deg, ${g.from}, ${g.to})`, textShadow: '0 1px 2px rgba(0,0,0,.5)' }} aria-label={`Gradient ${g.label}`} onClick={() => dispatch({ type: 'setBackground', background: gradientBackground(g) })}>{g.label}</button>)}
        </div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Patterns and textures</p>
        <div className="grid grid-cols-3 gap-1.5" data-testid="pattern-presets">
          {PATTERNS.map(p => <button key={p.id} type="button" className="overflow-hidden rounded border border-border p-1 text-left text-[10px] hover:ring-2 hover:ring-primary" aria-label={`Pattern ${p.label}`} onClick={() => dispatch({ type: 'setBackground', background: patternBackground(p.id as PatternId, theme) })}><span className="mb-1 block h-8 rounded" style={{ backgroundColor: theme.background, backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'>${p.tile.items.map(i => (i.t === 'rect' ? `<rect x='${i.x}' y='${i.y}' width='${i.w}' height='${i.h}' fill='${theme.foreground}' fill-opacity='.45'/>` : i.t === 'circle' ? `<circle cx='${i.cx}' cy='${i.cy}' r='${i.r}' fill='${theme.foreground}' fill-opacity='.45'/>` : `<line x1='${i.x1}' y1='${i.y1}' x2='${i.x2}' y2='${i.y2}' stroke='${theme.foreground}' stroke-opacity='.45' stroke-width='${i.w}'/>`)).join('')}</svg>`)}")`, backgroundSize: `${Math.max(8, p.size * 260)}px` }} />{p.label}</button>)}
        </div>
        {bg.kind === 'pattern' && (
          <div className="space-y-1.5 rounded-md border border-border p-2" data-testid="pattern-controls">
            <label className="flex items-center gap-2 text-xs"><span className="w-20 text-muted-foreground">Size</span><input type="range" aria-label="Pattern size" min={0.25} max={4} step={0.05} value={bg.scale} onChange={e => dispatch({ type: 'setBackground', background: { ...bg, scale: Number(e.target.value) } })} className="flex-1" data-testid="pattern-scale" /></label>
            <label className="flex items-center gap-2 text-xs"><span className="w-20 text-muted-foreground">Pattern colour</span><input type="color" aria-label="Pattern colour" value={typeof bg.color === 'string' ? bg.color.slice(0, 7) : '#ffffff'} onChange={e => dispatch({ type: 'setBackground', background: { ...bg, color: `${e.target.value}55` } })} className="h-8 w-12 rounded border border-border p-0.5" /></label>
            <label className="flex items-center gap-2 text-xs"><span className="w-20 text-muted-foreground">Base colour</span><input type="color" aria-label="Pattern base colour" value={typeof bg.background === 'string' ? bg.background.slice(0, 7) : '#000000'} onChange={e => dispatch({ type: 'setBackground', background: { ...bg, background: e.target.value } })} className="h-8 w-12 rounded border border-border p-0.5" /></label>
          </div>
        )}
        {bg.kind === 'image' && (
          <div className="space-y-2 rounded-md border border-border p-2" data-testid="background-effects">
            <p className="text-xs font-semibold">Background picture effects</p>
            <AdjustControls adjust={bg.adjust} onChange={a => dispatch({ type: 'setBackground', background: { ...bg, adjust: a } })} />
            <label className="flex items-center gap-2 text-xs"><span className="w-20 text-muted-foreground">Colour overlay</span>
              <input type="color" aria-label="Overlay colour" value={typeof bg.overlay?.color === 'string' ? bg.overlay.color : '#000000'} onChange={e => dispatch({ type: 'setBackground', background: { ...bg, overlay: { color: e.target.value, opacity: bg.overlay?.opacity ?? 0.3 } } })} className="h-8 w-12 rounded border border-border p-0.5" />
              <input type="range" aria-label="Overlay strength" min={0} max={100} step={1} value={Math.round((bg.overlay?.opacity ?? 0) * 100)} onChange={e => dispatch({ type: 'setBackground', background: { ...bg, overlay: Number(e.target.value) === 0 ? undefined : { color: bg.overlay?.color ?? '#000000', opacity: Number(e.target.value) / 100 } } })} className="flex-1" data-testid="overlay-strength" /></label>
          </div>
        )}
      </section>

      <section aria-label="Shapes" className="space-y-2 border-t border-border pt-3" data-testid="design-shapes">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Shapes</h3>
        {SHAPE_CATEGORIES.map(cat => (
          <div key={cat} className="space-y-1">
            <p className="text-[11px] text-muted-foreground">{cat}</p>
            <div className="flex flex-wrap gap-1">
              {[...PLAIN_SHAPES.filter(p => p.category === cat), ...SHAPES.filter(s => s.category === cat)].map(s => (
                <button key={s.id} type="button" className="inline-flex h-9 w-9 items-center justify-center rounded border border-border bg-card text-foreground hover:bg-muted" title={s.label} aria-label={`Add ${s.label}`} onClick={() => add(newShape(s.id, doc.format, theme))} data-testid="add-shape-kind"><ShapeGlyph kind={s.id} /></button>
              ))}
            </div>
          </div>
        ))}
        <p className="text-[11px] text-muted-foreground">Select a shape, then type in &ldquo;Text inside&rdquo; to put words in it, or choose a shape as a picture&rsquo;s Shape to place a photo inside it.</p>
      </section>

      <section aria-label="Information elements" className="space-y-2 border-t border-border pt-3" data-testid="design-info">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Dates, places and codes</h3>
        <div className="flex flex-wrap gap-1.5">
          {(['date', 'time', 'datetime', 'countdown', 'timer'] as DynamicKind[]).map(k => <button key={k} type="button" className={btn} onClick={() => add(newDynamicText(k, doc.format, theme))} data-testid={`add-${k}`}>{DYNAMIC_NAMES[k]}</button>)}
          <button type="button" className={btn} onClick={() => add(newLocationText(doc.format, theme))} data-testid="add-location">Location</button>
          <button type="button" className={btn} onClick={() => add(newAddressText(doc.format, theme))} data-testid="add-address">Address</button>
          <button type="button" className={btn} onClick={() => add(newMapImage())} data-testid="add-map">Map image</button>
        </div>
        <p className="text-[11px] text-muted-foreground">Countdowns and timers tick only in an animated video; a still image shows one moment. A map image is a picture slot: upload a screenshot of your map.</p>
        <div className="space-y-1.5 rounded-md border border-border p-2" data-testid="add-qr">
          <p className="text-xs font-semibold">QR code</p>
          <input className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm" aria-label="Web address for the QR code" value={qrText} onChange={e => setQrText(e.target.value)} data-testid="qr-new-data" />
          <LinkMessage raw={qrText === 'https://' ? '' : qrText} />
          <button type="button" className={btn} disabled={!qrReady} onClick={() => qrCheck.ok && add(newQr(qrCheck.url))} data-testid="add-qr-btn">Add QR code</button>
        </div>
      </section>

      <section aria-label="Saved library" className="space-y-2 border-t border-border pt-3" data-testid="design-library">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">My library</h3>
        <div className="flex gap-1.5">
          <input className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-sm" aria-label="Name for the library item" placeholder="Name" value={name} onChange={e => setName(e.target.value)} data-testid="library-name" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className={btn} disabled={busy || !name.trim() || selectedEls.length === 0} onClick={() => run(async () => { await libraryStore.saveElements(name.trim(), selectedEls); setName(''); await reload(); return 'Saved the selected elements to your library.' })} data-testid="save-selection">Save selection ({selectedEls.length})</button>
          <button type="button" className={btn} disabled={busy || !name.trim()} onClick={() => run(async () => { await libraryStore.saveBackground(name.trim(), bg); setName(''); await reload(); return 'Saved this background to your library.' })} data-testid="save-background">Save background</button>
        </div>
        {msg && <p role={msg.tone === 'error' ? 'alert' : 'status'} className={msg.tone === 'error' ? 'text-xs text-destructive' : 'text-xs text-emerald-700 dark:text-emerald-400'} data-testid="library-message">{msg.text}</p>}
        {items === null && <p className="text-xs text-muted-foreground">Loading…</p>}
        {items?.length === 0 && <p className="text-xs text-muted-foreground" data-testid="library-empty">Nothing saved yet. Select elements on the slide, name them and save them to reuse later.</p>}
        <ul className="space-y-1.5">
          {(items ?? []).map(it => (
            <li key={it.id} className="flex items-center gap-1.5 rounded-md border border-border p-1.5 text-xs" data-testid="library-item">
              <span className="min-w-0 flex-1 truncate"><span className="font-medium">{it.name}</span> <span className="text-muted-foreground">· {it.kind === 'elements' ? 'elements' : 'background'}</span></span>
              <button type="button" className={btn} disabled={busy} onClick={() => run(async () => { const full = await libraryStore.get(it.id); if (full.kind === 'elements') dispatch({ type: 'addPreparedMany', elements: instantiateElements(full.elements) }); else dispatch({ type: 'setBackground', background: full.background }); return `Added "${it.name}".` })} data-testid="library-use">Use</button>
              <button type="button" className="rounded p-1.5 text-destructive hover:bg-muted" aria-label={`Delete ${it.name} from the library`} disabled={busy} onClick={() => { if (window.confirm(`Delete "${it.name}" from your library? Slides that already use it are not affected.`)) void run(async () => { await libraryStore.remove(it.id); await reload(); return 'Deleted.' }) }}><Trash2 className="h-3.5 w-3.5" /></button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
