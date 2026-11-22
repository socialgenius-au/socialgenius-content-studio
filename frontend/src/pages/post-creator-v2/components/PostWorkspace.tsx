// The Create stage's editing workspace. It is the SAME canvas, inspector, layers, design, format and brand panels the Carousel Creator uses, working on the post's single page, so every tool
// shown here is real: nothing is a placeholder and nothing calls a mock.
import { useState } from 'react'
import { Image as ImageIcon, Layers, LayoutTemplate, Palette, Redo2, Shapes, Undo2, Type, UploadCloud, Sparkles, FolderOpen } from 'lucide-react'
import { makeBrandLogo, makeBrandName } from '../../../lib/carousel/brandKit'
import { themeById } from '../../../lib/carousel/layouts'
import { BrandTokensContext } from '../../../lib/carousel/brandContext'
import StageCanvas from '../../carousel-creator/components/StageCanvas'
import Inspector from '../../carousel-creator/components/Inspector'
import DesignPanel from '../../carousel-creator/components/DesignPanel'
import FormatPanel from '../../carousel-creator/components/FormatPanel'
import LayersPanel from '../../carousel-creator/components/LayersPanel'
import BrandPanel from '../../carousel-creator/components/BrandPanel'
import { SaveBadge } from '../../carousel-creator/components/SyncStatus'
import { usePostSession } from '../session'

type Tab = 'edit' | 'design' | 'format' | 'layers' | 'brand'

export default function PostWorkspace() {
  const s = usePostSession()
  const { state, dispatch, doc } = s
  const [tab, setTab] = useState<Tab>('design')
  const [snap, setSnap] = useState(true)
  const page = doc.pages[0]
  const selected = state.selectedElementId ? page.elements.find(e => e.id === state.selectedElementId) : undefined
  const theme = themeById(state.themeId)


  return (
    <BrandTokensContext.Provider value={s.tokens}>
      <div className="pcv2-editor-grid" data-testid="pcv2-workspace">
        <nav className="pcv2-editor-rail" aria-label="Design tools">
          {([{id:'design',label:'Design',icon:LayoutTemplate},{id:'edit',label:'Elements',icon:Shapes},{id:'edit',label:'Text',icon:Type},{id:'design',label:'Media',icon:ImageIcon},{id:'brand',label:'Brand Kit',icon:Palette},{id:'design',label:'Uploads',icon:UploadCloud},{id:'layers',label:'Layers',icon:Layers},{id:'format',label:'Format',icon:FolderOpen}] as const).map((t,i)=><button key={i} type="button" className={tab===t.id?'active':''} onClick={()=>setTab(t.id)}><t.icon size={21}/><span>{t.label}</span></button>)}
        </nav>
        <aside className="pcv2-editor-left" aria-label="Templates and design tools">
          <h3>{tab==='design'?'Design':tab==='edit'?'Elements & text':tab==='brand'?'Brand Kit':tab==='layers'?'Layers': 'Format'}</h3>
          <div className="pcv2-editor-left-tabs"><button type="button" className={tab==='design'?'active':''} onClick={()=>setTab('design')}>Templates & layouts</button><button type="button" className={tab==='brand'?'active':''} onClick={()=>setTab('brand')}>Brand</button></div>
          {tab==='design'&&<DesignPanel doc={doc} page={page} theme={theme} selectedIds={state.selectedIds} dispatch={dispatch} libraryStore={s.libraryStore} />}
          {tab==='layers'&&<LayersPanel page={page} selectedId={state.selectedElementId} selectedIds={state.selectedIds} dispatch={dispatch} />}
          {tab==='format'&&<FormatPanel key={`${doc.format.width}x${doc.format.height}`} doc={doc} dispatch={dispatch} />}
          {tab==='brand'&&<BrandPanel kit={s.kit} missingKitId={s.missingKit} kits={s.kits} error={s.kitError} busy={s.kitBusy} report={s.kitReport} onChooseKit={id=>void s.chooseKit(id)} onApply={s.applyKit} onDetach={()=>void s.chooseKit(null)} onManage={()=>window.open('/create-brief','_blank','noopener')} onAddLogo={l=>dispatch({type:'addPrepared',element:makeBrandLogo(l)})} onAddName={n=>dispatch({type:'addPrepared',element:makeBrandName(n,doc.format,theme)})}/>}
          {tab==='edit'&&<div className="pcv2-editor-left-hint"><p>Select a text, image or shape on the canvas to edit it in the right panel.</p><button type="button" onClick={()=>setTab('design')}>Browse elements and backgrounds</button></div>}
        </aside>
        <section className="pcv2-editor-center" aria-label="Editable design canvas">
          <div className="pcv2-editor-toolbar"><button type="button" disabled={state.past.length===0} onClick={()=>dispatch({type:'undo'})} aria-label="Undo"><Undo2 size={17}/></button><button type="button" disabled={state.future.length===0} onClick={()=>dispatch({type:'redo'})} aria-label="Redo"><Redo2 size={17}/></button><strong>{doc.title}</strong><span>{doc.format.width} × {doc.format.height}</span><button type="button" onClick={()=>setTab('edit')}>Edit image / shape</button><button type="button" onClick={()=>setTab('layers')}>Position</button><label className="pcv2-toolbar-snap"><input type="checkbox" checked={snap} onChange={e=>setSnap(e.target.checked)}/> Snap</label><SaveBadge state={s.sync} onRetry={s.retry}/></div>
          <div className="pcv2-editor-stage"><StageCanvas doc={doc} pageId={page.id} selectedId={state.selectedElementId} selectedIds={state.selectedIds} snap={snap} dispatch={dispatch}/></div>
          <div className="pcv2-editor-pages"><div className="pcv2-page-chip"><span>1</span>Page 1 of 1</div><span>Use Carousel Creator for multiple slides</span></div>
        </section>
        <aside className="pcv2-editor-right" aria-label="Post editing panels">
          <div className="pcv2-editor-inspector-tabs"><button type="button" className={tab==='edit'?'active':''} onClick={()=>setTab('edit')}>Edit</button><button type="button" className={tab==='design'?'active':''} onClick={()=>setTab('design')}>Effects & design</button><button type="button" onClick={()=>setTab('layers')}>Position</button></div>
          <Inspector doc={doc} page={page} selected={selected} selectedIds={state.selectedIds} swatches={s.swatches} kitFonts={s.kitFonts} dispatch={dispatch}/>
          <div className="pcv2-editor-inspector-hint"><Sparkles size={15}/> Select an image inside a shape to adjust the image and its frame using the available editing controls.</div>
        </aside>
      </div>
    </BrandTokensContext.Provider>
  )
}
