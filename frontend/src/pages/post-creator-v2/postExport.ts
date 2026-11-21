// Finished-post export for several platforms at once. Reuses the Carousel Creator's resize (every layer kept, re-laid out) and its exporter, so a file here is drawn exactly like a normal export.
import type { DocumentFormat, PostDocument } from '../../lib/postDocument'
import { formatFor, resizeDocument } from '../../lib/carousel/formats'
import { exportSlide, slug, type ExportFile, type ExportOptions, type RasterBackend } from '../../lib/carousel/exporter'
import { buildZip } from '../../lib/carousel/zip'
import { postCreatorFormats } from './format/formatState'

/** The concrete size used for another platform: the same-named format if that platform has one (e.g. feed_portrait), otherwise its first fixed-size post format. */
export function targetFormatFor(platformKey: string, preferredFormatKey: string): DocumentFormat | null {
  const fixed = postCreatorFormats(platformKey).filter(f => f.ratio !== 'CUSTOM')
  const pick = fixed.find(f => f.key === preferredFormatKey) ?? fixed[0]
  return pick ? formatFor(platformKey, pick.key) : null
}

export interface PlatformExport { platformKey: string; format: DocumentFormat }

export const platformExports = (doc: PostDocument, platformKeys: string[]): PlatformExport[] =>
  platformKeys.flatMap(k => { const f = targetFormatFor(k, doc.format.formatKey); return f && k !== doc.format.platformKey ? [{ platformKey: k, format: f }] : [] })

/** One PNG per selected platform (plus the post as designed) in a single ZIP. */
export async function exportForPlatforms(doc: PostDocument, platformKeys: string[], backend: RasterBackend, o: ExportOptions = {}): Promise<ExportFile> {
  const base = o.fileBase ? slug(o.fileBase) : slug(doc.title)
  const files: ExportFile[] = []
  const own = await exportSlide(doc, 0, 'png', backend, o)
  files.push({ ...own, name: `${base}-${doc.format.platformKey}-${doc.format.formatKey}.png` })
  const targets = platformExports(doc, platformKeys)
  for (const t of targets) {
    if (o.signal?.aborted) { const e = new Error('Export cancelled'); e.name = 'AbortError'; throw e }
    const resized = resizeDocument(doc, t.format, 'fit')
    const f = await exportSlide(resized, 0, 'png', backend, o)
    files.push({ ...f, name: `${base}-${t.platformKey}-${t.format.formatKey}.png` })
    o.onProgress?.(files.length, targets.length + 1)
  }
  return { name: `${base}-platforms.zip`, mime: 'application/zip', bytes: buildZip(files.map(f => ({ name: f.name, data: f.bytes })), o.now) }
}
