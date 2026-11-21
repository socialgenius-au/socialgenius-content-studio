// Post Creator V2 - the post's own data, kept ENTIRELY inside the saved PostDocument (`context.workflow` and `context.message`), so one saved draft restores every stage and nothing lives
// in mock data. Pure functions (no React, no network) so they are unit tested.
import type { DocumentFormat, PostDocument, PostElement } from '../../lib/postDocument'
import { createCarouselDocument } from '../../lib/carousel/document'
import { customFormat } from '../../lib/carousel/formats'
import { exportWarnings } from '../../lib/carousel/exporter'
import { checkLimits } from '../../lib/carousel/platformLimits'
import { CAROUSEL_THEMES, DEFAULT_THEME_ID } from '../../lib/carousel/layouts'
import type { OpContext } from '../../lib/carousel/ops'

export const GOALS = ['Generate enquiries', 'Drive traffic', 'Build awareness', 'Promote an offer', 'Announce news', 'Other'] as const
export const THEMES = CAROUSEL_THEMES.map(t => ({ id: t.id, label: t.label }))

export interface PostBrief {
  title: string
  audience: string
  goal: string
  product: string
  keyMessage: string
  cta: string
  instructions: string
  themeId: string
  /** Brand Kit to apply when the post is started (optional). */
  brandKitId: number | null
}
export interface PostInsights { audience: string; painPoints: string; angles: string; proof: string; notes: string }
export interface PostReference { id: string; assetId: number; url: string; name: string; note: string }
export interface PostWorkflow { brief: PostBrief; insights: PostInsights; references: PostReference[] }

export const emptyBrief = (): PostBrief => ({ title: '', audience: '', goal: GOALS[0], product: '', keyMessage: '', cta: '', instructions: '', themeId: DEFAULT_THEME_ID, brandKitId: null })
export const emptyInsights = (): PostInsights => ({ audience: '', painPoints: '', angles: '', proof: '', notes: '' })

const str = (v: unknown, max = 4000): string => (typeof v === 'string' ? v.slice(0, max) : '')
export const MAX_REFERENCES = 12

/** Reads the workflow block of a saved document. Anything missing or malformed falls back to empty, so an old or hand-edited document can never break a stage. */
export function workflowOf(doc: PostDocument): PostWorkflow {
  const w = (doc.context.workflow ?? {}) as Record<string, unknown>
  const b = (w.brief ?? {}) as Record<string, unknown>
  const i = (w.insights ?? {}) as Record<string, unknown>
  const refs = Array.isArray(w.references) ? w.references : []
  const kit = Number(b.brandKitId)
  return {
    brief: { title: str(b.title ?? doc.title, 120), audience: str(b.audience), goal: str(b.goal) || GOALS[0], product: str(b.product), keyMessage: str(b.keyMessage), cta: str(b.cta, 200), instructions: str(b.instructions), themeId: str(b.themeId, 40) || DEFAULT_THEME_ID, brandKitId: Number.isInteger(kit) && kit > 0 ? kit : null },
    insights: { audience: str(i.audience), painPoints: str(i.painPoints), angles: str(i.angles), proof: str(i.proof), notes: str(i.notes) },
    references: refs.slice(0, MAX_REFERENCES).flatMap((r): PostReference[] => {
      const o = r as Record<string, unknown>
      const assetId = Number(o.assetId)
      return Number.isInteger(assetId) && assetId > 0 && typeof o.url === 'string' ? [{ id: str(o.id, 64) || `ref_${assetId}`, assetId, url: str(o.url, 2048), name: str(o.name, 120), note: str(o.note, 2000) }] : []
    }),
  }
}

/** The same document with the workflow (and the matching `context.message` the rest of the app already understands) replaced. A content edit: revision + 1. */
export function withWorkflow(doc: PostDocument, w: PostWorkflow, now: () => Date = () => new Date()): PostDocument {
  return {
    ...doc,
    revision: doc.revision + 1,
    updatedAt: now().toISOString(),
    context: {
      ...doc.context,
      message: { ...doc.context.message, keyMessage: w.brief.keyMessage || undefined, audience: w.brief.audience || undefined, objective: w.brief.goal || undefined, cta: w.brief.cta || undefined },
      workflow: { brief: w.brief, insights: w.insights, references: w.references },
    },
  }
}

export const postTitle = (b: PostBrief): string => (b.title.trim() || b.product.trim() || b.keyMessage.trim() || 'Untitled post').slice(0, 80)

/**
 * A new one-page post built from the brief, using the SAME layout engine as the Carousel Creator (so it is fully editable text, shapes and pictures on a real canvas of the chosen format).
 * Blank brief fields get honest, obviously editable starter wording rather than invented marketing claims.
 */
