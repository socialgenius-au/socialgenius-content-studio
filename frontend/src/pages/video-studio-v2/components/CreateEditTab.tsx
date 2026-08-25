
import React,{useState} from "react";
import {mediaItems} from "../data/videoStudioMock";
export default function CreateEditTab({onNext,onBack}:{onNext?:()=>void,onBack?:()=>void}) {
  const [mode,setMode]=useState("AI Create (Text to Video)");
  const [rail,setRail]=useState("Media");
  return <div className="stage-page create-page">
    <div className="creation-modes">{["AI Create (Text to Video)","Templates","Import External","Blank Canvas","My Drafts"].map(x=><button className={mode===x?"active":""} onClick={()=>setMode(x)} key={x}>{x}</button>)}<div className="canvas-size">Canvas Size <select><option>1080 × 1920 (9:16)</option></select><button>⛶</button></div></div>
    <div className="editor-shell">
      <aside className="editor-rail">{["Media","Audio","Text","Overlay","Elements","Transitions","Filters","Brand Kit","AI Tools","Uploads","Layers"].map(x=><button className={rail===x?"active":""} onClick={()=>setRail(x)} key={x}><span>◫</span>{x}</button>)}</aside>
      <aside className="asset-panel">
        <div className="asset-head"><b>{rail}</b><select><option>All Media</option></select></div>
        <input className="search" placeholder="Search media..." />
        <div className="subtabs compact"><button className="active">All</button><button>Videos</button><button>Images</button><button>Audio</button><button>GIFs</button></div>
        <div className="media-grid">{mediaItems.map((x,i)=><div className="media-card" key={x}><div className="fake-media" data-index={i+1}/><small>{x}</small></div>)}<button className="add-media">+<br/>Add Media</button></div>
      </aside>
      <section className="preview-area">
        <div className="canvas-toolbar"><button>↶</button><button>↷</button><button>✋</button><button className="active">⌁</button><select><option>100%</option></select><button>Crop⌄</button></div>
        <div className="video-preview"><div className="preview-brand">◇ ABC TILES</div><div className="preview-copy">WHY BUILDERS<br/>CHOOSE US<br/><strong>EVERY TIME</strong></div><div className="preview-badge">STOCK • SERVICE • SOLUTIONS</div><div className="preview-icons"><span>✓<b>RELIABLE<br/>STOCK</b></span><span>▣<b>FAST<br/>DELIVERY</b></span><span>♙<b>TRADE<br/>SUPPORT</b></span></div><div className="preview-cta">VISIT OUR SHOWROOM TODAY</div></div>
        <div className="transport"><button>▶</button><button>◀◀</button><button>▶▶</button><span>00:05 / 00:15</span><span>🔊</span><button>⛶</button></div>
      </section>
      <aside className="properties-panel">
        <div className="subtabs compact"><button className="active">Properties</button><button>Layers</button><button>Adjustments</button></div>
        <h4>Text</h4><textarea defaultValue={"WHY BUILDERS\nCHOOSE US\nEVERY TIME"} />
        <select><option>Montserrat</option></select>
        <div className="row"><select><option>Extra Bold</option></select><select><option>96</option></select><input type="color" defaultValue="#000000"/></div>
        <div className="align-row"><button>≡</button><button className="active">≡</button><button>≡</button><button>≡</button></div>
        <h4>Transform</h4><div className="row"><input value="X 120" readOnly/><input value="Y 420" readOnly/></div><div className="row"><input value="W 100%" readOnly/><input value="H 100%" readOnly/></div><select><option>Rotation 0°</option></select>
        <h4>Layer</h4><label>Opacity <input type="range" defaultValue="100"/></label>
      </aside>
      <aside className="ai-tools-panel">
        <h3>✦ AI Tools</h3>{["AI Prompt Generator","AI Image Generator","AI Hook Suggestion","AI Script Writer","AI Caption Generator","AI Thumbnail Ideas"].map(x=><button key={x}><b>{x}</b><small>{x==="AI Prompt Generator"?"Generate on-brand prompts":x==="AI Image Generator"?"Create custom images":x==="AI Hook Suggestion"?"Get better hooks":x==="AI Script Writer"?"Write engaging scripts":x==="AI Caption Generator"?"Create captions & hashtags":"Generate thumbnails"}</small></button>)}
        <h3>Quick Actions</h3>{["Remove Background","Auto Enhance","Resize for Platforms","Generate Video (External)"].map(x=><button key={x}>{x}</button>)}
      </aside>
      <section className="timeline">
        <div className="timeline-toolbar"><button>+ Add Track</button><button>⧉</button><button>⌫</button><button>✂</button><button>◫</button><button>◩</button></div>
        <div className="time-ruler">0s <span>3s</span><span>6s</span><span>9s</span><span>12s</span><span>15s</span></div>
        <Track label="V1 Video"><div className="clip blue">showroom_walk.mp4</div><div className="clip blue">stock_tiles.jpg</div><div className="clip blue">delivery_truck.mp4</div></Track>
        <Track label="T1 Text"><div className="clip purple">WHY BUILDERS</div><div className="clip purple">CHOOSE US</div><div className="clip purple">EVERY TIME</div><div className="clip purple">STOCK • SERVICE • SOLUTIONS</div></Track>
        <Track label="O1 Overlay"><div className="clip pink">icons_overlay.png</div></Track>
        <Track label="A1 Audio"><div className="clip aqua long">background_music.mp3</div></Track>
      </section>
      <div className="ai-assistant"><b>✦ AI Assistant</b><input placeholder="Ask AI anything about your video..." /><button>➤</button><button>Improve this scene</button><button>Shorten video to 10s</button><button>Add stronger CTA</button><button>Suggest bg music</button></div>
    </div>
    <div className="stage-footer"><button className="secondary" onClick={onBack}>← Back: Creative Lab</button><button className="primary" onClick={onNext}>Next: Review →</button></div>
  </div>
}
function Track({label,children}:{label:string,children:React.ReactNode}){return <div className="track"><div className="track-label">{label}<span>◉ 🔒</span></div><div className="track-lane">{children}</div></div>}
