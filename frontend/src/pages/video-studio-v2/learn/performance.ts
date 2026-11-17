// A. VERIFIED PERFORMANCE. Real audience results exist only if a connected platform (or an import) supplied them, and every figure must say where it came from and what period it covers.
// Nothing in this system produces such data today, so the Learn stage shows PERFORMANCE_NOT_AVAILABLE. This parser is the only door for data to enter: anything incomplete or implausible is
// refused in full (never partly shown), so a half-filled or invented figure can never appear as a result.
export const PERFORMANCE_NOT_AVAILABLE = 'Not available — connect or import performance data after publishing.'

export const METRIC_KEYS = ['views', 'reach', 'engagement', 'watch_time_seconds', 'avg_retention_pct', 'ctr_pct', 'conversions'] as const
export type MetricKey = (typeof METRIC_KEYS)[number]

const LABELS: Record<MetricKey, string> = {
  views: 'Views', reach: 'Reach', engagement: 'Engagements', watch_time_seconds: 'Watch time (seconds)', avg_retention_pct: 'Average retention (%)', ctr_pct: 'Click-through rate (%)', conversions: 'Conversions',
}
const PERCENT: ReadonlySet<MetricKey> = new Set(['avg_retention_pct', 'ctr_pct'])

export interface VerifiedMetric { key: MetricKey; label: string; value: number; source: string; periodStart: string; periodEnd: string }
export interface VerifiedPerformance { metrics: VerifiedMetric[] }

const isoDay = /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/

/** Strict. Returns null (=> "Not available") unless EVERY metric has a known key, a finite non-negative value (percentages 0-100), a named source and a valid measurement period. */
export function parseVerifiedPerformance(input: unknown): VerifiedPerformance | null {
  const list = (input as { metrics?: unknown } | null)?.metrics
  if (!Array.isArray(list) || list.length === 0) return null
  const out: VerifiedMetric[] = []
  for (const m of list) {
    if (!m || typeof m !== 'object') return null
    const { key, value, source, periodStart, periodEnd } = m as Record<string, unknown>
    if (typeof key !== 'string' || !(METRIC_KEYS as readonly string[]).includes(key)) return null
    const k = key as MetricKey
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (PERCENT.has(k) && value > 100)) return null
    if (typeof source !== 'string' || !source.trim()) return null
    if (typeof periodStart !== 'string' || typeof periodEnd !== 'string' || !isoDay.test(periodStart) || !isoDay.test(periodEnd)) return null
    const a = Date.parse(periodStart), b = Date.parse(periodEnd)
    if (!Number.isFinite(a) || !Number.isFinite(b) || a > b) return null
    out.push({ key: k, label: LABELS[k], value, source: source.trim(), periodStart, periodEnd })
  }
  return { metrics: out }
}
