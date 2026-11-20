// Carousel Creator - the account's design library: reusable elements and backgrounds. Using an item always inserts a COPY (new ids); the saved item never changes.
import { stripMediaToken } from '../../api/mediaAccess'
import type { Background, PostDocument, PostElement } from '../postDocument'
import { cloneElement, type OpContext } from './ops'
import { toServerError } from './serverStore'
import { stripTokens } from './storage'

export interface LibrarySummary { id: number; name: string; kind: 'elements' | 'background' }
export type LibraryItem = LibrarySummary & ({ kind: 'elements'; elements: PostElement[] } | { kind: 'background'; background: Background })

export interface LibraryStore {
  list(): Promise<LibrarySummary[]>
  get(id: number): Promise<LibraryItem>
  saveElements(name: string, elements: PostElement[]): Promise<LibraryItem>
  saveBackground(name: string, background: Background): Promise<LibraryItem>
  rename(id: number, name: string): Promise<void>
  remove(id: number): Promise<void>
}

interface Api { list(): Promise<{ data: unknown }>; get(id: number): Promise<{ data: unknown }>; create(b: Record<string, unknown>): Promise<{ data: unknown }>; rename(id: number, name: string): Promise<unknown>; delete(id: number): Promise<unknown> }
const wrap = async <T,>(fn: () => Promise<T>): Promise<T> => { try { return await fn() } catch (e) { throw toServerError(e) } }

/** Elements with media tokens removed, as a plain copy (what gets stored). */
function cleanElements(els: PostElement[]): PostElement[] {
  const holder = { pages: [{ elements: els }] } as unknown as PostDocument
  return stripTokens(holder, stripMediaToken).pages[0].elements
}
function cleanBackground(bg: Background): Background {
  const holder = { pages: [{ background: bg, elements: [] }] } as unknown as PostDocument
  return stripTokens(holder, stripMediaToken).pages[0].background
}

export function createHttpLibraryStore(api: Api): LibraryStore {
  const from = (w: { id: number; name: string; kind: 'elements' | 'background'; item: { elements?: PostElement[]; background?: Background } }): LibraryItem =>
    (w.kind === 'elements' ? { id: w.id, name: w.name, kind: 'elements', elements: w.item.elements ?? [] } : { id: w.id, name: w.name, kind: 'background', background: w.item.background as Background })
  return {
    list: () => wrap(async () => (await api.list()).data as LibrarySummary[]),
    get: id => wrap(async () => from((await api.get(id)).data as never)),
    saveElements: (name, elements) => wrap(async () => from((await api.create({ name, kind: 'elements', item: { elements: cleanElements(elements) } })).data as never)),
    saveBackground: (name, background) => wrap(async () => from((await api.create({ name, kind: 'background', item: { background: cleanBackground(background) } })).data as never)),
    rename: (id, name) => wrap(async () => { await api.rename(id, name) }),
    remove: id => wrap(async () => { await api.delete(id) }),
  }
}

/** Fresh copies of a saved set of elements, ready to drop on a slide (every element and group child gets a new id). */
export const instantiateElements = (els: PostElement[], ctx?: OpContext): PostElement[] => els.map(e => cloneElement({ ...e, locked: false }, ctx))
