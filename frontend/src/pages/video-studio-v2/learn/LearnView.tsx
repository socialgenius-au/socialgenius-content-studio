// The Learn stage, presentational. Three clearly separated sections -- never mixed:
//   A. Verified performance (real audience data only; otherwise the exact "Not available" sentence)
//   B. Content assessment (AI-inferred blueprint structure, and rule-based checks on this project) -- explicitly NOT audience performance
//   C. Recommendations (measured vs hypothesis, with a decision the person can record) and lessons from earlier videos
import { useState } from 'react'
import type { Assessment, AiSceneStructure } from './assessment'
import { INSUFFICIENT, type Recommendation } from './recommendations'
import { PERFORMANCE_NOT_AVAILABLE, type VerifiedPerformance } from './performance'
import './learn.css'

export type Decision = 'open' | 'accepted' | 'dismissed' | 'tested'
export interface SavedDecision { status: Decision; note: string | null }
export interface Lesson { id: number; text: string; basis: string; draftName: string; evidence: string[]; caveat: string | null; note: string | null; updatedAt: string }

export interface LearnViewProps {
  identity: { client: string; campaign: string }
  performance: VerifiedPerformance | null
  assessment: Assessment
  ai: AiSceneStructure[]
  recommendations: Recommendation[]
  decisions: Record<string, SavedDecision>
  canRecord: boolean                       // a saved draft exists to attach decisions to
  busyKey: string | null
  error: string | null
  lessons: Lesson[]
  onDecide: (rec: Recommendation, status: Decision, note: string) => void
  onBack?: () => void
}

const LABEL: Record<Decision, string> = { open: 'Not decided', accepted: 'Accepted', dismissed: 'Dismissed', tested: 'Tested' }

function RecCard({ rec, saved, canRecord, busy, onDecide }: { rec: Recommendation; saved?: SavedDecision; canRecord: boolean; busy: boolean; onDecide: LearnViewProps['onDecide'] }) {
  const [note, setNote] = useState(saved?.note ?? '')
  const status = saved?.status ?? 'open'
  return (
    <li className="learn-rec" data-testid={`rec-${rec.key}`}>
      <div className="learn-rec-head">
        <span className={`learn-tag ${rec.basis === 'evidence' ? 'tag-measured' : 'tag-hypo'}`}>{rec.basis === 'evidence' ? 'Measured in this project' : 'Hypothesis — needs testing'}</span>
        <span className="learn-status" data-status={status}>{LABEL[status]}</span>
      </div>
      <p className="learn-rec-text">{rec.text}</p>
      <ul className="learn-evidence">{rec.evidence.map(e => <li key={e}>{e}</li>)}</ul>
      <p className="learn-caveat">{rec.caveat}</p>
      <div className="learn-rec-actions">
        <input type="text" value={note} maxLength={1000} placeholder="Optional note" aria-label={`Note for: ${rec.text}`} onChange={e => setNote(e.target.value)} disabled={!canRecord || busy} />
        {(['accepted', 'dismissed', 'tested'] as const).map(s => (
          <button key={s} type="button" className={status === s ? 'primary' : 'secondary'} disabled={!canRecord || busy} onClick={() => onDecide(rec, s, note)}>{LABEL[s]}</button>
        ))}
      </div>
    </li>
  )
}

