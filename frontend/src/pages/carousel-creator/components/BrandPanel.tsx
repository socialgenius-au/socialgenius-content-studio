import { Palette, Settings2, Type } from 'lucide-react'
import type { ApplyReport, BrandKit, BrandKitSummary, KitLogo, KitName } from '../../../lib/carousel/brandKit'
import { kitSwatches } from '../../../lib/carousel/brandKit'
import { withMediaToken } from '../../../api/mediaAccess'

export interface BrandPanelProps {
  kit: BrandKit | null
  /** Id the open carousel is linked to but could not be loaded (deleted or offline). */
  missingKitId?: number | null
  kits: BrandKitSummary[] | null
  error?: string | null
  busy?: boolean
  report?: ApplyReport | null
  onChooseKit: (id: number | null) => void
  onApply: () => void
  onDetach: () => void
  onAddLogo: (logo: KitLogo) => void
  onAddName: (name: KitName) => void
  onManage: () => void
}

const btn = 'inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs font-medium hover:bg-muted disabled:opacity-50'

/**
 * Brand Kit for the open carousel: choose a kit, apply it WITHOUT overwriting your own colours or fonts, and drop its logos and brand names onto the slide as ordinary elements
 * (free to move, resize, layer, group and delete).
 */
export default function BrandPanel(p: BrandPanelProps) {
  const swatches = p.kit ? kitSwatches(p.kit.kit) : []
  return (
    <section aria-label="Brand Kit" data-testid="brand-panel" className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Brand Kit</h3>
      {p.error && <p role="alert" className="text-xs text-destructive" data-testid="brand-error">{p.error}</p>}
      {p.missingKitId && !p.kit && <p role="status" className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100" data-testid="kit-missing">This carousel used a Brand Kit that is no longer available. Its colours and fonts still show as they were saved.</p>}
      <label className="block space-y-1 text-xs">
        <span className="text-muted-foreground">Kit for this carousel</span>
        <select className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm" value={p.kit?.id ?? ''} disabled={p.busy || p.kits === null} onChange={e => p.onChooseKit(e.target.value ? Number(e.target.value) : null)} data-testid="kit-select" aria-label="Brand Kit for this carousel">
          <option value="">No Brand Kit</option>
          {(p.kits ?? []).map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
        </select>
      </label>
      {p.kits !== null && p.kits.length === 0 && <p className="text-xs text-muted-foreground" data-testid="no-kits">You have no Brand Kits yet. Create one to reuse your logos, colours and fonts on every carousel.</p>}
      <button type="button" className={btn} onClick={p.onManage} data-testid="manage-kits"><Settings2 className="h-3.5 w-3.5" />Create or edit Brand Kits</button>

      {p.kit && (
        <>
          {swatches.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5" aria-label="Kit colours" data-testid="kit-swatches">
              {swatches.map(s => <span key={s.label + s.hex} title={`${s.label} ${s.hex}`} className="h-6 w-6 rounded-full border border-border" style={{ background: s.hex }} />)}
            </div>
          )}
          <div className="space-y-1.5 rounded-md border border-border p-2">
            <button type="button" className={`${btn} w-full bg-primary text-primary-foreground hover:bg-primary/90`} disabled={p.busy} onClick={p.onApply} data-testid="apply-kit"><Palette className="h-3.5 w-3.5" />Apply to this carousel</button>
            <p className="text-[11px] text-muted-foreground">Updates only the colours and fonts that still use the carousel theme. Anything you changed yourself is left alone, and you can undo it.</p>
            {p.report && <p role="status" className="text-xs text-emerald-700 dark:text-emerald-400" data-testid="apply-report">Updated {p.report.recoloured} colour{p.report.recoloured === 1 ? '' : 's'} and {p.report.refonted} font{p.report.refonted === 1 ? '' : 's'}. Kept {p.report.kept} custom colour{p.report.kept === 1 ? '' : 's'} as you set them.</p>}
            <button type="button" className="text-[11px] underline" onClick={p.onDetach} data-testid="detach-kit">Stop using this kit on this carousel</button>
          </div>

          <div className="space-y-1.5" data-testid="kit-logos">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Logos</p>
            {p.kit.kit.logos.length === 0 && <p className="text-xs text-muted-foreground">This kit has no logos yet.</p>}
            <div className="grid grid-cols-3 gap-1.5">
              {p.kit.kit.logos.map(l => (
                <button key={l.id} type="button" className="flex aspect-[3/2] flex-col items-center justify-center gap-1 overflow-hidden rounded border border-border bg-muted/40 p-1 text-[10px] hover:ring-2 hover:ring-primary" title={`Add ${l.label} to this slide`} aria-label={`Add logo ${l.label} to this slide`} onClick={() => p.onAddLogo(l)} data-testid="add-logo">
                  {l.url ? <img src={withMediaToken(l.url)} alt="" className="max-h-full max-w-full object-contain" /> : null}
                  <span className="max-w-full truncate">{l.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5" data-testid="kit-names">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Brand names</p>
            {p.kit.kit.brand_names.length === 0 && <p className="text-xs text-muted-foreground">This kit has no brand names yet.</p>}
            <div className="flex flex-wrap gap-1.5">
              {p.kit.kit.brand_names.map(n => <button key={n.id} type="button" className={btn} aria-label={`Add brand name ${n.label} to this slide`} onClick={() => p.onAddName(n)} data-testid="add-name"><Type className="h-3.5 w-3.5" />{n.text}</button>)}
            </div>
          </div>
        </>
      )}
    </section>
  )
}
