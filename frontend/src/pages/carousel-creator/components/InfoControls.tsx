import { useEffect, useState, type ReactNode } from 'react'
import { AlertTriangle, Link2, MapPin } from 'lucide-react'
import type { DynamicKind, DynamicText, ImageElement, PostElement, TextElement } from '../../../lib/postDocument'
import { validateLinkUrl } from '../../../lib/postDocument'
import { DYNAMIC_LABELS, defaultDynamic } from '../../../lib/carousel/dynamicText'
import { mapsLinkFor } from '../../../lib/carousel/designLibrary'
import { QR_MAX_BYTES, qrFor, QrError } from '../../../lib/carousel/qr'

const field = 'h-8 w-full rounded-md border border-border bg-background px-2 text-sm'
const btn = 'inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs font-medium hover:bg-muted disabled:opacity-50'
type Upd = (patch: Record<string, unknown>) => void

function Row({ label, children }: { label: string; children: ReactNode }) {
  return <label className="grid grid-cols-[5.5rem_1fr] items-center gap-2 text-xs"><span className="text-muted-foreground">{label}</span><span className="min-w-0">{children}</span></label>
}

/** The checked result of typing a link: a message in words, never colour alone. */
export function LinkMessage({ raw }: { raw: string }) {
  if (raw.trim() === '') return null
  const r = validateLinkUrl(raw)
  if (!r.ok) return <p role="alert" className="flex items-start gap-1 text-[11px] text-destructive" data-testid="link-error"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />{r.error}</p>
  return r.warning ? <p role="status" className="text-[11px] text-amber-700 dark:text-amber-300" data-testid="link-warning">{r.warning}</p> : <p role="status" className="text-[11px] text-emerald-700 dark:text-emerald-400" data-testid="link-ok">Link is valid.</p>
}

/** A hyperlink on any element. A PDF export keeps it clickable (and an SVG opened in a web browser); PNG, JPEG, video and GIF exports cannot contain clickable links. */
export function LinkControls({ el, upd }: { el: PostElement; upd: Upd }) {
  const [text, setText] = useState(el.link?.url ?? '')
  useEffect(() => { setText(el.link?.url ?? '') }, [el.id, el.link?.url])
  const commit = (raw: string) => { if (raw.trim() === '') { upd({ link: undefined }); return } const r = validateLinkUrl(raw); if (r.ok) upd({ link: { ...el.link, url: r.url } }) }
  return (
    <div className="space-y-1.5 rounded-md border border-border p-2" data-testid="link-controls">
      <p className="flex items-center gap-1 text-xs font-semibold"><Link2 className="h-3.5 w-3.5" />Link</p>
      <input className={field} aria-label="Link address" placeholder="https://… or mailto: / tel: / app link" value={text} onChange={e => { setText(e.target.value); commit(e.target.value) }} data-testid="link-url" />
      <LinkMessage raw={text} />
      {el.type === 'text' && <button type="button" className={btn} onClick={() => { const u = mapsLinkFor(el.content); setText(u); upd({ link: { url: u, label: 'Open in maps' } }) }} data-testid="link-to-map"><MapPin className="h-3.5 w-3.5" />Link this text to a map</button>}
      <p className="text-[11px] text-muted-foreground" data-testid="link-note">Links are clickable in a PDF export, and in an SVG export when it is opened in a web browser. PNG, JPEG, video and GIF files cannot contain clickable links, so put the address in the caption or add a QR code too.</p>
    </div>
  )
}

