
import React, { useState } from "react";

const PLATFORM_ICONS = [
  { key: "instagram", glyph: "◎" },
  { key: "facebook", glyph: "f" },
  { key: "tiktok", glyph: "♪" },
  { key: "youtube", glyph: "▶" },
  { key: "linkedin", glyph: "in" },
];

export default function BriefTab({ onNext }: { onNext?: () => void; onBack?: () => void }) {
  const [campaign, setCampaign] = useState("Builders Footfall Campaign");
  const [objective, setObjective] = useState("Increase Footfall");
  const [audience, setAudience] = useState("Builders & Trade Professionals");
  const [platforms, setPlatforms] = useState<string[]>(["instagram", "facebook"]);
  const [videoLength, setVideoLength] = useState("15 – 30 seconds (Reel)");
  const [cta, setCta] = useState("Visit our showroom today");
  const [keyMessage, setKeyMessage] = useState(
    "Your showroom looks good.\nBut your positioning may be the reason people walk past."
  );
  const [notes, setNotes] = useState("");
  const [videoType, setVideoType] = useState("Educational / Problem – Solution");
  const [tone, setTone] = useState("Authoritative but Simple");
  const [contentFocus, setContentFocus] = useState("Positioning impacts footfall");
  const [refLinks, setRefLinks] = useState("");
  const [budget, setBudget] = useState("");
  const [saved, setSaved] = useState(false);

  const togglePlatform = (key: string) =>
    setPlatforms(p => (p.includes(key) ? p.filter(x => x !== key) : [...p, key]));

  const saveDraft = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  return (
    <div className="stage-page brief-page">
      <h2>Define your video project and objectives.</h2>
      <div className="brief-grid">
        <section className="card">
          <h3>Project Details</h3>
          <Field label="Client / Brand"><input value="ABC Tiles" readOnly /></Field>
          <Field label="Campaign / Project"><input value={campaign} onChange={e => setCampaign(e.target.value)} /></Field>
          <Field label="Objective"><input value={objective} onChange={e => setObjective(e.target.value)} /></Field>
          <Field label="Primary Audience">
            <select value={audience} onChange={e => setAudience(e.target.value)}>
              <option>Builders & Trade Professionals</option>
              <option>Homeowners</option>
              <option>Interior Designers</option>
              <option>Property Developers</option>
            </select>
          </Field>
          <Field label="Platform / Format">
            <div className="platform-pills">
              {PLATFORM_ICONS.map(p => (
                <button
                  key={p.key}
                  className={platforms.includes(p.key) ? "active" : ""}
                  onClick={() => togglePlatform(p.key)}
                  type="button"
                  title={p.key}
                >
                  {p.glyph}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Video Length">
            <select value={videoLength} onChange={e => setVideoLength(e.target.value)}>
              <option>15 – 30 seconds (Reel)</option>
              <option>30 – 60 seconds</option>
              <option>60 – 90 seconds</option>
              <option>90+ seconds</option>
            </select>
          </Field>
          <Field label="Call to Action (CTA)"><input value={cta} onChange={e => setCta(e.target.value)} /></Field>
          <Field label="Key Message">
            <textarea value={keyMessage} onChange={e => setKeyMessage(e.target.value)} />
          </Field>
          <Field label="Additional Brief (Optional)">
            <textarea
              placeholder="Add any extra context or instructions..."
              value={notes}
              onChange={e => setNotes(e.target.value)}
            />
          </Field>
        </section>

        <section className="card">
          <h3>Video Direction</h3>
          <Field label="Video Type">
            <select value={videoType} onChange={e => setVideoType(e.target.value)}>
              <option>Educational / Problem – Solution</option>
              <option>Brand Story</option>
              <option>Product Showcase</option>
              <option>Testimonial</option>
            </select>
          </Field>
          <Field label="Tone of Voice">
            <select value={tone} onChange={e => setTone(e.target.value)}>
              <option>Authoritative but Simple</option>
              <option>Friendly & Approachable</option>
              <option>Bold & Energetic</option>
              <option>Calm & Trustworthy</option>
            </select>
          </Field>
          <Field label="Content Focus">
            <select value={contentFocus} onChange={e => setContentFocus(e.target.value)}>
              <option>Positioning impacts footfall</option>
              <option>Price / value comparison</option>
              <option>Stock availability</option>
              <option>Trade support & service</option>
            </select>
          </Field>
          <label className="fieldLabel">Style Reference</label>
          <div className="thumb-row">
            {[1, 2, 3, 4].map(x => <div className="mini-thumb" key={x}><span>{x}</span></div>)}
            <button className="add-tile" type="button">+ Add</button>
          </div>
          <Field label="Reference Video (Optional)">
            <input placeholder="Add Links / Notes" value={refLinks} onChange={e => setRefLinks(e.target.value)} />
          </Field>
          <Field label="Budget (Optional)">
            <select value={budget} onChange={e => setBudget(e.target.value)}>
              <option value="">Select budget range</option>
              <option value="low">Under $500</option>
              <option value="mid">$500 – $2,000</option>
              <option value="high">$2,000+</option>
            </select>
          </Field>
        </section>

        <aside className="right-stack">
          <section className="card">
            <h3>☀ Tips</h3>
            <ul className="check-list">
              <li>Be specific about the outcome you want.</li>
              <li>One clear message works better than many.</li>
              <li>Know your audience and speak their language.</li>
              <li>A strong CTA drives action.</li>
            </ul>
          </section>
          <section className="card">
            <h3>✦ AI Suggestions</h3>
            <p>Based on similar top-performing videos for your industry:</p>
            <ul className="check-list">
              <li>Use a hook in first 2 seconds</li>
              <li>Show before/after contrast</li>
              <li>Add on-screen text emphasis</li>
              <li>End with a clear CTA</li>
            </ul>
          </section>
        </aside>
      </div>

      <div className="stage-footer">
        <button className="secondary" onClick={saveDraft} type="button">{saved ? "✓ Saved" : "Save Draft"}</button>
        <button className="primary" onClick={onNext} type="button">Next: Intelligence →</button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}
