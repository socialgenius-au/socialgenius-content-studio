// Carousel Creator - project files. A project file is plain JSON holding the whole editable carousel (every layer, its text, shapes, links, animations, music settings), so it can be saved
// to a computer, shared, and opened again as a new carousel with everything still editable. Pictures and music are separate uploads in an account, so a file can optionally carry
// them inside (as data addresses); when it is opened they are uploaded into the opening account and the layers are re-pointed at them. Anything that cannot be carried over is reported.
import type { AudioTrack, Background, ImageSource, PostDocument, PostElement, PostPage } from '../postDocument'
import { validatePostDocument } from '../postDocument'
import { detachBrandKit } from './brandKit'
import { defaultId, type OpContext } from './ops'

export const PROJECT_FORMAT = 'socialgenius-carousel'
export const PROJECT_VERSION = 1
export const PROJECT_EXTENSION = '.sgcarousel.json'
export const MAX_PROJECT_BYTES = 80 * 1024 * 1024
/** Embedded media (pictures and music together) larger than this is left out of the file, with a warning. */
export const MAX_EMBEDDED_BYTES = 48 * 1024 * 1024

export interface EmbeddedAsset { name: string; mime: string; dataUrl: string }
export interface ProjectFile { format: typeof PROJECT_FORMAT; version: number; exportedAt: string; title: string; themeId: string; document: PostDocument; assets?: Record<string, EmbeddedAsset> }

// ── walking the media a document refers to ───────────────────────────────────────────────────

const assetUrlOf = (s: ImageSource): string | null => (s.kind === 'asset' && s.url ? s.url : null)

/** Every stored media address used by the document: pictures (backgrounds, layers, groups) and the music track. */
export function collectMediaUrls(doc: PostDocument): string[] {
  const urls = new Set<string>()
  const walk = (els: PostElement[]) => { for (const e of els) { if (e.type === 'image') { const u = assetUrlOf(e.source); if (u) urls.add(u) } else if (e.type === 'group') walk(e.children) } }
  for (const p of doc.pages) {
    if (p.background.kind === 'image') { const u = assetUrlOf(p.background.source); if (u) urls.add(u) }
    walk(p.elements)
  }
  if (doc.audio?.url) urls.add(doc.audio.url)
  return [...urls]
}

export interface MediaTarget { assetId: number; url: string }

/** The same document with every media address passed through `f` (used to remove access tokens before a file leaves the account). */
export function mapMediaUrls(doc: PostDocument, f: (url: string) => string): PostDocument {
  const source = (s: ImageSource): ImageSource => (s.kind === 'asset' && s.url ? { ...s, url: f(s.url) } : s)
  const els = (list: PostElement[]): PostElement[] => list.map(e => (e.type === 'image' ? { ...e, source: source(e.source) } : e.type === 'group' ? { ...e, children: els(e.children) } : e))
  const out: PostDocument = { ...doc, pages: doc.pages.map(p => ({ ...p, background: p.background.kind === 'image' ? { ...p.background, source: source(p.background.source) } : p.background, elements: els(p.elements) })) }
  if (doc.audio) out.audio = doc.audio.url ? { ...doc.audio, url: f(doc.audio.url) } : doc.audio
  return out
}

/** Re-points every picture and the music at new addresses. `pick` returns the new target, or null when that media is not available (the layer becomes an empty picture slot, the music is removed). */
export function remapMedia(doc: PostDocument, pick: (url: string) => MediaTarget | null): { doc: PostDocument; missingPictures: number; musicRemoved: boolean } {
  let missingPictures = 0
  const source = (s: ImageSource): ImageSource => {
    const u = assetUrlOf(s)
    if (!u) return s
    const t = pick(u)
    if (t) return { kind: 'asset', assetId: t.assetId, url: t.url }
    missingPictures++
    return { kind: 'placeholder', label: 'Add image (the original picture was not included)', glyph: 'none' }
  }
  const els = (list: PostElement[]): PostElement[] => list.map(e => (e.type === 'image' ? { ...e, source: source(e.source) } : e.type === 'group' ? { ...e, children: els(e.children) } : e))
  const pages: PostPage[] = doc.pages.map(p => {
    let background: Background = p.background
    if (background.kind === 'image') {
      const s = source(background.source)
      background = s.kind === 'asset' ? { ...background, source: s } : { kind: 'solid', color: '#E5E7EB' }
    }
    return { ...p, background, elements: els(p.elements) }
  })
  let audio: AudioTrack | undefined = doc.audio
  let musicRemoved = false
  if (audio) { const t = audio.url ? pick(audio.url) : null; if (t) audio = { ...audio, assetId: t.assetId, url: t.url }; else { audio = undefined; musicRemoved = true } }
  const out: PostDocument = { ...doc, pages }
  if (audio) out.audio = audio; else delete out.audio
  return { doc: out, missingPictures, musicRemoved }
}

// ── writing ──────────────────────────────────────────────────────────────────────────────────

export interface FetchedMedia { name: string; mime: string; dataUrl: string; bytes: number }
export interface BuildOptions { includeMedia: boolean; /** Removes access tokens from media addresses so a project file never carries a credential. */ cleanUrl?: (url: string) => string; fetchMedia: (url: string) => Promise<FetchedMedia | null>; now?: () => Date }

