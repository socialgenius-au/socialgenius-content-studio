
import React,{useState} from "react";
import {analyticsRows} from "../data/videoStudioMock";
export default function LearnTab({onBack}:{onBack?:()=>void}) {
  const [sub,setSub]=useState("Analytics");
  return <div className="stage-page learn-page">
    <h2>Analyze performance, learn what worked, and improve future videos.</h2>
    <div className="subtabs">{["Our Videos","Uploaded / External","Analytics","Insights","Winning Patterns"].map(x=><button className={sub===x?"active":""} onClick={()=>setSub(x)} key={x}>{x}</button>)}</div>
    <div className="learn-grid">
      <section className="card performance-table">
        <div className="table-head"><h3>Top Performing Videos</h3><div><select><option>All Platforms</option></select><select><option>Last 30 Days</option></select></div></div>
        <table><thead><tr><th>Video</th><th>Platform</th><th>Views</th><th>Avg Watch Time</th><th>Completion</th><th>Engagement</th><th>Shares</th><th>CTR / Leads</th></tr></thead><tbody>{analyticsRows.map(r=><tr key={r[0]}>{r.map((c,i)=><td key={i}>{c}</td>)}</tr>)}</tbody></table>
      </section>
      <section className="performance-summary">{[["Total Views","128.3K","+18.4%"],["Avg Watch Time","8.3s","+12.6%"],["Completion Rate","57%","+9.2%"],["Engagement","8.4K","+14.7%"],["CTR / Leads","2.9%","+11.3%"]].map(x=><div className="card metric-card" key={x[0]}><span>{x[0]}</span><b>{x[1]}</b><em>{x[2]}</em></div>)}</section>
      <section className="card upload-panel"><h3>Upload / Analyze External Video</h3><div className="upload-drop">⇧<br/><b>Drag & drop video file here</b><span>or click to browse</span><small>MP4, MOV (Max 20GB)</small></div><p>or</p><div className="row"><input placeholder="Paste video link here..." /><button className="secondary">Import</button></div></section>
      <section className="card deconstruct-panel"><h3>AI Deconstruction</h3><ul className="check-list"><li>Hook (0–2s): Strong diagnostic question.</li><li>Problem (2–7s): Clear recognition of the issue.</li><li>Middle: Good message but a bit long.</li><li>Solution: Clear positioning link.</li><li>CTA (10–30s): Clear CTA but can add urgency.</li></ul><button className="secondary wide">View Full Breakdown</button></section>
      <section className="card learning-panel"><h3>Strengths & Weaknesses</h3><h4>Strengths</h4><ul className="positive"><li>Strong opening hook</li><li>Good visual quality</li><li>Clear positioning link</li><li>Relevant to target audience</li></ul><h4>Weaknesses</h4><ul className="negative"><li>Middle section too long</li><li>Could show proof earlier</li><li>CTA could be more urgent</li></ul><div className="learning-score">Overall Score <b>78</b><span>/100</span></div></section>
      <section className="card insight-panel"><h3>What to Reuse Next Time</h3><ul className="check-list"><li>Keep diagnostic-question hook family.</li><li>Keep showroom proof in opening frames.</li><li>Compress explanation between seconds 4–8.</li><li>Test urgency CTA vs trust CTA.</li></ul><button className="primary wide">Create New Video From Insights →</button></section>
    </div>
    <div className="stage-footer"><button className="secondary" onClick={onBack}>← Back: Review</button><button className="primary">Save Learnings to Library</button></div>
  </div>
}
