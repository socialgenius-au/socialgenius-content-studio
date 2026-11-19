// Carousel Creator — planning a carousel from a Deconstructor reconstruction blueprint. No AI call, no network: a deterministic mapping.
//
// A blueprint describes how NEW content should be structured (sections with a purpose, a role, instructions and the transferable mechanisms applied), never the reference's own wording.
// Each blueprint section becomes one slide: its role picks a layout, its `section_purpose` becomes the starting headline, and its `content_instruction` becomes clearly-marked
// PLACEHOLDER copy that the person replaces (the export check flags any that remain). What cannot be turned into a visible element is kept as a hidden "Plan note" on the slide, and
// the document records the blueprint, the mechanisms and the evidence it came from in `provenance.generation`. The "do not reproduce" list is carried into the plan for display.
import type { Blueprint, BlueprintSection } from '../../types/deconstructor'
import type { PostDocument, PostElement } from '../postDocument'
import { createCarouselDocument, formatFromRegistry, INSTAGRAM_CAROUSEL } from './document'
import { themeById, type LayoutContent, type LayoutId } from './layouts'
import { makeText } from './ops'

export const DEFAULT_PLAN_SLIDE_CAP = 10

export interface PlannedSlide {
  sectionNumber: number
  layout: LayoutId
  headline: string
  instruction: string
  requiredInformation: string[]
  role: string
  mechanisms: { id: string; type: string; principle: string }[]
  evidenceAnatomySections: number[]
  confidence: string
  limitations: string[]
}

export interface CarouselPlan {
  blueprintId: string
  referenceVideoId: number | null
  structuralApproach: string
  slides: PlannedSlide[]
  condensedFrom?: number
  doNotReproduce: { mechanism_id: string; kind: string; description: string }[]
  mechanismsNotUsed: { id: string; type: string; reason: string }[]
  copyPolicy: string
  notes: string[]
}

/** Role -> layout. Matching is on the role text so new roles degrade to a sensible default instead of failing. */
export function layoutForRole(role: string, index: number, total: number): LayoutId {
  const r = role.toLowerCase()
  if (index === 0 || /open|hook|intro/.test(r)) return 'cover'
  if (index === total - 1 || /cta|call.?to.?action|clos|invit/.test(r)) return 'cta'
  if (/demonstrat|proof|evidence|example|show/.test(r)) return 'image_caption'
  if (/contrast|compar|versus|reveal|turn/.test(r)) return 'statement'
  if (/step|list|how/.test(r)) return 'list'
  if (/quote|testimon|social/.test(r)) return 'quote'
  return 'title_body'
}

/** Keeps the opening and the closing section and samples evenly from the middle, so a long blueprint still fits a carousel. */
export function condenseSections<T>(sections: T[], cap: number): T[] {
  if (sections.length <= cap || cap < 3) return sections.length <= cap ? sections : sections.slice(0, Math.max(cap, 1))
  const middle = sections.slice(1, -1)
  const want = cap - 2
  const picked: T[] = []
  for (let i = 0; i < want; i++) picked.push(middle[Math.floor((i * middle.length) / want)])
  return [sections[0], ...picked, sections[sections.length - 1]]
}

export function planCarouselFromBlueprint(bp: Blueprint, opts: { cap?: number; referenceVideoId?: number | null } = {}): CarouselPlan {
  const all = bp.sections
  const chosen: BlueprintSection[] = condenseSections(all, opts.cap ?? DEFAULT_PLAN_SLIDE_CAP)
  const dispo = new Map(bp.mechanism_dispositions.map(d => [d.mechanism_id, d]))
  const slides: PlannedSlide[] = chosen.map((s, i) => ({
    sectionNumber: s.section_number,
    layout: layoutForRole(s.structural_role, i, chosen.length),
    headline: s.section_purpose,
    instruction: s.content_instruction,
    requiredInformation: s.required_information ?? [],
    role: s.structural_role,
    mechanisms: (s.mechanisms_applied ?? []).map(id => ({ id, type: dispo.get(id)?.mechanism_type ?? 'unknown', principle: dispo.get(id)?.transferable_principle ?? '' })),
    evidenceAnatomySections: s.evidence_refs?.anatomy_section_numbers ?? [],
    confidence: s.confidence,
    limitations: s.limitations ?? [],
  }))
  const notes: string[] = []
  if (chosen.length < all.length) notes.push(`The blueprint has ${all.length} sections; ${chosen.length} slides keep the opening and closing and sample the middle. Add slides to bring any back.`)
  if (bp.gaps?.length) notes.push(`${bp.gaps.length} gap(s) in the blueprint's evidence are listed in its limitations; slide copy is guidance to write from, not finished wording.`)
  return {
    blueprintId: bp.blueprint_id,
    referenceVideoId: opts.referenceVideoId ?? null,
    structuralApproach: bp.structural_approach,
    slides,
    condensedFrom: chosen.length < all.length ? all.length : undefined,
    doNotReproduce: bp.constraints?.do_not_reproduce ?? [],
    mechanismsNotUsed: (bp.mechanisms_not_used ?? []).map(d => ({ id: d.mechanism_id, type: d.mechanism_type, reason: d.reason ?? '' })),
    copyPolicy: bp.constraints?.copy_policy ?? '',
    notes,
  }
}