export async function buildProjectFile(input: PostDocument, themeId: string, o: BuildOptions): Promise<{ text: string; warnings: string[]; embedded: number }> {
  const doc = o.cleanUrl ? mapMediaUrls(input, o.cleanUrl) : input
  const warnings: string[] = []
  const assets: Record<string, EmbeddedAsset> = {}
  let total = 0
  if (o.includeMedia) {
    for (const url of collectMediaUrls(doc)) {
      const m = await o.fetchMedia(url).catch(() => null)
      if (!m) { warnings.push(`A picture or music file could not be read, so it is not inside the project file (${url.split('/').pop()}).`); continue }
      if (total + m.bytes > MAX_EMBEDDED_BYTES) { warnings.push(`"${m.name}" was left out because the project file would be too large. Its layer will be an empty picture slot (or the music removed) when the file is opened.`); continue }
      total += m.bytes
      assets[url] = { name: m.name, mime: m.mime, dataUrl: m.dataUrl }
    }
  } else if (collectMediaUrls(doc).length > 0) warnings.push('Pictures and music are not inside this project file. Their layers open as empty picture slots (and the music is removed) in another account.')
  const file: ProjectFile = { format: PROJECT_FORMAT, version: PROJECT_VERSION, exportedAt: (o.now ?? (() => new Date()))().toISOString(), title: doc.title, themeId, document: doc }
  if (Object.keys(assets).length) file.assets = assets
  if (doc.context.brand?.brandKitId) warnings.push('The Brand Kit itself is not inside the file: its colours and fonts stay on the layers, but the kit link is dropped when the file is opened in another account.')
  return { text: JSON.stringify(file), warnings, embedded: Object.keys(assets).length }
}

export function projectFileName(doc: PostDocument): string {
  const slug = doc.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'carousel'
  return `${slug}${PROJECT_EXTENSION}`
}

// ── reading ──────────────────────────────────────────────────────────────────────────────────

export class ProjectFileError extends Error { constructor(message: string) { super(message); this.name = 'ProjectFileError' } }

export interface ParsedProject { document: PostDocument; themeId: string; assets: Record<string, EmbeddedAsset>; title: string }

export function parseProjectFile(text: string): ParsedProject {
  if (text.length > MAX_PROJECT_BYTES) throw new ProjectFileError('That file is larger than 80 MB, which is more than a project file should be.')
  let raw: unknown
  try { raw = JSON.parse(text) } catch { throw new ProjectFileError('That is not a Social Genius project file (it is not valid JSON).') }
  const f = raw as Partial<ProjectFile> | null
  if (!f || typeof f !== 'object' || f.format !== PROJECT_FORMAT) throw new ProjectFileError('That is not a Social Genius carousel project file.')
  if (typeof f.version !== 'number' || f.version > PROJECT_VERSION) throw new ProjectFileError('That project file was made by a newer version of the editor. Update the editor and try again.')
  const check = validatePostDocument(f.document)
  if (check.errors.length > 0) throw new ProjectFileError(`That project file is damaged or incompatible: ${check.errors.slice(0, 3).join('; ')}.`)
  const assets: Record<string, EmbeddedAsset> = {}
  if (f.assets && typeof f.assets === 'object') {
    for (const [url, a] of Object.entries(f.assets)) {
      if (a && typeof a.dataUrl === 'string' && /^data:(image|audio)\/[a-z0-9.+-]+;base64,/i.test(a.dataUrl) && typeof a.name === 'string') assets[url] = { name: a.name.slice(0, 200), mime: String(a.mime), dataUrl: a.dataUrl }
    }
  }
  return { document: f.document as PostDocument, themeId: typeof f.themeId === 'string' ? f.themeId : 'forest', assets, title: typeof f.title === 'string' ? f.title : (f.document as PostDocument).title }
}

export interface PreparedProject { doc: PostDocument; themeId: string; warnings: string[] }

/** Turns a parsed project into a document for THIS account: embedded media is uploaded and the layers re-pointed at the uploads; media that was not embedded becomes empty slots. */
export async function prepareImportedProject(p: ParsedProject, upload: (name: string, mime: string, bytes: Uint8Array) => Promise<MediaTarget>): Promise<PreparedProject> {
  const warnings: string[] = []
  const mapped = new Map<string, MediaTarget>()
  for (const [url, a] of Object.entries(p.assets)) {
    try {
      const b64 = a.dataUrl.slice(a.dataUrl.indexOf(',') + 1)
      const bin = atob(b64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      mapped.set(url, await upload(a.name, a.mime, bytes))
    } catch { warnings.push(`"${a.name}" could not be uploaded to your library.`) }
  }
  const r = remapMedia(p.document, u => mapped.get(u) ?? null)
  if (r.missingPictures > 0) warnings.push(`${r.missingPictures} picture${r.missingPictures === 1 ? '' : 's'} could not be brought over and ${r.missingPictures === 1 ? 'is now an empty picture slot' : 'are now empty picture slots'}. Add ${r.missingPictures === 1 ? 'it' : 'them'} again.`)
  if (r.musicRemoved) warnings.push('The background music was not included in the file, so it was removed. Add music again in the Animate tab.')
  let doc = r.doc
  if (doc.context.brand?.brandKitId) { doc = detachBrandKit(doc); warnings.push('The Brand Kit link was removed because kits belong to an account. The colours and fonts on the layers are unchanged.') }
  return { doc: { ...doc, title: p.title || doc.title }, themeId: p.themeId, warnings }
}

/** The same carousel as a brand-new document: a fresh id (an account never accepts two documents with one id) and fresh timestamps, so Save As and opening a project file create a copy. */
export function asNewDocument(doc: PostDocument, ctx?: OpContext): PostDocument {
  const now = (ctx?.now ?? (() => new Date()))().toISOString()
  return { ...doc, id: (ctx?.newId ?? defaultId)('car'), revision: 0, createdAt: now, updatedAt: now }
}
