import { useState } from 'react'
import { CheckCircle2, Info } from 'lucide-react'
import { INTELLIGENCE_SUBTABS, INTELLIGENCE_CONTENT } from '../mockData'

export default function IntelligenceTab({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const [subtab, setSubtab] = useState<(typeof INTELLIGENCE_SUBTABS)[number]>('Customer')
  const content = INTELLIGENCE_CONTENT[subtab]

  return (
    <div>
      <div className="pcv2-stage-head">
        <span className="pcv2-stage-num">2</span>
        <span className="pcv2-stage-title">Intelligence</span>
      </div>
      <p className="pcv2-stage-sub">AI pulls relevant insights</p>

      <div className="pcv2-subtabs" style={{ marginTop: 20 }}>
        {INTELLIGENCE_SUBTABS.map((t) => (
          <button
            key={t}
            type="button"
            className={`pcv2-subtab ${subtab === t ? 'is-active' : ''}`}
            onClick={() => setSubtab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="pcv2-grid-2">
        <div className="pcv2-card">
          <h3 className="pcv2-card-title">Customer Insights</h3>
          <p className="pcv2-card-sub">Key insights for {subtab === 'Customer' ? 'Builders' : subtab.toLowerCase()}</p>
          <ul className="pcv2-insight-list">
            {content.customerInsights.map((t, i) => (
              <li key={i}>
                <CheckCircle2 size={15} /> {t}
              </li>
            ))}
          </ul>
        </div>

        <div className="pcv2-card">
          <h3 className="pcv2-card-title">Pain Points / Needs</h3>
          <p className="pcv2-card-sub">What's blocking conversion today</p>
          <ul className="pcv2-insight-list">
            {content.painPoints.map((t, i) => (
              <li key={i}>
                <Info size={15} /> {t}
              </li>
            ))}
          </ul>
        </div>

        <div className="pcv2-card">
          <h3 className="pcv2-card-title">Positioning Opportunities</h3>
          <p className="pcv2-card-sub">Where this post can win</p>
          <ul className="pcv2-insight-list">
            {content.positioningOpportunities.map((t, i) => (
              <li key={i}>
                <CheckCircle2 size={15} /> {t}
              </li>
            ))}
          </ul>
        </div>

        <div className="pcv2-card">
          <h3 className="pcv2-card-title">Competitor Insights</h3>
          <p className="pcv2-card-sub">What the competitive set is doing</p>
          <ul className="pcv2-insight-list">
            {content.competitorInsights.map((t, i) => (
              <li key={i}>
                <Info size={15} /> {t}
              </li>
            ))}
          </ul>
        </div>

        <div className="pcv2-card">
          <h3 className="pcv2-card-title">What's Working</h3>
          <p className="pcv2-card-sub">Proven performance patterns</p>
          <ul className="pcv2-insight-list">
            {content.whatsWorking.map((t, i) => (
              <li key={i}>
                <CheckCircle2 size={15} /> {t}
              </li>
            ))}
          </ul>
        </div>

        <div className="pcv2-card">
          <h3 className="pcv2-card-title">Recommended Content Angles</h3>
          <p className="pcv2-card-sub">Suggested CTA / message</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
            {content.recommendedAngles.map((a) => (
              <span key={a} className="pcv2-badge pcv2-badge-neutral">
                {a}
              </span>
            ))}
          </div>
          <div className="pcv2-readonly-row" style={{ paddingTop: 0 }}>
            <span className="pcv2-readonly-label">Suggested CTA</span>
            <span className="pcv2-readonly-value">{content.suggestedCta}</span>
          </div>
          <div className="pcv2-source-note">
            <Info size={12} /> {content.sourceNote}
          </div>
        </div>
      </div>

      <div className="pcv2-footer-nav">
        <button type="button" className="pcv2-btn pcv2-btn-secondary" onClick={onBack}>
          ← Brief
        </button>
        <button type="button" className="pcv2-btn pcv2-btn-primary" onClick={onNext}>
          Next: References →
        </button>
      </div>
    </div>
  )
}
