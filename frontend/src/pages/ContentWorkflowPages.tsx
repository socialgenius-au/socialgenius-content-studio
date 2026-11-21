import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Home, ChevronLeft, ChevronRight, Sparkles, WandSparkles, Image, Images, Clapperboard, Settings2, Download, Play, Check, PanelRightClose, PanelRightOpen, Plus, ArrowRight, ArrowLeft, Save, MonitorPlay, Copy, Share2 } from 'lucide-react'
import './ContentWorkflowPages.css'
type Stage='generate'|'edit'|'publish'
const labels=['Content Brief','Generate','Edit & Enhance','Publish / Export']
const destinations=['/create-brief','/create/generate','/create/edit','/create/publish']
const formatOptions=['Social Post','Carousel','Video']
const tiers=['Low','Medium','Best']
const navItems=[{name:'Home',url:'/dashboard',icon:Home},{name:'Create Brief',url:'/create-brief',icon:Sparkles},{name:'Generate',url:'/create/generate',icon:WandSparkles},{name:'Edit & Enhance',url:'/create/edit',icon:Settings2},{name:'Publish / Export',url:'/create/publish',icon:Share2},{name:'Video Studio',url:'/video-studio-v2',icon:Clapperboard}]
export default function ContentWorkflowPages(){
  const {stage:stageParam}=useParams()
  const stage:Stage=stageParam==='edit'?'edit':stageParam==='publish'?'publish':'generate'
  const step=stage==='generate'?1:stage==='edit'?2:3
  const navigate=useNavigate()
  const [navCollapsed,setNavCollapsed]=useState(false)
  const [rightOpen,setRightOpen]=useState(true)
  const [format,setFormat]=useState('Video')
  const [tier,setTier]=useState('Medium')
  const [prompt,setPrompt]=useState('')
  const [ratio,setRatio]=useState('9:16')
  const [selectedScene,setSelectedScene]=useState(0)
  const [scenes,setScenes]=useState(['Opening Hook','Introduce the Problem','Show the Solution','Benefits','Call to Action'])
  const [headline,setHeadline]=useState('Your story starts here')
  const [caption,setCaption]=useState('')
  const [saved,setSaved]=useState(false)
  const [preview,setPreview]=useState(false)
  const [brief]=useState<{topic?:string;goal?:string;brand?:string}>(()=>{try{return JSON.parse(sessionStorage.getItem('sg-content-brief')||'{}')}catch{return {}}})
  const save=()=>{sessionStorage.setItem('sg-content-workflow',JSON.stringify({format,tier,prompt,ratio,scenes,headline,caption}));setSaved(true)}
  const next=()=>{save();if(step<3)navigate(destinations[step+1])}
  return <div className="sgw-app">
    <aside className={'sgw-nav '+(navCollapsed?'sgw-nav-mini':'')}>
      <button className="sgw-collapse" onClick={()=>setNavCollapsed(!navCollapsed)} aria-label="Collapse navigation">{navCollapsed?<ChevronRight size={16}/>:<ChevronLeft size={16}/>}</button>
      <Link to="/dashboard" className="sgw-brand"><img src="/social-genius-official-logo.svg" alt="Social Genius official logo"/>{!navCollapsed&&<><strong>Social Genius</strong><small>Content Studio</small><em>The Positioning People</em></>}</Link>
      {navItems.map(({name,url,icon:Icon})=><Link key={name} to={url} className={'sgw-nav-item '+(url===destinations[step]?'active':'')} title={name}><Icon size={19}/>{!navCollapsed&&<span>{name}</span>}</Link>)}
    </aside>
    <div className="sgw-body">
      <header className="sgw-top"><Link to="/dashboard">Social Genius <b>Content Studio</b></Link><span className="sgw-project-name">{brief.topic||'Untitled content project'}</span><button onClick={()=>setRightOpen(!rightOpen)}>{rightOpen?<PanelRightClose size={17}/>:<PanelRightOpen size={17}/>} AI Assistant</button><span className="sgw-avatar">AS</span></header>
      <main className="sgw-main">
        <div className="sgw-title"><div><p>CONTENT CREATION WORKFLOW</p><h1>{labels[step]}</h1><span>{stage==='generate'?'Choose your format and generation settings':stage==='edit'?'Refine your content, scenes and visual elements':'Review your content and prepare it for publishing'}</span></div><span className="sgw-step-badge">Step {step+1} of 4</span></div>
        <div className="sgw-steps">{labels.map((label,i)=><Link key={label} to={destinations[i]} className={i===step?'active':''}><span>{i<step?<Check size={16}/>:i+1}</span>{label}</Link>)}</div>
        <div className={'sgw-grid '+(!rightOpen?'wide':'')}>
          <div className="sgw-center">
            {stage==='generate'&&<><section className="sgw-panel"><h2>What would you like to generate?</h2><div className="sgw-format-row">{formatOptions.map((f,i)=>{const Icon=[Image,Images,Clapperboard][i];return <button className={format===f?'chosen':''} key={f} onClick={()=>setFormat(f)}><Icon size={28}/><b>{f}</b><small>{['Single creative','Multi-slide story','Motion content'][i]}</small></button>})}</div></section>
              <section className="sgw-panel"><h2><Sparkles size={20}/> AI Generation Settings</h2><label>Describe your content<textarea rows={4} value={prompt} onChange={e=>setPrompt(e.target.value)} placeholder={brief.topic||'Describe the visual, style, subject and desired result...'}/></label><div className="sgw-field-grid"><label>Quality & pricing tier<div className="sgw-tier-row">{tiers.map(t=><button key={t} className={tier===t?'chosen':''} onClick={()=>setTier(t)}>{t}</button>)}</div></label><label>Aspect ratio<select value={ratio} onChange={e=>setRatio(e.target.value)}><option>9:16</option><option>1:1</option><option>4:5</option><option>16:9</option></select></label></div><p className="sgw-muted">Model availability and customer pricing will be connected to real providers. No API call or charge is made on this design screen.</p><button className="sgw-primary" onClick={()=>setPreview(true)}><WandSparkles size={18}/> Preview generation plan</button></section>
              {preview&&<section className="sgw-panel sgw-plan"><h2>Generation plan ready for review</h2><p><b>{format}</b> · {tier} · {ratio}</p><p>{prompt||brief.topic||'Add a prompt to specify the content.'}</p><p className="sgw-muted">This is a plan preview, not AI-generated media. Connect a provider to produce assets.</p></section>}</>}
            {stage==='edit'&&<><section className="sgw-panel"><div className="sgw-panel-heading"><h2>Scene-by-scene Storyboard</h2><button onClick={()=>{setScenes([...scenes,'New Scene']);setSelectedScene(scenes.length)}}><Plus size={16}/> Add scene</button></div><div className="sgw-scenes">{scenes.map((scene,i)=><button key={i} className={selectedScene===i?'chosen':''} onClick={()=>setSelectedScene(i)}><span>{i+1}</span><div className="sgw-scene-thumb"><Play size={16}/></div><b>{scene}</b></button>)}</div></section><section className="sgw-panel"><div className="sgw-panel-heading"><h2>Canvas & Object Properties</h2><span>{ratio} canvas</span></div><div className="sgw-canvas"><div><Sparkles size={38}/><h3>{headline}</h3><p>{scenes[selectedScene]}</p><small>Media preview — connect generated or uploaded assets</small></div></div><label>Headline / Text object<input value={headline} onChange={e=>setHeadline(e.target.value)}/></label><label>Selected scene name<input value={scenes[selectedScene]} onChange={e=>setScenes(scenes.map((s,i)=>i===selectedScene?e.target.value:s))}/></label><div className="sgw-tool-row"><button onClick={()=>navigate('/post-creator-v2')}><Image size={16}/> Open Post Editor</button><button onClick={()=>navigate('/carousel-creator')}><Images size={16}/> Open Carousel Editor</button><button onClick={()=>navigate('/video-studio-v2')}><Clapperboard size={16}/> Open Video Editor</button></div></section><section className="sgw-panel"><h2>Multitrack Timeline</h2>{['Video / Images','Text & Graphics','Audio & Music'].map((s,i)=><div className="sgw-track" key={s}><span>{s}</span><div style={{width:(78-i*15)+'%'}}/></div>)}<p className="sgw-muted">Storyboard and timeline are UI previews; the existing dedicated editors handle actual media editing.</p></section></>}
            {stage==='publish'&&<><section className="sgw-panel"><h2>Final Content Preview</h2><div className="sgw-publish-preview"><MonitorPlay size={50}/><h3>{headline}</h3><p>{brief.topic||'Your content will appear here once media is created.'}</p><span>Preview placeholder — no rendered output yet</span></div></section><section className="sgw-panel"><h2>Publishing Details</h2><label>Caption<textarea rows={4} value={caption} onChange={e=>setCaption(e.target.value)} placeholder="Write your post caption..."/></label><div className="sgw-field-grid"><label>Output format<select value={format} onChange={e=>setFormat(e.target.value)}>{formatOptions.map(x=><option key={x}>{x}</option>)}</select></label><label>Aspect ratio<select value={ratio} onChange={e=>setRatio(e.target.value)}><option>9:16</option><option>1:1</option><option>4:5</option><option>16:9</option></select></label></div><div className="sgw-tool-row"><button onClick={()=>navigator.clipboard?.writeText(caption)}><Copy size={16}/> Copy caption</button><button onClick={save}><Save size={16}/> Save publishing draft</button></div><p className="sgw-muted">Export, scheduling and platform publishing will be connected to real render and social integrations. This screen does not publish or export files.</p></section></>}
          </div>
          {rightOpen&&<aside className="sgw-panel sgw-assistant"><div className="sgw-panel-heading"><h2><Sparkles size={20}/> AI Suggestions</h2><button onClick={()=>setRightOpen(false)}><PanelRightClose size={17}/></button></div><p>Suggestions for your current workflow</p>{(stage==='generate'?['Start with a strong visual hook','Match the aspect ratio to your platform','Choose Low, Medium or Best based on your budget','Keep the main message easy to understand']:stage==='edit'?['Keep the first scene attention-grabbing','Use consistent typography and brand colours','Check scene-to-scene transitions','Keep text within safe margins']:['Check your opening frame','Proofread the caption and call to action','Review platform-specific dimensions','Verify the final media before publishing']).map(s=><div className="sgw-suggestion" key={s}><Sparkles size={16}/>{s}</div>)}<div className="sgw-brand-kit"><img src="/social-genius-official-logo.svg" alt="Social Genius official logo"/><div><b>Brand Kit</b><small>{brief.brand||'Social Genius'}</small></div></div><p className="sgw-muted">Suggestions are illustrative until the AI service is integrated.</p></aside>}
        </div>
        <footer className="sgw-footer"><button onClick={()=>navigate(destinations[step-1])}><ArrowLeft size={16}/> Previous</button><button onClick={save}><Save size={16}/>{saved?'Draft saved':'Save Draft'}</button>{step<3?<button className="sgw-primary" onClick={next}>Next: {labels[step+1]} <ArrowRight size={16}/></button>:<button className="sgw-primary" onClick={save}><Download size={16}/> Save publishing plan</button>}</footer>
      </main>
    </div>
  </div>
}
