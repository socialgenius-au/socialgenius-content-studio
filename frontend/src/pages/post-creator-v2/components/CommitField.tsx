import { useEffect, useRef, useState } from 'react'

interface Props {
  value: string
  onCommit: (v: string) => void
  multiline?: boolean
  placeholder?: string
  ariaLabel?: string
  testId?: string
  maxLength?: number
  rows?: number
}

/**
 * A text box that keeps what you type in its own state and saves it a moment after you stop (or when you leave the box), so typing is never interrupted by a save and the undo history gets
 * one entry per edit, not one per key. It shows the saved value again whenever the post is reloaded from the server.
 */
export default function CommitField({ value, onCommit, multiline, placeholder, ariaLabel, testId, maxLength = 4000, rows = 3 }: Props) {
  const [local, setLocal] = useState(value)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef({ local, value, onCommit })
  latest.current = { local, value, onCommit }
  useEffect(() => { setLocal(value) }, [value])
  const flush = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null } if (latest.current.local !== latest.current.value) latest.current.onCommit(latest.current.local) }
  useEffect(() => () => flush(), [])           // eslint-disable-line react-hooks/exhaustive-deps -- commit on leaving the stage
  const change = (v: string) => { setLocal(v); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(flush, 600) }
  return multiline
    ? <textarea className="pcv2-textarea" rows={rows} value={local} placeholder={placeholder} aria-label={ariaLabel} data-testid={testId} maxLength={maxLength} onChange={e => change(e.target.value)} onBlur={flush} />
    : <input className="pcv2-input" value={local} placeholder={placeholder} aria-label={ariaLabel} data-testid={testId} maxLength={maxLength} onChange={e => change(e.target.value)} onBlur={flush} />
}
