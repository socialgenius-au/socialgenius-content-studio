// Carousel Creator - dates, times, countdowns and timers. The text an element shows is COMPUTED from its settings and, for countdowns and timers, from how far into the animated export we
// are. A still image shows the value at the start of the slide; an animated video counts frame by frame. Dates use the Australian English format by default.
import type { DynamicText, TextElement } from '../postDocument'

const LOCALE = 'en-AU'
const pad = (n: number) => String(Math.floor(n)).padStart(2, '0')

function parse(iso: string | undefined, fallback: Date): Date {
  const d = iso ? new Date(iso) : fallback
  return Number.isNaN(d.getTime()) ? fallback : d
}

export function formatDate(d: Date, style: DynamicText['style'] = 'long'): string {
  switch (style) {
    case 'short': return d.toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' })
    case 'medium': return d.toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' })
    case 'numeric': return d.toLocaleDateString(LOCALE, { day: '2-digit', month: '2-digit', year: 'numeric' })
    default: return d.toLocaleDateString(LOCALE, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  }
}

export function formatTime(d: Date, style: DynamicText['style'] = '12h'): string {
  return d.toLocaleTimeString(LOCALE, { hour: style === '24h' ? '2-digit' : 'numeric', minute: '2-digit', hour12: style !== '24h' }).replace(/\s?(am|pm)/i, m => m.trim().toUpperCase())
}

/** A length of time as text. 'auto' picks the shortest sensible form. */
export function formatDuration(totalSeconds: number, format: DynamicText['format'] = 'auto'): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  if (format === 'ss') return String(s)
  if (format === 'mm:ss') return `${pad(Math.floor(s / 60))}:${pad(sec)}`
  if (format === 'hh:mm:ss') return `${pad(Math.floor(s / 3600))}:${pad(m)}:${pad(sec)}`
  if (d > 0) return `${d}d ${pad(h)}h ${pad(m)}m ${pad(sec)}s`
  if (h > 0) return `${h}h ${pad(m)}m ${pad(sec)}s`
  return `${pad(m)}:${pad(sec)}`
}

/** The text to draw for `el` at `timeMs` into its slide. `now` is when the export started (countdowns run from it). */
export function displayText(el: Pick<TextElement, 'content' | 'dynamic'>, timeMs = 0, now: Date = new Date()): string {
  const dyn = el.dynamic
  if (!dyn) return el.content
  let value: string
  switch (dyn.kind) {
    case 'date': value = formatDate(parse(dyn.iso, now), dyn.style); break
    case 'time': value = formatTime(parse(dyn.iso, now), dyn.style); break
    case 'datetime': { const d = parse(dyn.iso, now); value = `${formatDate(d, dyn.style === '12h' || dyn.style === '24h' ? 'long' : dyn.style)} · ${formatTime(d, dyn.style === '24h' ? '24h' : '12h')}`; break }
    case 'countdown': { const target = parse(dyn.iso, now).getTime(); value = formatDuration(Math.ceil((target - (now.getTime() + timeMs)) / 1000), dyn.format); break }
    case 'timer': {
      const start = dyn.seconds ?? 60
      const t = timeMs / 1000
      value = formatDuration((dyn.direction ?? 'down') === 'down' ? Math.ceil(Math.max(0, start - t)) : Math.min(start, Math.floor(t)), dyn.format)
      break
    }
  }
  return dyn.label ? `${dyn.label} ${value}` : value
}

export const DYNAMIC_LABELS: Record<DynamicText['kind'], string> = { date: 'Date', time: 'Time', datetime: 'Date and time', countdown: 'Countdown to a date', timer: 'Timer (counts across the slide)' }

/** A sensible starting setting for each kind (a date a week from `now`, a 60 second timer). */
export function defaultDynamic(kind: DynamicText['kind'], now: Date = new Date()): DynamicText {
  const when = new Date(now.getTime() + 7 * 86400000); when.setMinutes(0, 0, 0)
  const local = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T${pad(when.getHours())}:00`
  if (kind === 'timer') return { kind, seconds: 10, direction: 'down', format: 'auto' }
  if (kind === 'countdown') return { kind, iso: local, format: 'auto' }
  return { kind, iso: local, style: kind === 'time' ? '12h' : 'long' }
}
