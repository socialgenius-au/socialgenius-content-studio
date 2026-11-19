// Carousel Creator — the server-backed store.
//
// `CarouselServer` is the contract the editor depends on; `createHttpCarouselServer` implements it over the authenticated /carousels API and `createFakeCarouselServer`
// (in serverStore.fake.ts, tests only) implements the same contract in memory. Documents sent to the server never carry media tokens; documents received are checked with the
// same validator the editor uses, so a damaged server record is reported instead of crashing the editor.
import { parsePostDocument, type PostDocument } from '../postDocument'
import { stripMediaToken } from '../../api/mediaAccess'
import { stripTokens } from './storage'

export type ServerErrorKind = 'network' | 'auth' | 'conflict' | 'exists' | 'invalid' | 'too_large' | 'limit' | 'not_found' | 'server'

export class CarouselServerError extends Error {
  constructor(public kind: ServerErrorKind, message: string, public opts: { status?: number; serverVersion?: number; details?: string[] } = {}) {
    super(message)
    this.name = 'CarouselServerError'
  }
  /** Worth retrying later with the same data (a dropped connection or a server hiccup). Everything else needs a person or a different request. */
  get retryable(): boolean { return this.kind === 'network' || this.kind === 'server' }
}

export interface ServerCarouselSummary {
  id: string
  title: string
  slideCount: number
  platformKey: string
  formatKey: string
  themeId: string
  origin: string
  version: number
  createdAt: string
  updatedAt: string
}
export interface ServerCarousel extends ServerCarouselSummary { activeSlideId?: string; document: PostDocument }
export interface SaveMeta { themeId: string; activeSlideId?: string }
export interface SaveAck { version: number; updatedAt: string }

export interface CarouselServer {
  list(): Promise<ServerCarouselSummary[]>
  get(id: string): Promise<ServerCarousel>
  /** Refuses (kind 'exists') when the id is already in the account: a create never overwrites. */
  create(doc: PostDocument, meta: SaveMeta & { importedFrom?: 'browser' }): Promise<ServerCarousel>
  /** `expectedVersion` is the version the editor last saw. A newer server version is refused (kind 'conflict') unless `force`. */
  update(id: string, doc: PostDocument, meta: SaveMeta & { expectedVersion: number; force?: boolean }): Promise<SaveAck>
  duplicate(id: string): Promise<ServerCarousel>
  remove(id: string): Promise<void>
}

// ── HTTP implementation ────────────────────────────────────────────────────────────────────────────────────────────────

interface Wire {
  doc_id: string; title: string; slide_count: number; platform_key: string; format_key: string; theme_id: string; origin: string; version: number
  created_at: string; updated_at: string; active_slide_id?: string | null; document?: unknown
}

const summaryFrom = (w: Wire): ServerCarouselSummary => ({
  id: w.doc_id, title: w.title, slideCount: w.slide_count, platformKey: w.platform_key, formatKey: w.format_key, themeId: w.theme_id, origin: w.origin,
  version: w.version, createdAt: w.created_at, updatedAt: w.updated_at,
})

function fullFrom(w: Wire): ServerCarousel {
  const parsed = parsePostDocument(JSON.stringify(w.document))
  if (!parsed.ok) throw new CarouselServerError('invalid', `The saved carousel is damaged and could not be opened: ${parsed.errors.slice(0, 3).join('; ')}`, { details: parsed.errors })
  const activeSlideId = w.active_slide_id && parsed.document.pages.some(p => p.id === w.active_slide_id) ? w.active_slide_id : undefined
  return { ...summaryFrom(w), activeSlideId, document: parsed.document }
}

interface AxiosLikeError { response?: { status?: number; data?: { detail?: unknown } }; message?: string }

