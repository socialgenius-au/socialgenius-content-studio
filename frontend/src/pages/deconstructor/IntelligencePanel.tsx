// New Content: "What this reference teaches". Shows the person which creative mechanisms will be reused, on what evidence, when each applies or should be avoided, and how to adapt it to a different business.
// Presentational only. The record is computed by the server from stored results; nothing here calls an AI.
import type React from 'react'
import {
  channelLabel, evidenceSummary, hookSummary, INTELLIGENCE_HEADING, REUSE_NOT_COPY, STATUS_NOTE, typeLabel, type CreativeIntelligence,
} from './intelligence'

export interface IntelligencePanelProps { status: 'loading' | 'ready' | 'error'; intel: CreativeIntelligence | null; error?: string | null }

function Details({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <details className="rounded-lg border bg-muted/20 px-3 py-2 text-xs">
      <summary className="cursor-pointer font-medium">{label}</summary>
      <div className="mt-2 space-y-1 text-muted-foreground">{children}</div>
    </details>
  )
}
const List = ({ items }: { items: string[] }) => <ul className="ml-4 list-disc">{items.map(i => <li key={i}>{i}</li>)}</ul>

export default function IntelligencePanel({ status, intel, error }: IntelligencePanelProps) {
  return (
    <section className="rounded-xl border bg-card p-4 space-y-3" data-testid="intelligence-panel">
      <div>
        <h3 className="text-sm font-semibold">{INTELLIGENCE_HEADING}</h3>
        <p className="text-xs text-muted-foreground"><strong>{REUSE_NOT_COPY}</strong> What follows is how the reference appears to work, with the evidence behind each point. It describes apparent design only; nothing says how any audience responded.</p>
      </div>
      {status === 'loading' && <p className="text-xs text-muted-foreground">Reading the reference’s analysis…</p>}
      {status === 'error' && <p className="text-xs text-red-700" role="alert">{error ?? 'Could not load the reference’s creative intelligence.'} You can still describe your new content below.</p>}
      {status === 'ready' && intel && (
        <>
          {STATUS_NOTE[intel.status] && <p className="text-xs text-amber-700" data-testid="intelligence-status-note">{STATUS_NOTE[intel.status]}</p>}

          {intel.hook && (
            <div className="space-y-1 text-sm" data-testid="intelligence-hook">
              <div className="font-medium">How the opening works <span className="font-normal text-muted-foreground">· {hookSummary(intel.hook)}</span></div>
              <div className="flex flex-wrap gap-1.5 text-[11px]">
                {Object.entries(intel.hook.channels).filter(([, v]) => v.present).map(([k, v]) => (
                  <span key={k} className="rounded-full border px-2 py-0.5">{channelLabel(k)}{v.reliable === false ? ' (unverified)' : ''}</span>
                ))}
              </div>
              {intel.hook.attention_mechanism && <p className="text-xs text-muted-foreground">{intel.hook.attention_mechanism}</p>}
              {intel.hook.relationships.length > 0 && <ul className="ml-4 list-disc text-xs text-muted-foreground">{intel.hook.relationships.map(r => <li key={r}>{r}</li>)}</ul>}
            </div>
          )}

          {intel.narrative && (
            <div className="text-sm" data-testid="intelligence-narrative">
              <div className="font-medium">How the story progresses</div>
              {intel.narrative.arc_text ? <p className="text-xs text-muted-foreground">{intel.narrative.arc_text} <em>(read from the frames by an AI; inferred)</em></p> : <p className="text-xs text-muted-foreground">Not established.</p>}
              {intel.narrative.uncertainty.length > 0 && <ul className="ml-4 list-disc text-xs text-amber-700">{intel.narrative.uncertainty.map(u => <li key={u}>{u}</li>)}</ul>}
            </div>
          )}

          {intel.mechanisms.length > 0 && (
            <div className="space-y-2" data-testid="intelligence-mechanisms">
              <div className="text-sm font-medium">Principles that can be reused ({intel.mechanisms.length})</div>
              {intel.mechanisms.map(m => (
                <article key={m.mechanism_id} className="rounded-lg border p-3 text-sm" data-testid={`intel-mechanism-${m.mechanism_id}`}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-semibold">{m.mechanism_id} · {typeLabel(m)}</span>
                    {m.confidence && <span className="rounded-full border px-2 py-0.5 text-[11px]">{m.confidence} confidence</span>}
                    <span className="rounded-full border px-2 py-0.5 text-[11px]">AI interpretation</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{m.purpose}</p>
                  {m.transferable_principle && <p className="mt-1"><span className="font-medium">Principle to reuse: </span>{m.transferable_principle}</p>}
                  <p className="mt-1 text-xs text-muted-foreground" data-testid={`intel-evidence-${m.mechanism_id}`}>Seen in {evidenceSummary(m)}.</p>
                  {m.unreliable_channels.length > 0 && <p className="text-xs text-amber-700">Weak evidence: the {m.unreliable_channels.map(c => (c === 'audio' ? 'speech' : c)).join(' and ')} behind this is unverified.</p>}
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <Details label="May apply when"><List items={m.conditions.applies_when} /></Details>
                    <Details label="Avoid when"><List items={m.conditions.avoid_when} /></Details>
                    <Details label="How to adapt it to your business"><List items={m.adaptation_guidance} /></Details>
                    <Details label="Never copy"><List items={m.reuse_vs_copy.never_copy.map(x => x.description)} /></Details>
                  </div>
                  <Details label="Limitations and where the guidance comes from">
                    {m.limitations.length > 0 && <List items={m.limitations} />}
                    <p>{m.conditions.source}</p>
                  </Details>
                </article>
              ))}
            </div>
          )}

          {intel.contradictions.length > 0 && (
            <Details label={`Where the evidence disagrees or is weak (${intel.contradictions.length})`}>
              <ul className="ml-4 list-disc">{intel.contradictions.map(c => {
                const more = Math.max(0, (c.notes?.length ?? 0) - 1)
                const where = c.sections && c.sections.length ? `sections ${c.sections.join(', ')}` : null
                const extra = [more > 0 ? `+${more} more note${more > 1 ? 's' : ''}` : null, where].filter(Boolean).join('; ')
                return (
                  <li key={`${c.topic}-${c.status}`}>
                    <strong>{c.topic}</strong> ({c.status.replace(/_/g, ' ')}): {c.note}
                    {extra && <span className="text-slate-500"> ({extra})</span>}
                  </li>
                )
              })}</ul>
            </Details>
          )}
          {intel.structure && intel.structure.uncertainty.length > 0 && (
            <Details label="What the scene and story-beat analysis could not establish"><List items={intel.structure.uncertainty} /></Details>
          )}
          <p className="text-xs text-muted-foreground" data-testid="intelligence-audience-note">Audience effects: {intel.audience_effects.status.replace(/_/g, ' ')}. {intel.audience_effects.statement}</p>
        </>
      )}
    </section>
  )
}
