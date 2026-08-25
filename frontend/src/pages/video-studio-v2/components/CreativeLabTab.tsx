
import React,{useState} from "react";
import {hookIdeas} from "../data/videoStudioMock";
export default function CreativeLabTab({onNext,onBack}:{onNext?:()=>void,onBack?:()=>void}) {
  const [sub,setSub]=useState("Hooks"); const [selected,setSelected]=useState(0);
  return <div className="stage-page creative-page">
    <h2>Explore angles, hooks, and test before production.</h2>
    <div className="subtabs">{["Angles","Hooks","Opening Frames","Pre-test","Compare"].map(x=><button className={sub===x?"active":""} onClick={()=>setSub(x)} key={x}>{x}</button>)}</div>
    <div className="creative-grid">
      <aside className="card filter-card"><h3>Filters</h3>{["Hook Type","Goal","Tone","Sort By"].map((x,i)=><label className="stack-field" key={x}><span>{x}</span><select><option>{i===3?"AI Score (High-Low)":"All "+(i===0?"Types":i===1?"Goals":"Tones")}</option></select></label>)}<button className="secondary wide">Clear Filters</button></aside>
      <section className="card hook-list"><h3>Hook Ideas (28)</h3>{hookIdeas.map((h,i)=><button className={`hook-row ${selected===i?"active":""}`} onClick={()=>setSelected(i)} key={h.text}><span className="radioDot"/><b>{h.text}</b><em>High</em><span>Score {h.score}/100</span><span>☆</span></button>)}<button className="secondary wide">Load More Hooks ↓</button></section>
      <section className="card selected-hook"><h3>Selected Hook Details</h3><div className="quote-box">{hookIdeas[selected].text}</div><h4>Why this hook works</h4><ul className="check-list"><li>Creates curiosity with a problem</li><li>Relatable to showroom owners</li><li>Short, direct and punchy</li></ul><h4>Best used for</h4><div className="pill-row"><span>Awareness</span><span>Traffic</span><span>Leads</span></div><h4>Recommended For</h4><div className="pill-row"><span>Builders & Trade</span><span>Showroom Owners</span><span>B2B</span></div><h4>Suggested Follow-up Angles</h4><ul><li>Your showroom might be invisible online.</li><li>It’s not about tiles. It’s about trust.</li><li>They have options. Why should they choose you?</li></ul><div className="split-actions"><button className="secondary">☆ Add to Shortlist</button><button className="primary">Use This Hook →</button></div></section>
      <aside className="card scorecard"><h3>Hook Scorecard</h3><div className="ring-score"><b>86</b><span>/100</span><small>Excellent</small></div>{[["Scroll-stop Potential",9],["Clarity",8],["Relevance",9],["Curiosity Pull",9],["Novelty",8],["Brand Fit",9],["Proof Potential",8]].map(([a,b])=><div className="score-line" key={a as string}><span>{a}</span><b>{b}/10</b><i><u style={{width:`${Number(b)*10}%`}}/></i></div>)}<div className="total-line"><b>Total Score</b><strong>86/100</strong></div></aside>
    </div>
    <div className="stage-footer"><button className="secondary" onClick={onBack}>← Back: Intelligence</button><button className="primary" onClick={onNext}>Next: Create / Edit →</button></div>
  </div>
}
