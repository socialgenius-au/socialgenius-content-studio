import { VirtualAssetPicker } from '../../../components/VirtualAssetLibrary'
import { useEffect, useRef, useState } from 'react'
import { Loader2, Upload } from 'lucide-react'
import { assetsApi, uploadApi } from '../../../api/client'
import { stripMediaToken } from '../../../api/mediaAccess'
import type { Asset } from '../../../types'

export interface PickedImage { assetId: number; url: string; name: string }

export const MAX_IMAGE_BYTES = 15 * 1024 * 1024
const ALLOWED = /^image\/(png|jpe?g|webp|gif)$/i

/** The stable (token-free) URL stored in a slide for an asset; the current media token is added when it is drawn. */
export const storedUrlFor = (a: Pick<Asset, 'file_path'>): string => stripMediaToken(assetsApi.previewUrl(a.file_path))

export function validateImageFile(file: { type: string; size: number; name: string }): string | null {
  if (!ALLOWED.test(file.type)) return `"${file.name}" is not a PNG, JPEG, WebP or GIF image.`
  if (file.size > MAX_IMAGE_BYTES) return `"${file.name}" is larger than 15 MB. Use a smaller image.`
  return null
}

/**
 * Upload a picture or choose one already in the library. Calls onPick with the asset; the slide stores the asset id and a token-free URL.
 * With `onPickMany` it works in multi mode instead: several files can be uploaded at once and several library pictures ticked, then added together.
 */
export default function ImagePicker({ onPick, onPickMany }: { onPick: (img: PickedImage) => void; onPickMany?: (imgs: PickedImage[]) => void }) {
  const multi = !!onPickMany
  const [ticked, setTicked] = useState<PickedImage[]>([])
  const [assets, setAssets] = useState<Asset[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let live = true
    assetsApi.list({ file_type: 'image' }).then(r => { if (live) setAssets((r.data as Asset[]).slice(0, 24)) }).catch(() => { if (live) { setAssets([]); setError('Could not load your library.') } })
    return () => { live = false }
  }, [])

  const upload = async (files: FileList | File[] | undefined) => {
    const list = files ? Array.from(files) : []
    if (list.length === 0) return
    for (const f of list) { const problem = validateImageFile(f); if (problem) { setError(problem); return } }
    setBusy(true); setError(null)
    try {
      const done: PickedImage[] = []
      for (const file of list) {                                            // one at a time: each upload is validated and owned by the account on its own
        const res = await uploadApi.upload(file)
        const a = res.data as Asset
        setAssets(cur => [a, ...(cur ?? [])])
        done.push({ assetId: a.id, url: storedUrlFor(a), name: a.original_filename })
      }
      if (onPickMany) onPickMany(done); else onPick(done[0])
    } catch { setError('The upload failed. Check your connection and try again.') }
    finally { setBusy(false); if (input.current) input.current.value = '' }
  }
  const toggle = (img: PickedImage) => setTicked(cur => (cur.some(t => t.assetId === img.assetId) ? cur.filter(t => t.assetId !== img.assetId) : [...cur, img]))

  return (
    <div className="space-y-2" data-testid="image-picker">
      <VirtualAssetPicker kind="image" onMedia={asset => {
        const item = { assetId: asset.id, url: storedUrlFor(asset), name: asset.original_filename }
        if (multi) toggle(item)
        else onPick(item)
      }} />
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple={multi} className="hidden" onChange={e => upload(e.target.files ?? undefined)} data-testid="image-file-input" />
      <button type="button" disabled={busy} onClick={() => input.current?.click()} className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md border border-dashed border-border text-sm font-medium hover:bg-muted disabled:opacity-60">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} {multi ? 'Upload pictures' : 'Upload a picture'}
      </button>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      {assets === null && <p className="text-xs text-muted-foreground">Loading your library…</p>}
      {assets && assets.length > 0 && (
        <>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Or choose from your library</p>
          <div className="grid max-h-40 grid-cols-4 gap-1.5 overflow-y-auto">
            {assets.map(a => (
              <button key={a.id} type="button" title={a.original_filename} aria-pressed={multi ? ticked.some(t => t.assetId === a.id) : undefined} onClick={() => { const img = { assetId: a.id, url: storedUrlFor(a), name: a.original_filename }; if (multi) toggle(img); else onPick(img) }} className={`aspect-square overflow-hidden rounded border bg-muted hover:ring-2 hover:ring-primary ${ticked.some(t => t.assetId === a.id) ? 'border-primary ring-2 ring-primary' : 'border-border'}`} data-testid="library-image">
                <img src={assetsApi.previewUrl(a.file_path)} alt={a.original_filename} className="h-full w-full object-cover" loading="lazy" />
              </button>
            ))}
          </div>
          {multi && <button type="button" disabled={ticked.length === 0} onClick={() => { onPickMany?.(ticked); setTicked([]) }} className="inline-flex h-9 w-full items-center justify-center rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:opacity-50" data-testid="add-ticked">{ticked.length === 0 ? 'Tick pictures to add' : `Add ${ticked.length} picture${ticked.length === 1 ? '' : 's'}`}</button>}
        </>
      )}
    </div>
  )
}
