import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, ChevronLeft, ChevronRight, CirclePlay, Crop, FolderOpen, Grid2X2, Image, Layers, LayoutTemplate, Lock, Maximize, Menu, MoreHorizontal, Plus, Search, Shapes, SlidersHorizontal, Sparkles, StickyNote, Target, Type, Unlock, UploadCloud, X } from 'lucide-react'
import { assetsApi, carouselTemplatesApi, uploadApi } from '../../../api/client'
import { BrandTokensContext } from '../../../lib/carousel/brandContext'
import { makeBrandLogo, makeBrandName } from '../../../lib/carousel/brandKit'
import { CAROUSEL_THEMES, LAYOUTS, themeById } from '../../../lib/carousel/layouts'
import { createHttpTemplateStore } from '../../../lib/carousel/assetsStore'
import { applyTemplateSlides, type TemplateSummary } from '../../../lib/carousel/templates'
import { insertSlide, makeImage, newSlide, touch } from '../../../lib/carousel/ops'
import type { ImageElement } from '../../../lib/postDocument'
import type { Asset } from '../../../types'
import StageCanvas from '../../carousel-creator/components/StageCanvas'
import SlideView from '../../carousel-creator/components/SlideView'
import Inspector from '../../carousel-creator/components/Inspector'
import DesignPanel from '../../carousel-creator/components/DesignPanel'
import FormatPanel from '../../carousel-creator/components/FormatPanel'
import LayersPanel from '../../carousel-creator/components/LayersPanel'
import BrandPanel from '../../carousel-creator/components/BrandPanel'
import AnimatePanel from '../../carousel-creator/components/AnimatePanel'
import ImagePicker, { storedUrlFor, type PickedImage } from '../../carousel-creator/components/ImagePicker'
import { illustratedPage, illustratedTemplates, starterFormat } from '../illustratedTemplates'
import { usePostSession } from '../session'
import PostImageProperties, { type ImagePanel } from './PostImageProperties'
import './PostWorkspace.css'

const tools = [
  { label: 'Design', Icon: LayoutTemplate }, { label: 'Elements', Icon: Shapes }, { label: 'Text', Icon: Type },
  { label: 'Media', Icon: Image }, { label: 'Brand Kit', Icon: Target }, { label: 'Uploads', Icon: UploadCloud },
  { label: 'AI Tools', Icon: Sparkles }, { label: 'Apps', Icon: Grid2X2 }, { label: 'Projects', Icon: FolderOpen },
] as const

type Tool = typeof tools[number]['label']
const designTabs = ['Templates', 'Layouts', 'Styles'] as const
const propertyTabs = ['Edit', 'Effects', 'Animate'] as const

