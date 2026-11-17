// M1 / Stage 2 -- getting footage into the workspace: list the person's existing videos, upload a new one, read its REAL length.
// All I/O is behind `LibraryDeps` so the behaviour (including every failure) is testable without a browser or a server.
import { assetsApi, uploadApi } from '../../../api/client'
import type { Asset } from '../../../types'
import { errorMessage } from '../useDeconstructor'
import { isVideoAsset, readyEntry, type LibraryEntry, footageKeyFor } from './footageModel'

export type ProbeResult = { ok: true; duration: number; width?: number; height?: number } | { ok: false; reason: string }

export interface LibraryDeps {
  listAssets: () => Promise<Asset[]>
  upload: (file: File) => Promise<Asset>
  probe: (url: string) => Promise<ProbeResult>
  previewUrl: (filePath: string) => string
}

/** Real length of a video from its metadata. Unlike the editor's own probe there is NO fallback length: if it cannot be read, that is reported. */
export function probeVideoDuration(url: string, timeoutMs = 10000): Promise<ProbeResult> {
  return new Promise(resolve => {
    const vid = document.createElement('video')
    let settled = false
    const finish = (r: ProbeResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      vid.removeAttribute('src')
      vid.load()
      resolve(r)
    }
    const timer = setTimeout(() => finish({ ok: false, reason: 'The video took too long to load, so its length could not be read.' }), timeoutMs)
    vid.preload = 'metadata'
    vid.onloadedmetadata = () => finish(Number.isFinite(vid.duration) && vid.duration > 0
      ? { ok: true, duration: vid.duration, ...(vid.videoWidth > 0 && vid.videoHeight > 0 ? { width: vid.videoWidth, height: vid.videoHeight } : {}) }
      : { ok: false, reason: 'This video file does not report a usable length.' })
    vid.onerror = () => finish({ ok: false, reason: 'This file could not be opened as a video.' })
    vid.src = url
  })
}

export const defaultLibraryDeps = (): LibraryDeps => ({
  listAssets: async () => (await assetsApi.list({ file_type: 'video' })).data as Asset[],
  upload: async file => (await uploadApi.upload(file)).data as Asset,
  probe: probeVideoDuration,
  previewUrl: assetsApi.previewUrl,
})

export async function loadVideoAssets(deps: LibraryDeps): Promise<{ ok: true; assets: Asset[] } | { ok: false; message: string }> {
  try {
    const all = await deps.listAssets()
    return { ok: true, assets: (Array.isArray(all) ? all : []).filter(isVideoAsset) }
  } catch (e) {
    return { ok: false, message: errorMessage(e, 'Could not load your videos.') }
  }
}

/** Read a stored video's real length and turn it into a library entry (ready, or failed with the reason). */
export async function probeAsset(asset: Asset, deps: LibraryDeps): Promise<LibraryEntry> {
  const key = footageKeyFor(asset.id)
  let r: ProbeResult
  try { r = await deps.probe(deps.previewUrl(asset.file_path)) } catch { r = { ok: false, reason: 'This video could not be read.' } }
  if (!r.ok) return { state: 'failed', key, assetId: asset.id, name: asset.original_filename, reason: r.reason }
  return readyEntry(asset, r.duration, deps.previewUrl, { width: r.width, height: r.height })
}

export const UPLOAD_NOT_VIDEO = 'That file is not a video. Choose a video file (for example MP4 or MOV).'

export type UploadOutcome =
  | { ok: true; asset: Asset; entry: LibraryEntry }
  | { ok: false; message: string; asset?: Asset }

/** Upload one video through the existing upload endpoint, then read its real length. A failure at either step is reported and nothing is assumed. */
export async function uploadFootage(file: File, deps: LibraryDeps): Promise<UploadOutcome> {
  if (!file.type.startsWith('video/')) return { ok: false, message: UPLOAD_NOT_VIDEO }
  let asset: Asset
  try {
    asset = await deps.upload(file)
  } catch (e) {
    return { ok: false, message: errorMessage(e, 'The upload failed. Nothing was added — please try again.') }
  }
  if (!asset || !Number.isInteger(asset.id) || typeof asset.file_path !== 'string') return { ok: false, message: 'The upload finished but the server did not return the file’s details. Nothing was added.' }
  if (!isVideoAsset(asset)) return { ok: false, message: UPLOAD_NOT_VIDEO, asset }
  const entry = await probeAsset(asset, deps)
  if (entry.state === 'failed') return { ok: false, message: `Uploaded “${asset.original_filename}”, but ${entry.reason.charAt(0).toLowerCase()}${entry.reason.slice(1)}`, asset }
  return { ok: true, asset, entry }
}
