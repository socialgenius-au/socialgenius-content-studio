import { useState } from 'react'
import { assetsApi, uploadApi } from '../../../api/client'
import type { ImageElement } from '../../../lib/postDocument'
import type { Asset } from '../../../types'
import { storedUrlFor } from './ImagePicker'

export default function ImageBackgroundTools({ element, canvasWidth, canvasHeight, update }: {
  element: ImageElement; canvasWidth: number; canvasHeight: number; update: (patch: Partial<ImageElement>) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [colour, setColour] = useState('#FFFFFF')
  const [mode, setMode] = useState<'flat' | 'complex'>('flat')
  const assetId = element.source.kind === 'asset' ? element.source.assetId : null
  const btn = 'rounded border border-border px-2 py-1.5 text-xs hover:bg-muted disabled:opacity-50'

  async function process(replace: boolean) {
    if (assetId === null || busy) return
    setBusy(true); setError('')
    try {
      const response = mode === 'flat' ? await assetsApi.removeFlatBackground(assetId) : await assetsApi.removeComplexBackground(assetId)
      let blob = response.data as Blob
      if (replace) {
        const bitmap = await createImageBitmap(blob)
        try {
          const canvas = document.createElement('canvas')
          canvas.width = bitmap.width; canvas.height = bitmap.height
          const context = canvas.getContext('2d')
          if (!context) throw new Error('Canvas unavailable')
          context.fillStyle = colour
          context.fillRect(0, 0, canvas.width, canvas.height)
          context.drawImage(bitmap, 0, 0)
          blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(v => v ? resolve(v) : reject(new Error('Could not render image')), 'image/png'))
        } finally { bitmap.close() }
      }
      const file = new File([blob], replace ? 'replaced-background.png' : 'transparent-background.png', { type: 'image/png' })
      const asset = (await uploadApi.upload(file)).data as Asset
      update({ source: { kind: 'asset', assetId: asset.id, url: storedUrlFor(asset) }, fit: 'contain' })
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Processing failed') }
    finally { setBusy(false) }
  }

  async function autoFit() {
    if (assetId === null || busy) return
    setBusy(true); setError('')
    try {
      const response = await assetsApi.download(assetId)
      const bitmap = await createImageBitmap(response.data as Blob)
      try {
        const scale = Math.min(canvasWidth * 0.76 / bitmap.width, canvasHeight * 0.36 / bitmap.height)
        const width = bitmap.width * scale / canvasWidth, height = bitmap.height * scale / canvasHeight
        update({ x: (1 - width) / 2, y: (1 - height) / 2, width, height, fit: 'contain', lockAspect: true })
      } finally { bitmap.close() }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Auto fit failed') }
    finally { setBusy(false) }
  }

  return <div className="space-y-2 rounded border border-border p-2" aria-label="Image background tools">
    <p className="text-xs font-semibold">Image tools</p>
    <button type="button" className={btn} disabled={busy || assetId === null} onClick={() => void autoFit()}>Auto fit image (keep proportions)</button>
    <label className="block text-xs">Background type
      <select className="mt-1 w-full rounded border border-border bg-background p-1" value={mode} onChange={e => setMode(e.target.value as 'flat' | 'complex')}>
        <option value="flat">Plain background</option><option value="complex">Complex background (approximate)</option>
      </select>
    </label>
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={btn} disabled={busy || assetId === null} onClick={() => void process(false)}>Make transparent</button>
      <input type="color" aria-label="Replacement background colour" value={colour} onChange={e => setColour(e.target.value)} />
      <button type="button" className={btn} disabled={busy || assetId === null} onClick={() => void process(true)}>Replace background colour</button>
    </div>
    <p className="text-[11px] text-muted-foreground">Creates a new asset; original stays unchanged. Complex background removal is approximate.</p>
    {busy && <p className="text-xs">Processing image…</p>}
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
  </div>
}
