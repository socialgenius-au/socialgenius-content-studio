import { useMemo, useState } from 'react'
import { AlertTriangle, Download, FileText, Images, Loader2 } from 'lucide-react'
import type { PostDocument } from '../../../lib/postDocument'
import { browserBackend, downloadBytes } from '../../../lib/carousel/browserBackend'
import { exportAllSlidesZip, exportPdf, exportPixelSize, exportSlide, exportWarnings, type ExportFile, type ImageKind } from '../../../lib/carousel/exporter'
import { withMediaToken } from '../../../api/mediaAccess'

/** PNG / JPEG for the open slide or every slide (ZIP, numbered in swipe order), and one multi-page PDF. Warns before exporting if a slide still has an empty image or placeholder text. */
export default function ExportPanel({ doc, activeIndex }: { doc: PostDocument; activeIndex: number }) {
  const [kind, setKind] = useState<ImageKind>('png')
  const [scale, setScale] = useState(1)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const warnings = useMemo(() => exportWarnings(doc), [doc])
  const size = exportPixelSize(doc, scale)

  const run = async (label: string, job: () => Promise<ExportFile>) => {
    setBusy(label); setMessage(null)
    try {
      if (typeof document !== 'undefined' && document.fonts?.ready) await document.fonts.ready
      const file = await job()
      downloadBytes(file.name, file.mime, file.bytes)
      setMessage({ tone: 'ok', text: `Downloaded ${file.name} (${(file.bytes.length / 1024 / 1024).toFixed(2)} MB).` })
    } catch (e) {
      setMessage({ tone: 'error', text: e instanceof Error ? e.message : 'The export failed.' })
    } finally { setBusy(null) }
  }
  const opts = { scale, resolveUrl: withMediaToken }
  const be = () => browserBackend()
  const act = 'inline-flex h-9 w-full items-center justify-center gap-2 rounded-md border border-border bg-card px-3 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50'

  return (
    <section aria-label="Export" data-testid="export-panel" className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Export</h3>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <label className="space-y-1"><span className="text-muted-foreground">Image format</span>
          <select className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm" value={kind} onChange={e => setKind(e.target.value as ImageKind)} data-testid="export-kind"><option value="png">PNG (lossless)</option><option value="jpeg">JPEG (smaller)</option></select></label>
        <label className="space-y-1"><span className="text-muted-foreground">Size</span>
          <select className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm" value={scale} onChange={e => setScale(Number(e.target.value))} data-testid="export-scale"><option value={1}>1x</option><option value={2}>2x</option></select></label>
      </div>
      <p className="text-xs text-muted-foreground" data-testid="export-size">Each slide exports at {size.width} × {size.height} px ({doc.format.ratio}).</p>

      {warnings.length > 0 && (
        <div role="status" className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100" data-testid="export-warnings">
          <p className="mb-1 flex items-center gap-1 font-semibold"><AlertTriangle className="h-3.5 w-3.5" />Check before exporting</p>
          <ul className="list-disc space-y-0.5 pl-4">{warnings.slice(0, 6).map((w, i) => <li key={i}>{w}</li>)}{warnings.length > 6 && <li>…and {warnings.length - 6} more</li>}</ul>
          <p className="mt-1">You can still export; these will appear as shown.</p>
        </div>
      )}

      <div className="space-y-2">
        <button type="button" className={act} disabled={!!busy} onClick={() => run('slide', () => exportSlide(doc, activeIndex, kind, be(), opts))} data-testid="export-slide">
          {busy === 'slide' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} This slide ({activeIndex + 1}) as {kind.toUpperCase()}
        </button>
        <button type="button" className={act} disabled={!!busy} onClick={() => run('zip', () => exportAllSlidesZip(doc, kind, be(), opts))} data-testid="export-all">
          {busy === 'zip' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Images className="h-4 w-4" />} All {doc.pages.length} slides (ZIP of {kind.toUpperCase()})
        </button>
        <button type="button" className={act} disabled={!!busy} onClick={() => run('pdf', () => exportPdf(doc, be(), opts))} data-testid="export-pdf">
          {busy === 'pdf' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />} PDF, one page per slide
        </button>
      </div>
      {busy && <p className="text-xs text-muted-foreground" role="status">Rendering… large carousels can take a few seconds.</p>}
      {message && <p role={message.tone === 'error' ? 'alert' : 'status'} className={message.tone === 'error' ? 'text-xs text-destructive' : 'text-xs text-emerald-700 dark:text-emerald-400'} data-testid="export-message">{message.text}</p>}
    </section>
  )
}
