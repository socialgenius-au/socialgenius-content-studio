// Admin-only, read-only view of AI spending (backend: GET /ai/usage). Shows whether AI spending is switched on, whether a provider key is configured (yes/no only), the caps,
// what has been spent, and the latest calls. It cannot change anything, and it never receives a key, a prompt or a response.
import { useEffect, useState } from 'react'
import { aiUsageApi } from '@/api/client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

interface Usage {
  enabled: boolean
  key_configured: boolean
  phase_id: string
  price_table_version: string
  caps: { per_reference_usd: number; phase_usd: number }
  phase: { spent_usd: number; remaining_usd: number; calls: number; failed: number; refused: number; cache_hits: number; in_flight: number }
  by_reference: { reference_video_id: number | null; spent_usd: number; calls: number; remaining_usd: number | null }[]
  by_reasoner: { reasoner: string; model: string; spent_usd: number; calls: number }[]
  recent: { id: number; at: string; reasoner: string; reference_video_id: number | null; model: string; attempt: number; status: string; cost_usd: number; error: string | null }[]
}

const usd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`

export function AiSpendCard() {
  const [u, setU] = useState<Usage | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    aiUsageApi.usage().then(setU).catch(() => setErr('Could not load AI spending.'))
  }, [])

  return (
    <Card data-testid="ai-spend-card">
      <CardHeader>
        <CardTitle>AI spending</CardTitle>
        <CardDescription>Read-only. Every paid request is checked against these limits on the server before it is sent.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        {err && <div className="text-destructive">{err}</div>}
        {!u && !err && <div className="text-muted-foreground">Loading…</div>}
        {u && (
          <>
            <div className="flex items-center justify-between"><span className="text-muted-foreground">AI spending</span><Badge variant={u.enabled ? 'default' : 'outline'} data-testid="ai-enabled">{u.enabled ? 'ON' : 'OFF (nothing can be sent)'}</Badge></div>
            <div className="flex items-center justify-between"><span className="text-muted-foreground">Provider key</span><span className="font-medium">{u.key_configured ? 'configured' : 'not configured'}</span></div>
            <div className="flex items-center justify-between"><span className="text-muted-foreground">Limit per reference</span><span className="font-medium">{usd(u.caps.per_reference_usd)}</span></div>
            <div className="flex items-center justify-between"><span className="text-muted-foreground">Phase limit ({u.phase_id})</span><span className="font-medium">{usd(u.caps.phase_usd)}</span></div>
            <div className="flex items-center justify-between"><span className="text-muted-foreground">Spent / remaining (estimated)</span><span className="font-medium">{usd(u.phase.spent_usd)} / {usd(u.phase.remaining_usd)}</span></div>
            <div className="flex items-center justify-between"><span className="text-muted-foreground">Calls · failed · refused · reused free</span><span className="font-medium">{u.phase.calls} · {u.phase.failed} · {u.phase.refused} · {u.phase.cache_hits}</span></div>
            {u.by_reference.length > 0 && (
              <div className="mt-2">
                <div className="mb-1 font-medium">By reference</div>
                {u.by_reference.map(r => (
                  <div key={String(r.reference_video_id)} className="flex justify-between text-xs"><span>{r.reference_video_id == null ? 'not tied to a reference' : `Reference ${r.reference_video_id}`}</span><span>{usd(r.spent_usd)} · {r.calls} calls{r.remaining_usd != null ? ` · ${usd(r.remaining_usd)} left` : ''}</span></div>
                ))}
              </div>
            )}
            {u.recent.length > 0 && (
              <div className="mt-2">
                <div className="mb-1 font-medium">Latest calls</div>
                {u.recent.slice(0, 8).map(r => (
                  <div key={r.id} className="flex justify-between gap-2 text-xs"><span>{r.reasoner}{r.reference_video_id != null ? ` · ref ${r.reference_video_id}` : ''} · try {r.attempt}</span><span>{r.status}{r.error ? ` (${r.error})` : ''} · {usd(r.cost_usd)}</span></div>
                ))}
              </div>
            )}
            <div className="text-xs text-muted-foreground">Prices as of {u.price_table_version}. Amounts are estimates built from the provider's published prices.</div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
