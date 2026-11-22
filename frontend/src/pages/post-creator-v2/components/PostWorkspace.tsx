import { useEffect, useMemo, useState } from 'react'
import { LayoutTemplate, Shapes, Type, Image as ImageIcon, Palette, UploadCloud, Sparkles, FolderOpen, ChevronLeft, ChevronRight, Plus, Crop, Lock, SlidersHorizontal, Maximize, Grid2X2, X, Search, FlipHorizontal, Trash2, MousePointer2 } from 'lucide-react'
import { BrandTokensContext } from '../../../lib/carousel/brandContext'
import { makeBrandLogo, makeBrandName } from '../../../lib/carousel/brandKit'
import { themeById } from '../../../lib/carousel/layouts'
import { createHttpTemplateStore } from '../../../lib/carousel/assetsStore'
import { applyTemplateSlides, type TemplateSummary } from '../../../lib/carousel/templates'
import { carouselTemplatesApi } from '../../../api/client'
import { useResizableEditorPanels } from '../../../components/editor/useResizableEditorPanels'
import StageCanvas from '../../carousel-creator/components/StageCanvas'
import Inspector from '../../carousel-creator/components/Inspector'
import DesignPanel from '../../carousel-creator/components/DesignPanel'
import FormatPanel from '../../carousel-creator/components/FormatPanel'
import LayersPanel from '../../carousel-creator/components/LayersPanel'
import BrandPanel from '../../carousel-creator/components/BrandPanel'
import { usePostSession } from '../session'
import './FreshCanvaEditor.css'

