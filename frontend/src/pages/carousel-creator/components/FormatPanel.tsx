import { useMemo, useState, type Dispatch } from 'react'
import { AlertTriangle } from 'lucide-react'
import type { PostDocument } from '../../../lib/postDocument'
import { CUSTOM_FORMAT, allFormatOptions, checkCustomSize, customFormat, formatFor, isCustomFormat, orientationOf, resizeDocument, sameFormat, type Orientation, type ResizeMode } from '../../../lib/carousel/formats'
import { describeLimits } from '../../../lib/carousel/platformLimits'
import { MAX_CUSTOM_SIZE, MIN_CUSTOM_SIZE } from '../../../lib/platformFormats'
import type { EditorAction } from '../editorState'

const field = 'h-8 w-full rounded-md border border-border bg-background px-2 text-sm'
const btn = 'inline-flex h-8 items-center justify-center rounded-md border border-border bg-card px-2.5 text-xs font-medium hover:bg-muted disabled:opacity-50'

/**
 * Canvas size and shape: platform presets (portrait, landscape, square), a custom size, and resizing the open carousel to another format. Resizing never flattens anything: every layer stays an
 * editable element, and the change can be undone. The pixel size here is the DESIGN size; export size is chosen separately in the Export tab.
 */
export default function FormatPanel({ doc, dispatch }: { doc: PostDocument; dispatch: Dispatch<EditorAction> }) {
  const options = useMemo(allFormatOptions, [])
  const [orientation, setOrientation] = useState<Orientation | 'all'>('all')
  const [platform, setPlatform] = useState(doc.format.platformKey)
  const [placement, setPlacement] = useState(doc.format.formatKey)
  const [w, setW] = useState(String(doc.format.width))
  const [h, setH] = useState(String(doc.format.height))
  const [mode, setMode] = useState<ResizeMode>('fit')
  const [note, setNote] = useState<string | null>(null)

  const platforms = useMemo(() => [...new Map(options.map(o => [o.platformKey, o.platformLabel])).entries()], [options])
  const inPlatform = options.filter(o => o.platformKey === platform && (orientation === 'all' || o.orientation === orientation))
  const custom = checkCustomSize(Number(w), Number(h))
  const chosen = placement === CUSTOM_FORMAT.formatKey && platform === CUSTOM_FORMAT.platformKey ? (custom.ok ? customFormat(custom.width, custom.height) : null) : formatFor(platform, placement)
  const changed = !!chosen && !sameFormat(chosen, doc.format)
  const limits = describeLimits(doc)

  const apply = () => {
    if (!chosen || !changed) return
    dispatch({ type: 'commitDoc', doc: resizeDocument(doc, chosen, mode) })
    setNote(`Resized to ${chosen.width} × ${chosen.height} px (${chosen.ratio}). Every layer is still editable, and you can undo this.`)
  }

  return (
    <section aria-label="Format and size" className="space-y-3" data-testid="format-panel">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Format and size</h3>
      <p className="text-xs" data-testid="current-format">Now: <strong>{doc.format.width} × {doc.format.height} px</strong> · {doc.format.ratio} · {orientationOf(doc.format.width, doc.format.height)}{isCustomFormat(doc.format) ? ' · custom size' : ` · ${doc.format.platformKey} ${doc.format.formatKey.replace(/_/g, ' ')}`}</p>

      <div role="tablist" aria-label="Orientation" className="flex gap-1 rounded-md bg-muted p-0.5 text-xs">
        {(['all', 'portrait', 'landscape', 'square'] as const).map(o => <button key={o} type="button" role="tab" aria-selected={orientation === o} onClick={() => setOrientation(o)} className={`flex-1 rounded px-1.5 py-1 font-medium capitalize ${orientation === o ? 'bg-card shadow-sm' : 'text-muted-foreground'}`} data-testid={`orientation-${o}`}>{o}</button>)}
      </div>

      <label className="block space-y-1 text-xs"><span className="text-muted-foreground">Platform</span>
        <select className={field} value={platform} onChange={e => { setPlatform(e.target.value); const first = options.find(o => o.platformKey === e.target.value); if (first) setPlacement(first.formatKey) }} data-testid="format-platform" aria-label="Platform">
          {platforms.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </label>
      <div className="space-y-1" data-testid="format-presets" role="listbox" aria-label="Sizes">
        {inPlatform.length === 0 && <p className="text-xs text-muted-foreground">No {orientation} sizes for this platform.</p>}
        {inPlatform.map(o => <button key={`${o.platformKey}/${o.formatKey}`} type="button" role="option" aria-selected={placement === o.formatKey && !isCustomChoice(platform, placement)} onClick={() => setPlacement(o.formatKey)} className={`flex w-full items-center justify-between rounded-md border px-2 py-1.5 text-left text-xs hover:bg-muted ${placement === o.formatKey ? 'border-primary bg-primary/5' : 'border-border'}`} data-testid="format-preset"><span>{o.label}</span><span className="text-muted-foreground">{o.width} × {o.height} · {o.ratio}</span></button>)}
      </div>

      <fieldset className="space-y-1.5 rounded-md border border-border p-2" data-testid="custom-size">
        <legend className="px-1 text-xs font-semibold">Custom size</legend>
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-0.5 text-[11px] text-muted-foreground">Width (px)<input type="number" min={MIN_CUSTOM_SIZE} max={MAX_CUSTOM_SIZE} className={field} value={w} onChange={e => { setW(e.target.value); setPlatform(CUSTOM_FORMAT.platformKey); setPlacement(CUSTOM_FORMAT.formatKey) }} data-testid="custom-width" aria-label="Custom width in pixels" /></label>
          <label className="space-y-0.5 text-[11px] text-muted-foreground">Height (px)<input type="number" min={MIN_CUSTOM_SIZE} max={MAX_CUSTOM_SIZE} className={field} value={h} onChange={e => { setH(e.target.value); setPlatform(CUSTOM_FORMAT.platformKey); setPlacement(CUSTOM_FORMAT.formatKey) }} data-testid="custom-height" aria-label="Custom height in pixels" /></label>
        </div>
        {!custom.ok && isCustomChoice(platform, placement) && <p role="alert" className="flex items-start gap-1 text-[11px] text-destructive" data-testid="custom-error"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />{custom.error}</p>}
        {custom.ok && <p className="text-[11px] text-muted-foreground">{orientationOf(custom.width, custom.height)} · {customFormat(custom.width, custom.height).ratio}</p>}
      </fieldset>

      <fieldset className="space-y-1.5 rounded-md border border-border p-2" data-testid="resize-mode">
        <legend className="px-1 text-xs font-semibold">How to resize the design</legend>
        <label className="flex items-start gap-2 text-xs"><input type="radio" name="resize-mode" checked={mode === 'fit'} onChange={() => setMode('fit')} data-testid="mode-fit" /><span><strong>Fit the whole design</strong> (keeps proportions, centred; the background fills the rest)</span></label>
        <label className="flex items-start gap-2 text-xs"><input type="radio" name="resize-mode" checked={mode === 'relative'} onChange={() => setMode('relative')} data-testid="mode-relative" /><span><strong>Stretch the layout</strong> (every element keeps its place as a share of the new canvas)</span></label>
      </fieldset>

      <button type="button" className={`${btn} w-full bg-primary text-primary-foreground hover:bg-primary/90`} disabled={!changed} onClick={apply} data-testid="apply-format">{changed && chosen ? `Resize to ${chosen.width} × ${chosen.height}` : 'Choose a different size to resize'}</button>
      {note && <p role="status" className="text-xs text-emerald-700 dark:text-emerald-400" data-testid="format-note">{note}</p>}

      {limits.length > 0 && (
        <div role="status" className="rounded-md border border-border bg-muted/40 p-2 text-xs" data-testid="platform-limits">
          <p className="mb-1 font-semibold">About this platform</p>
          <ul className="list-disc space-y-0.5 pl-4">{limits.map((m, i) => <li key={i}>{m}</li>)}</ul>
        </div>
      )}
    </section>
  )
}

const isCustomChoice = (platform: string, placement: string) => platform === CUSTOM_FORMAT.platformKey && placement === CUSTOM_FORMAT.formatKey
