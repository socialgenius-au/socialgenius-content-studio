// M2.6 -- presentational manifest panel: everything the Reconstructor made for the draft, by scene, with how each was found and what is not recovered. No state beyond a copy button, no I/O
// of its own, changes nothing in the draft.
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { FAMILY_LABEL, manifestText, type Manifest, type ManifestEntry } from './manifest'

const box = 'rounded-xl border bg-card p-4'
const sub = 'text-xs text-muted-foreground'
const BUCKET_VARIANT: Record<ManifestEntry['bucket'], 'success' | 'warning' | 'outline'> = { recovered: 'success', inferred: 'warning', manual: 'outline' }
const secs = (n: number | null) => (n === null ? '' : `${n.toFixed(1)}s`)

export function ManifestView({ manifest }: { manifest: Manifest }) {
  const [copied, setCopied] = useState<'ok' | 'failed' | null>(null)
  const scenes = [...new Set(manifest.entries.map(e => e.scene))]
  const copy = async () => {
    try { await navigator.clipboard.writeText(manifestText(manifest)); setCopied('ok') } catch { setCopied('failed') }
  }
  return (
    <section className={`${box} space-y-3`} data-testid="reconstruction-manifest" aria-label="What the Reconstructor made for this draft">
      <div>
        <h3 className="text-sm font-semibold">What was made for this draft <Badge variant="outline">Preview</Badge></h3>
        <p className={sub}>One list of every element the Reconstructor will write into the draft, by scene. It only reads what the panels above hold; nothing here changes the draft.</p>
      </div>
      {manifest.total === 0
        ? <p className={sub} data-testid="manifest-empty">Nothing has been approved yet. Include some elements in the panels above and they will be listed here.</p>
        : (
          <>
            <ul className="flex flex-wrap gap-2 text-xs" data-testid="manifest-summary">
              {manifest.summary.map(s => (
                <li key={s.family} className="rounded-lg border bg-muted/30 px-2 py-1" data-testid={`manifest-count-${s.family}`}>
                  <strong>{s.total}</strong> {s.label.toLowerCase()} <span className={sub}>({s.byBucket.recovered} measured · {s.byBucket.inferred} estimated · {s.byBucket.manual} set by you)</span>
                </li>
              ))}
            </ul>
            {scenes.map(scene => (
              <div key={scene ?? 'draft'} className="space-y-1" data-testid={`manifest-scene-${scene ?? 'draft'}`}>
                <h4 className="text-xs font-semibold">{scene === null ? 'Whole draft' : `Scene ${scene}`}</h4>
                <ul className="space-y-1">
                  {manifest.entries.filter(e => e.scene === scene).map(e => (
                    <li key={e.family + e.id} className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/10 px-2 py-1 text-xs" data-testid="manifest-entry" data-family={e.family} data-bucket={e.bucket}>
                      <Badge variant="outline">{FAMILY_LABEL[e.family]}</Badge>
                      <span dir="auto" className="min-w-0 flex-1 truncate">{e.label}</span>
                      {e.startTime !== null && <span className={sub}>{secs(e.startTime)}{e.endTime !== null && e.endTime !== e.startTime ? `–${secs(e.endTime)}` : ''}</span>}
                      <Badge variant={BUCKET_VARIANT[e.bucket]}>{e.bucketLabel}</Badge>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <button type="button" className="rounded-md border bg-background px-2 py-1 text-xs font-medium hover:bg-muted" onClick={() => void copy()} data-testid="manifest-copy">Copy as text</button>
              {copied === 'ok' && <span className={sub} role="status">Copied.</span>}
              {copied === 'failed' && <span className="text-xs text-amber-700" role="status">Your browser did not allow copying.</span>}
            </div>
          </>
        )}
      <div role="note" className="rounded-lg border bg-muted/40 px-3 py-2 text-xs" data-testid="manifest-not-recovered">
        <strong>What is not recovered.</strong>
        <ul className="mt-1 list-disc pl-4">{manifest.limitations.map(l => <li key={l}>{l}</li>)}</ul>
      </div>
    </section>
  )
}
