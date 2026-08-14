import { useEffect, useRef, useState } from 'react'
import { Pencil } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

interface EditableFieldProps {
  value: string
  onChange: (value: string) => void
  multiline?: boolean
  placeholder?: string
  className?: string
  textClassName?: string
}

export function EditableField({ value, onChange, multiline, placeholder, className, textClassName }: EditableFieldProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const ref = useRef<HTMLInputElement | HTMLTextAreaElement>(null)

  useEffect(() => {
    if (editing) ref.current?.focus()
  }, [editing])

  const commit = () => {
    setEditing(false)
    const trimmed = draft.trim()
    if (trimmed !== value) onChange(trimmed)
  }
  const cancel = () => {
    setDraft(value)
    setEditing(false)
  }

  if (editing) {
    const Comp = multiline ? Textarea : Input
    return (
      <Comp
        ref={ref as never}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter' && !multiline) commit()
          if (e.key === 'Escape') cancel()
        }}
        placeholder={placeholder}
        className={cn('text-sm', className)}
        rows={multiline ? 3 : undefined}
      />
    )
  }

  return (
    <button
      type="button"
      onClick={() => {
        setDraft(value)
        setEditing(true)
      }}
      className={cn('group flex w-full items-start gap-1.5 rounded-md px-1.5 py-1 text-left hover:bg-muted/60', className)}
    >
      <span className={cn('flex-1 text-sm', !value && 'italic text-muted-foreground', textClassName)}>
        {value || placeholder || 'Not yet defined.'}
      </span>
      <Pencil className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" />
    </button>
  )
}
