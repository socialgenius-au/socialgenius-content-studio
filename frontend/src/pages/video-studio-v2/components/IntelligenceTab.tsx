
import React, { useState } from "react";

const TABS = ["Positioning Insight", "Audience Insight", "Competitor Insight", "Content Insight", "Market Insight"] as const;
type InsightTab = typeof TABS[number];

// Only "Positioning Insight" has an approved-reference-exact content set (spec section E).
// The other four insight tabs are real, navigable, and share the identical approved card
// layout — but since no reference content was supplied for them, their copy here is a
// placeholder stand-in, not a fabricated "real" insight. Flagged in the completion report.
const INSIGHT_CONTENT: Record<InsightTab, {
  keyFindings: string[];
  opportunityTitle: string;
  opportunity: string;
  tags: string[];
  differentiator: string;
  angles: string[];
  summary: string;
  focusAreas: string[];
}> = {
  "Positioning Insight": {
    keyFindings: [
      "Showroom has visibility but lacks clear positioning for builders.",
      "Competition focuses on price, few focus on reliability + availability.",
      "Builders value stock availability, speed, and trade support.",
      "Positioning opportunity: “The most reliable tile partner for builders.”",
    ],
    opportunityTitle: "Positioning Opportunity",
    opportunity: "Position as the most reliable stock + service partner for builders.",
    tags: ["Reliability", "Stock", "Trade Support"],
    differentiator: "Differentiator: Stock availability + Fast delivery + Expert advice",
    angles: ["Reliability over everything", "Stock availability promise", "Fast delivery for builders", "Trade support & credit", "Real builders, real results"],
    summary: "Your project is about increasing footfall through a clear positioning that speaks directly to builders’ needs.",
    focusAreas: ["Stock reliability", "Fast fulfilment", "Trade-friendly support", "Clear builder-first messaging"],
  },
  "Audience Insight": {
    keyFindings: [
      "Primary audience is trade builders researching suppliers on mobile.",
      "Decision window is short — most compare 2–3 suppliers before visiting.",
      "Trust signals (stock, reviews, trade pricing) matter more than aesthetics.",
      "Audience opportunity: speak to urgency and certainty, not just range.",
    ],
    opportunityTitle: "Audience Opportunity",
    opportunity: "Speak directly to time-poor trade buyers who need certainty before they drive out.",
    tags: ["Trade Buyers", "Mobile-First", "Time-Poor"],
    differentiator: "Differentiator: Speed of decision + trade-specific proof points",
    angles: ["Built for busy trade schedules", "Skip the guesswork", "Trade pricing, no surprises", "One trip, everything in stock", "Trusted by builders like you"],
    summary: "Your audience decides fast and on mobile — the video should remove doubt before they visit, not just showcase the range.",
    focusAreas: ["Mobile-first pacing", "Trust signals early", "Trade-specific proof", "Clear next step"],
  },
  "Competitor Insight": {
    keyFindings: [
      "Most competitors lead with price promotions, not reliability.",
      "Few competitors show real stock or trade-support proof in their ads.",
      "Competitor content skews generic — little builder-specific messaging.",
      "Gap: nobody owns “reliability” as a positioning territory yet.",
    ],
    opportunityTitle: "Competitive Opportunity",
    opportunity: "Own “reliability” while competitors keep competing on price alone.",
    tags: ["Whitespace", "Reliability", "Differentiation"],
    differentiator: "Differentiator: Category-first claim no competitor currently owns",
    angles: ["While others discount, we deliver", "Reliability nobody else claims", "Stop comparing prices, start comparing stock", "The supplier that shows up", "Consistency over one-time deals"],
    summary: "No competitor currently owns a reliability-led message — this is open territory to claim before someone else does.",
    focusAreas: ["Category whitespace", "Non-price differentiation", "Proof over promotion", "First-mover messaging"],
  },
  "Content Insight": {
    keyFindings: [
      "Short, problem-first hooks outperform brand-first openings.",
      "On-screen text with spoken narration lifts completion rate.",
      "Builder testimonials outperform staged studio footage.",
      "Content opportunity: lead with the problem, not the showroom.",
    ],
    opportunityTitle: "Content Opportunity",
    opportunity: "Lead with a builder's real problem before introducing the showroom.",
    tags: ["Hook-First", "Testimonial", "On-Screen Text"],
    differentiator: "Differentiator: Problem-first structure over brand-first structure",
    angles: ["Start with the frustration, not the fix", "Let a real builder say it", "Text-forward for sound-off viewing", "Show, don't just tell, the stock", "End on the specific next step"],
    summary: "Content that opens on a relatable problem, not the brand, is what's converting best in this category right now.",
    focusAreas: ["Problem-first hooks", "Real testimonials", "Sound-off readability", "Specific CTA"],
  },
  "Market Insight": {
    keyFindings: [
      "Trade construction activity in the region is trending upward.",
      "Search demand for “tile supplier near me” has grown quarter over quarter.",
      "Supply-chain delays are a recurring pain point across the category.",
      "Market opportunity: reliability messaging lands harder during a supply squeeze.",
    ],
    opportunityTitle: "Market Opportunity",
    opportunity: "Capitalise on category-wide supply delays with a reliability-first message right now.",
    tags: ["Market Timing", "Local Demand", "Supply Squeeze"],
    differentiator: "Differentiator: Timely relevance while competitors are out of stock",
    angles: ["While others wait, we deliver", "Local stock, no delays", "Built for a market that's rebuilding", "Ahead of the supply squeeze", "Available when it counts"],
    summary: "Rising local demand and category-wide supply delays make this the right window for a reliability-first campaign.",
    focusAreas: ["Timely relevance", "Local demand signals", "Supply-chain contrast", "Urgency without discounting"],
  },
};

