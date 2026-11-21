import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { assetsApi, uploadApi } from '../api/client'
import type { Asset } from '../types'
import AssetLibrary from './AssetLibrary'
import './MediaLibraryHub.css'

type Section = 'saved' | 'upload' | 'discover'
type Kind = 'images' | 'videos' | 'audio' | 'text'
type Source = 'recommended' | 'pexels' | 'pixabay' | 'ai-image' | 'ai-video' | 'music'
const sources: {id:Source;label:string}[] = [
  {id:'recommended',label:'AI Recommendations'}, {id:'pexels',label:'Pexels'}, {id:'pixabay',label:'Pixabay'},
  {id:'ai-image',label:'AI Image'}, {id:'ai-video',label:'AI Video'}, {id:'music',label:'Music & Audio'}
]
const sections: {id:Section;icon:string;title:string;desc:string}[] = [
  {id:'saved',icon:'▣',title:'My Library',desc:'Previously uploaded & saved'},
  {id:'upload',icon:'↑',title:'Upload & Import',desc:'From your device or internet'},
  {id:'discover',icon:'✦',title:'Discover & Create',desc:'Stock media & AI tools'}
]
export default function MediaLibraryHub() {
  const [section,setSection] = useState<Section>('saved')
  const [kind,setKind] = useState<Kind>('images')
  const [source,setSource] = useState<Source>('recommended')
  const [files,setFiles] = useState<File[]>([])
  const [busy,setBusy] = useState(false)
  const [notice,setNotice] = useState('')
  const [search,setSearch] = useState('')
  const [url,setUrl] = useState('')
  const [recent,setRecent] = useState<Asset[]>([])
  useEffect(()=>{assetsApi.list().then(r=>setRecent(r.data as Asset[])).catch(()=>setRecent([]))},[section])
  const upload = async () => {
    if (!files.length || busy) return
    setBusy(true);setNotice('')
    let done=0
    try {
      for(const file of files) {await uploadApi.upload(file);done++}
      setNotice(`Uploaded ${done} file(s) to My Library.`)
      setFiles([]);setSection('saved')
    } catch(e) {setNotice(`Uploaded ${done} file(s). Remaining upload failed: ${e instanceof Error?e.message:'Unknown error'}`)}
    finally {setBusy(false)}
  }
  const stockUrl = (provider:'pexels'|'pixabay',type:Kind) => {
    const q=encodeURIComponent(search.trim() || 'business')
    if(provider==='pexels')return `https://www.pexels.com/search/${type==='videos'?'videos/':''}${q}/`
    const group=type==='videos'?'videos':type==='audio'?'music':'images'
    return `https://pixabay.com/${group}/search/${q}/`
  }
  return <main className="mlh">
    <header className="mlh-hero"><div><small>SOCIAL GENIUS · CONTENT STUDIO</small><h1>Media Library</h1><p>One place to find, upload, organise and create assets for posts, carousels and videos.</p></div><span className="mlh-hero-icon" aria-hidden>✦</span></header>
    <nav className="mlh-sections" aria-label="Media Library sections">
      {sections.map(s=><button key={s.id} type="button" className={section===s.id?'active':''} aria-current={section===s.id?'page':undefined} onClick={()=>{setSection(s.id);setNotice('')}}><span aria-hidden>{s.icon}</span><strong>{s.title}</strong><small>{s.desc}</small></button>)}
    </nav>
    {notice&&<p className="mlh-notice" role="status">{notice}</p>}
    {section==='saved'&&<section className="mlh-panel"><div className="mlh-panel-head"><div><h2>My saved assets</h2><p>Videos, images, documents and audio already stored in your account.</p></div><button onClick={()=>setSection('upload')}>+ Add media</button></div><AssetLibrary /></section>}
    {section==='upload'&&<section className="mlh-panel"><h2>Upload & Import</h2><p>Add files from your computer or phone. Uploaded files are stored using the existing Content Studio asset service.</p><label className="mlh-drop"><span aria-hidden>↑</span><strong>Select media from your device</strong><small>Images · Videos · Audio · Text files</small><input type="file" multiple accept="image/*,video/*,audio/*,.txt,.md,.pdf,.doc,.docx" onChange={e=>setFiles(Array.from(e.target.files||[]))}/></label>{files.length>0&&<div className="mlh-upload-queue"><p>{files.length} file(s) selected: {files.map(f=>f.name).join(', ')}</p><button disabled={busy} onClick={()=>void upload()}>{busy?'Uploading…':'Upload to My Library'}</button></div>}<div className="mlh-subpanel"><h3>Import from the internet</h3><label htmlFor="mlh-url">Media URL</label><input id="mlh-url" type="url" placeholder="https://…" value={url} onChange={e=>setUrl(e.target.value)}/><p>Internet links can be reviewed here. Direct server import is not connected yet; download authorised media from its source and upload it above.</p><button disabled={!/^https:\/\//i.test(url)} onClick={()=>window.open(url,'_blank','noopener,noreferrer')}>Review source URL</button></div></section>}
    {section==='discover'&&<section className="mlh-panel"><h2>Discover & Create</h2><p>Explore stock sources, AI recommendations, creative generators and royalty-free music options.</p><div className="mlh-pills" aria-label="Asset type">{(['images','videos','audio','text'] as Kind[]).map(k=><button key={k} className={kind===k?'active':''} onClick={()=>setKind(k)}>{k[0].toUpperCase()+k.slice(1)}</button>)}</div><div className="mlh-source-grid">{sources.map(s=><button key={s.id} className={source===s.id?'active':''} onClick={()=>setSource(s.id)}>{s.label}</button>)}</div><div className="mlh-subpanel">{source==='recommended'?<><h3>AI recommendations</h3><p>Recommendations should use the project's topic, brand, script and scene context. Automatic recommendation is not yet connected.</p><p>{recent.length} existing asset(s) available in your library.</p><button onClick={()=>setSection('saved')}>Browse my assets</button></>:source==='pexels'||source==='pixabay'?<><h3>{source==='pexels'?'Pexels':'Pixabay'} stock search</h3><label htmlFor="mlh-search">What are you looking for?</label><input id="mlh-search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="e.g. business meeting, product packaging"/>{source==='pexels'&&(kind==='audio'||kind==='text')?<p>Pexels provides stock images and videos. Select Images or Videos.</p>:<a className="mlh-action" href={stockUrl(source,kind)} target="_blank" rel="noopener noreferrer">Search {source==='pexels'?'Pexels':'Pixabay'} ↗</a>}<p>Review each asset's licence before downloading and adding it to My Library.</p></>:source==='music'?<><h3>Music, ambience & sound effects</h3><p>Find existing free music and sound effects, including background tracks. Review the licence for commercial use and attribution requirements.</p><a className="mlh-action" href="https://pixabay.com/music/" target="_blank" rel="noopener noreferrer">Browse Pixabay Music ↗</a><a className="mlh-action" href="https://pixabay.com/sound-effects/" target="_blank" rel="noopener noreferrer">Browse sound effects ↗</a></>:<><h3>{source==='ai-image'?'AI image generation':'AI video generation'}</h3><p>Provider selection and generation will be connected to the Content Studio's existing generation services. No generation or charges will occur from this screen yet.</p><Link className="mlh-action" to="/create">Open creation tools →</Link></>}</div><p className="mlh-footnote">Workflow: Discover or generate → review source and rights → save to My Library → insert into editor.</p></section>}
  </main>
}