export default function PostWorkspace({ onProjects, templateRevision = 0 }: { onProjects?: () => void; templateRevision?: number }) {
  const s = usePostSession()
  const { state, dispatch, doc } = s
  const pageIndex = doc.pages.findIndex(p => p.id === state.activeSlideId)
  const page = doc.pages[pageIndex]
  const selected = state.selectedIds.length === 1 ? page.elements.find(e => e.id === state.selectedElementId) : undefined
  const picture = selected?.type === 'image' ? selected : undefined
  const theme = themeById(state.themeId)
  const latest = useRef(state)
  latest.current = state

  const [tool, setTool] = useState<Tool>('Design')
  const [designTab, setDesignTab] = useState<typeof designTabs[number]>('Templates')
  const [filter, setFilter] = useState('All')
  const [search, setSearch] = useState('')
  const [filterOpen, setFilterOpen] = useState(true)
  const [pageMenu, setPageMenu] = useState(false)
  const [mobilePanel, setMobilePanel] = useState<'library' | 'properties' | null>(null)
  const [focus, setFocus] = useState(false)
  const [notes, setNotes] = useState(false)
  const [filmstrip, setFilmstrip] = useState(true)
  const [zoom, setZoom] = useState(62)
  const [inspectorTab, setInspectorTab] = useState<typeof propertyTabs[number]>('Edit')
  const [panel, setPanel] = useState<ImagePanel>('image')
  const [backgroundMenu, setBackgroundMenu] = useState(false)
  const [backgroundBusy, setBackgroundBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [templates, setTemplates] = useState<TemplateSummary[]>([])
  const [templateError, setTemplateError] = useState('')
  const [templateBusy, setTemplateBusy] = useState(false)
  const store = useMemo(() => createHttpTemplateStore(carouselTemplatesApi), [])
  const previews = useMemo(() => illustratedTemplates.map(template => ({ ...template, page: illustratedPage(template.id, starterFormat) })), [])
  const film = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const active = film.current?.querySelector<HTMLElement>('[aria-current="page"]')
    if (active && film.current) {
      const strip = film.current.getBoundingClientRect()
      const card = active.getBoundingClientRect()
      if (card.right > strip.right) film.current.scrollLeft += card.right - strip.right
      if (card.left < strip.left) film.current.scrollLeft -= strip.left - card.left
    }
  }, [page.id, filmstrip])
  useEffect(() => {
    let active = true
    store.list().then(list => { if (active) { setTemplates(list); setTemplateError('') } })
      .catch(() => { if (active) setTemplateError('Saved templates could not be loaded.') })
    return () => { active = false }
  }, [store, templateRevision])

  function applyExample(id: typeof illustratedTemplates[number]['id']) {
    const next = { ...illustratedPage(id, doc.format), id: page.id }
    const hero = next.elements.find(e => e.name === 'Business portrait')
    dispatch({ type: 'commitDoc', doc: touch({ ...doc, pages: doc.pages.map(p => p.id === page.id ? next : p) }), selectIds: hero ? [hero.id] : [] })
    setMobilePanel(null)
  }

  async function applyTemplate(id: number) {
    setTemplateBusy(true)
    setTemplateError('')
    try {
      const template = await store.get(id)
      const current = latest.current
      if (!current.doc.pages.some(p => p.id === page.id)) return
      const result = applyTemplateSlides(current.doc, template, 'replace', page.id)
      dispatch({ type: 'commitDoc', doc: result.doc, activeSlideId: result.slideIds[0] })
      setMobilePanel(null)
    } catch (error) {
      setTemplateError(error instanceof Error ? error.message : 'Could not apply the template.')
    } finally {
      setTemplateBusy(false)
    }
  }

  function patchImage(patch: Partial<ImageElement>) {
    if (picture) dispatch({ type: 'updateElement', id: picture.id, patch })
  }

  function replacePicture(asset: PickedImage) {
    patchImage({ source: { kind: 'asset', url: asset.url, assetId: asset.assetId }, alt: asset.name, zoom: 1, focal: { x: .5, y: .5 }, trim: undefined })
  }

  async function removeBackground(mode: 'complex' | 'flat') {
    if (!picture || picture.locked || picture.source.kind !== 'asset') return
    setBackgroundMenu(false)
    if (!picture.source.assetId) {
      setNotice(picture.source.url?.endsWith('/portrait.webp') ? 'This portrait already has a transparent background.' : 'Background removal is available for images from Uploads or Media.')
      return
    }
    setNotice('')
    setBackgroundBusy(true)
    try {
      const response = mode === 'flat' ? await assetsApi.removeFlatBackground(picture.source.assetId) : await assetsApi.removeComplexBackground(picture.source.assetId)
      const current = latest.current
      const currentPicture = current.doc.pages.find(p => p.id === page.id)?.elements.find(e => e.id === picture.id)
      if (currentPicture?.type !== 'image' || currentPicture.locked || currentPicture.source !== picture.source) return
      const name = picture.name.replace(/\.[^.]+$/, '') + '-cutout.png'
      const result = await uploadApi.upload(new File([response.data], name, { type: 'image/png' }))
      const asset = result.data as Asset
      const now = latest.current
      const currentPage = now.doc.pages.find(p => p.id === page.id)
      const target = currentPage?.elements.find(e => e.id === picture.id)
      if (target?.type !== 'image' || target.locked || target.source !== picture.source) {
        setNotice('The cutout is available in Uploads.')
        return
      }
      const cutout: ImageElement = { ...target, source: { kind: 'asset', assetId: asset.id, url: storedUrlFor(asset) } }
      const pages = now.doc.pages.map(p => p.id === page.id ? { ...p, elements: p.elements.map(e => e.id === target.id ? cutout : e) } : p)
      dispatch({ type: 'commitDoc', doc: touch({ ...now.doc, pages }), selectIds: now.selectedIds })
      setNotice('Background removed. The original image is available in Media.')
    } catch (error) {
      const response = (error as { response?: { data?: Blob } }).response?.data
      const detail = response instanceof Blob ? await response.text().then(value => JSON.parse(value).detail).catch(() => '') : ''
      setNotice(typeof detail === 'string' && detail ? detail : 'Background removal failed. Try the flat-colour mode for a plain backdrop.')
    } finally {
      setBackgroundBusy(false)
    }
  }

  function showProperties(tab: typeof propertyTabs[number], nextPanel: ImagePanel = 'image') {
    setInspectorTab(tab)
    setPanel(nextPanel)
    setMobilePanel('properties')
  }

  function addPage() {
    const next = newSlide({ kind: 'solid', color: '#ffffff' }, [], 'Untitled page')
    dispatch({ type: 'commitDoc', doc: insertSlide(doc, next, undefined), activeSlideId: next.id })
  }

  const query = search.trim().toLowerCase()
  const matches = previews.filter(t => (filter === 'All' || t.category === filter) && t.name.toLowerCase().includes(query))
  const saved = templates.filter(t => filter === 'All' && t.name.toLowerCase().includes(query))

  return <BrandTokensContext.Provider value={s.tokens}>
    <div className={'sg-post-workspace' + (focus ? ' sg-post-focus' : '')} data-mobile-panel={mobilePanel ?? ''} data-testid="pcv2-workspace">
      <nav className="sg-post-rail" aria-label="Design tools">
        {tools.map(({ label, Icon }) => <button key={label} type="button" aria-pressed={tool === label} onClick={() => {
          if (label === 'Projects' && onProjects) { onProjects(); return }
          setTool(label)
          setMobilePanel(mobilePanel === 'library' && tool === label ? null : 'library')
        }}><Icon size={24}/><span>{label}</span></button>)}
      </nav>
      <aside className="sg-post-library" aria-label="Design library">
        <div className="sg-post-library-tabs">
          {tool === 'Design' ? designTabs.map(tab => <button type="button" key={tab} aria-pressed={designTab === tab} onClick={() => setDesignTab(tab)}>{tab}</button>) : <strong>{tool}</strong>}
        </div>
        {tool === 'Design' && designTab === 'Templates' ? <>
          <div className="sg-post-search"><Search size={20}/><input aria-label="Search templates" placeholder="Search templates…" value={search} onChange={e => setSearch(e.target.value)}/><button type="button" aria-label="Template categories" aria-expanded={filterOpen} onClick={() => setFilterOpen(v => !v)}><SlidersHorizontal size={19}/></button></div>
          {filterOpen && <div className="sg-post-filters">{['All', 'Business', 'Marketing', 'Education', 'Real Estate'].map(category => <button type="button" key={category} aria-pressed={filter === category} onClick={() => setFilter(category)}>{category}</button>)}</div>}
          {templateError && <p role="alert">{templateError}</p>}
          <div className="sg-post-templates">
            {matches.map(t => <button type="button" key={t.id} aria-label={t.name} aria-pressed={page.name === t.name} onClick={() => applyExample(t.id)}>
              <SlideView doc={{ ...doc, format: starterFormat, pages: [t.page] }} pageId={t.page.id} style={{ height: '100%', aspectRatio: 'auto' }}/>
            </button>)}
            {saved.map(t => <button type="button" key={t.id} disabled={templateBusy} onClick={() => void applyTemplate(t.id)} className="sg-post-saved-template">{t.name}</button>)}
          </div>
          {!matches.length && !saved.length && <p>No matching templates.</p>}
          <a className="sg-post-more" href="/templates">See more templates <ArrowRight size={18}/></a>
        </> : <div className="sg-post-library-content">
          {tool === 'Design' && designTab === 'Layouts' ? <div className="sg-post-layout-options">{LAYOUTS.map(layout => <button key={layout.id} type="button" onClick={() => dispatch({ type: 'applyLayout', layout: layout.id })}><LayoutTemplate size={18}/>{layout.label}</button>)}</div>
            : tool === 'Design' && designTab === 'Styles' ? <div className="sg-post-layout-options">{CAROUSEL_THEMES.map(style => <button type="button" key={style.id} onClick={() => {
              dispatch({ type: 'setTheme', themeId: style.id })
              dispatch({ type: 'setBackground', background: { kind: 'solid', color: style.background } })
            }}><span style={{ background: style.background, borderColor: style.accent }}/>{style.label}</button>)}</div>
            : tool === 'Brand Kit' ? <BrandPanel kit={s.kit} missingKitId={s.missingKit} kits={s.kits} error={s.kitError} busy={s.kitBusy} report={s.kitReport} onChooseKit={id => void s.chooseKit(id)} onApply={s.applyKit} onDetach={() => void s.chooseKit(null)} onManage={() => window.open('/create-brief','_blank','noopener')} onAddLogo={logo => dispatch({ type: 'addPrepared', element: makeBrandLogo(logo) })} onAddName={name => dispatch({ type: 'addPrepared', element: makeBrandName(name, doc.format, theme) })}/>
            : tool === 'Apps' ? <FormatPanel key={doc.format.width + 'x' + doc.format.height} doc={doc} dispatch={dispatch}/>
            : tool === 'AI Tools' ? <a href="/create-brief" target="_blank" rel="noreferrer">Open Content Brief</a>
            : tool === 'Media' || tool === 'Uploads' ? <ImagePicker onPick={asset => {
              dispatch({ type: 'addPrepared', element: makeImage({ name: asset.name, alt: asset.name, source: { kind: 'asset', assetId: asset.assetId, url: asset.url } }) })
              setMobilePanel(null)
            }}/>
            : tool === 'Text' ? <button type="button" onClick={() => { dispatch({ type: 'addElement', kind: 'text' }); showProperties('Edit') }}>Add text</button>
            : <DesignPanel doc={doc} page={page} theme={theme} selectedIds={state.selectedIds} dispatch={dispatch} libraryStore={s.libraryStore}/>}
        </div>}
      </aside>
      <main className="sg-post-centre" aria-label="Editable design canvas">
        <div className="sg-post-toolbar" aria-label="Canvas tools">
          <button type="button" aria-label="Open media" onClick={() => { setTool('Media'); setMobilePanel('library') }}><Image size={20}/></button>
          <button type="button" disabled={!picture} onClick={() => showProperties('Edit')}>Edit image</button>
          <div className="sg-post-bg-action">
            <button type="button" disabled={!picture || picture.locked || backgroundBusy || picture.source.kind !== 'asset'} aria-expanded={backgroundMenu} onClick={() => setBackgroundMenu(v => !v)}>{backgroundBusy ? 'Removing…' : 'Remove BG'}</button>
            {backgroundMenu && picture && <div className="sg-post-bg-menu">
              <button type="button" onClick={() => void removeBackground('complex')}>Remove complex background</button>
              <button type="button" onClick={() => void removeBackground('flat')}>Remove flat-colour background</button>
            </div>}
          </div>
          <button type="button" disabled={!picture || picture.locked} onClick={() => showProperties('Edit', 'crop')}><Crop size={15}/> Crop</button>
          <button type="button" disabled={!picture || picture.locked} onClick={() => picture && patchImage({ flipX: !picture.flipX })}>Flip</button>
          <button type="button" onClick={() => showProperties('Animate')}><CirclePlay size={18}/> Animate</button>
          <button type="button" className="sg-post-position" onClick={() => showProperties('Edit', 'position')}>Position</button>
          <button type="button" disabled={!selected} aria-label={selected?.locked ? 'Unlock selected' : 'Lock selected'} onClick={() => selected && dispatch({ type: 'updateElement', id: selected.id, patch: { locked: !selected.locked } })}>{selected?.locked ? <Unlock size={19}/> : <Lock size={19}/>}</button>
          <div className="sg-post-bg-action">
            <button type="button" aria-label="Page actions" aria-expanded={pageMenu} onClick={() => setPageMenu(v => !v)}><MoreHorizontal size={19}/></button>
            {pageMenu && <div className="sg-post-bg-menu sg-post-page-menu">
              <button type="button" onClick={() => { dispatch({ type: 'duplicateSlide', id: page.id }); setPageMenu(false) }}>Duplicate page</button>
              <button type="button" onClick={() => { dispatch({ type: 'renameSlide', id: page.id, name: window.prompt('Page name', page.name ?? '')?.trim() || page.name || 'Untitled page' }); setPageMenu(false) }}>Rename page</button>
              <button type="button" disabled={doc.pages.length === 1} onClick={() => { dispatch({ type: 'deleteSlide', id: page.id }); setPageMenu(false) }}>Delete page</button>
            </div>}
          </div>
        </div>
        {(notice || state.notice) && <div className="sg-post-canvas-message" role="status">{notice || state.notice}<button type="button" aria-label="Dismiss message" onClick={() => { setNotice(''); dispatch({ type: 'clearNotice' }) }}>×</button></div>}
        <div className="sg-post-stage"><StageCanvas doc={doc} pageId={page.id} selectedId={state.selectedElementId} selectedIds={state.selectedIds} zoomFactor={zoom / 62} fitHeight cornerHandles dispatch={dispatch}/></div>
        {filmstrip && <div className="sg-post-pages">
          <button type="button" className="sg-post-page-nav" aria-label="Previous page" disabled={pageIndex === 0} onClick={() => dispatch({ type: 'selectSlide', id: doc.pages[pageIndex - 1].id })}><ChevronLeft size={18}/></button>
          <div className="sg-post-filmstrip" ref={film}>
            {doc.pages.map((p, index) => <button type="button" key={p.id} className="sg-post-page" aria-label={'Page ' + (index + 1) + (p.name ? ' · ' + p.name : '')} aria-current={p.id === page.id ? 'page' : undefined} onClick={() => {
              dispatch({ type: 'selectSlide', id: p.id })
              setInspectorTab('Edit'); setPanel('image')
            }}><SlideView doc={doc} pageId={p.id} style={{ height: '100%', aspectRatio: 'auto' }}/><span>{index + 1}</span></button>)}
            <button type="button" className="sg-post-add" onClick={addPage}><Plus size={23}/> Add Page</button>
          </div>
          <button type="button" className="sg-post-page-nav" aria-label="Next page" disabled={pageIndex === doc.pages.length - 1} onClick={() => dispatch({ type: 'selectSlide', id: doc.pages[pageIndex + 1].id })}><ChevronRight size={18}/></button>
        </div>}
        {notes && <label className="sg-post-notes">Project notes<textarea aria-label="Project notes" value={s.workflow.insights.notes} onChange={e => {
          const value = e.target.value
          s.setWorkflow(current => ({ ...current, insights: { ...current.insights, notes: value } }))
        }}/></label>}
        <footer className="sg-post-footer">
          <button type="button" aria-expanded={notes} onClick={() => setNotes(v => !v)}><StickyNote size={17}/> Notes</button>
          <span>Page {pageIndex + 1} of {doc.pages.length}</span>
          <label className="sg-post-zoom"><input aria-label="Canvas zoom" type="range" min="25" max="125" value={zoom} onChange={e => setZoom(Number(e.target.value))}/><span>{zoom}%</span></label>
          <button type="button" aria-label="Toggle page thumbnails" aria-pressed={filmstrip} onClick={() => setFilmstrip(v => !v)}><Grid2X2 size={17}/></button>
          <button type="button" aria-label="Toggle properties" className="sg-post-mobile-properties" onClick={() => setMobilePanel(v => v === 'properties' ? null : 'properties')}><Menu size={17}/></button>
          <button type="button" aria-label="Toggle focus mode" aria-pressed={focus} onClick={() => setFocus(v => !v)}><Maximize size={18}/></button>
        </footer>
      </main>
      <aside className="sg-post-properties" aria-label="Properties">
        <div className="sg-post-property-tabs">{propertyTabs.map(tab => <button type="button" key={tab} aria-pressed={inspectorTab === tab} onClick={() => showProperties(tab, tab === 'Effects' ? 'effects' : 'image')}>{tab}</button>)}<button type="button" className="sg-post-close-properties" aria-label="Close properties" onClick={() => setMobilePanel(null)}><X size={18}/></button></div>
        <div className="sg-post-properties-content">
          {inspectorTab === 'Animate' ? <AnimatePanel doc={doc} page={page} pageIndex={pageIndex} selected={selected} dispatch={dispatch}/>
            : picture ? <PostImageProperties key={picture.id} image={picture} panel={panel} update={patchImage} replace={replacePicture} addText={() => dispatch({ type: 'addElement', kind: 'text' })} remove={() => dispatch({ type: 'deleteSelected' })} order={move => dispatch({ type: 'layer', id: picture.id, move })}/>
            : <><h3>{selected?.type === 'text' ? 'Text' : selected?.type === 'shape' ? 'Shape' : 'Design properties'}</h3><Inspector doc={doc} page={page} selected={selected} selectedIds={state.selectedIds} swatches={s.swatches} kitFonts={s.kitFonts} dispatch={dispatch}/></>}
          {(!picture || panel === 'position') && <details className="sg-post-property-section"><summary><Layers size={18}/> Layers</summary><div><LayersPanel page={page} selectedId={state.selectedElementId} selectedIds={state.selectedIds} dispatch={dispatch}/></div></details>}
        </div>
      </aside>
    </div>
  </BrandTokensContext.Provider>
}
