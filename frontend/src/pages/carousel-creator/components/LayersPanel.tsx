import type { Dispatch } from 'react'
import { ArrowDown, ArrowUp, Eye, EyeOff, Image as ImageIcon, Lock, Shapes, Type, Group } from 'lucide-react'
import type { PostElement, PostPage } from '../../../lib/postDocument'
import { cn } from '@/lib/utils'
import type { EditorAction } from '../editorState'

const ICON = { text: Type, image: ImageIcon, shape: Shapes, group: Group } as const

/** Layers of the open slide, front first (the last array item paints on top). */
export default function LayersPanel({ page, selectedId, dispatch }: { page: PostPage; selectedId: string | null; dispatch: Dispatch<EditorAction> }) {
  const front: PostElement[] = [...page.elements].reverse()
  return (
    <section aria-label="Layers" data-testid="layers" className="space-y-1">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Layers (front first)</h3>
      {front.length === 0 && <p className="text-xs text-muted-foreground">This slide is empty. Add text, an image or a shape.</p>}
      <ul className="space-y-1">
        {front.map((el, i) => {
          const Icon = ICON[el.type]
          return (
            <li key={el.id} data-testid="layer-item" data-element-id={el.id} data-selected={el.id === selectedId ? 'true' : undefined} className={cn('flex items-center gap-1 rounded-md border px-1.5 py-1 text-xs', el.id === selectedId ? 'border-primary bg-primary/5' : 'border-border bg-card')}>
              <button type="button" className="flex min-w-0 flex-1 items-center gap-1.5 text-left" onClick={() => dispatch({ type: 'selectElement', id: el.id })} aria-label={`Select ${el.name}`}>
                <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className={cn('truncate', !el.visible && 'text-muted-foreground line-through')}>{el.name}</span>
                {el.locked && <Lock className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="locked" />}
              </button>
              <button type="button" className="rounded p-1 hover:bg-muted disabled:opacity-30" aria-label={`Bring ${el.name} forward`} disabled={i === 0} onClick={() => dispatch({ type: 'layer', id: el.id, move: 'forward' })}><ArrowUp className="h-3.5 w-3.5" /></button>
              <button type="button" className="rounded p-1 hover:bg-muted disabled:opacity-30" aria-label={`Send ${el.name} backward`} disabled={i === front.length - 1} onClick={() => dispatch({ type: 'layer', id: el.id, move: 'backward' })}><ArrowDown className="h-3.5 w-3.5" /></button>
              <button type="button" className="rounded p-1 hover:bg-muted" aria-label={el.visible ? `Hide ${el.name}` : `Show ${el.name}`} onClick={() => dispatch({ type: 'updateElement', id: el.id, patch: { visible: !el.visible } })}>{el.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}</button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
