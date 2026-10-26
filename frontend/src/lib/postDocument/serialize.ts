// Post Document — JSON round-trip. (No persistence in P2: these only prove the model is plain, serialisable data.)
import { validatePostDocument } from './validate'
import type { PostDocument } from './types'

export function serializePostDocument(doc: PostDocument): string {
  return JSON.stringify(doc)
}

export type ParseResult = { ok: true; document: PostDocument } | { ok: false; errors: string[] }

/** Parses JSON text and validates it. A document from a newer/older schema version is rejected (no silent coercion). */
export function parsePostDocument(json: string): ParseResult {
  let raw: unknown
  try { raw = JSON.parse(json) } catch { return { ok: false, errors: ['not valid JSON'] } }
  const v = validatePostDocument(raw)
  return v.ok ? { ok: true, document: raw as PostDocument } : { ok: false, errors: v.errors }
}
