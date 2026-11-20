import { useMemo, useRef, useState } from 'react'
import { AlertTriangle, Download, FileText, Images, Loader2, X } from 'lucide-react'
import type { PostDocument } from '../../../lib/postDocument'
import { browserBackend, downloadBytes, svgBackend } from '../../../lib/carousel/browserBackend'
import { exportSvgSlide, exportSvgZip, type SvgExportResult } from '../../../lib/carousel/svgExport'
import { countPdfLinks } from '../../../lib/carousel/pageLinks'
import { checkLimits } from '../../../lib/carousel/platformLimits'
import { hasAdjust } from '../../../lib/carousel/adjust'
import { exportAllSlidesZip, exportPdf, exportPixelSize, exportSlide, exportWarnings, type ExportFile, type ExportOptions, type ImageKind } from '../../../lib/carousel/exporter'
import { exportAdvice } from '../../../lib/carousel/resources'
import { withMediaToken } from '../../../api/mediaAccess'
import { useBrandTokens } from '../../../lib/carousel/brandContext'

const clampInt = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(Number.isFinite(v) ? v : lo)))
type StillKind = ImageKind | 'svg'
export const MIN_EXPORT_WIDTH = 200
export const MAX_EXPORT_WIDTH = 8000
/** Whether the carousel uses picture adjustments, which need the canvas `filter` feature to export (missing in a few browsers). */
function usesAdjustments(doc: PostDocument): boolean {
  const walk = (els: PostDocument['pages'][number]['elements']): boolean => els.some(e => (e.visible && e.type === 'image' && hasAdjust(e.adjust)) || (e.type === 'group' && walk(e.children)))
  return doc.pages.some(p => (p.background.kind === 'image' && hasAdjust(p.background.adjust)) || walk(p.elements))
}
const canvasFilterSupported = () => typeof CanvasRenderingContext2D === 'undefined' || 'filter' in CanvasRenderingContext2D.prototype

/**
 * PNG / JPEG / SVG for the open slide or the chosen slides (ZIP, numbered in swipe order), and one multi-page PDF with clickable links. Size, JPEG quality and file names are set here and do not depend on how big the editor preview is. There is no slide-count limit: big exports show a resource warning
 * first, report progress slide by slide, can be cancelled, and can be done in batches with the slide range. Warns if a slide still has an empty image or placeholder text.
 */
