import { useState, type KeyboardEvent } from 'react'
import { Plus, X } from 'lucide-react'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'

interface EditableTagListProps {
  items: string[]
  onChange: (items: string[]) => void
  placeholder?: string
  variant?: BadgeProps['variant']
  empty?: string
}

export function EditableTagList({ items, onChange, placeholder = 'Add…', variant = 'outline', empty = 'Not yet defined.' }: EditableTagListProps) {
  const [draft, setDraft] = useState('')

  const add = () => {
    const trimmed = draft.trim()
    if (!trimmed || items.includes(trimmed)) return
    onChange([...items, trimmed])
    setDraft('')
  }
  const remove = (item: string) => onChange(items.filter(i => i !== item))
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      add()
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {items.length === 0 && <p className="text-xs italic text-muted-foreground">{empty}</p>}
      <div className="flex flex-wrap gap-1.5">
        {items.map(i => (
          <Badge key={i} variant={variant} className="gap-1 pr-1">
            {i}
            <button type="button" onClick={() => remove(i)} className="rounded-full hover:bg-black/10">
              <X className="h-2.5 w-2.5" />
            </button>
          </Badge>
        ))}
      </div>
      <div className="flex items-center gap-1.5">
        <Input value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={onKeyDown} placeholder={placeholder} className="h-7 max-w-56 text-xs" />
        <button type="button" onClick={add} disabled={!draft.trim()} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-input text-muted-foreground hover:bg-muted disabled:opacity-40">
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
