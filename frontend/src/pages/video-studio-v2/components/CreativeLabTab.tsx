
import React, { useMemo, useState } from "react";
import { hookIdeas } from "../data/videoStudioMock";

const SUBTABS = ["Angles", "Hooks", "Opening Frames", "Pre-text", "Compare"] as const;
type SubTab = typeof SUBTABS[number];

const SCORE_LABEL = (score: number) => (score >= 80 ? "High" : score >= 65 ? "Med" : "Low");

const ANGLES = [
  { title: "Reliability over everything", desc: "Lead with stock certainty as the core promise." },
  { title: "Stock availability promise", desc: "Show real stock on hand, not just range." },
  { title: "Fast delivery for builders", desc: "Speed as the differentiator for trade buyers." },
  { title: "Trade support & credit", desc: "Lean into account/trade-specific benefits." },
  { title: "Real builders, real results", desc: "Testimonial-led social proof." },
];

const OPENING_FRAMES = [
  { label: "Showroom wide shot", tag: "Establishing" },
  { label: "Builder walking past", tag: "Problem" },
  { label: "Close-up on stock shelf", tag: "Proof" },
  { label: "Staff greeting a trade customer", tag: "Trust" },
  { label: "Delivery truck arriving", tag: "Reliability" },
  { label: "Text-on-black hook card", tag: "Hook" },
];

