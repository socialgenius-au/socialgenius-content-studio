import { useState, type Dispatch, type ReactNode } from 'react'
import { AlignCenter, AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignHorizontalSpaceBetween, AlignLeft, AlignRight, AlignStartHorizontal, AlignStartVertical, AlignVerticalSpaceBetween, ArrowDown, ArrowUp, ChevronsDown, ChevronsUp, Copy, Eye, EyeOff, Lock, Unlock, Trash2 } from 'lucide-react'
import { resolveColor, shorterSide, type Background, type ColorRef, type PostDocument, type PostElement, type PostPage } from '../../../lib/postDocument'
import { LAYOUTS, type LayoutId } from '../../../lib/carousel/layouts'
import { IMAGE_MASKS } from '../../../lib/carousel/masks'
import { useBrandTokens } from '../../../lib/carousel/brandContext'
import { BRAND } from '../../../lib/carousel/brandKit'
import type { AlignMode, AlignTo } from '../../../lib/carousel/geometry'
import type { EditorAction } from '../editorState'
import ImagePicker from './ImagePicker'
import ImageBackgroundTools from './ImageBackgroundTools'
import { ImageExtras, ShapeExtras, ShapeSelect, TypographyExtras } from './ElementControls'
import { DynamicControls, LinkControls, QrControls } from './InfoControls'

export const FONT_STACKS: { label: string; value: string }[] = [
  { label: 'Inter', value: 'Inter, ui-sans-serif, system-ui, sans-serif' },
  { label: 'Montserrat', value: 'Montserrat, Inter, ui-sans-serif, system-ui, sans-serif' },
  { label: 'Poppins', value: 'Poppins, Inter, ui-sans-serif, system-ui, sans-serif' },
  { label: 'Georgia (serif)', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Courier (mono)', value: '"Courier New", ui-monospace, monospace' },
]

export const fontStack = (family: string) => `"${family.replace(/"/g, '')}", Inter, ui-sans-serif, system-ui, sans-serif`

const field = 'h-8 w-full rounded-md border border-border bg-background px-2 text-sm'
const tbtn = 'inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card hover:bg-muted disabled:opacity-40'

function Row({ label, children }: { label: string; children: ReactNode }) {
  return <label className="grid grid-cols-[5.5rem_1fr] items-center gap-2 text-xs"><span className="text-muted-foreground">{label}</span><span className="min-w-0">{children}</span></label>
}

const hex = (c: string) => (/^#[0-9a-f]{6}$/i.test(c) ? c : /^#[0-9a-f]{3}$/i.test(c) ? `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}` : '#000000')
const pctOf = (n: number) => Math.round(n * 1000) / 10
const toFrac = (v: string, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, Number(v) / 100))

function NumField({ value, onChange, min = 0, max = 100, step = 0.5, label, disabled }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; label: string; disabled?: boolean }) {
  return <input type="number" aria-label={label} className={field} value={Number.isFinite(value) ? value : 0} min={min} max={max} step={step} disabled={disabled} onChange={e => { if (e.target.value !== '') onChange(Number(e.target.value)) }} />
}

function SwatchRow({ swatches, onPick, label }: { swatches: { label: string; ref: ColorRef; hex: string }[]; onPick: (ref: ColorRef) => void; label: string }) {
  if (swatches.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-1" aria-label={label} data-testid="brand-swatches">
      {swatches.map(s => <button key={s.label + s.hex} type="button" title={`${s.label} ${s.hex}`} aria-label={`Use brand colour ${s.label}`} onClick={() => onPick(s.ref)} className="h-5 w-5 rounded-full border border-border" style={{ background: s.hex }} />)}
    </div>
  )
}

export interface InspectorProps {
  doc: PostDocument
  page: PostPage
  selected: PostElement | undefined
  /** Every selected element; with two or more the inspector offers align / distribute / group instead of single-element settings. */
  selectedIds?: string[]
  /** Brand Kit colours to offer as one-click swatches (they follow the kit), and the kit's custom font families. */
  swatches?: { label: string; ref: ColorRef; hex: string }[]
  kitFonts?: string[]
  dispatch: Dispatch<EditorAction>
}

