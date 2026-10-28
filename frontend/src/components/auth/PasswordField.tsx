import { useState } from 'react'
import { s } from './authStyles'

interface Props {
  id: string
  label: string                       // what the field is called, for assistive technology ("New password")
  value: string
  onChange: (value: string) => void
  autoComplete?: string
  autoFocus?: boolean
  disabled?: boolean
  initiallyShown?: boolean            // lets tests render the "revealed" state without a DOM
}

/** A password input with its own Show/Hide control. The control is a real button (keyboard reachable) that announces its state. */
export default function PasswordField({ id, label, value, onChange, autoComplete, autoFocus, disabled, initiallyShown = false }: Props) {
  const [shown, setShown] = useState(initiallyShown)
  return (
    <div style={s.fieldWrap}>
      <input
        id={id}
        style={{ ...s.input, ...s.inputWithToggle }}
        type={shown ? 'text' : 'password'}
        placeholder={label}
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        disabled={disabled}
        spellCheck={false}
        autoCapitalize="none"
        autoCorrect="off"
      />
      <button
        type="button"
        style={s.toggle}
        onClick={() => setShown((v) => !v)}
        aria-pressed={shown}
        aria-controls={id}
        aria-label={`${shown ? 'Hide' : 'Show'} ${label.toLowerCase()}`}
        data-testid={`${id}-toggle`}
      >
        {shown ? 'Hide' : 'Show'}
      </button>
    </div>
  )
}
