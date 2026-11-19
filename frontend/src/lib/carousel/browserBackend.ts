// Carousel Creator — the real browser drawing backend (HTMLCanvasElement) and file download helper. Kept separate so the rest of lib/carousel stays DOM-free.
import type { RasterBackend, RasterSurface } from './exporter'
import type { Ctx2D, DrawableImage } from './rasterize'

export function browserBackend(): RasterBackend {
  return {
    createSurface(width: number, height: number): RasterSurface {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('This browser cannot draw on a canvas, so slides cannot be exported.')
      return {
        ctx: ctx as unknown as Ctx2D,
        toBytes: (mime, quality) => new Promise((resolve, reject) => {
          canvas.toBlob(blob => {
            if (!blob) { reject(new Error('The slide could not be encoded. If an image comes from another site, its server must allow cross-origin use.')); return }
            blob.arrayBuffer().then(b => resolve(new Uint8Array(b)), reject)
          }, mime, quality)
        }),
      }
    },
    loadImage(url: string): Promise<DrawableImage | null> {
      return new Promise(resolve => {
        const img = new Image()
        img.crossOrigin = 'anonymous'
        img.onload = () => resolve(img)
        img.onerror = () => resolve(null)
        img.src = url
      })
    },
  }
}

/** Starts a file download from bytes. */
export function downloadBytes(name: string, mime: string, bytes: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
