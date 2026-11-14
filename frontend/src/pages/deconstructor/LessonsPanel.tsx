import type React from 'react'
// "Learning from Previous Videos": the person's accepted lessons, ranked for THIS brief, each selectable. Presentational; the page owns the state.
import { confidenceText, LESSONS_HEADING, LESSONS_NOTICE, type LessonCandidate } from './lessons'

function Disclosure({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <details className="rounded-lg border bg-muted/20 px-3 py-2 text-xs">
      <summary className="cursor-pointer font-medium">{label}</summary>
      <div className="mt-2 space-y-1 text-muted-foreground">{children}</div>
    </details>
  )
}

export interface LessonsPanelProps {
  status: 'loading' | 'ready' | 'error'
  lessons: LessonCandidate[]
  error?: string | null
  useLessons: boolean
  selected: ReadonlySet<number>
  onUseLessons: (on: boolean) => void
  onToggle: (id: number) => void
  onSelectSuggested: () => void
  onClear: () => void
}

function Card({ l, checked, enabled, onToggle }: { l: LessonCandidate; checked: boolean; enabled: boolean; onToggle: (id: number) => void }) {
  const r = l.relevance
  return (
    <li className="rounded-lg border p-3 text-sm" data-testid={`lesson-${l.lesson_id}`}>
      <label className="flex items-start gap-2">
        <input type="checkbox" className="mt-1" checked={checked} disabled={!enabled} onChange={() => onToggle(l.lesson_id)} aria-label={`Include lesson: ${l.text}`} />
        <span className="font-medium">{l.text}</span>
      </label>
      <div className="mt-1.5 flex flex-wrap gap-1.5 pl-6 text-[11px]">
        <span className="rounded-full border px-2 py-0.5 font-semibold">{l.classification_label}</span>
        {l.qualifier_labels.map(q => <span key={q} className="rounded-full border px-2 py-0.5">{q}</span>)}
        <span className="rounded-full border px-2 py-0.5">{confidenceText(l.confidence)}</span>
        {r?.relevant && !r.conflicts.length && <span className="rounded-full border border-emerald-600 px-2 py-0.5 text-emerald-700">Suggested for this brief</span>}
      </div>
      <p className="mt-1 pl-6 text-xs text-muted-foreground">From “{l.source.draft_name}”{l.source.accepted_at ? `, accepted ${l.source.accepted_at.slice(0, 10)}` : ''}.{l.user_note ? ` Your note: ${l.user_note}` : ''}</p>
      {r && r.reasons.length > 0 && <p className="mt-1 pl-6 text-xs text-muted-foreground">Why: {r.reasons.join(' ')}</p>}
      {r && r.conflicts.length > 0 && <p className="mt-1 pl-6 text-xs font-medium text-amber-700" role="note">Conflicts with this brief: {r.conflicts.join(' ')} If you include it, the blueprint will explain why it was not applied.</p>}
      <div className="pl-6"><Disclosure label="Evidence and caveat">
        <ul className="ml-4 list-disc">{l.evidence.map(e => <li key={e}>{e}</li>)}</ul>
        {l.caveat && <p className="pt-1">{l.caveat}</p>}
      </Disclosure></div>
    </li>
  )
}

export default function LessonsPanel(p: LessonsPanelProps) {
  const relevant = p.lessons.filter(l => l.relevance?.relevant)
  const others = p.lessons.filter(l => !l.relevance?.relevant)
  const count = p.useLessons ? p.selected.size : 0
  return (
    <section className="rounded-xl border bg-card p-4 space-y-3" data-testid="lessons-panel">
      <div>
        <h3 className="text-sm font-semibold">{LESSONS_HEADING}</h3>
        <p className="text-xs text-muted-foreground" data-testid="lessons-notice">{LESSONS_NOTICE}</p>
      </div>
      {p.status === 'loading' && <p className="text-xs text-muted-foreground">Looking for your accepted lessons…</p>}
      {p.status === 'error' && <p className="text-xs text-red-700" role="alert">{p.error ?? 'Could not load your lessons.'} You can still build the blueprint without them.</p>}
      {p.status === 'ready' && p.lessons.length === 0 && <p className="text-xs text-muted-foreground" data-testid="lessons-empty">No accepted lessons yet. Accept a recommendation on a video’s Learn screen and it will appear here.</p>}
      {p.status === 'ready' && p.lessons.length > 0 && (
        <>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={p.useLessons} onChange={e => p.onUseLessons(e.target.checked)} data-testid="use-lessons-toggle" />
            Use lessons from previous videos in this blueprint
          </label>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <button type="button" className="underline disabled:opacity-50" disabled={!p.useLessons} onClick={p.onSelectSuggested}>Select suggested</button>
            <button type="button" className="underline disabled:opacity-50" disabled={!p.useLessons || p.selected.size === 0} onClick={p.onClear}>Clear selection</button>
            <span className="text-muted-foreground" data-testid="lessons-count">{count === 0 ? 'No lessons will be used.' : `${count} ${count === 1 ? 'lesson' : 'lessons'} will be used as guidance.`}</span>
          </div>
          <div>
            <div className="text-xs font-medium">Relevant to this brief ({relevant.length})</div>
            {relevant.length === 0 ? <p className="text-xs text-muted-foreground">None of your accepted lessons look relevant to this brief yet.</p>
              : <ul className="mt-1 space-y-2">{relevant.map(l => <Card key={l.lesson_id} l={l} checked={p.selected.has(l.lesson_id)} enabled={p.useLessons} onToggle={p.onToggle} />)}</ul>}
          </div>
          {others.length > 0 && (
            <Disclosure label={`Other accepted lessons (${others.length})`}>
              <ul className="space-y-2">{others.map(l => <Card key={l.lesson_id} l={l} checked={p.selected.has(l.lesson_id)} enabled={p.useLessons} onToggle={p.onToggle} />)}</ul>
            </Disclosure>
          )}
        </>
      )}
    </section>
  )
}
