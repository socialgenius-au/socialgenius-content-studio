// M2.2a -- the browser I/O of the image path, kept apart from the engine and injectable so tests need no browser:
//   * validate and decode a picture the person chose (size, transparency),
//   * cut a plain rectangle out of a reference frame the app already serves (opt-in; read-only on the frame),
//   * upload a chosen picture through the EXISTING asset upload -- and only when the person asks for the layers to be added, never while candidates are shown.
// Nothing here talks to the analysis, an AI provider or the editor.
import { assetsApi, uploadApi } from '../../../api/client'
import type { Asset } from '../../../types'
import { IMAGE_EXTENSIONS, IMAGE_MIME_TYPES, MAX_IMAGE_BYTES, type ImageSource, type Rect } from './contract'
import type { ImageRef } from './materialize'

/** A picture the person chose (or a crop they asked for), held in memory until they add the layers. `token` identifies this exact choice. */
export interface PickedImage {
  token: string
  source: ImageSource
  blob: Blob
  fileName: string
  width: number
  height: number
  hasAlpha: boolean | null
  previewUrl: string
  cropRegion?: Rect
}

export const toImageRef = (p: PickedImage, uploaded?: { assetId: number; url: string }): ImageRef => ({
  source: p.source, width: p.width, height: p.height, fileName: p.fileName, hasAlpha: p.hasAlpha, ...(p.cropRegion ? { cropRegion: p.cropRegion } : {}), ...(uploaded ?? {}),
})

/** Plain-words reason a file cannot be used, or null. Static pictures only: an animated GIF would export as a single frame. */
export function validateImageFile(f: { name: string; type: string; size: number }): string | null {
  const ext = f.name.includes('.') ? f.name.split('.').pop()!.toLowerCase() : ''
  if (!(IMAGE_EXTENSIONS as readonly string[]).includes(ext)) return `“${f.name}” is not a PNG, JPG or WebP picture. Animated GIFs are not supported here.`
  if (f.type && !(IMAGE_MIME_TYPES as readonly string[]).includes(f.type)) return `“${f.name}” does not look like a PNG, JPG or WebP picture.`
  if (f.size <= 0) return `“${f.name}” is empty.`
  if (f.size > MAX_IMAGE_BYTES) return `“${f.name}” is larger than ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB. Use a smaller picture.`
  return null
}

export interface Decoded { width: number; height: number; hasAlpha: boolean | null }
export type ImageDecoder = (blob: Blob) => Promise<Decoded | null>

/** Real size of the picture and whether any pixel is see-through (checked on a small copy; null when the browser would not let us look). */
export const browserDecode: ImageDecoder = blob => new Promise(resolve => {
  const url = URL.createObjectURL(blob)
  const img = new Image()
  img.onload = () => {
    const width = img.naturalWidth, height = img.naturalHeight
    let hasAlpha: boolean | null = null
    try {
      const k = Math.min(1, 192 / Math.max(width, height))
      const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(width * k)); c.height = Math.max(1, Math.round(height * k))
      const ctx = c.getContext('2d', { willReadFrequently: true })
      if (ctx) {
        ctx.drawImage(img, 0, 0, c.width, c.height)
        const d = ctx.getImageData(0, 0, c.width, c.height).data
        hasAlpha = false
        for (let i = 3; i < d.length; i += 4) if (d[i] < 250) { hasAlpha = true; break }
      }
    } catch { hasAlpha = null }
    URL.revokeObjectURL(url)
    resolve(width > 0 && height > 0 ? { width, height, hasAlpha } : null)
  }
  img.onerror = () => { URL.revokeObjectURL(url); resolve(null) }
  img.src = url
})

export type PickResult = { ok: true; image: PickedImage } | { ok: false; message: string }
let counter = 0
const newToken = () => `p${Date.now().toString(36)}${(counter++).toString(36)}`

export async function pickImageFile(file: File, decode: ImageDecoder = browserDecode, makeUrl: (b: Blob) => string = URL.createObjectURL): Promise<PickResult> {
  const bad = validateImageFile(file)
  if (bad) return { ok: false, message: bad }
  const d = await decode(file)
  if (!d) return { ok: false, message: `“${file.name}” could not be read as a picture.` }
  return { ok: true, image: { token: newToken(), source: 'user_upload', blob: file, fileName: file.name, width: d.width, height: d.height, hasAlpha: d.hasAlpha, previewUrl: makeUrl(file) } }
}

// ── an opt-in rectangular crop of a reference frame ──────────────────────────────────────────