export default function ExportPanel({ doc, activeIndex }: { doc: PostDocument; activeIndex: number }) {
  const [kind, setKind] = useState<StillKind>('png')
  const [sizeKey, setSizeKey] = useState('1')
  const [customWidth, setCustomWidth] = useState(doc.format.width)
  const [quality, setQuality] = useState(92)
  const [fileBase, setFileBase] = useState('')
  const [svgNotes, setSvgNotes] = useState<string[]>([])
  const scale = sizeKey === 'custom' ? clampInt(customWidth, MIN_EXPORT_WIDTH, MAX_EXPORT_WIDTH) / doc.format.width : Number(sizeKey)
  const [from, setFrom] = useState(1)
  const [to, setTo] = useState(0)                         // 0 = through the last slide
  const [busy, setBusy] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const abort = useRef<AbortController | null>(null)
  const tokens = useBrandTokens()
  const warnings = useMemo(() => exportWarnings(doc), [doc])
  const size = exportPixelSize(doc, scale)

  const last = to === 0 ? doc.pages.length : clampInt(to, 1, doc.pages.length)
  const first = clampInt(from, 1, last)
  const indices = useMemo(() => Array.from({ length: last - first + 1 }, (_, i) => first - 1 + i), [first, last])
  const partial = indices.length !== doc.pages.length
  const advice = useMemo(() => exportAdvice(doc, kind === 'jpeg' ? 'jpeg' : 'png', scale, indices.length), [doc, kind, scale, indices.length])
  const limitWarnings = useMemo(() => checkLimits(doc, { kind: 'image', slideCount: indices.length }), [doc, indices.length])
  const pdfLinks = useMemo(() => countPdfLinks(doc, indices), [doc, indices])
  const noFilters = useMemo(() => !canvasFilterSupported() && usesAdjustments(doc), [doc])
  const pdfAdvice = useMemo(() => exportAdvice(doc, 'pdf', scale, indices.length), [doc, scale, indices.length])

  const run = async (label: string, job: (o: ExportOptions) => Promise<ExportFile | SvgExportResult>) => {
    setBusy(label); setMessage(null); setProgress(null); setSvgNotes([])
    const ctl = new AbortController()
    abort.current = ctl
    try {
      if (typeof document !== 'undefined' && document.fonts?.ready) await document.fonts.ready
      const out = await job({ scale, quality: quality / 100, fileBase: fileBase.trim() || undefined, resolveUrl: withMediaToken, tokens, indices, signal: ctl.signal, onProgress: (done, total) => setProgress({ done, total }) })
      const file = 'file' in out ? out.file : out
      if ('file' in out) setSvgNotes([...new Set(out.warnings)])
      downloadBytes(file.name, file.mime, file.bytes)
      setMessage({ tone: 'ok', text: `Downloaded ${file.name} (${(file.bytes.length / 1024 / 1024).toFixed(2)} MB).` })
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') setMessage({ tone: 'ok', text: 'Export cancelled. Nothing was downloaded.' })
      else setMessage({ tone: 'error', text: e instanceof Error ? e.message : 'The export failed. For a very large carousel, export a smaller slide range, use 1x size, or choose JPEG.' })
    } finally { setBusy(null); setProgress(null); abort.current = null }
  }
  const be = () => browserBackend()
  const act = 'inline-flex h-9 w-full items-center justify-center gap-2 rounded-md border border-border bg-card px-3 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50'
  const numIn = 'h-8 w-full rounded-md border border-border bg-background px-2 text-sm'
  const worst = pdfAdvice.level === 'extreme' || advice.level === 'extreme' ? 'extreme' : pdfAdvice.level === 'heavy' || advice.level === 'heavy' ? 'heavy' : advice.level === 'notice' ? 'notice' : 'ok'
  const adviceMessages = [...new Set([...advice.messages, ...pdfAdvice.messages])]

  return (
    <section aria-label="Export" data-testid="export-panel" className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Export</h3>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <label className="space-y-1"><span className="text-muted-foreground">Image format</span>
          <select className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm" value={kind} onChange={e => setKind(e.target.value as StillKind)} data-testid="export-kind"><option value="png">PNG (lossless)</option><option value="jpeg">JPEG (smaller)</option><option value="svg">SVG (vector, editable text)</option></select></label>
        <label className="space-y-1"><span className="text-muted-foreground">Size</span>
          <select className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm" value={sizeKey} onChange={e => setSizeKey(e.target.value)} data-testid="export-scale"><option value="0.5">0.5x (small)</option><option value="1">1x</option><option value="2">2x</option><option value="3">3x</option><option value="custom">Custom width…</option></select></label>
        {sizeKey === 'custom' && <label className="space-y-1"><span className="text-muted-foreground">Width (px)</span>
          <input type="number" min={MIN_EXPORT_WIDTH} max={MAX_EXPORT_WIDTH} step={10} className={numIn} value={customWidth} onChange={e => setCustomWidth(Number(e.target.value))} data-testid="export-custom-width" /></label>}
        {kind === 'jpeg' && <label className="col-span-2 space-y-1"><span className="text-muted-foreground">JPEG quality {quality}% (also used for the PDF pages)</span>
          <input type="range" min={40} max={100} step={1} className="w-full" value={quality} onChange={e => setQuality(Number(e.target.value))} aria-label="JPEG quality" data-testid="export-quality" /></label>}
        <label className="col-span-2 space-y-1"><span className="text-muted-foreground">File name (optional)</span>
          <input type="text" maxLength={60} placeholder={doc.title} className={numIn} value={fileBase} onChange={e => setFileBase(e.target.value)} data-testid="export-filename" /></label>
        <label className="space-y-1"><span className="text-muted-foreground">From slide</span>
          <input type="number" min={1} max={doc.pages.length} className={numIn} value={first} onChange={e => setFrom(Number(e.target.value))} data-testid="export-from" /></label>
        <label className="space-y-1"><span className="text-muted-foreground">To slide</span>
          <input type="number" min={1} max={doc.pages.length} className={numIn} value={last} onChange={e => setTo(Number(e.target.value))} data-testid="export-to" /></label>
      </div>
      <p className="text-xs text-muted-foreground" data-testid="export-size">Each slide exports at {size.width} × {size.height} px ({doc.format.ratio}).{partial ? ` Slides ${first}–${last} of ${doc.pages.length}.` : ''}{kind === 'svg' ? ' An SVG scales to any size; this is its starting size.' : ''}</p>
      <p className="text-xs text-muted-foreground" data-testid="export-link-note">{pdfLinks > 0 ? `${pdfLinks} link${pdfLinks === 1 ? '' : 's'} will be clickable in the PDF${kind === 'svg' ? ' and, in a web browser, in the SVG' : ''}. PNG, JPEG, MP4 and GIF files cannot contain clickable links.` : 'PNG, JPEG, MP4 and GIF files cannot contain clickable links. Links you add are clickable in the PDF.'}</p>

      {adviceMessages.length > 0 && (
        <div role="status" className={`rounded-md border p-2 text-xs ${worst === 'extreme' ? 'border-destructive/50 bg-destructive/5 text-destructive' : 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100'}`} data-testid="export-resources" data-level={worst}>
          <p className="mb-1 flex items-center gap-1 font-semibold"><AlertTriangle className="h-3.5 w-3.5" />{worst === 'notice' ? 'Good to know' : 'Large export'}</p>
          <ul className="list-disc space-y-0.5 pl-4">{adviceMessages.map((m, i) => <li key={i}>{m}</li>)}</ul>
        </div>
      )}

      {(limitWarnings.length > 0 || noFilters) && (
        <div role="status" className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100" data-testid="export-platform-limits">
          <p className="mb-1 flex items-center gap-1 font-semibold"><AlertTriangle className="h-3.5 w-3.5" />Platform and browser notes</p>
          <ul className="list-disc space-y-0.5 pl-4">{limitWarnings.map((m, i) => <li key={i}>{m}</li>)}{noFilters && <li>This browser cannot apply picture adjustments (brightness, blur and so on) while exporting, so adjusted pictures will export without them. Try a current Chrome, Edge or Firefox.</li>}</ul>
        </div>
      )}

      {warnings.length > 0 && (
        <div role="status" className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100" data-testid="export-warnings">
          <p className="mb-1 flex items-center gap-1 font-semibold"><AlertTriangle className="h-3.5 w-3.5" />Check before exporting</p>
          <ul className="list-disc space-y-0.5 pl-4">{warnings.slice(0, 6).map((w, i) => <li key={i}>{w}</li>)}{warnings.length > 6 && <li>…and {warnings.length - 6} more</li>}</ul>
          <p className="mt-1">You can still export; these will appear as shown.</p>
        </div>
      )}

      <div className="space-y-2">
        <button type="button" className={act} disabled={!!busy} onClick={() => run('slide', o => (kind === 'svg' ? exportSvgSlide(doc, activeIndex, svgBackend(), o) : exportSlide(doc, activeIndex, kind, be(), o)))} data-testid="export-slide">
          {busy === 'slide' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} This slide ({activeIndex + 1}) as {kind.toUpperCase()}
        </button>
        <button type="button" className={act} disabled={!!busy} onClick={() => run('zip', o => (kind === 'svg' ? exportSvgZip(doc, svgBackend(), o) : exportAllSlidesZip(doc, kind, be(), o)))} data-testid="export-all">
          {busy === 'zip' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Images className="h-4 w-4" />} {partial ? `Slides ${first}–${last}` : `All ${doc.pages.length} slides`} (ZIP of {kind.toUpperCase()})
        </button>
        <button type="button" className={act} disabled={!!busy} onClick={() => run('pdf', o => exportPdf(doc, be(), o))} data-testid="export-pdf">
          {busy === 'pdf' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />} PDF, one page per slide
        </button>
      </div>
      {busy && (
        <div className="space-y-1" role="status" data-testid="export-progress">
          <div className="h-2 overflow-hidden rounded bg-muted"><div className="h-full bg-primary transition-[width]" style={{ width: progress ? `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` : '5%' }} /></div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{progress ? `Rendered ${progress.done} of ${progress.total} slides…` : 'Rendering…'}</span>
            <button type="button" className="inline-flex items-center gap-1 underline" onClick={() => abort.current?.abort()} data-testid="export-cancel"><X className="h-3 w-3" />Cancel</button>
          </div>
        </div>
      )}
      {svgNotes.length > 0 && <ul className="list-disc space-y-0.5 pl-4 text-xs text-amber-900 dark:text-amber-100" data-testid="export-svg-notes">{svgNotes.slice(0, 8).map((m, i) => <li key={i}>{m}</li>)}{svgNotes.length > 8 && <li>…and {svgNotes.length - 8} more like these for other slides.</li>}</ul>}
      {message && <p role={message.tone === 'error' ? 'alert' : 'status'} className={message.tone === 'error' ? 'text-xs text-destructive' : 'text-xs text-emerald-700 dark:text-emerald-400'} data-testid="export-message">{message.text}</p>}
    </section>
  )
}
