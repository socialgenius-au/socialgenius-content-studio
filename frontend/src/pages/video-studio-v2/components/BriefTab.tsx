
import React from "react";
export default function BriefTab({onNext}:{onNext?:()=>void}) {
  return <div className="stage-page brief-page">
    <h2>Define your video project and objectives.</h2>
    <div className="brief-grid">
      <section className="card">
        <h3>Project Details</h3>
        <Field label="Client / Brand"><input value="ABC Tiles" readOnly /></Field>
        <Field label="Campaign / Project"><input defaultValue="Builders Footfall Campaign" /></Field>
        <Field label="Objective"><input defaultValue="Increase Footfall" /></Field>
        <Field label="Primary Audience"><select><option>Builders & Trade Professionals</option></select></Field>
        <Field label="Platform / Format"><div className="platform-pills"><button>◎</button><button>f</button><button>♪</button><button>▶</button><button>in</button></div></Field>
        <Field label="Video Length"><select><option>15–30 seconds (Reel)</option></select></Field>
        <Field label="Call to Action (CTA)"><input defaultValue="Visit our showroom today" /></Field>
        <Field label="Key Message"><textarea defaultValue="Your showroom looks good. But your positioning may be the reason people walk past." /></Field>
        <Field label="Additional Brief (Optional)"><textarea placeholder="Add any extra context or instructions..." /></Field>
      </section>
      <section className="card">
        <h3>Video Direction</h3>
        <Field label="Video Type"><select><option>Educational / Problem – Solution</option></select></Field>
        <Field label="Tone of Voice"><select><option>Authoritative but Simple</option></select></Field>
        <Field label="Content Focus"><select><option>Positioning impacts footfall</option></select></Field>
        <label className="fieldLabel">Style Reference</label>
        <div className="thumb-row">{[1,2,3,4].map(x=><div className="mini-thumb" key={x}><span>{x}</span></div>)}<button className="add-tile">+ Add</button></div>
        <Field label="Reference Video (Optional)"><input placeholder="Add Links / Notes" /></Field>
        <Field label="Budget (Optional)"><select><option>Select budget range</option></select></Field>
      </section>
      <aside className="right-stack">
        <section className="card"><h3>☀ Tips</h3><ul className="check-list"><li>Be specific about the outcome you want.</li><li>One clear message works better than many.</li><li>Know your audience and speak their language.</li><li>A strong CTA drives action.</li></ul></section>
        <section className="card"><h3>✦ AI Suggestions</h3><p>Based on similar top-performing videos for your industry:</p><ul className="check-list"><li>Use a hook in first 2 seconds</li><li>Show before/after contrast</li><li>Add on-screen text emphasis</li><li>End with a clear CTA</li></ul></section>
      </aside>
    </div>
    <div className="stage-footer"><button className="secondary">Save Draft</button><button className="primary" onClick={onNext}>Next: Intelligence →</button></div>
  </div>
}
function Field({label,children}:{label:string,children:React.ReactNode}){return <label className="field"><span>{label}</span>{children}</label>}
