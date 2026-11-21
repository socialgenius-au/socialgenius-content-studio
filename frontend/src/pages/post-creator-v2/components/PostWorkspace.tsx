// The Create stage's editing workspace. It is the SAME canvas, inspector, layers, design, format and brand panels the Carousel Creator uses, working on the post's single page, so every tool
// shown here is real: nothing is a placeholder and nothing calls a mock.
import { useState } from 'react'
import { Eraser, Image as ImageIcon, Layers, LayoutTemplate, Palette, Redo2, Shapes, Undo2 } from 'lucide-react'
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
const TABS: { id: Tab; label: string }[] = [{ id: 'edit', label: 'Edit' }, { id: 'design', label: 'Design' }, { id: 'format', label: 'Format' }, { id: 'layers', label: 'Layers' }, { id: 'brand', label: 'Brand' }]

export default function PostWorkspace() {
  const s = usePostSession()
  const { state, dispatch, doc } = s
  const [tab, setTab] = useState<Tab>('edit')
  const [snap, setSnap] = useState(true)
  const page = doc.pages[0]
  const selected = state.selectedElementId ? page.elements.find(e => e.id === state.selectedElementId) : undefined
  const theme = themeById(state.themeId)
  const blank = () => dispatch({ type: 'commitDoc', doc: { ...doc, revision: doc.revision + 1, updatedAt: new Date().toISOString(), pages: doc.pages.map(p => ({ ...p, elements: [] })) } })
  const mode = 'pcv2-mode-btn'

  return (
    <BrandTokensContext.Provider value={s.tokens}>
      <div className="pcv2-mode-row" style={{ marginTop: 16, alignItems: 'center' }} data-testid="pcv2-create-modes">
        <button type="button" className={mode} onClick={() => { setTab('edit'); dispatch({ type: 'selectElement', id: null }) }} data-testid="pcv2-mode-edit"><LayoutTemplate size={14} /> Layout &amp; text</button>
        <button type="button" className={mode} onClick={() => setTab('design')} data-testid="pcv2-mode-design"><Shapes size={14} /> Shapes &amp; backgrounds</button>
        <button type="button" className={mode} onClick={() => { setTab('edit'); dispatch({ type: 'selectElement', id: null }) }} data-testid="pcv2-mode-pictures"><ImageIcon size={14} /> Add pictures</button>
        <button type="button" className={mode} onClick={() => setTab('brand')} data-testid="pcv2-mode-brand"><Palette size={14} /> Brand Kit</button>
        <button type="button" className={mode} onClick={() => setTab('layers')} data-testid="pcv2-mode-layers"><Layers size={14} /> Layers</button>
        <button type="button" className={mode} onClick={blank} data-testid="pcv2-mode-blank" title="Remove every layer. You can undo this."><Eraser size={14} /> Blank canvas</button>
        <span style={{ flex: 1 }} />
        <button type="button" className="pcv2-canvas-tool" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={state.past.length === 0} onClick={() => dispatch({ type: 'undo' })} data-testid="pcv2-undo"><Undo2 size={16} /></button>
        <button type="button" className="pcv2-canvas-tool" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={state.future.length === 0} onClick={() => dispatch({ type: 'redo' })} data-testid="pcv2-redo"><Redo2 size={16} /></button>
        <label className="pcv2-canvas-tool" style={{ gap: 4 }}><input type="checkbox" checked={snap} onChange={e => setSnap(e.target.checked)} data-testid="pcv2-snap" /> Snap</label>
        <SaveBadge state={s.sync} onRetry={s.retry} />
      </div>

      <div className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-3 xl:h-[calc(100dvh-19rem)] xl:min-h-[480px] xl:grid-cols-[minmax(0,1fr)_21rem] xl:grid-rows-[minmax(0,1fr)]" data-testid="pcv2-workspace">
        <div className="flex min-h-0 flex-col">
          <StageCanvas doc={doc} pageId={page.id} selectedId={state.selectedElementId} selectedIds={state.selectedIds} snap={snap} dispatch={dispatch} />
        </div>
        <aside className="min-h-0 rounded-lg border border-border bg-card p-3 text-foreground xl:h-full xl:overflow-y-auto" aria-label="Post editing panels">
          <div role="tablist" aria-label="Editing panels" className="mb-3 flex gap-1 overflow-x-auto rounded-md bg-muted p-1">
            {TABS.map(t => (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} data-testid={`pcv2-tab-${t.id}`}
                className={`flex-1 shrink-0 rounded px-2 py-1.5 text-sm font-medium ${tab === t.id ? 'bg-card shadow-sm' : 'text-muted-foreground'}`}>{t.label}</button>
            ))}
          </div>
          {tab === 'edit' && <Inspector doc={doc} page={page} selected={selected} selectedIds={state.selectedIds} swatches={s.swatches} kitFonts={s.kitFonts} dispatch={dispatch} />}
          {tab === 'design' && <DesignPanel doc={doc} page={page} theme={theme} selectedIds={state.selectedIds} dispatch={dispatch} libraryStore={s.libraryStore} />}
          {tab === 'format' && <FormatPanel key={`${doc.format.width}x${doc.format.height}`} doc={doc} dispatch={dispatch} />}
          {tab === 'layers' && <LayersPanel page={page} selectedId={state.selectedElementId} selectedIds={state.selectedIds} dispatch={dispatch} />}
          {tab === 'brand' && (
            <BrandPanel kit={s.kit} missingKitId={s.missingKit} kits={s.kits} error={s.kitError} busy={s.kitBusy} report={s.kitReport} onChooseKit={id => void s.chooseKit(id)} onApply={s.applyKit} onDetach={() => void s.chooseKit(null)}
              onManage={() => window.open('/carousel-creator', '_blank', 'noopener')}
              onAddLogo={l => dispatch({ type: 'addPrepared', element: makeBrandLogo(l) })} onAddName={n => dispatch({ type: 'addPrepared', element: makeBrandName(n, doc.format, theme) })} />
          )}
        </aside>
      </div>
    </BrandTokensContext.Provider>
  )
}