export default function CreativeLabTab({ onNext, onBack }: { onNext?: () => void; onBack?: () => void }) {
  const [sub, setSub] = useState<SubTab>("Hooks");
  const [selected, setSelected] = useState(0);
  const [shortlisted, setShortlisted] = useState<Set<number>>(new Set());
  const [compareMode, setCompareMode] = useState(false);
  const [compareIds, setCompareIds] = useState<Set<number>>(new Set());
  const [visibleCount, setVisibleCount] = useState(6);

  const [hookType, setHookType] = useState("All Types");
  const [goal, setGoal] = useState("All Goals");
  const [tone, setTone] = useState("All Tones");
  const [sortBy, setSortBy] = useState("AI Score (High-Low)");

  const filtered = useMemo(() => {
    let list = hookIdeas.map((h, i) => ({ ...h, idx: i }));
    if (hookType !== "All Types") list = list.filter(h => h.type === hookType);
    if (goal !== "All Goals") list = list.filter(h => h.goal === goal);
    if (tone !== "All Tones") list = list.filter(h => h.tone === tone);
    list = [...list].sort((a, b) => sortBy === "AI Score (High-Low)" ? b.score - a.score : a.score - b.score);
    return list;
  }, [hookType, goal, tone, sortBy]);

  const visible = filtered.slice(0, visibleCount);
  const activeHook = hookIdeas[selected];

  const toggleShortlist = (idx: number) => setShortlisted(p => {
    const next = new Set(p);
    next.has(idx) ? next.delete(idx) : next.add(idx);
    return next;
  });

  const toggleCompare = (idx: number) => setCompareIds(p => {
    const next = new Set(p);
    next.has(idx) ? next.delete(idx) : next.add(idx);
    return next;
  });

  const clearFilters = () => { setHookType("All Types"); setGoal("All Goals"); setTone("All Tones"); setSortBy("AI Score (High-Low)"); };

  return (
    <div className="stage-page creative-page">
      <h2>Explore angles, hooks, and test before production.</h2>
      <div className="subtabs">
        {SUBTABS.map(x => <button className={sub === x ? "active" : ""} onClick={() => setSub(x)} key={x}>{x}</button>)}
      </div>

      {sub === "Hooks" && (
        <div className="creative-grid">
          <aside className="card filter-card">
            <h3>Filters</h3>
            <label className="stack-field"><span>Hook Type</span>
              <select value={hookType} onChange={e => setHookType(e.target.value)}>
                <option>All Types</option><option>Question</option><option>Statement</option><option>Scenario</option>
              </select>
            </label>
            <label className="stack-field"><span>Goal</span>
              <select value={goal} onChange={e => setGoal(e.target.value)}>
                <option>All Goals</option><option>Awareness</option><option>Traffic</option><option>Leads</option>
              </select>
            </label>
            <label className="stack-field"><span>Tone</span>
              <select value={tone} onChange={e => setTone(e.target.value)}>
                <option>All Tones</option><option>Direct</option><option>Curious</option><option>Bold</option>
              </select>
            </label>
            <label className="stack-field"><span>Sort By</span>
              <select value={sortBy} onChange={e => setSortBy(e.target.value)}>
                <option>AI Score (High-Low)</option><option>AI Score (Low-High)</option>
              </select>
            </label>
            <button className="secondary wide" type="button" onClick={clearFilters}>🗑 Clear Filters</button>
          </aside>

          <section className="card hook-list">
            <div className="hook-list-head">
              <h3>Hook Ideas ({filtered.length})</h3>
              <label className="compare-toggle">
                Select to compare
                <input type="checkbox" checked={compareMode} onChange={e => { setCompareMode(e.target.checked); if (!e.target.checked) setCompareIds(new Set()); }} />
              </label>
            </div>
            {visible.map(h => (
              <button
                className={`hook-row ${!compareMode && selected === h.idx ? "active" : ""}`}
                onClick={() => compareMode ? toggleCompare(h.idx) : setSelected(h.idx)}
                key={h.text}
              >
                <span className={compareMode ? "checkDot" : "radioDot"}>{compareMode && compareIds.has(h.idx) ? "✓" : ""}</span>
                <b>{h.text}</b>
                <em>{SCORE_LABEL(h.score)}</em>
                <span>Score {h.score}/100</span>
                <span className="bookmark" onClick={ev => { ev.stopPropagation(); toggleShortlist(h.idx); }}>{shortlisted.has(h.idx) ? "★" : "☆"}</span>
              </button>
            ))}
            {visibleCount < filtered.length && (
              <button className="secondary wide" type="button" onClick={() => setVisibleCount(c => c + 6)}>Load More Hooks ↓</button>
            )}
          </section>

          <section className="card selected-hook">
            <h3>Selected Hook Details</h3>
            <div className="quote-box">
              “{activeHook.text}”
              <button className="copy-btn" type="button" title="Copy" onClick={() => navigator.clipboard?.writeText(activeHook.text)}>⧉</button>
            </div>
            <h4>Why this hook works</h4>
            <ul className="check-list">
              <li>Creates curiosity with a problem</li>
              <li>Relatable to showroom owners</li>
              <li>Short, direct and punchy</li>
            </ul>
            <h4>Best used for</h4>
            <div className="pill-row"><span>Awareness</span><span>Traffic</span><span>Leads</span></div>
            <h4>Recommended For</h4>
            <div className="pill-row"><span>Builders & Trade</span><span>Showroom Owners</span><span>B2B</span></div>
            <h4>Suggested Follow-up Angles</h4>
            <ul>
              <li>Your showroom might be invisible online.</li>
              <li>It’s not about tiles. It’s about trust.</li>
              <li>They have options. Why should they choose you?</li>
            </ul>
            <div className="split-actions">
              <button className="secondary" type="button" onClick={() => toggleShortlist(selected)}>
                {shortlisted.has(selected) ? "★ Shortlisted" : "☆ Add to Shortlist"}
              </button>
              <button className="primary" type="button" onClick={onNext}>Use This Hook →</button>
            </div>
          </section>

          <aside className="card scorecard">
            <h3>Hook Scorecard</h3>
            <div className="ring-score"><b>{activeHook.score}</b><span>/100</span><small>{activeHook.score >= 80 ? "Excellent" : "Good"}</small></div>
            {[["Scroll-stop Potential", 9], ["Clarity", 8], ["Relevance", 9], ["Curiosity Pull", 9], ["Novelty", 8], ["Brand Fit", 9], ["Proof Potential", 8]].map(([a, b]) => (
              <div className="score-line" key={a as string}><span>{a}</span><b>{b}/10</b><i><u style={{ width: `${Number(b) * 10}%` }} /></i></div>
            ))}
            <div className="total-line"><b>Total Score</b><strong>{activeHook.score}/100</strong></div>
          </aside>
        </div>
      )}

      {sub === "Angles" && (
        <div className="angles-grid">
          {ANGLES.map((a, i) => (
            <section className="card angle-card" key={a.title}>
              <span className="angle-num">{i + 1}</span>
              <h3>{a.title}</h3>
              <p>{a.desc}</p>
              <button className="secondary wide" type="button">Use This Angle →</button>
            </section>
          ))}
        </div>
      )}

      {sub === "Opening Frames" && (
        <div className="frames-grid">
          {OPENING_FRAMES.map(f => (
            <div className="frame-card" key={f.label}>
              <div className="frame-thumb"><span>{f.tag}</span></div>
              <small>{f.label}</small>
            </div>
          ))}
        </div>
      )}

      {sub === "Pre-text" && (
        <section className="card pretext-card">
          <h3>Pre-text Performance Prediction</h3>
          <p>Predicted early-scroll-stop performance for the currently selected hook, based on similar copy in this category.</p>
          <div className="ring-score large"><b>{activeHook.score}</b><span>/100</span><small>Predicted</small></div>
          <ul className="check-list">
            <li>Strong pattern-interrupt in the first line.</li>
            <li>Reads well with sound off (short, punchy).</li>
            <li>Consider testing a shorter variant under 6 words.</li>
          </ul>
        </section>
      )}

      {sub === "Compare" && (
        <section className="card compare-card">
          <h3>Compare Shortlisted / Selected Hooks</h3>
          {compareIds.size === 0 ? (
            <p className="empty-hint">Go to the Hooks tab, turn on “Select to compare”, and choose two or more hooks to see them side by side here.</p>
          ) : (
            <div className="compare-table">
              {[...compareIds].map(idx => (
                <div className="compare-col" key={idx}>
                  <div className="quote-box">{hookIdeas[idx].text}</div>
                  <div className="score-line"><span>AI Score</span><b>{hookIdeas[idx].score}/100</b></div>
                  <div className="score-line"><span>Type</span><b>{hookIdeas[idx].type}</b></div>
                  <div className="score-line"><span>Goal</span><b>{hookIdeas[idx].goal}</b></div>
                  <div className="score-line"><span>Tone</span><b>{hookIdeas[idx].tone}</b></div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <div className="stage-footer">
        <button className="secondary" onClick={onBack} type="button">← Back: Intelligence</button>
        <button className="primary" onClick={onNext} type="button">Next: Create / Edit →</button>
      </div>
    </div>
  );
}