export interface PlanToDocumentOptions { title?: string; themeId?: string; platformKey?: string; formatKey?: string; intentCta?: string | null }

/** Builds the starting carousel for a plan: one slide per planned slide, placeholder copy marked as such, and the plan recorded in the document's provenance. */
export function carouselFromPlan(plan: CarouselPlan, bp: Blueprint, opts: PlanToDocumentOptions = {}): PostDocument {
  const platformKey = opts.platformKey ?? INSTAGRAM_CAROUSEL.platformKey
  const formatKey = opts.formatKey ?? INSTAGRAM_CAROUSEL.formatKey
  const format = formatFromRegistry(platformKey, formatKey)
  const theme = themeById(opts.themeId)
  const cta = opts.intentCta ?? bp.intent?.desired_cta ?? undefined
  const contents: LayoutContent[] = plan.slides.map(s => ({
    // the new-content call to action belongs on the closing slide only; the cover keeps its own "Swipe" prompt

    headline: s.headline,
    body: `PLACEHOLDER — ${s.instruction}`,
    caption: `PLACEHOLDER — ${s.requiredInformation.length ? `Still needed: ${s.requiredInformation.join('; ')}` : s.instruction}`,
    items: s.requiredInformation.length ? s.requiredInformation.slice(0, 3).map(t => `PLACEHOLDER — ${t}`) : undefined,
    cta: s.layout === 'cta' ? cta || undefined : undefined,
    kicker: s.role.replace(/_/g, ' ').toUpperCase(),
  }))
  const doc = createCarouselDocument({
    title: opts.title ?? `Carousel — ${bp.intent?.product_service_or_topic ?? 'new content'}`.slice(0, 80),
    platformKey, formatKey, themeId: opts.themeId,
    layouts: plan.slides.map(s => s.layout), content: contents,
    names: plan.slides.map((s, i) => `${i + 1}. ${s.role.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())}`),
    provenance: {
      origin: 'template',
      importRef: `blueprint:${plan.blueprintId}`,
      generation: {
        briefRef: plan.blueprintId,
        intelligenceRefs: [
          ...(plan.referenceVideoId !== null ? [{ kind: 'reference_video', id: String(plan.referenceVideoId) }] : []),
          ...[...new Set(plan.slides.flatMap(s => s.mechanisms.map(m => m.id)))].map(id => ({ kind: 'mechanism', id })),
        ],
        promptSummary: plan.structuralApproach.slice(0, 300),
        engine: 'deconstructor blueprint mapping (no AI call)',
      },
      note: plan.copyPolicy || undefined,
    },
  })
  // Hidden per-slide "Plan note": the instruction, mechanisms and limits behind the slide. Hidden elements stay in the data and are never exported.
  const pages = doc.pages.map((page, i) => {
    const s = plan.slides[i]
    const note: PostElement = makeText(format, {
      name: 'Plan note', role: 'other', visible: false, origin: 'template', x: 0.08, y: 0.9, width: 0.84,
      content: [`Section ${s.sectionNumber} (${s.role})`, s.instruction, s.mechanisms.length ? `Mechanisms: ${s.mechanisms.map(m => `${m.id} ${m.type}`).join(', ')}` : '', s.limitations.length ? `Limits: ${s.limitations.join(' | ')}` : ''].filter(Boolean).join('\n'),
    })
    return { ...page, elements: [...page.elements, note] }
  })
  return { ...doc, pages }
}