type Tool = 'Design' | 'Elements' | 'Text' | 'Media' | 'Brand Kit' | 'Uploads' | 'AI Tools' | 'Apps' | 'Projects'
type DesignTab = 'Templates' | 'Layouts' | 'Styles'
const tools = [
  { label:'Design', Icon:LayoutTemplate },{ label:'Elements', Icon:Shapes },{ label:'Text', Icon:Type },
  { label:'Media', Icon:ImageIcon },{ label:'Brand Kit', Icon:Palette },{ label:'Uploads', Icon:UploadCloud },
  { label:'AI Tools', Icon:Sparkles },{ label:'Apps', Icon:Grid2X2 },{ label:'Projects', Icon:FolderOpen },
] as const
const examples = [
  {name:'Grow your business',tag:'Business',headline:'GROW YOUR BUSINESS',sub:'WITH SOCIAL GENIUS',style:'growth'},
  {name:'AI Automation',tag:'Business',headline:'AI AUTOMATION',sub:'FOR YOUR BUSINESS',style:'ai'},
  {name:'Positioning & Strategy',tag:'Marketing',headline:'POSITIONING',sub:'THAT GETS YOU CLIENTS',style:'position'},
  {name:'Mentoring & Coaching',tag:'Education',headline:'MENTORING',sub:'& COACHING',style:'mentor'},
  {name:'The Positioning People',tag:'Business',headline:'THE POSITIONING',sub:'PEOPLE',style:'people'},
  {name:'Content That Converts',tag:'Marketing',headline:'CONTENT THAT',sub:'CONVERTS',style:'content'},
]
export default function PostWorkspace() {
  const s=usePostSession()
  const {state,dispatch,doc}=s
  const page=doc.pages[0]
  const selected=state.selectedElementId?page.elements.find(e=>e.id===state.selectedElementId):undefined
  const theme=themeById(state.themeId)
  const panels=useResizableEditorPanels('sg-canva-rebuilt-post-panels')
  const [tool,setTool]=useState<Tool>('Design')
  const [designTab,setDesignTab]=useState<DesignTab>('Templates')
  const [filter,setFilter]=useState('All')
  const [search,setSearch]=useState('')
  const [focus,setFocus]=useState(false)
  const [snap,setSnap]=useState(true)
  const [zoom,setZoom]=useState(62)
  const [inspectorTab,setInspectorTab]=useState<'Edit'|'Effects'|'Animate'>('Edit')
  const [templates,setTemplates]=useState<TemplateSummary[]>([])
  const [templateError,setTemplateError]=useState('')
  const [busy,setBusy]=useState(false)
  const store=useMemo(()=>createHttpTemplateStore(carouselTemplatesApi),[])
  useEffect(()=>{let active=true;store.list().then(t=>{if(active)setTemplates(t)}).catch(e=>{if(active)setTemplateError(String(e))});return()=>{active=false}},[store])
  const applyTemplate=async(id:number)=>{
    setBusy(true);setTemplateError('')
    try{const t=await store.get(id);const result=applyTemplateSlides(doc,t,'replace',page.id);const first=result.doc.pages[0];dispatch({type:'commitDoc',doc:{...result.doc,id:doc.id,title:doc.title,context:doc.context,pages:[first]},activeSlideId:first.id})}
    catch(e){setTemplateError(e instanceof Error?e.message:String(e))}
    finally{setBusy(false)}
  }
  const selectTool=(t:Tool)=>{setTool(t);if(panels.widths.left===0)panels.toggle('left')}
  const chooseExample=(name:string)=>{
    const match=templates.find(t=>t.name.toLowerCase()===name.toLowerCase())
    if(match){void applyTemplate(match.id);return}
    setTemplateError('This example is a design preview. Save a matching template to your library to apply its editable artwork.')
  }
  return <BrandTokensContext.Provider value={s.tokens}>
    <div className={'sg-fresh-editor'+(focus?' sg-fresh-focus':'')} style={panels.style} data-testid="pcv2-workspace">
      <nav className="sg-fresh-rail" aria-label="Design tools">
        {tools.map(({label,Icon})=><button key={label} type="button" className={tool===label?'selected':''} onClick={()=>selectTool(label)}><Icon size={23}/><span>{label}</span></button>)}
      </nav>
      <aside className="sg-fresh-library" aria-label="Design library">
        <div className="sg-fresh-library-head">
          <button type="button" className="sg-fresh-collapse" aria-label="Collapse library" onClick={()=>panels.toggle('left')}><ChevronLeft size={18}/></button>
          {tool==='Design'?(['Templates','Layouts','Styles'] as const).map(t=><button type="button" key={t} className={designTab===t?'selected':''} onClick={()=>setDesignTab(t)}>{t}</button>):<strong>{tool}</strong>}
        </div>
        {tool==='Design'&&designTab==='Templates'?<div className="sg-fresh-template-area">
          <div className="sg-fresh-search"><Search size={17}/><input aria-label="Search templates" placeholder="Search templates..." value={search} onChange={e=>setSearch(e.target.value)}/><SlidersHorizontal size={17}/></div>
          <div className="sg-fresh-filters">{['All','Business','Marketing','Education','Real Estate'].map(v=><button type="button" key={v} className={filter===v?'selected':''} onClick={()=>setFilter(v)}>{v}</button>)}</div>
          {templateError&&<p className="sg-fresh-error" role="alert">{templateError}<button type="button" onClick={()=>setTemplateError('')}><X size={13}/></button></p>}
          <div className="sg-fresh-templates">
            {examples.filter(e=>(filter==='All'||e.tag===filter)&&(`${e.name} ${e.headline} ${e.sub}`).toLowerCase().includes(search.toLowerCase())).map(e=><button type="button" key={e.name} onClick={()=>chooseExample(e.name)} className="sg-fresh-template-card"><span className={'sg-fresh-art sg-fresh-art-'+e.style}><small>✦ SOCIAL GENIUS</small><strong>{e.headline}</strong><em>{e.sub}</em><span className="sg-fresh-art-accent"/></span></button>)}
            {templates.filter(t=>!examples.some(e=>e.name.toLowerCase()===t.name.toLowerCase())&&(filter==='All'||t.name.toLowerCase().includes(filter.toLowerCase()))&&t.name.toLowerCase().includes(search.toLowerCase())).map(t=><button type="button" key={t.id} disabled={busy} onClick={()=>void applyTemplate(t.id)} className="sg-fresh-template-card"><span className="sg-fresh-art sg-fresh-art-saved"><small>YOUR TEMPLATE</small><strong>{t.name}</strong><em>{t.slideCount} page{t.slideCount!==1?'s':''}</em><span className="sg-fresh-art-accent"/></span></button>)}
          </div><button type="button" className="sg-fresh-more" onClick={()=>window.location.assign('/templates')}>See more templates →</button>
        </div>:tool==='Brand Kit'?<div className="sg-fresh-tool-content"><BrandPanel kit={s.kit} missingKitId={s.missingKit} kits={s.kits} error={s.kitError} busy={s.kitBusy} report={s.kitReport} onChooseKit={id=>void s.chooseKit(id)} onApply={s.applyKit} onDetach={()=>void s.chooseKit(null)} onManage={()=>window.open('/create-brief','_blank','noopener')} onAddLogo={logo=>dispatch({type:'addPrepared',element:makeBrandLogo(logo)})} onAddName={name=>dispatch({type:'addPrepared',element:makeBrandName(name,doc.format,theme)})}/></div>
        :tool==='Projects'?<div className="sg-fresh-tool-content"><h3>Saved projects</h3><button type="button" onClick={()=>window.location.assign('/post-creator-v2')}>Open projects</button><LayersPanel page={page} selectedId={state.selectedElementId} selectedIds={state.selectedIds} dispatch={dispatch}/></div>
        :tool==='Apps'?<div className="sg-fresh-tool-content"><FormatPanel key={doc.format.width+'x'+doc.format.height} doc={doc} dispatch={dispatch}/></div>
        :tool==='AI Tools'?<div className="sg-fresh-tool-content"><h3>AI Tools</h3><p>Use Content Brief to prepare AI-assisted design instructions.</p><button type="button" onClick={()=>window.open('/create-brief','_blank','noopener')}>Open Content Brief</button></div>
        :<div className="sg-fresh-tool-content"><h3>{tool==='Text'?'Add and edit text':tool==='Media'||tool==='Uploads'?'Images and media':tool==='Elements'?'Shapes and elements':designTab+' library'}</h3>
          {tool==='Text'&&<button type="button" onClick={()=>dispatch({type:'addElement',kind:'text'})}><Plus size={17}/> Add text</button>}
          {(tool==='Media'||tool==='Uploads')&&<button type="button" onClick={()=>dispatch({type:'addElement',kind:'image'})}><Plus size={17}/> Add image</button>}
          {tool==='Elements'&&<button type="button" onClick={()=>dispatch({type:'addElement',kind:'shape'})}><Plus size={17}/> Add shape</button>}
          <DesignPanel doc={doc} page={page} theme={theme} selectedIds={state.selectedIds} dispatch={dispatch} libraryStore={s.libraryStore}/>
        </div>}
      </aside>
      <div {...panels.separator('left')}/>
      <main className="sg-fresh-center" aria-label="Editable design canvas">
        <div className="sg-fresh-context">
          <button type="button" onClick={()=>setInspectorTab('Edit')}><ImageIcon size={17}/> Edit image</button>
          <button type="button" onClick={()=>setInspectorTab('Effects')}>Remove BG</button>
          <button type="button" onClick={()=>setInspectorTab('Edit')}><Crop size={17}/> Crop</button>
          <button type="button" onClick={()=>setInspectorTab('Edit')}><FlipHorizontal size={17}/> Flip</button>
          <span className="sg-fresh-rule"/>
          <button type="button" onClick={()=>setInspectorTab('Animate')}>◉ Animate</button>
          <button type="button" className="sg-fresh-position" onClick={()=>selectTool('Projects')}>Position</button>
          <button type="button" onClick={()=>dispatch({type:'lockSelected',locked:true})} aria-label="Lock selected"><Lock size={18}/></button>
        </div>
        <div className="sg-fresh-stage"><StageCanvas doc={doc} pageId={page.id} selectedId={state.selectedElementId} selectedIds={state.selectedIds} snap={snap} dispatch={dispatch}/></div>
        <div className="sg-fresh-pages"><button type="button" className="sg-fresh-back" onClick={()=>panels.toggle('left')} aria-label="Toggle design library"><ChevronLeft size={17}/></button><button type="button" className="sg-fresh-page-card" aria-label="Current page"><span className="sg-fresh-page-art">✦<strong>{doc.title}</strong></span><small>1</small></button><div className="sg-fresh-page-add"><button type="button" onClick={()=>window.location.assign('/carousel-creator')}><Plus size={24}/> Multi-page carousel</button></div></div>
        <footer className="sg-fresh-footer"><button type="button" onClick={()=>setSnap(v=>!v)}>▤ Notes</button><span>Page 1 of 1</span><div className="sg-fresh-zoom"><input aria-label="Canvas zoom" type="range" min="25" max="200" value={zoom} onChange={e=>setZoom(Number(e.target.value))}/><span>{zoom}%</span></div><button type="button" onClick={()=>setFocus(v=>!v)} aria-label="Toggle focus mode"><Maximize size={18}/></button></footer>
      </main>
      <div {...panels.separator('right')}/>
      <aside className="sg-fresh-properties" aria-label="Properties">
        <div className="sg-fresh-property-tabs">{(['Edit','Effects','Animate'] as const).map(t=><button type="button" key={t} className={inspectorTab===t?'selected':''} onClick={()=>setInspectorTab(t)}>{t}</button>)}<button type="button" className="sg-fresh-collapse" aria-label="Collapse properties" onClick={()=>panels.toggle('right')}><ChevronRight size={18}/></button></div>
        <div className="sg-fresh-properties-content">
          <h3>{selected?.type==='image'?'Image / Video':selected?.type==='text'?'Text':selected?.type==='shape'?'Shape':'Design properties'}</h3>
          {selected&&<div className="sg-fresh-selected"><span><MousePointer2 size={20}/> Selected element</span><button type="button" aria-label="Delete selected element" onClick={()=>dispatch({type:'deleteSelected'})}><Trash2 size={19}/></button></div>}
          {inspectorTab==='Effects'&&<p className="sg-fresh-property-note">Image adjustments, transparency and available effects appear below. Automatic background removal requires a connected image processing service.</p>}
          {inspectorTab==='Animate'&&<p className="sg-fresh-property-note">Animation controls are available in Carousel Creator for multi-slide designs.</p>}
          <Inspector doc={doc} page={page} selected={selected} selectedIds={state.selectedIds} swatches={s.swatches} kitFonts={s.kitFonts} dispatch={dispatch}/>
        </div>
      </aside>
    </div>
  </BrandTokensContext.Provider>
}
