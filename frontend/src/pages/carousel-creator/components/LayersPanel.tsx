import { useState, type Dispatch } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Eye, EyeOff, Group, Image as ImageIcon, Lock, Shapes, Type, Ungroup, Unlock } from 'lucide-react'
import type { PostElement, PostPage } from '../../../lib/postDocument'
import { cn } from '@/lib/utils'
import type { EditorAction } from '../editorState'

const ICON = { text: Type, image: ImageIcon, shape: Shapes, group: Group } as const
const small = 'rounded p-1 hover:bg-muted disabled:opacity-30'

export interface LayersPanelProps {
  page: PostPage
  selectedId: string | null
  /** Every selected layer. Defaults to just the primary. */
  selectedIds?: string[]
  dispatch: Dispatch<EditorAction>
}

/**
 * Layers of the open slide, front first (the last array item paints on top). Each layer can be selected (a checkbox adds it to the selection, as does Shift/Ctrl-click),
 * shown or hidden, locked, moved up or down (buttons work by touch and keyboard) or dragged to a new place. Selecting two or more offers Group; a group can be Ungrouped.
 */
export default function LayersPanel({ page, selectedId, selectedIds, dispatch }: LayersPanelProps) {
  const ids = selectedIds ?? (selectedId ? [selectedId] : [])
  const front: PostElement[] = [...page.elements].reverse()
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const selectedGroup = ids.length === 1 ? page.elements.find(e => e.id === ids[0] && e.type === 'group') : undefined
  const arrayIndex = (id: string) => page.elements.findIndex(e => e.id === id)

  return (
    <section aria-label="Layers" data-testid="layers" className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Layers (front first)</h3>
        <span className="text-[11px] text-muted-foreground" data-testid="layers-selected-count">{ids.length > 0 ? `${ids.length} selected` : ''}</span>
      </div>
      <div className="flex flex-wrap gap-1.5" aria-label="Layer actions">
        <button type="button" className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-card px-2 text-xs hover:bg-muted disabled:opacity-40" disabled={ids.length < 2} onClick={() => dispatch({ type: 'group' })} data-testid="group-btn"><Group className="h-3.5 w-3.5" />Group</button>
        <button type="button" className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-card px-2 text-xs hover:bg-muted disabled:opacity-40" disabled={!selectedGroup} onClick={() => dispatch({ type: 'ungroup' })} data-testid="ungroup-btn"><Ungroup className="h-3.5 w-3.5" />Ungroup</button>
        <button type="button" className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-card px-2 text-xs hover:bg-muted disabled:opacity-40" disabled={page.elements.length === 0} onClick={() => dispatch({ type: 'selectAll' })} data-testid="select-all-btn">Select all</button>
        <button type="button" className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-card px-2 text-xs hover:bg-muted disabled:opacity-40" disabled={ids.length === 0} onClick={() => dispatch({ type: 'lockSelected', locked: !ids.every(i => page.elements.find(e => e.id === i)?.locked) })} data-testid="lock-selected-btn">Lock / unlock</button>
      </div>
      {front.length === 0 && <p className="text-xs text-muted-foreground">This slide is empty. Add text, an image or a shape.</p>}
      <ul className="space-y-1">
        {front.map((el, i) => {
          const Icon = ICON[el.type]
          const selected = ids.includes(el.id)
          const isOpen = el.type === 'group' && open[el.id]
          return (
            <li key={el.id} className="space-y-1">
              <div
                data-testid="layer-item" data-element-id={el.id} data-selected={selected ? 'true' : undefined} draggable
                onDragStart={e => { setDragId(el.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', el.id) }}
                onDragOver={e => { if (dragId) { e.preventDefault(); setOverId(el.id) } }}
                onDragLeave={() => setOverId(cur => (cur === el.id ? null : cur))}
                onDrop={e => { e.preventDefault(); if (dragId && dragId !== el.id) dispatch({ type: 'reorderElement', id: dragId, to: arrayIndex(el.id) }); setDragId(null); setOverId(null) }}
                onDragEnd={() => { setDragId(null); setOverId(null) }}
                className={cn('flex items-center gap-1 rounded-md border px-1.5 py-1 text-xs', selected ? 'border-primary bg-primary/5' : 'border-border bg-card', overId === el.id && dragId !== el.id && 'ring-2 ring-primary/60', dragId === el.id && 'opacity-50')}
              >
                <input type="checkbox" aria-label={`Include ${el.name} in the selection`} checked={selected} onChange={() => dispatch({ type: 'selectElement', id: el.id, mode: 'toggle' })} className="h-4 w-4 shrink-0" data-testid="layer-check" />
                {el.type === 'group' && <button type="button" className={small} aria-label={isOpen ? `Collapse ${el.name}` : `Expand ${el.name}`} onClick={() => setOpen(o => ({ ...o, [el.id]: !o[el.id] }))}>{isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}</button>}
                <button type="button" className="flex min-w-0 flex-1 items-center gap-1.5 text-left" onClick={e => dispatch({ type: 'selectElement', id: el.id, mode: e.shiftKey || e.ctrlKey || e.metaKey ? 'toggle' : 'replace' })} aria-label={`Select ${el.name}`}>
                  <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className={cn('truncate', !el.visible && 'text-muted-foreground line-through')}>{el.name}</span>
                </button>
                <button type="button" className={small} aria-label={`Bring ${el.name} forward`} disabled={i === 0} onClick={() => dispatch({ type: 'layer', id: el.id, move: 'forward' })}><ArrowUp className="h-3.5 w-3.5" /></button>
                <button type="button" className={small} aria-label={`Send ${el.name} backward`} disabled={i === front.length - 1} onClick={() => dispatch({ type: 'layer', id: el.id, move: 'backward' })}><ArrowDown className="h-3.5 w-3.5" /></button>
                <button type="button" className={small} aria-label={el.locked ? `Unlock ${el.name}` : `Lock ${el.name}`} aria-pressed={el.locked} onClick={() => dispatch({ type: 'updateElement', id: el.id, patch: { locked: !el.locked } })}>{el.locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5 text-muted-foreground" />}</button>
                <button type="button" className={small} aria-label={el.visible ? `Hide ${el.name}` : `Show ${el.name}`} onClick={() => dispatch({ type: 'updateElement', id: el.id, patch: { visible: !el.visible } })}>{el.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}</button>
              </div>
              {isOpen && el.type === 'group' && (
                <ul className="ml-6 space-y-0.5" data-testid="group-children">
                  {[...el.children].reverse().map(c => { const CI = ICON[c.type]; return <li key={c.id} className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><CI className="h-3 w-3" />{c.name}</li> })}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
