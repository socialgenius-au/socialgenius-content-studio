import { useState } from 'react'
import { Sparkles, Wand2, Send, Download, Save } from 'lucide-react'
import { REVIEW_SCORES, AI_RECOMMENDATIONS, PLATFORMS } from '../mockData'

export default function ReviewTab({ onBack }: { onBack: () => void }) {
  const [platforms, setPlatforms] = useState<string[]>(['Instagram Feed'])

  const togglePlatform = (p: string) =>
    setPlatforms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]))

  const overall = Math.round(REVIEW_SCORES.reduce((s, r) => s + r.value, 0) / REVIEW_SCORES.length)

  return (
    <div>
      <div className="pcv2-stage-head">
        <span className="pcv2-stage-num">5</span>
        <span className="pcv2-stage-title">Review</span>
      </div>
      <p className="pcv2-stage-sub">Quality check before publishing</p>

      <div className="pcv2-review-layout" style={{ marginTop: 20 }}>
        <div>
          <div className="pcv2-review-preview" />
          <div className="pcv2-card" style={{ marginTop: 16 }}>
            <h3 className="pcv2-card-title">Post Quality Score</h3>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, margin: '10px 0 4px' }}>
              <span style={{ fontSize: 34, fontWeight: 800, color: 'var(--pcv2-accent)' }}>{overall}</span>
              <span style={{ color: 'var(--pcv2-text-muted)', fontSize: 13 }}>/100 Excellent</span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="pcv2-btn pcv2-btn-primary pcv2-btn-block">
                <Send size={14} /> Approve &amp; Export
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
              <button type="button" className="pcv2-btn pcv2-btn-secondary pcv2-btn-block">
                Send for Approval
              </button>
              <button type="button" className="pcv2-btn pcv2-btn-secondary pcv2-btn-block">
                <Save size={14} /> Save as Draft
              </button>
            </div>
          </div>
        </div>

        <div>
          <div className="pcv2-card" style={{ marginBottom: 20 }}>
            <h3 className="pcv2-card-title">Scorecard</h3>
            <p className="pcv2-card-sub">How this post is expected to perform</p>
            {REVIEW_SCORES.map((s) => (
              <div key={s.label} className="pcv2-score-row">
                <span className="pcv2-score-label">{s.label}</span>
                <div className="pcv2-score-bar-track">
                  <div className="pcv2-score-bar-fill" style={{ width: `${s.value}%` }} />
                </div>
                <span className="pcv2-score-value">{s.value}</span>
              </div>
            ))}
          </div>

          <div className="pcv2-card" style={{ marginBottom: 20 }}>
            <h3 className="pcv2-card-title">
              <Sparkles size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
              AI Recommendations
            </h3>
            {AI_RECOMMENDATIONS.map((r) => (
              <div key={r.id} className="pcv2-recommendation">
                <span style={{ fontSize: 12.5 }}>{r.text}</span>
                <button type="button" className="pcv2-btn pcv2-btn-secondary" style={{ padding: '6px 10px', fontSize: 11.5 }}>
                  <Wand2 size={12} /> Apply
                </button>
              </div>
            ))}
          </div>

          <div className="pcv2-card">
            <h3 className="pcv2-card-title">Publish To</h3>
            <p className="pcv2-card-sub">Select platforms for this post</p>
            <div className="pcv2-platform-row">
              {PLATFORMS.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`pcv2-platform-pill ${platforms.includes(p) ? 'is-selected' : ''}`}
                  onClick={() => togglePlatform(p)}
                >
                  {p}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button type="button" className="pcv2-btn pcv2-btn-primary">
                <Send size={14} /> Send to Publishing
              </button>
              <button type="button" className="pcv2-btn pcv2-btn-secondary">
                <Download size={14} /> Export
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="pcv2-footer-nav" style={{ justifyContent: 'flex-start' }}>
        <button type="button" className="pcv2-btn pcv2-btn-secondary" onClick={onBack}>
          ← Create
        </button>
      </div>
    </div>
  )
}
