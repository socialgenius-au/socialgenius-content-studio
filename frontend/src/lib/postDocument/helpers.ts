// Post Document — small pure helpers shared by the validator, the renderer and tests.
import type { ColorRef, FontRef, PostDocument, PostElement, PostPage } from './types'

/** Every element of a page (groups first, then their children), in paint order at each level. */
export function walkElements(elements: PostElement[], visit: (el: PostElement, depth: number) => void, depth = 0): void {
  for (const el of elements) {
    visit(el, depth)
    if (el.type === 'group') walkElements(el.children, visit, depth + 1)
  }
}

export function allElements(doc: PostDocument): PostElement[] {
  const out: PostElement[] = []
  for (const p of doc.pages) walkElements(p.elements, e => out.push(e))
  return out
}

export const findElement = (doc: PostDocument, id: string): PostElement | undefined => allElements(doc).find(e => e.id === id)

/** The page a renderer draws in P2 (the first page). */
export const primaryPage = (doc: PostDocument): PostPage => doc.pages[0]

export type BrandTokens = Record<string, string>

/** Literal colour, or a brand token resolved from `tokens` with the literal fallback. Never reads the UI theme. */
export function resolveColor(ref: ColorRef, tokens?: BrandTokens): string {
  if (typeof ref === 'string') return ref
  return tokens?.[ref.token] ?? ref.fallback
}

export function resolveFont(ref: FontRef, tokens?: BrandTokens): string {
  if (typeof ref === 'string') return ref
  return tokens?.[ref.token] ?? ref.fallback
}

/** The shorter side of the document's canvas (export pixels) — the unit typography is expressed against. */
export const shorterSide = (doc: Pick<PostDocument, 'format'>): number => Math.min(doc.format.width, doc.format.height)
