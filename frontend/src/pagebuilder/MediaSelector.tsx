import { useRef, useState } from 'react'

/**
 * Extensible media-source picker (Visual Editor V1, Section 11 of the brief).
 *
 * Today only "Upload from device" is wired up. The other sources are declared here as disabled
 * menu entries so the SHAPE of the picker already exists — adding a real source later (Content
 * Studio Media, Pexels, Pixabay, AI Find, AI Generate) means implementing one `onSelect` handler
 * and flipping `disabled: false` on its entry, not rebuilding this component or its callers
 * (PropertyPanel's element-image and section-background panels both use this one component).
 */
export type MediaSource = 'upload' | 'content-studio' | 'pexels' | 'pixabay' | 'ai-find' | 'ai-generate'

const SOURCES: { id: MediaSource; label: string; enabled: boolean }[] = [
  { id: 'upload', label: 'Upload from device', enabled: true },
  { id: 'content-studio', label: 'Content Studio Media', enabled: false },
  { id: 'pexels', label: 'Pexels', enabled: false },
  { id: 'pixabay', label: 'Pixabay', enabled: false },
  { id: 'ai-find', label: 'AI Find', enabled: false },
  { id: 'ai-generate', label: 'AI Generate', enabled: false },
]

export function MediaSelector({ label, onUpload }: { label: string; onUpload: (file: File) => void }) {
  const [open, setOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) onUpload(file)
    e.target.value = ''
    setOpen(false)
  }

  return (
    <div className="pb-media-selector">
      <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleFile} />
      <button className="pb-toggle" onClick={() => setOpen(o => !o)}>{label} ▾</button>
      {open && (
        <div className="pb-media-menu" onPointerDown={(e) => e.stopPropagation()}>
          {SOURCES.map(source => (
            <button
              key={source.id}
              className="pb-media-menu-item"
              disabled={!source.enabled}
              onClick={() => { if (source.id === 'upload') fileInputRef.current?.click() }}
              title={source.enabled ? undefined : 'Coming soon'}
            >
              {source.label}{!source.enabled && <span className="pb-media-menu-soon">soon</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
