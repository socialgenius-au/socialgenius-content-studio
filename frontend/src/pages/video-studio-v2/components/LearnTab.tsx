
import React, { useState } from "react";

// Matches the approved composite reference: single-project performance dashboard (Reach /
// Engagement / Shares / Watch Time, a trend chart, Top Insights, What to Try Next) — not the
// older multi-video analytics table this file previously implemented. See the completion
// report: the reference PNG "06-learn-reference.png" (a publish/export screen) conflicts with
// both this design and the written spec; this build follows the written spec + the composite
// image the user confirmed, treating the PNG as superseded for this stage.

const METRICS = [
  { label: "Reach", value: "28.4K", delta: "+24%", series: "reach" as const },
  { label: "Engagement", value: "4.2K", delta: "+18%", series: "engagement" as const },
  { label: "Shares", value: "1.3K", delta: "+32%", series: "shares" as const },
  { label: "Watch Time", value: "12.6K", delta: "+20%", series: "watchTime" as const },
];

const DATES = ["14 Aug", "15 Aug", "16 Aug", "17 Aug", "18 Aug", "19 Aug", "20 Aug"];
// Normalized (0-1) sample points per series — enough to draw a believable trend line without
// claiming precision no real analytics pipeline has produced yet.
const SERIES: Record<string, number[]> = {
  reach: [0.35, 0.42, 0.4, 0.55, 0.5, 0.68, 0.74],
  engagement: [0.3, 0.33, 0.45, 0.4, 0.52, 0.58, 0.6],
  watchTime: [0.25, 0.3, 0.28, 0.38, 0.45, 0.5, 0.62],
};
const SERIES_COLOR: Record<string, string> = {
  reach: "var(--v-accent)",
  engagement: "var(--v-blue)",
  watchTime: "var(--v-purple)",
};

const TOP_INSIGHTS = [
  "Strong interest in ‘Stock Availability’ message.",
  "CTA ‘Visit our showroom today’ performed best.",
  "Most viewers dropped off after 10 seconds.",
  "Mobile retention could be improved.",
];

const WHAT_TO_TRY = [
  "Try a shorter 10-second version.",
  "Add testimonial in opening.",
  "Test new hook options.",
];

function TrendChart() {
  const w = 560, h = 160, pad = 8;
  const toPoints = (vals: number[]) => vals
    .map((v, i) => {
      const x = pad + (i / (vals.length - 1)) * (w - pad * 2);
      const y = h - pad - v * (h - pad * 2);
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="trend-chart" preserveAspectRatio="none">
      {[0.25, 0.5, 0.75].map(g => (
        <line key={g} x1={pad} x2={w - pad} y1={h - pad - g * (h - pad * 2)} y2={h - pad - g * (h - pad * 2)} className="trend-grid" />
      ))}
      {(["reach", "engagement", "watchTime"] as const).map(key => (
        <polyline key={key} points={toPoints(SERIES[key])} fill="none" stroke={SERIES_COLOR[key]} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </svg>
  );
}

export default function LearnTab({ onBack }: { onBack?: () => void; onNext?: () => void }) {
  const [createClicked, setCreateClicked] = useState(false);

  return (
    <div className="stage-page learn-page-v2">
      <h2>Your video performance and learnings.</h2>

      <div className="metric-row">
        {METRICS.map(m => (
          <div className="card metric-card-v2" key={m.label}>
            <span>{m.label}</span>
            <b>{m.value}</b>
            <em style={{ color: SERIES_COLOR[m.series] ?? "var(--v-accent)" }}>{m.delta}</em>
          </div>
        ))}
      </div>

      <section className="card trend-card">
        <div className="trend-head">
          <h3>Performance Over Time</h3>
          <div className="trend-legend">
            <span><i style={{ background: SERIES_COLOR.reach }} />Reach</span>
            <span><i style={{ background: SERIES_COLOR.engagement }} />Engagement</span>
            <span><i style={{ background: SERIES_COLOR.watchTime }} />Watch Time</span>
          </div>
        </div>
        <TrendChart />
        <div className="trend-axis">{DATES.map(d => <span key={d}>{d}</span>)}</div>
      </section>

      <div className="learn-lower-grid">
        <section className="card">
          <h3>Top Insights</h3>
          <ul className="check-list">{TOP_INSIGHTS.map(i => <li key={i}>{i}</li>)}</ul>
        </section>
        <section className="card">
          <h3>What to Try Next</h3>
          <ul className="check-list">{WHAT_TO_TRY.map(i => <li key={i}>{i}</li>)}</ul>
        </section>
      </div>

      <section className="card ai-learn-banner">
        <div>
          <strong>✦ AI Learn Mode</strong>
          <span>Capture what works · Improve with every video</span>
        </div>
        <button className="primary" type="button" onClick={() => setCreateClicked(true)}>
          {createClicked ? "✓ Starting new video…" : "Create New Video →"}
        </button>
      </section>

      <div className="stage-footer">
        <button className="secondary" onClick={onBack} type="button">← Back: Review</button>
      </div>
    </div>
  );
}
