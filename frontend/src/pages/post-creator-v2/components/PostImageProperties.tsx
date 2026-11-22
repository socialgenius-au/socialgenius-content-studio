import { useState, type ReactNode } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ChevronDown, Circle, Image, Layers, MoreHorizontal, Scan, Square, Trash2, Type, Upload } from 'lucide-react'
import { withMediaToken } from '../../../api/mediaAccess'
import type { ImageElement } from '../../../lib/postDocument'
import ImagePicker, { type PickedImage } from '../../carousel-creator/components/ImagePicker'
import { AdjustControls, ImageExtras } from '../../carousel-creator/components/ElementControls'

export type ImagePanel = 'image' | 'crop' | 'position' | 'effects'

export function PropertySection({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return <details className="sg-post-property-section">
    <summary>{icon}<span>{title}</span><ChevronDown size={17}/></summary>
    <div>{children}</div>
  </details>
}

export default function PostImageProperties({ image, panel, update, replace, addText, remove, order }: {
  image: ImageElement
  panel: ImagePanel
  update: (patch: Partial<ImageElement>) => void
  replace: (asset: PickedImage) => void
  addText: () => void
  remove: () => void
  order: (move: 'forward' | 'backward' | 'front' | 'back') => void
}) {
  const [replaceOpen, setReplaceOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const focal = image.focal ?? { x: .5, y: .5 }
  const pan = (x: number, y: number) => update({ focal: { x: Math.max(0, Math.min(1, focal.x + x)), y: Math.max(0, Math.min(1, focal.y + y)) } })
  const url = image.source.kind === 'asset' && image.source.url
  const position = <div className="sg-post-number-grid">
    {(['x', 'y', 'width', 'height', 'rotation'] as const).map(key => {
      const value = image[key]
      const scale = key === 'rotation' ? 1 : 100
      return <label key={key}>{({ x: 'X (%)', y: 'Y (%)', width: 'Width (%)', height: 'Height (%)', rotation: 'Rotation (°)' })[key]}
        <input type="number" step="any" value={value === 'auto' ? '' : Number((value * scale).toFixed(2))} onChange={e => {
          if (e.target.value !== '' && e.target.validity.valid) update({ [key]: Number(e.target.value) / scale })
        }}/>
      </label>
    })}
  </div>
  if (panel === 'effects') return <><h3>Image effects</h3><AdjustControls adjust={image.adjust} onChange={adjust => update({ adjust })}/></>
  if (panel === 'crop') return <><h3>Crop & flip</h3><ImageExtras el={image} upd={update}/></>
  if (panel === 'position') return <><h3>Position & size</h3>{position}<div className="sg-post-property-actions">{(['forward', 'backward', 'front', 'back'] as const).map(move => <button key={move} onClick={() => order(move)}>{move}</button>)}</div></>

  return <>
    <h3>Image / Video</h3>
    <div className="sg-post-image-actions">
      <div className="sg-post-image-thumb">{url ? <img src={withMediaToken(url)} alt={image.alt ?? image.name}/> : <Image size={24}/>}</div>
      <button type="button" disabled={image.locked} aria-expanded={replaceOpen} onClick={() => setReplaceOpen(v => !v)}><Upload size={18}/> Replace</button>
      <button type="button" disabled={image.locked} aria-label="Delete selected element" onClick={remove}><Trash2 size={19}/></button>
      <button type="button" aria-label="More image properties" aria-expanded={moreOpen} onClick={() => setMoreOpen(v => !v)}><MoreHorizontal size={20}/></button>
    </div>
    {replaceOpen && <ImagePicker onPick={asset => { replace(asset); setReplaceOpen(false) }}/>}
    {moreOpen && <label className="sg-post-field">Image description<input value={image.alt ?? ''} onChange={e => update({ alt: e.target.value })}/></label>}
    <h4 className="sg-post-fit-title">Fit inside shape</h4>
    <div className="sg-post-fit">
      <button type="button" disabled={image.locked} aria-pressed={image.fit === 'cover'} onClick={() => update({ fit: 'cover' })}>Fill<small>(Crop to fit)</small></button>
      <button type="button" disabled={image.locked} aria-pressed={image.fit === 'contain'} onClick={() => update({ fit: 'contain' })}>Fit<small>(Show whole)</small></button>
    </div>
    <label className="sg-post-field">Zoom<span className="sg-post-image-zoom"><input type="range" aria-label="Image zoom" min="1" max="4" step=".01" disabled={image.locked || image.fit !== 'cover'} value={image.zoom ?? 1} onChange={e => update({ zoom: Number(e.target.value) })}/><output>{Math.round((image.zoom ?? 1) * 100)}%</output></span></label>
    <div className="sg-post-pan"><strong>Position</strong><div>
      <button type="button" aria-label="Pan image up" onClick={() => pan(0, -.05)}><ArrowUp size={15}/></button>
      <button type="button" aria-label="Pan image left" onClick={() => pan(-.05, 0)}><ArrowLeft size={15}/></button>
      <button type="button" aria-label="Centre image" onClick={() => update({ focal: { x: .5, y: .5 } })}><Image size={20}/></button>
      <button type="button" aria-label="Pan image right" onClick={() => pan(.05, 0)}><ArrowRight size={15}/></button>
      <button type="button" aria-label="Pan image down" onClick={() => pan(0, .05)}><ArrowDown size={15}/></button>
    </div></div>
    <PropertySection title="Text" icon={<Type size={18}/>}><div className="sg-post-property-actions"><button type="button" onClick={addText}>Add text layer</button></div></PropertySection>
    <PropertySection title="Shape" icon={<Square size={18}/>}> <label className="sg-post-field">Mask<select value={image.mask ?? 'none'} onChange={e => update({ mask: e.target.value as ImageElement['mask'] })}><option value="none">Rectangle</option><option value="circle">Circle</option><option value="rounded">Rounded</option><option value="diamond">Diamond</option></select></label></PropertySection>
    <PropertySection title="Border" icon={<Square size={18}/>}><label className="sg-post-field">Corner radius<input type="range" min="0" max=".25" step=".005" value={image.cornerRadius ?? 0} onChange={e => update({ cornerRadius: Number(e.target.value) })}/></label></PropertySection>
    <PropertySection title="Shadow" icon={<Circle size={18}/>}><label className="sg-post-field">Shadow strength<input type="range" min="0" max=".06" step=".002" value={image.shadow ?? 0} onChange={e => update({ shadow: Number(e.target.value) })}/></label></PropertySection>
    <PropertySection title="Transparency" icon={<Circle size={18}/>}><label className="sg-post-field">Opacity<input type="range" min="0" max="1" step=".01" value={image.opacity} onChange={e => update({ opacity: Number(e.target.value) })}/></label></PropertySection>
    <PropertySection title="Position & Size" icon={<Scan size={18}/>}>{position}</PropertySection>
    <PropertySection title="Layer (Forward / Backward)" icon={<Layers size={20}/>}><div className="sg-post-property-actions">{(['forward', 'backward', 'front', 'back'] as const).map(move => <button key={move} onClick={() => order(move)}>{move}</button>)}</div></PropertySection>
  </>
}
