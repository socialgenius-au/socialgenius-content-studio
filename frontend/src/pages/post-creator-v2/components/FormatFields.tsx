// Reusable, state-bound controls for the shared platform/format selection. Every stage renders THESE (never its own copy of a platform list),
// so Brief, References, Create and Review can never disagree.
import { useEffect, useState } from 'react'
import { MAX_CUSTOM_SIZE, MIN_CUSTOM_SIZE, postLabel } from '../../../lib/platformFormats'
import { usePostFormat } from '../format/PostFormatContext'

export function PlatformSelect({ testId = 'pcv2-platform-select', ariaLabel = 'Platform' }: { testId?: string; ariaLabel?: string }) {
  const { state, platforms, selectPlatform } = usePostFormat()
  return (
    <select className="pcv2-select" data-testid={testId} aria-label={ariaLabel} value={state.selection.platformKey} onChange={e => selectPlatform(e.target.value)}>
      {platforms.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
    </select>
  )
}

export function FormatSelect({ testId = 'pcv2-format-select', ariaLabel = 'Format' }: { testId?: string; ariaLabel?: string }) {
  const { state, formats, selectFormat } = usePostFormat()
  return (
    <select className="pcv2-select" data-testid={testId} aria-label={ariaLabel} value={state.selection.formatKey} onChange={e => selectFormat(e.target.value)}>
      {formats.map(f => <option key={f.key} value={f.key}>{f.ratio === 'CUSTOM' ? `${postLabel(f)} (any size)` : `${postLabel(f)} — ${f.width} × ${f.height} (${f.ratio})`}</option>)}
    </select>
  )
}

/** Width × height inputs, shown only for a Custom placement. Typing is free-form; a valid number is committed (clamped) on blur / Enter. */
export function CustomSizeInputs() {
  const { canvas, setCustomSize } = usePostFormat()
  const [w, setW] = useState(String(canvas.width))
  const [h, setH] = useState(String(canvas.height))
  useEffect(() => { setW(String(canvas.width)); setH(String(canvas.height)) }, [canvas.width, canvas.height])
  if (!canvas.isCustom) return null
  const commit = () => {
    const nw = Number(w), nh = Number(h)
    if (Number.isFinite(nw) && Number.isFinite(nh) && nw > 0 && nh > 0) setCustomSize({ width: nw, height: nh })
    else { setW(String(canvas.width)); setH(String(canvas.height)) }
  }
  const onKey = (e: React.KeyboardEvent) => { if (e.key === 'Enter') commit() }
  return (
    <span className="pcv2-custom-size" data-testid="pcv2-custom-size">
      <input className="pcv2-input" type="number" min={MIN_CUSTOM_SIZE} max={MAX_CUSTOM_SIZE} aria-label="Custom width" data-testid="pcv2-custom-width" value={w} onChange={e => setW(e.target.value)} onBlur={commit} onKeyDown={onKey} />
      <span aria-hidden>×</span>
      <input className="pcv2-input" type="number" min={MIN_CUSTOM_SIZE} max={MAX_CUSTOM_SIZE} aria-label="Custom height" data-testid="pcv2-custom-height" value={h} onChange={e => setH(e.target.value)} onBlur={commit} onKeyDown={onKey} />
    </span>
  )
}

/** "1080 × 1350 · 4:5" */
export function sizeReadout(c: { width: number; height: number; ratioLabel: string }): string {
  return `${c.width} × ${c.height} · ${c.ratioLabel}`
}