export default function LearnView(p: LearnViewProps) {
  const measured = p.recommendations.filter(r => r.basis === 'evidence')
  const hypotheses = p.recommendations.filter(r => r.basis === 'hypothesis')
  return (
    <div className="stage-page learn-page-v2 learn-trust">
      <h2>What this video tells us — and what it doesn’t yet.</h2>
      <p className="learn-project">Project: <strong>{p.identity.client}</strong> — {p.identity.campaign}</p>

      <section className="card learn-section" data-testid="learn-performance">
        <h3>A. Verified performance</h3>
        {p.performance ? (
          <table className="learn-table"><thead><tr><th>Metric</th><th>Value</th><th>Source</th><th>Period</th></tr></thead>
            <tbody>{p.performance.metrics.map(m => (
              <tr key={m.key}><td>{m.label}</td><td>{m.value.toLocaleString()}</td><td>{m.source}</td><td>{m.periodStart.slice(0, 10)} to {m.periodEnd.slice(0, 10)}</td></tr>
            ))}</tbody></table>
        ) : (
          <>
            <p className="learn-na" data-testid="performance-not-available">{PERFORMANCE_NOT_AVAILABLE}</p>
            <p className="learn-muted">No views, reach, engagement, watch time, retention, clicks or conversions are shown because none have been measured for this video.</p>
          </>
        )}
      </section>

      <section className="card learn-section" data-testid="learn-ai-assessment">
        <h3>B. AI Content Assessment — Not Actual Audience Performance.</h3>
        <p className="learn-muted">The creative structure the AI inferred when it analysed the reference video and planned this blueprint. These are judgements about design, with the AI’s own confidence and stated limits. They are not results.</p>
        {p.ai.length === 0 ? (
          <p className="learn-na">No AI blueprint analysis is attached to this draft.</p>
        ) : (
          <ol className="learn-ai">{p.ai.map(s => (
            <li key={s.scene}>
              <strong>Scene {s.scene} · {s.role} · {s.seconds}s</strong> <span className="learn-tag tag-ai">AI-inferred · confidence {s.confidence}</span>
              <ul>{s.mechanisms.map(m => <li key={m.id}>{m.id} ({m.type.replace(/_/g, ' ')}): {m.principle}</li>)}</ul>
              {s.limitations.length > 0 && <p className="learn-caveat">Limits stated by the AI: {s.limitations.join(' ')}</p>}
            </li>
          ))}</ol>
        )}

        <h4>Project checks</h4>
        <p className="learn-muted" data-testid="learn-checks-label">Computed from this project’s own timeline and text. Not AI, and not audience data.</p>
        <ul className="learn-checks" data-testid="learn-checks">{p.assessment.findings.map(f => (
          <li key={f.id}>
            <strong>{f.title}</strong> <span className={`learn-tag ${f.kind === 'measured' ? 'tag-measured' : 'tag-hypo'}`}>{f.kind === 'measured' ? 'Measured' : 'Rule of thumb'} · confidence {f.confidence}</span>
            <p>{f.finding}</p>
            <details><summary>Evidence and reasoning</summary>
              <ul>{f.evidence.map(e => <li key={e}>{e}</li>)}</ul>
              <p className="learn-caveat">{f.reasoning}</p>
            </details>
          </li>
        ))}</ul>
      </section>

      <section className="card learn-section" data-testid="learn-recommendations">
        <h3>C. Recommendations and learning</h3>
        {!p.canRecord && <p className="learn-muted" data-testid="learn-save-hint">Save this video as a draft (Create/Edit → Save Draft) to record your decisions so they can be reused.</p>}
        {p.error && <p className="learn-error" role="alert">{p.error}</p>}

        <h4>Supported by measurements in this project</h4>
        {measured.length === 0 ? <p className="learn-muted">Nothing measured in this project needs changing under the checks above.</p>
          : <ul className="learn-recs">{measured.map(r => <RecCard key={r.key} rec={r} saved={p.decisions[r.key]} canRecord={p.canRecord} busy={p.busyKey === r.key} onDecide={p.onDecide} />)}</ul>}

        <h4>Hypotheses to test (no audience data behind them)</h4>
        <ul className="learn-recs">{hypotheses.map(r => <RecCard key={r.key} rec={r} saved={p.decisions[r.key]} canRecord={p.canRecord} busy={p.busyKey === r.key} onDecide={p.onDecide} />)}</ul>

        <h4>Not enough evidence to say</h4>
        <ul className="learn-insufficient">{INSUFFICIENT.map(i => <li key={i}>{i}</li>)}</ul>
      </section>

      <section className="card learn-section" data-testid="learn-lessons">
        <h3>Lessons you kept from earlier videos</h3>
        {p.lessons.length === 0 ? <p className="learn-muted">None yet. Accept a recommendation above and it will appear here for your next video.</p> : (
          <ul className="learn-recs">{p.lessons.map(l => (
            <li key={l.id} className="learn-rec">
              <span className={`learn-tag ${l.basis === 'evidence' ? 'tag-measured' : 'tag-hypo'}`}>{l.basis === 'evidence' ? 'Measured' : 'Hypothesis'}</span>
              <p className="learn-rec-text">{l.text}</p>
              <p className="learn-caveat">From “{l.draftName}”, accepted {l.updatedAt.slice(0, 10)}.{l.note ? ` Your note: ${l.note}` : ''}</p>
            </li>
          ))}</ul>
        )}
      </section>

      <div className="stage-footer"><button className="secondary" onClick={p.onBack} type="button">← Back: Review</button></div>
    </div>
  )
}