export type FrameCropper = (framePath: string, region: Rect) => Promise<{ blob: Blob; width: number; height: number } | null>

export function browserFrameCropper(frameUrl: (path: string) => string): FrameCropper {
  const frames = new Map<string, Promise<HTMLImageElement | null>>()
  // The panel also shows the same still in a plain <img>. A browser may keep that copy (fetched WITHOUT the CORS headers) and hand it back to this CORS-mode load,
  // which then fails and leaves the canvas unreadable. A distinct query string (the server ignores it) gives the pixel read its own, CORS-mode request.
  const corsUrl = (url: string) => `${url}${url.includes('?') ? '&' : '?'}pixels=1`
  const load = (url: string) => new Promise<HTMLImageElement | null>(resolve => {
    const img = new Image()
    img.crossOrigin = 'anonymous'                                                   // required to read pixels back from an image served by the API origin
    img.onload = () => resolve(img.naturalWidth > 0 ? img : null)
    img.onerror = () => resolve(null)
    img.src = corsUrl(url)
  })
  return async (framePath, region) => {
    const url = frameUrl(framePath)
    if (!url) return null
    if (!frames.has(url)) frames.set(url, load(url))
    const img = await frames.get(url)!
    if (!img) return null
    const w = Math.max(1, Math.round(region.w * img.naturalWidth)), h = Math.max(1, Math.round(region.h * img.naturalHeight))
    const sx = Math.min(img.naturalWidth - w, Math.round(region.x * img.naturalWidth)), sy = Math.min(img.naturalHeight - h, Math.round(region.y * img.naturalHeight))
    try {
      const c = document.createElement('canvas'); c.width = w; c.height = h
      const ctx = c.getContext('2d')
      if (!ctx) return null
      ctx.drawImage(img, Math.max(0, sx), Math.max(0, sy), w, h, 0, 0, w, h)       // a plain 1:1 rectangle: no resampling, no masking, no clean-up
      const blob = await new Promise<Blob | null>(res => c.toBlob(res, 'image/png'))
      return blob ? { blob, width: w, height: h } : null
    } catch { return null }                                                         // tainted canvas: the browser refused pixel access
  }
}

export async function pickFrameCrop(frame: { id: number; path: string }, region: Rect, cropper: FrameCropper, makeUrl: (b: Blob) => string = URL.createObjectURL): Promise<PickResult> {
  const out = await cropper(frame.path, region)
  if (!out) return { ok: false, message: 'The reference frame could not be read here (the browser may have blocked access to its pixels). Choose an image of your own instead.' }
  const fileName = `reference-crop-f${frame.id}-${Math.round(region.x * 1000)}-${Math.round(region.y * 1000)}.png`
  return { ok: true, image: { token: newToken(), source: 'reference_frame_crop', blob: out.blob, fileName, width: out.width, height: out.height, hasAlpha: false, previewUrl: makeUrl(out.blob), cropRegion: { ...region } } }
}

// ── upload (only when the person adds the layers) ────────────────────────────────────────────

export interface UploadDeps { upload: (file: File) => Promise<Asset>; assetUrl: (assetFilePath: string) => string }
export const defaultUploadDeps = (): UploadDeps => ({ upload: async f => (await uploadApi.upload(f)).data as Asset, assetUrl: assetsApi.previewUrl })

export interface UploadedPick { token: string; assetId: number; url: string }

/** Upload exactly the listed choices, one after another. One failure never stops or undoes the others; the failures are reported by file name. */
export async function uploadChosen(ids: readonly string[], picks: Readonly<Record<string, PickedImage>>, deps: UploadDeps): Promise<{ done: Record<string, UploadedPick>; failed: string[] }> {
  const done: Record<string, UploadedPick> = {}
  const failed: string[] = []
  for (const id of ids) {
    const p = picks[id]
    if (!p) continue
    try { done[id] = { token: p.token, ...(await uploadPicked(p, deps)) } } catch { failed.push(p.fileName) }
  }
  return { done, failed }
}

export async function uploadPicked(p: PickedImage, deps: UploadDeps = defaultUploadDeps()): Promise<{ assetId: number; url: string }> {
  const type = p.blob.type || (p.fileName.endsWith('.png') ? 'image/png' : p.fileName.endsWith('.webp') ? 'image/webp' : 'image/jpeg')
  const asset = await deps.upload(new File([p.blob], p.fileName, { type }))
  const url = deps.assetUrl(asset.file_path)
  if (!url) throw new Error('The uploaded picture has no address the editor can load.')
  return { assetId: asset.id, url }
}