export function createPostDocument(brief: PostBrief, format: DocumentFormat, ctx?: OpContext): PostDocument {
  const isCustom = format.formatKey === 'custom'
  const base = createCarouselDocument({
    title: postTitle(brief),
    ...(isCustom ? {} : { platformKey: format.platformKey, formatKey: format.formatKey }),
    themeId: brief.themeId,
    layouts: ['cta'],
    names: ['Post'],
    content: [{ headline: brief.keyMessage.trim() || postTitle(brief), body: brief.product.trim() || 'Add a short supporting line', cta: brief.cta.trim() || 'Learn more' }],
    provenance: { origin: 'manual', note: 'post-creator-v2' },
  }, ctx)
  const withFormat: PostDocument = isCustom ? { ...base, format: customFormat(format.width, format.height) } : base
  return withWorkflow({ ...withFormat, revision: 0 }, { brief: { ...brief, title: postTitle(brief) }, insights: emptyInsights(), references: [] }, ctx?.now)
}

// ── real pre-publish checks (deterministic; no scores, no predictions) ───────────────────────

export interface ReviewCheck { id: string; status: 'pass' | 'warn' | 'info'; label: string; detail?: string }

const walkText = (els: PostElement[], out: { content: string; size: number }[] = []) => {
  for (const e of els) {
    if (!e.visible) continue
    if (e.type === 'text') out.push({ content: e.content, size: e.style.fontSize })
    else if (e.type === 'shape' && e.text?.content) out.push({ content: e.text.content, size: e.text.style.fontSize })
    else if (e.type === 'group') walkText(e.children, out)
  }
  return out
}
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()

/** What can be known about a finished post without guessing: it is checked against the brief the user wrote and against facts about the design. */
export function reviewChecks(doc: PostDocument): ReviewCheck[] {
  const w = workflowOf(doc)
  const texts = walkText(doc.pages[0]?.elements ?? [])
  const all = norm(texts.map(t => t.content).join(' \n '))
  const out: ReviewCheck[] = []
  out.push(texts.some(t => t.content.trim() !== '')
    ? { id: 'text', status: 'pass', label: 'The post has text' }
    : { id: 'text', status: 'warn', label: 'The post has no text', detail: 'Add a headline in Create.' })
  if (w.brief.keyMessage.trim()) {
    out.push(all.includes(norm(w.brief.keyMessage))
      ? { id: 'message', status: 'pass', label: 'Your key message is on the post' }
      : { id: 'message', status: 'warn', label: 'Your key message is not on the post', detail: `The brief says: "${w.brief.keyMessage.trim().slice(0, 80)}". It does not appear as text in the design.` })
  }
  if (w.brief.cta.trim()) {
    out.push(all.includes(norm(w.brief.cta))
      ? { id: 'cta', status: 'pass', label: 'Your call to action is on the post' }
      : { id: 'cta', status: 'warn', label: 'Your call to action is not on the post', detail: `The brief says: "${w.brief.cta.trim().slice(0, 60)}".` })
  } else out.push({ id: 'cta', status: 'info', label: 'No call to action was set in the brief' })
  const small = texts.filter(t => t.content.trim() !== '' && t.size < 0.022)
  out.push(small.length === 0
    ? { id: 'size', status: 'pass', label: 'No text is too small to read on a phone' }
    : { id: 'size', status: 'warn', label: `${small.length} text layer${small.length === 1 ? ' is' : 's are'} very small`, detail: 'Text under about 2% of the shorter side is hard to read on a phone.' })
  const ew = exportWarnings(doc)
  const empty = ew.filter(m => /still empty/.test(m)), placeholder = ew.filter(m => /placeholder/i.test(m))
  out.push(empty.length === 0 ? { id: 'images', status: 'pass', label: 'No empty picture slots' } : { id: 'images', status: 'warn', label: `${empty.length} empty picture slot${empty.length === 1 ? '' : 's'}`, detail: 'Empty slots export as blank space. Add a picture or delete the slot.' })
  out.push(placeholder.length === 0 ? { id: 'placeholder', status: 'pass', label: 'No planning placeholder text' } : { id: 'placeholder', status: 'warn', label: 'Placeholder text is still on the post', detail: placeholder[0] })
  for (const m of checkLimits(doc, { kind: 'image', slideCount: 1 })) out.push({ id: `limit-${out.length}`, status: 'warn', label: m })
  out.push(doc.context.brand?.brandKitId ? { id: 'brand', status: 'pass', label: 'A Brand Kit is applied' } : { id: 'brand', status: 'info', label: 'No Brand Kit is applied', detail: 'Optional: apply one in Create > Brand.' })
  return out
}

export const checkSummary = (checks: ReviewCheck[]) => ({ passed: checks.filter(c => c.status === 'pass').length, warnings: checks.filter(c => c.status === 'warn').length, total: checks.filter(c => c.status !== 'info').length })
