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

/** Upload a picture or choose one already in the library. Calls onPick with the asset; the slide stores the asset id and a token-free URL. */
export default function ImagePicker({ onPick }: { onPick: (img: PickedImage) => void }) {
  const [assets, setAssets] = useState<Asset[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let live = true
    assetsApi.list({ file_type: 'image' }).then(r => { if (live) setAssets((r.data as Asset[]).slice(0, 24)) }).catch(() => { if (live) { setAssets([]); setError('Could not load your library.') } })
    return () => { live = false }
  }, [])

  const upload = async (file: File | undefined) => {
    if (!file) return
    const problem = validateImageFile(file)
    if (problem) { setError(problem); return }
    setBusy(true); setError(null)
    try {
      const res = await uploadApi.upload(file)
      const a = res.data as Asset
      setAssets(cur => [a, ...(cur ?? [])])
      onPick({ assetId: a.id, url: storedUrlFor(a), name: a.original_filename })
    } catch { setError('The upload failed. Check your connection and try again.') }
    finally { setBusy(false); if (input.current) input.current.value = '' }
  }

  return (
    <div className="space-y-2" data-testid="image-picker">
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={e => upload(e.target.files?.[0])} data-testid="image-file-input" />
      <button type="button" disabled={busy} onClick={() => input.current?.click()} className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md border border-dashed border-border text-sm font-medium hover:bg-muted disabled:opacity-60">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Upload a picture
      </button>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      {assets === null && <p className="text-xs text-muted-foreground">Loading your library…</p>}
      {assets && assets.length > 0 && (
        <>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Or choose from your library</p>
          <div className="grid max-h-40 grid-cols-4 gap-1.5 overflow-y-auto">
            {assets.map(a => (
              <button key={a.id} type="button" title={a.original_filename} onClick={() => onPick({ assetId: a.id, url: storedUrlFor(a), name: a.original_filename })} className="aspect-square overflow-hidden rounded border border-border bg-muted hover:ring-2 hover:ring-primary" data-testid="library-image">
                <img src={assetsApi.previewUrl(a.file_path)} alt={a.original_filename} className="h-full w-full object-cover" loading="lazy" />
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
