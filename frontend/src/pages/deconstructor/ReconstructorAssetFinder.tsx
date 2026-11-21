import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Check, ExternalLink, Image, Music2, Search, Sparkles, Upload, Video, X } from 'lucide-react'
import './ReconstructorAssetFinder.css'
type MediaType='images'|'videos'|'audio'
type Provider='all'|'pexels'|'pixabay'
type Selection={source:string;type:MediaType;scene:number;query:string;url:string;title:string;addedAt:string}
const key='sg-reconstructor-asset-finder-v1'
const readSaved=()=>{try{return JSON.parse(sessionStorage.getItem(key)||'{}') as Record<string,unknown>}catch{return {}}}
export default function ReconstructorAssetFinder(){
 const [params]=useSearchParams()
 const initial=readSaved()
 const [scene,setScene]=useState<number>(Number(params.get('scene')||initial.scene||3))
 const [type,setType]=useState<MediaType>((initial.type as MediaType)||'videos')
 const [source,setSource]=useState<Provider>((initial.source as Provider)||'all')
 const [query,setQuery]=useState(String(initial.query||''))
 const [selected,setSelected]=useState<Selection[]>(Array.isArray(initial.selected)?initial.selected as Selection[]:[])
 const [link,setLink]=useState('')
 const [message,setMessage]=useState('')
 const [file,setFile]=useState<File|null>(null)
 const [showStory,setShowStory]=useState(true)
 const [showTechnical,setShowTechnical]=useState(true)
 useEffect(()=>{sessionStorage.setItem(key,JSON.stringify({scene,type,source,query,selected}))},[scene,type,source,query,selected])
 const searchTerm=encodeURIComponent(query.trim())
 const links= [
  {id:'pexels',label:'Pexels',url:`https://www.pexels.com/search/${type==='videos'?'videos/':''}${searchTerm}/`,enabled:type!=='audio'},
  {id:'pixabay',label:'Pixabay',url:`https://pixabay.com/${type==='images'?'images':type==='videos'?'videos':'music'}/search/${searchTerm}/`,enabled:true}
 ].filter(x=>x.enabled&&(source==='all'||source===x.id))
 const addLink=()=>{try{const parsed=new URL(link);if(!['https:','http:'].includes(parsed.protocol))throw Error('Use a website URL');if(!/(^|\.)(pexels\.com|pixabay\.com)$/.test(parsed.hostname))throw Error('Only Pexels or Pixabay links are supported');const entry:Selection={source:parsed.hostname.includes('pexels')?'Pexels':'Pixabay',type,scene,query,url:parsed.href,title:parsed.pathname.split('/').filter(Boolean).slice(-1)[0]||'Selected asset',addedAt:new Date().toISOString()};setSelected(old=>[...old,entry]);setLink('');setMessage('Saved to scene review. This is a reference link, not an imported media file.')}catch(e){setMessage(e instanceof Error?e.message:'Invalid link')}}
 const suggested=query.trim()||'cinematic professional business storytelling'
 const selectedForScene=selected.filter(x=>x.scene===scene)
 return <div className="raf-page"><header className="raf-header"><Link to="/video-studio-v2"><ArrowLeft size={17}/> Video Studio</Link><div><strong>Social Genius</strong><span>Reconstructor · Asset Finder</span></div><span className="raf-pill">Review workspace</span></header>
 <main className="raf-main"><div className="raf-heading"><div><small>RECONSTRUCTOR / ASSET DISCOVERY</small><h1>Find the right assets for every scene</h1><p>Keep your story, technical analysis and scene selection together while searching stock libraries or preparing AI generation prompts.</p></div><div className="raf-scene"><label htmlFor="raf-scene">Active scene</label><select id="raf-scene" value={scene} onChange={e=>setScene(Number(e.target.value))}>{Array.from({length:20},(_,i)=><option key={i+1} value={i+1}>Scene {i+1}</option>)}</select></div></div>
 <div className="raf-workflow"><span>Reference</span><span>Anatomy</span><span>Mechanisms</span><span>New Content</span><strong>Blueprint / Asset Finder</strong><span>Create</span></div>
 <div className="raf-analysis"><div className="raf-analysis-actions"><button onClick={()=>setShowStory(!showStory)}>{showStory?'Hide':'Show'} Story</button><button onClick={()=>setShowTechnical(!showTechnical)}>{showTechnical?'Hide':'Show'} Technical</button></div>{showStory&&<section><h3>Story prompt</h3><p>What is this scene communicating? Describe the hook, problem, solution or CTA you want to preserve or change.</p><button onClick={()=>setQuery('Scene '+scene+' visual illustrating the story message')}>Use story as search starting point</button></section>}{showTechnical&&<section><h3>Technical prompt</h3><p>Describe the camera framing, movement, lighting, mood, visual style or audio requirements.</p><button onClick={()=>setQuery('Scene '+scene+' cinematic close-up professional lighting')}>Use technical search starting point</button></section>}</div>
 <div className="raf-columns"><section className="raf-panel"><h2><Search size={20}/> Stock Asset Finder</h2><p>Search manually or use a prompt suggested from the scene analysis.</p><div className="raf-switch">{(['images','videos','audio'] as MediaType[]).map(t=><button key={t} className={type===t?'active':''} onClick={()=>setType(t)}>{t==='images'?<Image size={17}/>:t==='videos'?<Video size={17}/>:<Music2 size={17}/>} {t}</button>)}</div><label>Search description<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Describe the image, video or sound you want"/></label><div className="raf-switch">{(['all','pexels','pixabay'] as Provider[]).map(p=><button key={p} className={source===p?'active':''} onClick={()=>setSource(p)}>{p==='all'?'All sources':p==='pexels'?'Pexels':'Pixabay'}</button>)}</div><div className="raf-suggest"><Sparkles size={18}/><div><b>AI-recommended search direction</b><p>{suggested}</p><small>Suggested wording only; no AI provider has been called.</small></div></div><div className="raf-link-list">{links.map(l=><a key={l.id} href={l.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={17}/> Browse {l.label} {type} in a new tab</a>)}</div><p className="raf-note">Your selected scene and search are retained when you return to this tab. Pexels and Pixabay are opened externally until API credentials are configured.</p></section>
 <section className="raf-panel"><h2><Check size={20}/> Select and approve assets</h2><p>After browsing, paste the asset's individual Pexels or Pixabay page link here.</p><label>Asset page URL<input value={link} onChange={e=>setLink(e.target.value)} placeholder="https://www.pexels.com/... or https://pixabay.com/..."/></label><button className="raf-primary" onClick={addLink}>Add to Scene {scene} review</button><div className="raf-upload"><Upload size={20}/><label>Or choose a downloaded asset<input type="file" accept="image/*,video/*,audio/*" onChange={e=>setFile(e.target.files?.[0]||null)}/></label>{file&&<p>{file.name} selected locally. Upload to project storage is not yet connected.</p>}</div>{message&&<p className="raf-note" role="status">{message}</p>}<h3>Scene {scene} · Review queue ({selectedForScene.length})</h3>{selectedForScene.length===0?<div className="raf-empty">No assets selected yet. Search a provider and add your preferred asset here.</div>:selectedForScene.map((s,i)=><div className="raf-selected" key={s.url+i}><div><b>{s.source} · {s.type}</b><small>{s.title}</small><a href={s.url} target="_blank" rel="noopener noreferrer">Open original asset</a></div><button aria-label="Remove asset" onClick={()=>setSelected(v=>v.filter(x=>x!==s))}><X size={17}/></button></div>)}<p className="raf-note">Selections are saved in this browser session. Media download, licence verification, server storage and timeline replacement require backend integration.</p></section></div>
 <footer className="raf-footer"><Link to="/video-studio-v2">Return to Video Studio</Link><span>{selected.length} assets referenced across scenes · no replacements applied</span></footer></main></div>
}
