
import React, {useState} from "react";
export default function IntelligenceTab({onNext,onBack}:{onNext?:()=>void,onBack?:()=>void}) {
  const [sub,setSub]=useState("Positioning Insight");
  return <div className="stage-page intelligence-page">
    <h2>AI-powered insights and strategic intelligence.</h2>
    <div className="subtabs">{["Positioning Insight","Audience Insight","Competitor Insight","Content Insight","Market Insight"].map(x=><button className={sub===x?"active":""} onClick={()=>setSub(x)} key={x}>{x}</button>)}</div>
    <div className="intel-grid">
      <section className="card"><h3>Key Findings</h3><ul className="check-list separated"><li>Showroom has visibility but lacks clear positioning for builders.</li><li>Competition focuses on price, few focus on reliability + availability.</li><li>Builders value stock availability, speed, and trade support.</li><li>Positioning opportunity: “The most reliable tile partner for builders.”</li></ul></section>
      <section className="card"><h3>Positioning Opportunity</h3><div className="callout big">Position as the most reliable stock + service partner for builders.</div><div className="pill-row"><span>Reliability</span><span>Stock</span><span>Trade Support</span></div><p>Differentiator: Stock availability + Fast delivery + Expert advice</p><button className="secondary wide">View Positioning Ideas →</button></section>
      <section className="card"><h3>Recommended Angles</h3><ol className="angle-list"><li>Reliability over everything</li><li>Stock availability promise</li><li>Fast delivery for builders</li><li>Trade support & credit</li><li>Real builders, real results</li></ol><button className="secondary wide">View All Angles →</button></section>
      <section className="card"><h3>✦ AI Summary</h3><p>Your project is about increasing footfall through a clear positioning that speaks directly to builders’ needs.</p><hr/><h4>Focus Areas</h4><ul><li>Stock reliability</li><li>Fast fulfilment</li><li>Trade-friendly support</li><li>Clear builder-first messaging</li></ul></section>
    </div>
    <section className="card framework-card"><h3>Content Framework Recommendation</h3><div className="framework-flow">{["Hook|Pattern Interrupt","Problem / Symptom|Low Footfall","Why / Diagnosis|Positioning Gap","Insight / Reframe|Not the real reason","Way Forward|Better Positioning","CTA|Visit Showroom"].map((x,i)=>{const [a,b]=x.split("|");return <React.Fragment key={a}><div><b>{a}</b><span>{b}</span></div>{i<5&&<i>→</i>}</React.Fragment>})}</div></section>
    <div className="stage-footer"><button className="secondary" onClick={onBack}>← Back to Brief</button><button className="primary" onClick={onNext}>Next: Creative Lab →</button></div>
  </div>
}