/** Turns whatever the HTTP layer threw into a typed, human-readable error. */
export function toServerError(err: unknown): CarouselServerError {
  if (err instanceof CarouselServerError) return err
  const e = err as AxiosLikeError
  const status = e?.response?.status
  const detail = e?.response?.data?.detail
  const code = detail && typeof detail === 'object' && !Array.isArray(detail) ? String((detail as { code?: unknown }).code ?? '') : ''
  const message = detail && typeof detail === 'object' && !Array.isArray(detail) && typeof (detail as { message?: unknown }).message === 'string' ? (detail as { message: string }).message : typeof detail === 'string' ? detail : ''
  const serverVersion = detail && typeof detail === 'object' && !Array.isArray(detail) && typeof (detail as { server_version?: unknown }).server_version === 'number' ? (detail as { server_version: number }).server_version : undefined
  if (status === undefined) return new CarouselServerError('network', 'Could not reach the server. Your changes are kept in this tab and will be sent when the connection returns.')
  if (status === 401 || status === 403) return new CarouselServerError('auth', 'Your session has ended. Sign in again; your latest edits are kept in this browser until they are saved.', { status })
  if (status === 404) return new CarouselServerError('not_found', 'That carousel was not found in your account.', { status })
  if (status === 409 && code === 'version_conflict') return new CarouselServerError('conflict', message || 'This carousel was saved from somewhere else since you opened it.', { status, serverVersion })
  if (status === 409 && code === 'limit') return new CarouselServerError('limit', message || 'You have reached the carousel limit. Delete one first.', { status })
  if (status === 409) return new CarouselServerError('exists', message || 'A carousel with this id already exists in your account; it was not changed.', { status, serverVersion })
  if (status === 413) return new CarouselServerError('too_large', message || 'That carousel is too large to save. Move large images into the media library.', { status })
  if (status === 422) {
    const errors = detail && typeof detail === 'object' && !Array.isArray(detail) && Array.isArray((detail as { errors?: unknown }).errors) ? ((detail as { errors: unknown[] }).errors.map(String)) : []
    return new CarouselServerError('invalid', errors.length ? `The server rejected this carousel: ${errors.slice(0, 3).join('; ')}` : 'The server rejected this carousel.', { status, details: errors })
  }
  return new CarouselServerError('server', status >= 500 ? 'The server had a problem saving. It will be retried.' : message || `Unexpected response (${status}).`, { status })
}

export interface CarouselsApiLike {
  list(): Promise<{ data: unknown }>
  get(id: string): Promise<{ data: unknown }>
  create(body: Record<string, unknown>): Promise<{ data: unknown }>
  update(id: string, body: Record<string, unknown>): Promise<{ data: unknown }>
  duplicate(id: string): Promise<{ data: unknown }>
  delete(id: string): Promise<unknown>
}

export function createHttpCarouselServer(api: CarouselsApiLike): CarouselServer {
  const wrap = async <T,>(fn: () => Promise<T>): Promise<T> => { try { return await fn() } catch (e) { throw toServerError(e) } }
  const clean = (doc: PostDocument) => stripTokens(doc, stripMediaToken)
  return {
    list: () => wrap(async () => ((await api.list()).data as Wire[]).map(summaryFrom)),
    get: id => wrap(async () => fullFrom((await api.get(id)).data as Wire)),
    create: (doc, meta) => wrap(async () => fullFrom((await api.create({ document: clean(doc), theme_id: meta.themeId, active_slide_id: meta.activeSlideId ?? null, imported_from: meta.importedFrom ?? null })).data as Wire)),
    update: (id, doc, meta) => wrap(async () => {
      const r = (await api.update(id, { document: clean(doc), expected_version: meta.expectedVersion, theme_id: meta.themeId, active_slide_id: meta.activeSlideId ?? null, force: !!meta.force })).data as { version: number; updated_at: string }
      return { version: r.version, updatedAt: r.updated_at }
    }),
    duplicate: id => wrap(async () => fullFrom((await api.duplicate(id)).data as Wire)),
    remove: id => wrap(async () => { await api.delete(id) }),
  }
}