/** Turn a text element into a date, time, countdown or timer, and set it up. */
export function DynamicControls({ el, upd }: { el: TextElement; upd: Upd }) {
  const d = el.dynamic
  const set = (patch: Partial<DynamicText>) => d && upd({ dynamic: { ...d, ...patch } })
  return (
    <div className="space-y-2 rounded-md border border-border p-2" data-testid="dynamic-controls">
      <Row label="Shows">
        <select className={field} aria-label="What this text shows" value={d?.kind ?? ''} onChange={e => upd({ dynamic: e.target.value ? defaultDynamic(e.target.value as DynamicKind) : undefined })} data-testid="dynamic-kind">
          <option value="">Fixed text</option>
          {(Object.keys(DYNAMIC_LABELS) as DynamicKind[]).map(k => <option key={k} value={k}>{DYNAMIC_LABELS[k]}</option>)}
        </select>
      </Row>
      {d && (d.kind === 'date' || d.kind === 'time' || d.kind === 'datetime' || d.kind === 'countdown') && (
        <Row label={d.kind === 'countdown' ? 'Counts down to' : 'When'}><input type="datetime-local" className={field} aria-label="Date and time" value={d.iso ?? ''} onChange={e => e.target.value && set({ iso: e.target.value })} data-testid="dynamic-iso" /></Row>
      )}
      {d && (d.kind === 'date' || d.kind === 'time' || d.kind === 'datetime') && (
        <Row label="Style">
          <select className={field} aria-label="Date and time style" value={d.style ?? (d.kind === 'time' ? '12h' : 'long')} onChange={e => set({ style: e.target.value as DynamicText['style'] })}>
            {d.kind === 'time' ? <><option value="12h">12-hour (6:30 PM)</option><option value="24h">24-hour (18:30)</option></> : <><option value="long">Thursday 31 December 2026</option><option value="medium">31 Dec 2026</option><option value="short">31 Dec</option><option value="numeric">31/12/2026</option></>}
          </select>
        </Row>
      )}
      {d?.kind === 'timer' && (
        <>
          <Row label="Seconds"><input type="number" min={1} max={359999} className={field} aria-label="Timer length in seconds" value={d.seconds ?? 10} onChange={e => e.target.value !== '' && set({ seconds: Math.max(1, Math.min(359999, Math.round(Number(e.target.value)))) })} data-testid="dynamic-seconds" /></Row>
          <Row label="Direction"><select className={field} aria-label="Timer direction" value={d.direction ?? 'down'} onChange={e => set({ direction: e.target.value as 'down' | 'up' })}><option value="down">Counts down</option><option value="up">Counts up</option></select></Row>
        </>
      )}
      {d && (d.kind === 'timer' || d.kind === 'countdown') && (
        <Row label="Format"><select className={field} aria-label="Time format" value={d.format ?? 'auto'} onChange={e => set({ format: e.target.value as DynamicText['format'] })}><option value="auto">Automatic</option><option value="mm:ss">mm:ss</option><option value="hh:mm:ss">hh:mm:ss</option><option value="ss">Seconds only</option></select></Row>
      )}
      {d && <Row label="Label"><input className={field} aria-label="Text before the value" placeholder="e.g. Starts in" value={d.label ?? ''} onChange={e => set({ label: e.target.value || undefined })} /></Row>}
      {d && (d.kind === 'countdown' || d.kind === 'timer') && <p className="text-[11px] text-muted-foreground" data-testid="dynamic-note">{d.kind === 'timer' ? 'In an animated video this counts across the slide. In a still image it shows its starting value.' : 'In an animated video this counts down frame by frame from the moment you export. A still image shows the time left at export.'}</p>}
    </div>
  )
}

/** Edit where a QR code points, and its colours. The destination is checked before it is applied. */
export function QrControls({ el, upd }: { el: ImageElement; upd: Upd }) {
  const src = el.source.kind === 'qr' ? el.source : null
  const [text, setText] = useState(src?.data ?? '')
  useEffect(() => { setText(src?.data ?? '') }, [el.id, src?.data])
  if (!src) return null
  const check = validateLinkUrl(text)
  const q = check.ok ? qrFor(check.url) : null
  const apply = (raw: string) => { const r = validateLinkUrl(raw); if (r.ok && !(qrFor(r.url) instanceof QrError)) upd({ source: { ...src, data: r.url }, alt: `QR code for ${r.url}`, link: { ...el.link, url: r.url } }) }
  return (
    <div className="space-y-2 rounded-md border border-border p-2" data-testid="qr-controls">
      <p className="text-xs font-semibold">QR code</p>
      <input className={field} aria-label="Where the QR code goes" value={text} onChange={e => { setText(e.target.value); apply(e.target.value) }} data-testid="qr-data" />
      <LinkMessage raw={text} />
      {q instanceof QrError && <p role="alert" className="text-[11px] text-destructive" data-testid="qr-error">{q.message}</p>}
      <p className="text-[11px] text-muted-foreground">Up to {QR_MAX_BYTES} characters. Changing the address redraws the code. Scan it with a phone before you publish.</p>
      <Row label="Colours"><span className="flex items-center gap-1.5">
        <input type="color" aria-label="QR code colour" value={src.fg ?? '#000000'} onChange={e => upd({ source: { ...src, fg: e.target.value.toUpperCase() } })} className="h-8 w-12 rounded border border-border p-0.5" />
        <input type="color" aria-label="QR code background" value={src.bg ?? '#FFFFFF'} onChange={e => upd({ source: { ...src, bg: e.target.value.toUpperCase() } })} className="h-8 w-12 rounded border border-border p-0.5" />
      </span></Row>
      <p className="text-[11px] text-muted-foreground">Keep strong contrast: a dark code on a light background scans best.</p>
    </div>
  )
}
