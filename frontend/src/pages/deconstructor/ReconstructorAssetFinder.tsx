import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Check, ExternalLink, Image, Music2, Search, Sparkles, Upload, Video, X } from 'lucide-react'
import './ReconstructorAssetFinder.css'
import { referenceVideosApi, uploadApi } from '../../api/client'
import type { Asset } from '../../types'
type MediaType='images'|'videos'|'audio'
type Provider='all'|'pexels'|'pixabay'
type Selection={source:string;type:MediaType;scene:number;query:string;url:string;title:string;addedAt:string;assetId?:number;assetPath?:string}
type HandoffFinding = [label: string, value: string | number | null, evidence: string]
type HandoffMechanism = {mechanism_id:string; type:string; purpose:string; transferable_principle:string|null}
type SavedResearch = {topic:string; partial?:boolean; findings:{text:string; citations:{title:string; url:string}[]}[]}
type MarketingPurpose = {summary:string; confidence:string; scene:{start:number; end:number}; evidence:{kind:string; start:number; end:number; text:string}[]}
type DetectedScene={number:number;start:number;end:number;role:string;story:string;technical:string;audio:string}
const readDetected=()=>{try{return JSON.parse(sessionStorage.getItem('sg-reconstructor-detected-scenes')||'null') as {referenceId:number|null;scenes:DetectedScene[]; messaging?:HandoffFinding[]; discoverability?:HandoffFinding[]; metadata?:HandoffFinding[]; mechanisms?:HandoffMechanism[]; research_reports?:Record<string,SavedResearch>; messaging_report?:{scenes:MarketingPurpose[]} | null}|null}catch{return null}}
const key='sg-reconstructor-asset-finder-v1'
const readSaved=()=>{try{return JSON.parse(sessionStorage.getItem(key)||'{}') as Record<string,unknown>}catch{return {}}}
export default function ReconstructorAssetFinder(){
 const [params]=useSearchParams()
 const initial=readSaved()
 const referenceId = Number(params.get('reference'))
 const handoffId = Number(params.get('handoff'))
 const [serverHandoff,setServerHandoff]=useState<{id:number; data:ReturnType<typeof readDetected>} | null>(null)
 const detected=handoffId ? (serverHandoff?.id===handoffId ? serverHandoff.data : null) : readDetected()
 const [handoffError,setHandoffError]=useState<number | null>(null)
 useEffect(()=>{
  if(!referenceId || !handoffId)return
  let live=true
  referenceVideosApi.handoff(referenceId,handoffId).then(({data})=>{
   if(live)setServerHandoff({id:handoffId,data})
  }).catch(()=>{if(live)setHandoffError(handoffId)})
  return ()=>{live=false}
 },[referenceId,handoffId])
 const activeScenes=detected?.scenes?.length?detected.scenes:[]
 const [scene,setScene]=useState<number>(Number(params.get('scene')||initial.scene||3))
 const [type,setType]=useState<MediaType>((initial.type as MediaType)||'videos')
 const [source,setSource]=useState<Provider>((initial.source as Provider)||'all')
 const [query,setQuery]=useState(String(initial.query||''))
 const [selected,setSelected]=useState<Selection[]>(Array.isArray(initial.selected)?initial.selected as Selection[]:[])
 const [link,setLink]=useState('')
 const [message,setMessage]=useState('')
 const [file,setFile]=useState<File|null>(null)
 const [uploading,setUploading]=useState(false)
 const [showStory,setShowStory]=useState(true)
 const [showTechnical,setShowTechnical]=useState(true)
 useEffect(()=>{sessionStorage.setItem(key,JSON.stringify({scene,type,source,query,selected}))},[scene,type,source,query,selected])
 const searchTerm=encodeURIComponent(query.trim())
 const links= [
  {id:'pexels',label:'Pexels',url:`https://www.pexels.com/search/${type==='videos'?'videos/':''}${searchTerm}/`,enabled:type!=='audio'},
  {id:'pixabay',label:'Pixabay',url:`https://pixabay.com/${type==='images'?'images':type==='videos'?'videos':'music'}/search/${searchTerm}/`,enabled:true}
 ].filter(x=>x.enabled&&(source==='all'||source===x.id))
 const addLink=()=>{try{const parsed=new URL(link);if(!['https:','http:'].includes(parsed.protocol))throw Error('Use a website URL');if(!/(^|\.)(pexels\.com|pixabay\.com)$/.test(parsed.hostname))throw Error('Only Pexels or Pixabay links are supported');const entry:Selection={source:parsed.hostname.includes('pexels')?'Pexels':'Pixabay',type,scene,query,url:parsed.href,title:parsed.pathname.split('/').filter(Boolean).slice(-1)[0]||'Selected asset',addedAt:new Date().toISOString()};setSelected(old=>[...old,entry]);setLink('');setMessage('Saved to scene review. This is a reference link, not an imported media file.')}catch(e){setMessage(e instanceof Error?e.message:'Invalid link')}}
 const selectedForScene=selected.filter(x=>x.scene===scene)
 const active=activeScenes.find(x=>x.number===scene)
 const [audioScope,setAudioScope]=useState<'scene'|'continuous'>('scene')
 const [audioLayer,setAudioLayer]=useState<'voice'|'music'|'effects'|'original'>('voice')
 const uploadFile=async()=>{if(!file||uploading)return;setUploading(true);setMessage('Uploading media to project asset library…');try{const response=await uploadApi.upload(file);const asset=response.data as Asset;setSelected(old=>[...old,{source:'My Media',type,scene,query,url:'',title:file.name,addedAt:new Date().toISOString(),assetId:asset.id,assetPath:asset.file_path}]);setFile(null);setMessage('Uploaded successfully to asset library and added to Scene '+scene+' review. No timeline changes have been made.')}catch(e){setMessage('Upload failed: '+(e instanceof Error?e.message:'Unknown error'))}finally{setUploading(false)}}
 const suggested=query.trim()||(type==='audio'?audioLayer+' for scene '+scene:active?.technical||'cinematic professional business storytelling')
 return <div className="raf-page"><header className="raf-header"><Link to="/video-studio-v2"><ArrowLeft size={17}/> Video Studio</Link><div><strong>✦ RECONSTRUCTOR</strong><span>Social Genius · Asset Finder · Create Mode</span></div><span className="raf-pill">Review workspace</span></header>
 <main className="raf-main"><div className="raf-heading"><div><small>RECONSTRUCTOR / ASSET DISCOVERY</small><h1>Find the right assets for every scene</h1><p>Keep your story, technical analysis and scene selection together while searching stock libraries or preparing AI generation prompts.</p></div><div className="raf-scene"><label htmlFor="raf-scene">Active scene</label><select id="raf-scene" value={scene} onChange={e=>setScene(Number(e.target.value))}>{(activeScenes.length?activeScenes.map(s=>s.number):Array.from({length:20},(_,i)=>i+1)).map(n=><option key={n} value={n}>Scene {n}{activeScenes.find(s=>s.number===n)?' · '+activeScenes.find(s=>s.number===n)?.role:''}</option>)}</select></div></div>
 {activeScenes.length>0?<div className="raf-suggest"><Check size={18}/><div><b>{activeScenes.length} analysed sections loaded from the reference</b><p>Scene {scene}: {active?.start.toFixed(1)}s–{active?.end.toFixed(1)}s · {active?.role}</p><small>Sections are analysis partitions; they may not correspond one-to-one with actual camera scenes. Confirm boundaries before replacement.</small></div></div>:<p className="raf-note">{handoffId ? (handoffError===handoffId ? 'Saved handoff could not be loaded.' : 'Loading saved analysis…') : 'No analysed reference was passed to this screen. Scene numbers are manual until you open Asset Finder from a deconstructed reference.'}</p>}<div className="raf-workflow"><span>Reference</span><span>Anatomy</span><span>Mechanisms</span><span>New Content</span><strong>Blueprint / Asset Finder</strong><Link to={handoffId && detected ? `/video-studio-v3?reference=${referenceId}&handoff=${handoffId}` : '/video-studio-v3'}>Create</Link></div>
 {detected?.referenceId && <section className="raf-panel">
   <h2>Reference evidence</h2>
   <Link to={`/deconstructor-v3/${detected.referenceId}?view=Deep%20Analysis`}>Open read-only analysis</Link>
   <Link to={`/deconstructor/${detected.referenceId}`}>Open six-stage reconstruction workflow</Link>
   {([['Messaging',detected.messaging],['Technical metadata',detected.metadata],['Discoverability',detected.discoverability]] as const).map(([label, findings]) => findings?.length ? <details key={label}><summary>{label}</summary><dl>{findings.map(([name,value,evidence]) => <div key={name}><dt>{name}</dt><dd>{value ?? 'Unavailable'} · {evidence}</dd></div>)}</dl></details> : null)}
   {!!detected.messaging_report?.scenes.length && <details><summary>Scene marketing purposes</summary>
     {detected.messaging_report.scenes.map(purpose => <div key={purpose.scene.start}>
       <p><strong>{purpose.scene.start.toFixed(1)}–{purpose.scene.end.toFixed(1)}s</strong> · {purpose.summary} · {purpose.confidence} evidence strength</p>
       <ul>{purpose.evidence.map((source,index) => <li key={index}>{source.kind} · {source.start.toFixed(1)}–{source.end.toFixed(1)}s · {source.text}</li>)}</ul>
     </div>)}
   </details>}
   {Object.entries(detected.research_reports ?? {}).map(([dimension, report]) => (
     <details key={dimension}>
       <summary>{dimension} research · {report.topic}{report.partial ? ' · Partial' : ''}</summary>
       {report.findings.map((finding, index) => <div key={index}>
         <p>{finding.text}</p>
         <ul>{finding.citations.filter(source => /^https?:\/\//i.test(source.url)).map(source =>
           <li key={source.url}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a></li>
         )}</ul>
       </div>)}
     </details>
   ))}
   {!!detected.mechanisms?.length && <details><summary>Mechanisms</summary><ul>{detected.mechanisms.map(item => <li key={item.mechanism_id}>{item.purpose}{item.transferable_principle && ` · ${item.transferable_principle}`}</li>)}</ul></details>}
 </section>}
 <div className="raf-analysis"><div className="raf-analysis-actions"><button onClick={()=>setShowStory(!showStory)}>{showStory?'Hide':'Show'} Story</button><button onClick={()=>setShowTechnical(!showTechnical)}>{showTechnical?'Hide':'Show'} Technical</button></div>{showStory&&<section><h3>Story prompt</h3><p>{active?.story||'What is this scene communicating? Describe the hook, problem, solution or CTA you want to preserve or change.'}</p><button onClick={()=>setQuery('Scene '+scene+' visual illustrating the story message')}>Use story as search starting point</button></section>}{showTechnical&&<section><h3>Technical prompt</h3><p>{active?.technical||'Describe the camera framing, movement, lighting, mood, visual style or audio requirements.'}</p><button onClick={()=>setQuery('Scene '+scene+' cinematic close-up professional lighting')}>Use technical search starting point</button></section>}</div>
 <div className="raf-columns"><section className="raf-panel"><h2><Search size={20}/> Stock Asset Finder</h2><p>Search manually or use a prompt suggested from the scene analysis.</p><div className="raf-switch">{(['images','videos','audio'] as MediaType[]).map(t=><button key={t} className={type===t?'active':''} onClick={()=>setType(t)}>{t==='images'?<Image size={17}/>:t==='videos'?<Video size={17}/>:<Music2 size={17}/>} {t}</button>)}</div>{type==='audio'&&<div className="raf-audio"><h3>Audio layers</h3><p>{active?.audio||'Audio analysis not loaded'}</p><div className="raf-switch">{(['voice','music','effects','original'] as const).map(layer=><button key={layer} className={audioLayer===layer?'active':''} onClick={()=>setAudioLayer(layer)}>{layer==='voice'?'Voiceover':layer==='music'?'Music':layer==='effects'?'Sound effects':'Original audio'}</button>)}</div><div className="raf-switch"><button className={audioScope==='scene'?'active':''} onClick={()=>setAudioScope('scene')}>This scene only</button><button className={audioScope==='continuous'?'active':''} onClick={()=>setAudioScope('continuous')}>Continuous track</button></div><small>Scope is for review and planning. Audio separation, track detection and replacement are not yet connected.</small></div>}<label>Search description<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Describe the image, video or sound you want"/></label><div className="raf-switch">{(['all','pexels','pixabay'] as Provider[]).map(p=><button key={p} className={source===p?'active':''} onClick={()=>setSource(p)}>{p==='all'?'All sources':p==='pexels'?'Pexels':'Pixabay'}</button>)}</div><div className="raf-suggest"><Sparkles size={18}/><div><b>AI-recommended search direction</b><p>{suggested}</p><small>Suggested wording only; no AI provider has been called.</small></div></div><div className="raf-link-list">{links.map(l=><a key={l.id} href={l.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={17}/> Browse {l.label} {type} in a new tab</a>)}</div><p className="raf-note">Your selected scene and search are retained when you return to this tab. Pexels and Pixabay are opened externally until API credentials are configured.</p></section>
 <section className="raf-panel"><h2><Check size={20}/> Select and approve assets</h2><p>After browsing, paste the asset's individual Pexels or Pixabay page link here.</p><label>Asset page URL<input value={link} onChange={e=>setLink(e.target.value)} placeholder="https://www.pexels.com/... or https://pixabay.com/..."/></label><button className="raf-primary" onClick={addLink}>Add to Scene {scene} review</button><div className="raf-upload"><Upload size={20}/><label>Or choose a downloaded asset<input type="file" accept="image/*,video/*,audio/*" onChange={e=>setFile(e.target.files?.[0]||null)}/></label>{file&&<><p>{file.name} ready to upload to the project asset library.</p><button className="raf-primary" disabled={uploading} onClick={()=>void uploadFile()}>{uploading?'Uploading…':'Upload and add to scene review'}</button></>}</div>{message&&<p className="raf-note" role="status">{message}</p>}<h3>Scene {scene} · Review queue ({selectedForScene.length})</h3>{selectedForScene.length===0?<div className="raf-empty">No assets selected yet. Search a provider and add your preferred asset here.</div>:selectedForScene.map((s,i)=><div className="raf-selected" key={s.url+i}><div><b>{s.source} · {s.type}</b><small>{s.title}</small>{s.url?<a href={s.url} target="_blank" rel="noopener noreferrer">Open original asset</a>:<small>Uploaded media asset #{s.assetId}</small>}</div><button aria-label="Remove asset" onClick={()=>setSelected(v=>v.filter(x=>x!==s))}><X size={17}/></button></div>)}<p className="raf-note">Selections are saved in this browser session. Uploaded files are stored through the existing asset API. Stock link downloads, licence verification and timeline replacement still require integration.</p></section></div>
 <footer className="raf-footer"><Link to={handoffId && detected ? `/video-studio-v3?reference=${referenceId}&handoff=${handoffId}` : "/video-studio-v3"}>Open V3 editor preview</Link><Link to="/video-studio-v2">Return to Video Studio</Link><span>{selected.length} assets referenced across scenes · no replacements applied</span></footer></main></div>
}