/** Properties of the open slide (name, layout, background) and of the selected element (position, text, image, shape, layering). */
export default function Inspector({ doc, page, selected, selectedIds, swatches = [], kitFonts = [], dispatch }: InspectorProps) {
  const tokens = useBrandTokens()
  const rc = (c: ColorRef) => resolveColor(c, tokens)
  const [layout, setLayout] = useState<LayoutId>('title_body')
  const [manyPicker, setManyPicker] = useState(false)
  const [alignTo, setAlignTo] = useState<AlignTo>('selection')
  const count = selectedIds?.length ?? (selected ? 1 : 0)
  const [bgPicker, setBgPicker] = useState(false)
  const bg = page.background
  const solid = bg.kind === 'solid' ? hex(rc(bg.color)) : '#1E4D2B'
  const setBg = (b: Background) => dispatch({ type: 'setBackground', background: b })
  const upd = (patch: Record<string, unknown>) => selected && dispatch({ type: 'updateElement', id: selected.id, patch: patch as never })
  const S = shorterSide(doc)

  return (
    <div className="space-y-4" data-testid="inspector">
      <section aria-label="Slide settings" className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Slide</h3>
        <Row label="Name"><input className={field} aria-label="Slide name" value={page.name ?? ''} placeholder="Untitled slide" onChange={e => dispatch({ type: 'renameSlide', id: page.id, name: e.target.value })} data-testid="slide-name" /></Row>
        <Row label="Background">
          <span className="flex items-center gap-1.5">
            <input type="color" aria-label="Background colour" value={solid} onChange={e => setBg({ kind: 'solid', color: e.target.value })} className="h-8 w-10 shrink-0 rounded border border-border bg-background p-0.5" data-testid="bg-color" />
            <button type="button" className="h-8 flex-1 rounded-md border border-border text-xs hover:bg-muted" onClick={() => setBg({ kind: 'gradient', angle: 160, stops: [{ offset: 0, color: solid }, { offset: 1, color: '#000000' }] })} data-testid="bg-gradient">Gradient</button>
            <button type="button" className="h-8 flex-1 rounded-md border border-border text-xs hover:bg-muted" onClick={() => setBgPicker(v => !v)} data-testid="bg-image">Image</button>
          </span>
        </Row>
        <SwatchRow swatches={swatches} label="Brand colours for the background" onPick={ref => setBg({ kind: 'solid', color: ref })} />
        {bg.kind === 'gradient' && (
          <Row label="Gradient">
            <span className="flex items-center gap-1.5">
              {bg.stops.slice(0, 2).map((s, i) => (
                <input key={i} type="color" aria-label={`Gradient colour ${i + 1}`} value={hex(rc(s.color))} onChange={e => setBg({ ...bg, stops: bg.stops.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)) })} className="h-8 w-10 rounded border border-border p-0.5" />
              ))}
              <NumField label="Gradient angle" value={bg.angle} min={0} max={360} step={5} onChange={v => setBg({ ...bg, angle: v })} />
            </span>
          </Row>
        )}
        {bg.kind === 'image' && (
          <Row label="Image fit"><select className={field} aria-label="Background image fit" value={bg.fit} onChange={e => setBg({ ...bg, fit: e.target.value as 'cover' | 'contain' })}><option value="cover">Fill (crop)</option><option value="contain">Fit inside</option></select></Row>
        )}
        {bgPicker && <ImagePicker onPick={img => { setBg({ kind: 'image', source: { kind: 'asset', assetId: img.assetId, url: img.url }, fit: 'cover' }); setBgPicker(false) }} />}
        <Row label="Layout">
          <span className="flex items-center gap-1.5">
            <select className={field} aria-label="Layout to apply" value={layout} onChange={e => setLayout(e.target.value as LayoutId)} data-testid="apply-layout-select">{LAYOUTS.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}</select>
            <button type="button" className="h-8 shrink-0 rounded-md border border-border px-2 text-xs font-medium hover:bg-muted" onClick={() => { if (page.elements.length === 0 || window.confirm('Replace this slide’s content with the sample layout? You can undo this.')) dispatch({ type: 'applyLayout', layout }) }} data-testid="apply-layout">Apply</button>
          </span>
        </Row>
      </section>

      <section aria-label="Element settings" className="space-y-2 border-t border-border pt-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{selected ? selected.name : 'Element'}</h3>
        {!selected && <p className="text-xs text-muted-foreground" data-testid="no-selection">Select an element on the slide to edit it, or add one below.</p>}
        <div className="flex flex-wrap gap-1.5" data-testid="add-elements">
          <button type="button" className="h-8 rounded-md border border-border px-2.5 text-xs font-medium hover:bg-muted" onClick={() => dispatch({ type: 'addElement', kind: 'text' })} data-testid="add-text">+ Text</button>
          <button type="button" className="h-8 rounded-md border border-border px-2.5 text-xs font-medium hover:bg-muted" onClick={() => dispatch({ type: 'addElement', kind: 'image' })} data-testid="add-image">+ Image</button>
          <button type="button" className="h-8 rounded-md border border-border px-2.5 text-xs font-medium hover:bg-muted" aria-expanded={manyPicker} onClick={() => setManyPicker(v => !v)} data-testid="add-images">+ Pictures</button>
          <button type="button" className="h-8 rounded-md border border-border px-2.5 text-xs font-medium hover:bg-muted" onClick={() => dispatch({ type: 'addElement', kind: 'shape' })} data-testid="add-shape">+ Shape</button>
        </div>

        {manyPicker && <ImagePicker onPick={() => undefined} onPickMany={imgs => { dispatch({ type: 'addImages', items: imgs }); setManyPicker(false) }} />}

        {count >= 2 && (
          <div className="space-y-2 rounded-md border border-border p-2" data-testid="multi-panel">
            <p className="text-xs font-medium">{count} elements selected</p>
            <Row label="Align to"><select className={field} aria-label="Align relative to" value={alignTo} onChange={e => setAlignTo(e.target.value as AlignTo)} data-testid="align-to"><option value="selection">Each other</option><option value="canvas">The slide</option></select></Row>
            <div className="flex flex-wrap gap-1.5" aria-label="Align">
              {([['left', AlignStartVertical, 'Align left'], ['center', AlignCenterVertical, 'Align centres horizontally'], ['right', AlignEndVertical, 'Align right'], ['top', AlignStartHorizontal, 'Align top'], ['middle', AlignCenterHorizontal, 'Align middles vertically'], ['bottom', AlignEndHorizontal, 'Align bottom']] as [AlignMode, typeof AlignLeft, string][]).map(([mode, Icon, label]) => (
                <button key={mode} type="button" className={tbtn} title={label} aria-label={label} onClick={() => dispatch({ type: 'align', mode, to: alignTo })} data-testid={`align-${mode}`}><Icon className="h-4 w-4" /></button>
              ))}
              <button type="button" className={tbtn} title="Space evenly across" aria-label="Distribute horizontally" disabled={count < 3} onClick={() => dispatch({ type: 'distribute', axis: 'horizontal' })} data-testid="distribute-h"><AlignHorizontalSpaceBetween className="h-4 w-4" /></button>
              <button type="button" className={tbtn} title="Space evenly down" aria-label="Distribute vertically" disabled={count < 3} onClick={() => dispatch({ type: 'distribute', axis: 'vertical' })} data-testid="distribute-v"><AlignVerticalSpaceBetween className="h-4 w-4" /></button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" className="h-8 rounded-md border border-border px-2.5 text-xs font-medium hover:bg-muted" onClick={() => dispatch({ type: 'group' })} data-testid="multi-group">Group</button>
              <button type="button" className="h-8 rounded-md border border-border px-2.5 text-xs font-medium text-destructive hover:bg-muted" onClick={() => dispatch({ type: 'deleteSelected' })} data-testid="multi-delete">Delete selected</button>
            </div>
            <p className="text-[11px] text-muted-foreground">Distribute needs three or more elements. Locked elements are never moved.</p>
          </div>
        )}

        {selected && count <= 1 && (
          <>
            <div className="flex flex-wrap gap-1.5" aria-label="Element actions">
              <button type="button" className={tbtn} title="Bring to front" aria-label="Bring to front" onClick={() => dispatch({ type: 'layer', id: selected.id, move: 'front' })}><ChevronsUp className="h-4 w-4" /></button>
              <button type="button" className={tbtn} title="Forward" aria-label="Move forward" onClick={() => dispatch({ type: 'layer', id: selected.id, move: 'forward' })}><ArrowUp className="h-4 w-4" /></button>
              <button type="button" className={tbtn} title="Backward" aria-label="Move backward" onClick={() => dispatch({ type: 'layer', id: selected.id, move: 'backward' })}><ArrowDown className="h-4 w-4" /></button>
              <button type="button" className={tbtn} title="Send to back" aria-label="Send to back" onClick={() => dispatch({ type: 'layer', id: selected.id, move: 'back' })}><ChevronsDown className="h-4 w-4" /></button>
              <button type="button" className={tbtn} title="Duplicate" aria-label="Duplicate element" onClick={() => dispatch({ type: 'duplicateElement', id: selected.id })} data-testid="el-duplicate"><Copy className="h-4 w-4" /></button>
              <button type="button" className={tbtn} title={selected.visible ? 'Hide' : 'Show'} aria-label={selected.visible ? 'Hide element' : 'Show element'} onClick={() => upd({ visible: !selected.visible })}>{selected.visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}</button>
              <button type="button" className={tbtn} title={selected.locked ? 'Unlock' : 'Lock'} aria-label={selected.locked ? 'Unlock element' : 'Lock element'} onClick={() => upd({ locked: !selected.locked })}>{selected.locked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}</button>
              <button type="button" className={`${tbtn} text-destructive`} title="Delete" aria-label="Delete element" onClick={() => dispatch({ type: 'deleteElement', id: selected.id })} data-testid="el-delete"><Trash2 className="h-4 w-4" /></button>
            </div>

            <Row label="Name"><input className={field} aria-label="Element name" value={selected.name} onChange={e => upd({ name: e.target.value })} /></Row>

            {selected.type === 'text' && (
              <>
                <DynamicControls el={selected} upd={upd} />
                <Row label="Text"><textarea className="min-h-20 w-full rounded-md border border-border bg-background p-2 text-sm" aria-label="Text content" value={selected.content} onChange={e => upd({ content: e.target.value })} data-testid="text-content" /></Row>
                <Row label="Font"><select className={field} aria-label="Font" value={typeof selected.style.fontFamily === 'object' ? `token:${selected.style.fontFamily.token}` : FONT_STACKS.find(f => f.value === selected.style.fontFamily)?.value ?? (kitFonts.map(k => fontStack(k)).find(v => v === selected.style.fontFamily) ?? (typeof selected.style.fontFamily === 'string' ? selected.style.fontFamily : FONT_STACKS[0].value))} onChange={e => { const v = e.target.value; upd({ style: { fontFamily: v.startsWith('token:') ? { token: v.slice(6), fallback: typeof selected.style.fontFamily === 'string' ? selected.style.fontFamily : selected.style.fontFamily.fallback } : v } }) }}>
                  {tokens && <optgroup label="Brand Kit"><option value={`token:${BRAND.fontHeading}`}>Brand heading font</option><option value={`token:${BRAND.fontBody}`}>Brand body font</option>{kitFonts.map(k => <option key={k} value={fontStack(k)}>{k}</option>)}</optgroup>}
                  {typeof selected.style.fontFamily === 'string' && !FONT_STACKS.some(f => f.value === selected.style.fontFamily) && <option value={selected.style.fontFamily}>Custom</option>}
                  {FONT_STACKS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}</select></Row>
                <Row label={`Size (≈${Math.round(selected.style.fontSize * S)}px)`}><input type="range" aria-label="Text size" min={2} max={24} step={0.5} value={pctOf(selected.style.fontSize)} onChange={e => upd({ style: { fontSize: toFrac(e.target.value, 0.01, 0.4) } })} className="w-full" data-testid="text-size" /></Row>
                <Row label="Weight"><select className={field} aria-label="Font weight" value={selected.style.fontWeight} onChange={e => upd({ style: { fontWeight: Number(e.target.value) } })}>{[300, 400, 500, 600, 700, 800, 900].map(w => <option key={w} value={w}>{w}</option>)}</select></Row>
                <Row label="Align">
                  <span className="flex gap-1.5">
                    {(['left', 'center', 'right'] as const).map(a => {
                      const Icon = a === 'left' ? AlignLeft : a === 'center' ? AlignCenter : AlignRight
                      return <button key={a} type="button" aria-label={`Align ${a}`} aria-pressed={selected.style.align === a} className={`${tbtn} ${selected.style.align === a ? 'bg-primary text-primary-foreground hover:bg-primary' : ''}`} onClick={() => upd({ style: { align: a } })}><Icon className="h-4 w-4" /></button>
                    })}
                  </span>
                </Row>
                <Row label="Colour"><span className="flex flex-wrap items-center gap-1.5"><input type="color" aria-label="Text colour" value={hex(rc(selected.style.color))} onChange={e => upd({ style: { color: e.target.value } })} className="h-8 w-14 rounded border border-border p-0.5" data-testid="text-color" /><SwatchRow swatches={swatches} label="Brand colours for the text" onPick={ref => upd({ style: { color: ref } })} /></span></Row>
                <Row label="Line height"><input type="range" aria-label="Line height" min={0.9} max={2} step={0.05} value={selected.style.lineHeight} onChange={e => upd({ style: { lineHeight: Number(e.target.value) } })} className="w-full" /></Row>
                <TypographyExtras el={selected} upd={upd} rc={rc} />
                <Row label="Button style">
                  <span className="flex items-center gap-1.5">
                    <input type="checkbox" aria-label="Give the text a filled background" checked={!!selected.box?.fill} onChange={e => upd({ box: e.target.checked ? { fill: '#E8B04A', radius: 0.03, paddingX: 0.04, paddingY: 0.02 } : undefined, autoSize: e.target.checked ? 'auto-width' : 'auto-height' })} />
                    {selected.box?.fill && typeof selected.box.fill === 'string' && <input type="color" aria-label="Background colour of the text" value={hex(selected.box.fill)} onChange={e => upd({ box: { ...selected.box, fill: e.target.value } })} className="h-8 w-14 rounded border border-border p-0.5" />}
                  </span>
                </Row>
              </>
            )}

            {selected.type === 'image' && (
              <>
                <QrControls el={selected} upd={upd} />
                <Row label="Fit"><select className={field} aria-label="Image fit" value={selected.fit} onChange={e => upd({ fit: e.target.value })}><option value="cover">Fill (crop)</option><option value="contain">Fit inside</option></select></Row>
                <Row label="Alt text"><input className={field} aria-label="Image description" value={selected.alt ?? ''} placeholder="Describe the picture" onChange={e => upd({ alt: e.target.value })} /></Row>
                <Row label="Corners"><input type="range" aria-label="Corner radius" min={0} max={12} step={0.5} value={pctOf(selected.cornerRadius ?? 0)} onChange={e => upd({ cornerRadius: toFrac(e.target.value, 0, 0.5) })} className="w-full" /></Row>
                <Row label="Shape"><select className={field} aria-label="Image mask" value={selected.mask ?? 'none'} onChange={e => upd({ mask: e.target.value })} data-testid="image-mask">{IMAGE_MASKS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</select></Row>
                {selected.fit === 'cover' && (
                  <>
                    <Row label={`Zoom ${(selected.zoom ?? 1).toFixed(1)}x`}><input type="range" aria-label="Image zoom" min={1} max={4} step={0.1} value={selected.zoom ?? 1} onChange={e => upd({ zoom: Number(e.target.value) })} className="w-full" data-testid="image-zoom" /></Row>
                    <Row label="Pan left-right"><input type="range" aria-label="Image focus horizontal" min={0} max={100} step={1} value={Math.round((selected.focal?.x ?? 0.5) * 100)} onChange={e => upd({ focal: { x: Number(e.target.value) / 100, y: selected.focal?.y ?? 0.5 } })} className="w-full" data-testid="image-focus-x" /></Row>
                    <Row label="Pan up-down"><input type="range" aria-label="Image focus vertical" min={0} max={100} step={1} value={Math.round((selected.focal?.y ?? 0.5) * 100)} onChange={e => upd({ focal: { x: selected.focal?.x ?? 0.5, y: Number(e.target.value) / 100 } })} className="w-full" data-testid="image-focus-y" /></Row>
                  </>
                )}
                <ImageExtras el={selected} upd={upd} />
                <ImageBackgroundTools element={selected} canvasWidth={doc.format.width} canvasHeight={doc.format.height} update={upd} />
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Replace this picture</p>
                <ImagePicker onPick={img => upd({ source: { kind: 'asset', assetId: img.assetId, url: img.url }, alt: selected.alt || img.name })} />
              </>
            )}

            {selected.type === 'shape' && (
              <>
                <Row label="Shape"><ShapeSelect value={selected.shape} onChange={v => upd({ shape: v })} /></Row>
                <Row label="Fill"><span className="flex flex-wrap items-center gap-1.5"><input type="color" aria-label="Fill colour" value={hex(typeof selected.fill === 'string' ? selected.fill : selected.fill && 'token' in (selected.fill as object) ? rc(selected.fill as ColorRef) : '#1E8A55')} onChange={e => upd({ fill: e.target.value })} className="h-8 w-14 rounded border border-border p-0.5" data-testid="shape-fill" /><SwatchRow swatches={swatches} label="Brand colours for the fill" onPick={ref => upd({ fill: ref })} /></span></Row>
                <Row label="Corners"><input type="range" aria-label="Corner radius" min={0} max={20} step={0.5} value={pctOf(selected.cornerRadius ?? 0)} onChange={e => upd({ cornerRadius: toFrac(e.target.value, 0, 0.5) })} className="w-full" /></Row>
                <ShapeExtras el={selected} upd={upd} rc={rc} />
              </>
            )}

            <div className="grid grid-cols-2 gap-x-3 gap-y-2" aria-label="Position and size">
              <Row label="X %"><NumField label="X position percent" value={pctOf(selected.x)} onChange={v => upd({ x: v / 100 })} /></Row>
              <Row label="Y %"><NumField label="Y position percent" value={pctOf(selected.y)} onChange={v => upd({ y: v / 100 })} /></Row>
              <Row label="Width %"><NumField label="Width percent" value={pctOf(selected.width)} min={1} onChange={v => upd({ width: v / 100 })} /></Row>
              <Row label="Height %">{selected.height === 'auto' ? <span className="text-xs text-muted-foreground">auto</span> : <NumField label="Height percent" value={pctOf(selected.height)} min={1} onChange={v => upd({ height: v / 100 })} />}</Row>
              <Row label="Rotate °"><span className="flex items-center gap-1.5"><input type="range" aria-label="Rotation slider" min={-180} max={180} step={1} value={selected.rotation} onChange={e => upd({ rotation: Number(e.target.value) })} className="min-w-0 flex-1" data-testid="rotation" /><NumField label="Rotation degrees" value={selected.rotation} min={-180} max={180} step={1} onChange={v => upd({ rotation: v })} /></span></Row>
              <Row label={`Opacity ${Math.round(selected.opacity * 100)}%`}><input type="range" aria-label="Opacity" min={0} max={100} step={1} value={Math.round(selected.opacity * 100)} onChange={e => upd({ opacity: Number(e.target.value) / 100 })} className="w-full" data-testid="opacity" /></Row>
            </div>
            <LinkControls el={selected} upd={upd} />
          </>
        )}
      </section>
    </div>
  )
}