const FRAMEWORK_FLOW: [string, string][] = [
  ["Hook", "Pattern Interrupt"],
  ["Problem / Symptom", "Low Footfall"],
  ["Why / Diagnosis", "Positioning Gap"],
  ["Insight / Reframe", "Not the real reason"],
  ["Way Forward", "Better Positioning"],
  ["CTA", "Visit Showroom"],
];

export default function IntelligenceTab({ onNext, onBack }: { onNext?: () => void; onBack?: () => void }) {
  const [sub, setSub] = useState<InsightTab>("Positioning Insight");
  const c = INSIGHT_CONTENT[sub];

  return (
    <div className="stage-page intelligence-page">
      <h2>AI-powered insights and strategic intelligence.</h2>
      <div className="subtabs">
        {TABS.map(x => (
          <button className={sub === x ? "active" : ""} onClick={() => setSub(x)} key={x}>{x}</button>
        ))}
      </div>
      <div className="intel-grid">
        <section className="card">
          <h3>Key Findings</h3>
          <ul className="check-list separated">
            {c.keyFindings.map(f => <li key={f}>{f}</li>)}
          </ul>
        </section>
        <section className="card">
          <h3>{c.opportunityTitle}</h3>
          <div className="callout big">{c.opportunity}</div>
          <div className="pill-row">{c.tags.map(t => <span key={t}>{t}</span>)}</div>
          <p>{c.differentiator}</p>
          <button className="secondary wide" type="button">View Positioning Ideas →</button>
        </section>
        <section className="card">
          <h3>Recommended Angles</h3>
          <ol className="angle-list">
            {c.angles.map(a => <li key={a}>{a}</li>)}
          </ol>
          <button className="secondary wide" type="button">View All Angles →</button>
        </section>
        <section className="card">
          <h3>✦ AI Summary</h3>
          <p>{c.summary}</p>
          <hr />
          <h4>Focus Areas</h4>
          <ul>{c.focusAreas.map(f => <li key={f}>{f}</li>)}</ul>
        </section>
      </div>

      <section className="card framework-card">
        <h3>Content Framework Recommendation</h3>
        <div className="framework-flow">
          {FRAMEWORK_FLOW.map(([a, b], i) => (
            <React.Fragment key={a}>
              <div><b>{a}</b><span>{b}</span></div>
              {i < FRAMEWORK_FLOW.length - 1 && <i>→</i>}
            </React.Fragment>
          ))}
        </div>
      </section>

      <div className="stage-footer">
        <button className="secondary" onClick={onBack} type="button">← Back to Brief</button>
        <button className="primary" onClick={onNext} type="button">Next: Creative Lab →</button>
      </div>
    </div>
  );
}
