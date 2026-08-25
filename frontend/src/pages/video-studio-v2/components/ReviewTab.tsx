
import React from "react";
import {reviewCriteria} from "../data/videoStudioMock";
export default function ReviewTab({onNext,onBack}:{onNext?:()=>void,onBack?:()=>void}) {
  return <div className="stage-page review-page">
    <h2>Review your video and optimize for maximum impact.</h2>
    <div className="review-grid">
      <section className="card quality"><h3>AI Quality Score</h3><div className="ring-score large"><b>92</b><span>/100</span><small>Excellent</small></div>{reviewCriteria.map(([a,b])=><div className="criteria" key={a}><span>✓ {a}</span><b>{b}/10</b></div>)}</section>
      <section className="card review-preview"><h3>Video Preview</h3><div className="video-preview review"><div className="preview-copy">WHY BUILDERS<br/>CHOOSE US<br/><strong>EVERY TIME</strong></div><div className="preview-badge">STOCK • SERVICE • SOLUTIONS</div></div><div className="review-transport">▶ 00:05 / 0:15 🔊 ⛶</div><div className="story-strip">{[1,2,3,4,5].map(x=><div className="story-thumb" key={x}/>)}</div></section>
      <section className="mid-stack">
        <section className="card"><h3>AI Recommendations</h3><ul className="check-list"><li>Great hook! Strong attention in the first 2 seconds.</li><li>Message is clear and benefit-focused.</li><li>Add urgency in CTA: “Visit today” or “Stock limited”.</li><li>Try bolder text on key message for mobile view.</li><li>Consider adding customer testimonial in scene 4.</li></ul><button className="secondary wide">Apply All Suggestions</button></section>
        <section className="card"><h3>Publishing Options</h3><p>Select Platforms</p><div className="platform-pills big"><button>◎<small>Instagram</small></button><button>f<small>Facebook</small></button><button>♪<small>TikTok</small></button><button>▶<small>YouTube</small></button><button>in<small>LinkedIn</small></button></div><div className="row"><input value="20 Aug 2026" readOnly/><input value="10:00 AM" readOnly/></div></section>
      </section>
      <aside className="right-stack">
        <section className="card"><h3>Content Scorecard</h3><div className="ring-score"><b>86</b><span>/100</span><small>Very Good</small></div>{[["Clarity",8.5],["Relevance",8.5],["Engagement",8.5],["Emotional Pull",8],["Shareability",8.5],["Brand Fit",9],["CTA Strength",8],["Overall Impact",8.5]].map(([a,b])=><div className="score-line" key={a as string}><span>{a}</span><b>{b}/10</b><i><u style={{width:`${Number(b)*10}%`}}/></i></div>)}</section>
        <section className="card"><h3>Review Notes</h3><textarea placeholder="Add your notes or feedback..."/></section>
      </aside>
    </div>
    <div className="stage-footer triple"><button className="secondary" onClick={onBack}>← Back: Create / Edit</button><div><button className="secondary">Export Video ↓</button><button className="secondary">Save as Draft</button></div><button className="primary" onClick={onNext}>Next: Learn →</button></div>
  </div>
}
