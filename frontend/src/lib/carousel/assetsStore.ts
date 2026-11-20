// Carousel Creator - the stores for Brand Kits and templates. `BrandKitStore` / `TemplateStore` are the contracts the editor uses; the HTTP implementations talk to the authenticated
// /brand-kits and /carousel-templates APIs, and assetsStore.fake.ts implements the same contracts in memory for tests. Errors are the same typed CarouselServerError as the carousel store.
import { parsePostDocument, type PostDocument } from '../postDocument'
import { stripMediaToken } from '../../api/mediaAccess'
import type { BrandKit, BrandKitData, BrandKitSummary } from './brandKit'
import { absoluteUploadUrl, emptyKit } from './brandKit'
import { CarouselServerError, toServerError } from './serverStore'
import { stripTokens } from './storage'
import type { Template, TemplateSummary } from './templates'

export interface UploadedFont { assetId: number; url: string; filename: string; familyGuess: string }

export interface BrandKitStore {
  list(): Promise<BrandKitSummary[]>
  get(id: number): Promise<BrandKit>
  create(name: string, kit: BrandKitData): Promise<BrandKit>
  update(id: number, name: string, kit: BrandKitData): Promise<BrandKit>
  duplicate(id: number): Promise<BrandKit>
  remove(id: number): Promise<void>
  uploadFont(file: File): Promise<UploadedFont>
}

export interface TemplateStore {
  list(): Promise<TemplateSummary[]>
  get(id: number): Promise<Template>
  create(input: { name: string; description: string; kind: 'carousel' | 'layout'; document: PostDocument; brandKitId?: number | null }): Promise<Template>
  update(id: number, patch: { name?: string; description?: string; document?: PostDocument }): Promise<Template>
  duplicate(id: number): Promise<Template>
  remove(id: number): Promise<void>
}

type Json = Record<string, unknown>
interface Api { [k: string]: (...args: never[]) => Promise<{ data?: unknown }> }

const wrap = async <T,>(fn: () => Promise<T>): Promise<T> => { try { return await fn() } catch (e) { throw toServerError(e) } }

const kitFrom = (w: { id: number; name: string; kit: Partial<BrandKitData> }): BrandKit => ({ id: w.id, name: w.name, kit: { ...emptyKit(), ...w.kit } as BrandKitData })

export function createHttpBrandKitStore(api: { list(): Promise<{ data: unknown }>; get(id: number): Promise<{ data: unknown }>; create(b: Json): Promise<{ data: unknown }>; update(id: number, b: Json): Promise<{ data: unknown }>; duplicate(id: number): Promise<{ data: unknown }>; delete(id: number): Promise<unknown>; uploadFont(f: File): Promise<{ data: unknown }> }): BrandKitStore {
  return {
    list: () => wrap(async () => ((await api.list()).data as { id: number; name: string; primary: string | null; logo_count: number; font_count: number; updated_at: string }[]).map(s => ({ id: s.id, name: s.name, primary: s.primary, logoCount: s.logo_count, fontCount: s.font_count, updatedAt: s.updated_at }))),
    get: id => wrap(async () => kitFrom((await api.get(id)).data as never)),
    create: (name, kit) => wrap(async () => kitFrom((await api.create({ name, kit })).data as never)),
    update: (id, name, kit) => wrap(async () => kitFrom((await api.update(id, { name, kit })).data as never)),
    duplicate: id => wrap(async () => kitFrom((await api.duplicate(id)).data as never)),
    remove: id => wrap(async () => { await api.delete(id) }),
    uploadFont: file => wrap(async () => { const r = (await api.uploadFont(file)).data as { asset_id: number; url: string; filename: string; family_guess: string }; return { assetId: r.asset_id, url: absoluteUploadUrl(stripMediaToken(r.url)), filename: r.filename, familyGuess: r.family_guess } }),
  }
}

interface WireTemplate { id: number; name: string; description: string; kind: 'carousel' | 'layout'; slide_count: number; platform_key: string; format_key: string; brand_kit_id: number | null; updated_at: string; document?: unknown }
const summaryFrom = (w: WireTemplate): TemplateSummary => ({ id: w.id, name: w.name, description: w.description, kind: w.kind, slideCount: w.slide_count, platformKey: w.platform_key, formatKey: w.format_key, brandKitId: w.brand_kit_id, updatedAt: w.updated_at })
function templateFrom(w: WireTemplate): Template {
  const parsed = parsePostDocument(JSON.stringify(w.document))
  if (!parsed.ok) throw new CarouselServerError('invalid', `The saved template is damaged and could not be opened: ${parsed.errors.slice(0, 3).join('; ')}`, { details: parsed.errors })
  return { ...summaryFrom(w), document: parsed.document }
}

export function createHttpTemplateStore(api: { list(): Promise<{ data: unknown }>; get(id: number): Promise<{ data: unknown }>; create(b: Json): Promise<{ data: unknown }>; update(id: number, b: Json): Promise<{ data: unknown }>; duplicate(id: number): Promise<{ data: unknown }>; delete(id: number): Promise<unknown> }): TemplateStore {
  const clean = (d: PostDocument) => stripTokens(d, stripMediaToken)
  return {
    list: () => wrap(async () => ((await api.list()).data as WireTemplate[]).map(summaryFrom)),
    get: id => wrap(async () => templateFrom((await api.get(id)).data as WireTemplate)),
    create: i => wrap(async () => templateFrom((await api.create({ name: i.name, description: i.description, kind: i.kind, document: clean(i.document), brand_kit_id: i.brandKitId ?? null })).data as WireTemplate)),
    update: (id, p) => wrap(async () => templateFrom((await api.update(id, { ...(p.name !== undefined ? { name: p.name } : {}), ...(p.description !== undefined ? { description: p.description } : {}), ...(p.document ? { document: clean(p.document) } : {}) })).data as WireTemplate)),
    duplicate: id => wrap(async () => templateFrom((await api.duplicate(id)).data as WireTemplate)),
    remove: id => wrap(async () => { await api.delete(id) }),
  }
}

export type { Api }
