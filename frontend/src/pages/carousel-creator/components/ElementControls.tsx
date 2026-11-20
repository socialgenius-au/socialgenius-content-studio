import type { ReactNode } from 'react'
import { FlipHorizontal2, FlipVertical2, RotateCcw } from 'lucide-react'
import type { ColorRef, ImageAdjust, ImageElement, ShapeElement, TextElement } from '../../../lib/postDocument'
import { ADJUST_DEFAULTS, hasAdjust } from '../../../lib/carousel/adjust'
import { PLAIN_SHAPES, SHAPES, SHAPE_CATEGORIES } from '../../../lib/carousel/shapes'

const field = 'h-8 w-full rounded-md border border-border bg-background px-2 text-sm'
const tbtn = 'inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs hover:bg-muted disabled:opacity-40'
const hex = (c: string) => (/^#[0-9a-f]{6}$/i.test(c) ? c : /^#[0-9a-f]{3}$/i.test(c) ? `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}` : '#000000')

function Row({ label, children }: { label: string; children: ReactNode }) {
  return <label className="grid grid-cols-[5.5rem_1fr] items-center gap-2 text-xs"><span className="text-muted-foreground">{label}</span><span className="min-w-0">{children}</span></label>
}

type Upd = (patch: Record<string, unknown>) => void
type Rc = (c: ColorRef) => string

/** Letter spacing, italic, outline and shadow for text (the basic size, weight, alignment, colour and line height live in the main inspector). */
export function TypographyExtras({ el, upd, rc }: { el: TextElement; upd: Upd; rc: Rc }) {
  const s = el.style
  const stroke = s.stroke
  const shadow = s.shadow
  return (
    <div className="space-y-2" data-testid="typography-extras">
      <Row label="Style"><span className="flex gap-1.5">
        <button type="button" className={`${tbtn} italic ${s.italic ? 'bg-primary text-primary-foreground hover:bg-primary' : ''}`} aria-pressed={!!s.italic} aria-label="Italic" onClick={() => upd({ style: { italic: !s.italic } })} data-testid="text-italic">I</button>
      </span></Row>
      <Row label="Letter space"><input type="range" aria-label="Letter spacing" min={-1} max={10} step={0.1} value={Math.round((s.letterSpacing ?? 0) * 1000) / 10} onChange={e => upd({ style: { letterSpacing: Number(e.target.value) / 100 } })} className="w-full" data-testid="text-spacing" /></Row>
      <Row label="Outline">
        <span className="flex flex-wrap items-center gap-1.5">
          <input type="checkbox" aria-label="Outline the text" checked={!!stroke} onChange={e => upd({ style: { stroke: e.target.checked ? { color: '#000000', width: 0.004 } : undefined } })} data-testid="text-outline" />
          {stroke && <><input type="color" aria-label="Outline colour" value={hex(rc(stroke.color))} onChange={e => upd({ style: { stroke: { ...stroke, color: e.target.value } } })} className="h-8 w-12 rounded border border-border p-0.5" />
            <input type="range" aria-label="Outline width" min={0.1} max={2} step={0.05} value={Math.round(stroke.width * 1000) / 10} onChange={e => upd({ style: { stroke: { ...stroke, width: Number(e.target.value) / 100 } } })} className="w-24" /></>}
        </span>
      </Row>
      <Row label="Shadow">
        <span className="flex flex-wrap items-center gap-1.5">
          <input type="checkbox" aria-label="Add a shadow to the text" checked={!!shadow} onChange={e => upd({ style: { shadow: e.target.checked ? { color: '#000000', blur: 0.01, offsetX: 0.004, offsetY: 0.004 } : undefined } })} data-testid="text-shadow" />
          {shadow && <input type="color" aria-label="Shadow colour" value={hex(rc(shadow.color))} onChange={e => upd({ style: { shadow: { ...shadow, color: e.target.value } } })} className="h-8 w-12 rounded border border-border p-0.5" />}
        </span>
      </Row>
      {shadow && (
        <>
          <Row label="Shadow blur"><input type="range" aria-label="Shadow blur" min={0} max={5} step={0.1} value={Math.round(shadow.blur * 1000) / 10} onChange={e => upd({ style: { shadow: { ...shadow, blur: Number(e.target.value) / 100 } } })} className="w-full" /></Row>
          <Row label="Shadow x / y"><span className="flex gap-1.5">
            <input type="range" aria-label="Shadow horizontal offset" min={-3} max={3} step={0.1} value={Math.round(shadow.offsetX * 1000) / 10} onChange={e => upd({ style: { shadow: { ...shadow, offsetX: Number(e.target.value) / 100 } } })} className="w-full" />
            <input type="range" aria-label="Shadow vertical offset" min={-3} max={3} step={0.1} value={Math.round(shadow.offsetY * 1000) / 10} onChange={e => upd({ style: { shadow: { ...shadow, offsetY: Number(e.target.value) / 100 } } })} className="w-full" />
          </span></Row>
        </>
      )}
    </div>
  )
}

const ADJUST_ROWS: { key: keyof ImageAdjust; label: string; min: number; max: number; step: number; scale: number }[] = [
  { key: 'brightness', label: 'Brightness', min: 0, max: 200, step: 1, scale: 1 }, { key: 'contrast', label: 'Contrast', min: 0, max: 200, step: 1, scale: 1 },
  { key: 'saturation', label: 'Saturation', min: 0, max: 200, step: 1, scale: 1 }, { key: 'blur', label: 'Blur', min: 0, max: 5, step: 0.1, scale: 100 },
  { key: 'grayscale', label: 'Black & white', min: 0, max: 100, step: 1, scale: 1 }, { key: 'sepia', label: 'Sepia', min: 0, max: 100, step: 1, scale: 1 }, { key: 'hue', label: 'Hue shift', min: -180, max: 180, step: 1, scale: 1 },
]

/** Brightness / contrast / saturation / blur / grayscale / sepia / hue sliders with a reset. Used for pictures and picture backgrounds. */
export function AdjustControls({ adjust, onChange }: { adjust: ImageAdjust | undefined; onChange: (a: ImageAdjust | undefined) => void }) {
  const a = { ...ADJUST_DEFAULTS, ...adjust }
  return (
    <div className="space-y-2" data-testid="adjust-controls">
      {ADJUST_ROWS.map(r => (
        <Row key={r.key} label={r.label}><input type="range" aria-label={r.label} min={r.min} max={r.max} step={r.step} value={Math.round(a[r.key] * r.scale * 10) / 10} onChange={e => { const next = { ...adjust, [r.key]: Number(e.target.value) / r.scale }; onChange(hasAdjust(next) ? next : undefined) }} className="w-full" data-testid={`adjust-${r.key}`} /></Row>
      ))}
      <button type="button" className={tbtn} disabled={!hasAdjust(adjust)} onClick={() => onChange(undefined)} data-testid="adjust-reset"><RotateCcw className="h-3.5 w-3.5" />Reset adjustments</button>
    </div>
  )
}

/** Flip, trim (crop) and adjustments for a picture. */
export function ImageExtras({ el, upd }: { el: ImageElement; upd: Upd }) {
  const t = el.trim ?? { top: 0, right: 0, bottom: 0, left: 0 }
  const setTrim = (k: keyof typeof t, v: number) => { const next = { ...t, [k]: Math.max(0, Math.min(0.9, v / 100)) }; upd({ trim: next.top || next.right || next.bottom || next.left ? next : undefined }) }
  return (
    <div className="space-y-2" data-testid="image-extras">
      <Row label="Flip"><span className="flex gap-1.5">
        <button type="button" className={`${tbtn} ${el.flipX ? 'bg-primary text-primary-foreground hover:bg-primary' : ''}`} aria-pressed={!!el.flipX} aria-label="Flip horizontally" onClick={() => upd({ flipX: !el.flipX })} data-testid="flip-x"><FlipHorizontal2 className="h-4 w-4" /></button>
        <button type="button" className={`${tbtn} ${el.flipY ? 'bg-primary text-primary-foreground hover:bg-primary' : ''}`} aria-pressed={!!el.flipY} aria-label="Flip vertically" onClick={() => upd({ flipY: !el.flipY })} data-testid="flip-y"><FlipVertical2 className="h-4 w-4" /></button>
      </span></Row>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Crop (hide edges, %)</p>
      <div className="grid grid-cols-4 gap-1.5" aria-label="Crop">
        {(['top', 'right', 'bottom', 'left'] as const).map(k => (
          <label key={k} className="space-y-0.5 text-[10px] text-muted-foreground">{k}<input type="number" min={0} max={90} step={1} aria-label={`Crop ${k} percent`} className={field} value={Math.round(t[k] * 100)} onChange={e => e.target.value !== '' && setTrim(k, Number(e.target.value))} data-testid={`trim-${k}`} /></label>
        ))}
      </div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Adjustments</p>
      <AdjustControls adjust={el.adjust} onChange={a => upd({ adjust: a })} />
    </div>
  )
}

/** Which shape this is, its outline, and text inside it. */
export function ShapeExtras({ el, upd, rc }: { el: ShapeElement; upd: Upd; rc: Rc }) {
  const stroke = el.stroke
  const text = el.text
  return (
    <div className="space-y-2" data-testid="shape-extras">
      <Row label="Outline">
        <span className="flex flex-wrap items-center gap-1.5">
          <input type="checkbox" aria-label="Outline the shape" checked={!!stroke} onChange={e => upd({ stroke: e.target.checked ? { color: '#FFFFFF', width: 0.006 } : undefined })} data-testid="shape-outline" />
          {stroke && <><input type="color" aria-label="Outline colour" value={hex(rc(stroke.color))} onChange={e => upd({ stroke: { ...stroke, color: e.target.value } })} className="h-8 w-12 rounded border border-border p-0.5" />
            <input type="range" aria-label="Outline width" min={0.1} max={3} step={0.1} value={Math.round(stroke.width * 1000) / 10} onChange={e => upd({ stroke: { ...stroke, width: Number(e.target.value) / 100 } })} className="w-24" /></>}
        </span>
      </Row>
      <Row label="Text inside"><textarea className="min-h-14 w-full rounded-md border border-border bg-background p-2 text-sm" aria-label="Text inside the shape" placeholder="Type to put text in this shape" value={text?.content ?? ''} onChange={e => upd({ text: e.target.value === '' ? undefined : { content: e.target.value, style: text?.style ?? { fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif', fontSize: 0.04, fontWeight: 700, lineHeight: 1.15, align: 'center', color: '#FFFFFF' } } })} data-testid="shape-text" /></Row>
      {text && (
        <>
          <Row label="Text size"><input type="range" aria-label="Text size inside the shape" min={1.5} max={12} step={0.5} value={Math.round(text.style.fontSize * 1000) / 10} onChange={e => upd({ text: { ...text, style: { ...text.style, fontSize: Number(e.target.value) / 100 } } })} className="w-full" /></Row>
          <Row label="Text colour"><input type="color" aria-label="Text colour inside the shape" value={hex(rc(text.style.color))} onChange={e => upd({ text: { ...text, style: { ...text.style, color: e.target.value } } })} className="h-8 w-14 rounded border border-border p-0.5" /></Row>
        </>
      )}
    </div>
  )
}

/** A grouped list of every shape. */
export function ShapeSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select className={field} aria-label="Shape type" value={value} onChange={e => onChange(e.target.value)} data-testid="shape-kind">
      {SHAPE_CATEGORIES.map(cat => (
        <optgroup key={cat} label={cat}>
          {PLAIN_SHAPES.filter(p => p.category === cat).map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          {SHAPES.filter(s => s.category === cat).map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </optgroup>
      ))}
    </select>
  )
}
