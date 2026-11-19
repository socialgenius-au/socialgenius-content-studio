// Carousel Creator — persistence.
//
// Every carousel is saved whole (all slides, in order, with every element), so reopening restores each slide exactly as it was left. The store is an interface over a
// key/value storage (the browser's localStorage in the app; a Map in tests), so a server-backed store can be swapped in without touching the editor.
//
// Saved data is the PostDocument JSON plus a small envelope (theme and the slide that was open). Image elements keep the stable asset URL WITHOUT a media token; tokens
// are short-lived and are applied when drawing (see api/mediaAccess.ts), never stored.
import { parsePostDocument, serializePostDocument, type PostDocument, type PostElement, type PostPage } from '../postDocument'

export interface KeyValueStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export const CAROUSEL_INDEX_KEY = 'sg.carousel.index.v1'
export const carouselKey = (id: string) => `sg.carousel.doc.v1.${id}`
export const CAROUSEL_RECORD_VERSION = 1

export interface CarouselRecord {
  recordVersion: number
  document: PostDocument
  themeId: string
  activeSlideId?: string
  savedAt: string
}

export interface CarouselSummary { id: string; title: string; slideCount: number; updatedAt: string; platformKey: string; formatKey: string }

export type SaveResult = { ok: true; savedAt: string } | { ok: false; error: string }
export type LoadResult = { ok: true; record: CarouselRecord } | { ok: false; error: string }

function readIndex(storage: KeyValueStorage): CarouselSummary[] {
  try {
    const raw = storage.getItem(CAROUSEL_INDEX_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter(s => s && typeof s.id === 'string') : []
  } catch { return [] }
}

export const summaryOf = (doc: PostDocument): CarouselSummary => ({ id: doc.id, title: doc.title, slideCount: doc.pages.length, updatedAt: doc.updatedAt, platformKey: doc.format.platformKey, formatKey: doc.format.formatKey })

/** Lists saved carousels, most recently updated first. */
export function listCarousels(storage: KeyValueStorage): CarouselSummary[] {
  return readIndex(storage).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

/** Removes any media token from image URLs so nothing short-lived is persisted. */
function stripTokens(doc: PostDocument, strip: (url: string) => string): PostDocument {
  const fixEl = (el: PostElement): PostElement => {
    if (el.type === 'image' && el.source.kind === 'asset' && el.source.url) return { ...el, source: { ...el.source, url: strip(el.source.url) } }
    if (el.type === 'group') return { ...el, children: el.children.map(fixEl) }
    return el
  }
  const fixPage = (p: PostPage): PostPage => ({
    ...p,
    background: p.background.kind === 'image' && p.background.source.kind === 'asset' && p.background.source.url ? { ...p.background, source: { ...p.background.source, url: strip(p.background.source.url) } } : p.background,
    elements: p.elements.map(fixEl),
  })
  return { ...doc, pages: doc.pages.map(fixPage) }
}

export function saveCarousel(storage: KeyValueStorage, doc: PostDocument, meta: { themeId: string; activeSlideId?: string }, opts: { now?: () => Date; stripToken?: (url: string) => string } = {}): SaveResult {
  const savedAt = (opts.now ?? (() => new Date()))().toISOString()
  const document = opts.stripToken ? stripTokens(doc, opts.stripToken) : doc
  const record: CarouselRecord = { recordVersion: CAROUSEL_RECORD_VERSION, document, themeId: meta.themeId, activeSlideId: meta.activeSlideId, savedAt }
  try {
    storage.setItem(carouselKey(doc.id), JSON.stringify({ ...record, document: JSON.parse(serializePostDocument(document)) }))
    const index = readIndex(storage).filter(s => s.id !== doc.id)
    index.push(summaryOf(document))
    storage.setItem(CAROUSEL_INDEX_KEY, JSON.stringify(index))
    return { ok: true, savedAt }
  } catch (e) {
    const quota = e instanceof Error && /quota|storage/i.test(`${e.name} ${e.message}`)
    return { ok: false, error: quota ? 'Browser storage is full. Delete an old carousel or remove large images, then try again.' : `Could not save: ${e instanceof Error ? e.message : String(e)}` }
  }
}

export function loadCarousel(storage: KeyValueStorage, id: string): LoadResult {
  let raw: string | null
  try { raw = storage.getItem(carouselKey(id)) } catch { return { ok: false, error: 'Browser storage is not available.' } }
  if (!raw) return { ok: false, error: 'That carousel was not found.' }
  let env: Partial<CarouselRecord>
  try { env = JSON.parse(raw) } catch { return { ok: false, error: 'The saved carousel is damaged (not valid JSON).' } }
  if (env.recordVersion !== CAROUSEL_RECORD_VERSION) return { ok: false, error: `The saved carousel uses an unsupported version (${String(env.recordVersion)}).` }
  const parsed = parsePostDocument(JSON.stringify(env.document))
  if (!parsed.ok) return { ok: false, error: `The saved carousel is invalid: ${parsed.errors.slice(0, 3).join('; ')}` }
  const activeSlideId = env.activeSlideId && parsed.document.pages.some(p => p.id === env.activeSlideId) ? env.activeSlideId : parsed.document.pages[0].id
  return { ok: true, record: { recordVersion: CAROUSEL_RECORD_VERSION, document: parsed.document, themeId: typeof env.themeId === 'string' ? env.themeId : 'forest', activeSlideId, savedAt: String(env.savedAt ?? '') } }
}

export function deleteCarousel(storage: KeyValueStorage, id: string): void {
  try { storage.removeItem(carouselKey(id)) } catch { /* nothing to remove */ }
  try { storage.setItem(CAROUSEL_INDEX_KEY, JSON.stringify(readIndex(storage).filter(s => s.id !== id))) } catch { /* index stays as is */ }
}

/** An in-memory store (tests and non-browser use). */
export function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage & { dump(): Record<string, string> } {
  const m = new Map(Object.entries(initial))
  return { getItem: k => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v) }, removeItem: k => { m.delete(k) }, dump: () => Object.fromEntries(m) }
}
