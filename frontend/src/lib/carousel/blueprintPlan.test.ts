import { describe, expect, it } from 'vitest'
import ref5131 from '../../pages/deconstructor/__fixtures__/ref5131.c4-blueprint.json'
import va5368 from '../../pages/deconstructor/__fixtures__/va5368.c4-blueprint.json'
import type { Blueprint, BlueprintResponse } from '../../types/deconstructor'
import { validatePostDocument } from '../postDocument'
import { exportWarnings } from './exporter'
import { carouselFromPlan, condenseSections, layoutForRole, planCarouselFromBlueprint } from './blueprintPlan'

const bp5131 = (ref5131 as unknown as BlueprintResponse).blueprint as Blueprint
const bp5368 = (va5368 as unknown as BlueprintResponse).blueprint as Blueprint

describe('roles map to layouts', () => {
  it('opening is a cover, the last section is a call to action, and known roles pick sensible layouts', () => {
    expect(layoutForRole('opening', 0, 5)).toBe('cover')
    expect(layoutForRole('anything', 0, 5)).toBe('cover')
    expect(layoutForRole('call_to_action', 4, 5)).toBe('cta')
    expect(layoutForRole('whatever', 4, 5)).toBe('cta')
    expect(layoutForRole('demonstration', 2, 5)).toBe('image_caption')
    expect(layoutForRole('contrast', 2, 5)).toBe('statement')
    expect(layoutForRole('setup', 1, 5)).toBe('title_body')
    expect(layoutForRole('totally_new_role', 1, 5)).toBe('title_body')
  })

  it('condenses a long list keeping the first and last and sampling the middle evenly', () => {
    const xs = Array.from({ length: 14 }, (_, i) => i + 1)
    const c = condenseSections(xs, 8)
    expect(c).toHaveLength(8)
    expect(c[0]).toBe(1)
    expect(c[c.length - 1]).toBe(14)
    expect(c).toEqual([...c].sort((a, b) => a - b))
    expect(new Set(c).size).toBe(8)
    expect(condenseSections(xs.slice(0, 5), 8)).toEqual([1, 2, 3, 4, 5])
  })
})

describe('planning a carousel from the real stored blueprints (no AI call)', () => {
  it('turns each blueprint section into one planned slide with its mechanisms, evidence and limits', () => {
    const plan = planCarouselFromBlueprint(bp5131, { referenceVideoId: 5131 })
    expect(plan.blueprintId).toBe(bp5131.blueprint_id)
    expect(plan.slides).toHaveLength(bp5131.sections.length)
    expect(plan.slides.map(s => s.sectionNumber)).toEqual(bp5131.sections.map(s => s.section_number))
    expect(plan.slides[0].layout).toBe('cover')
    expect(plan.slides[plan.slides.length - 1].layout).toBe('cta')
    plan.slides.forEach((s, i) => {
      expect(s.headline).toBe(bp5131.sections[i].section_purpose)
      expect(s.instruction).toBe(bp5131.sections[i].content_instruction)
      expect(s.mechanisms.map(m => m.id)).toEqual(bp5131.sections[i].mechanisms_applied)
      s.mechanisms.forEach(m => expect(m.principle).toBeTruthy())                       // the TRANSFERABLE principle, not the reference's own description
    })
    expect(plan.doNotReproduce).toEqual(bp5131.constraints.do_not_reproduce)
    expect(plan.copyPolicy).toBeTruthy()
  })

  it('builds a valid Instagram 4:5 carousel: one slide per section, placeholder copy marked as placeholder, mechanisms and evidence recorded in provenance', () => {
    const plan = planCarouselFromBlueprint(bp5131, { referenceVideoId: 5131 })
    const doc = carouselFromPlan(plan, bp5131, { themeId: 'ivory' })
    expect(validatePostDocument(doc)).toEqual({ ok: true, errors: [] })
    expect(doc.pages).toHaveLength(bp5131.sections.length)
    expect(doc.format).toMatchObject({ platformKey: 'instagram', formatKey: 'carousel', width: 1080, height: 1350 })
    expect(doc.provenance.origin).toBe('template')
    expect(doc.provenance.importRef).toBe(`blueprint:${bp5131.blueprint_id}`)
    expect(doc.provenance.generation?.briefRef).toBe(bp5131.blueprint_id)
    expect(doc.provenance.generation?.engine).toMatch(/no AI call/)
    const refs = doc.provenance.generation!.intelligenceRefs!
    expect(refs).toContainEqual({ kind: 'reference_video', id: '5131' })
    for (const id of bp5131.mechanisms_used) expect(refs).toContainEqual({ kind: 'mechanism', id })
    const firstHeadline = doc.pages[0].elements.find(e => e.name === 'Headline')
    expect(firstHeadline?.type === 'text' && firstHeadline.content).toBe(bp5131.sections[0].section_purpose)
    // the instruction is guidance, not final copy: it is marked and the export check catches it
    expect(exportWarnings(doc).some(w => /placeholder text/.test(w))).toBe(true)
    // each slide keeps a HIDDEN plan note that is never painted
    doc.pages.forEach(p => {
      const note = p.elements.find(e => e.name === 'Plan note')
      expect(note?.visible).toBe(false)
      expect(note?.type === 'text' && note.content).toMatch(/^Section \d/)
    })
  })

  it('uses the new-content call to action on the closing slide, and falls back when there is none', () => {
    const plan = planCarouselFromBlueprint(bp5131)
    const withCta = carouselFromPlan(plan, bp5131, { intentCta: 'Book a free survey' })
    const last = withCta.pages[withCta.pages.length - 1]
    expect(last.elements.some(e => e.type === 'text' && e.content === 'Book a free survey')).toBe(true)
    const none = carouselFromPlan(plan, { ...bp5131, intent: { ...bp5131.intent, desired_cta: null } })
    expect(none.pages[none.pages.length - 1].elements.some(e => e.type === 'text' && e.content === 'Get in touch')).toBe(true)
  })

  it('keeps the cover\'s own Swipe prompt; the new-content call to action appears only on the closing slide', () => {
    const plan = planCarouselFromBlueprint(bp5131)
    const doc = carouselFromPlan(plan, bp5131, { intentCta: 'visit/showroom/contact for guidance' })
    const textsOf = (i: number) => doc.pages[i].elements.map(e => (e.type === 'text' ? e.content : ''))
    expect(textsOf(0)).toContain('Swipe →')
    expect(textsOf(0).some(t => /showroom/.test(t))).toBe(false)
    doc.pages.slice(1, -1).forEach((_, i) => expect(textsOf(i + 1).some(t => /showroom/.test(t))).toBe(false))
    expect(textsOf(doc.pages.length - 1)).toContain('visit / showroom / contact for guidance')
  })

  it('never copies the reference: no slide text contains a do-not-reproduce description, and plan text comes only from blueprint fields', () => {
    const plan = planCarouselFromBlueprint(bp5368)
    const doc = carouselFromPlan(plan, bp5368)
    const allText = doc.pages.flatMap(p => p.elements.map(e => (e.type === 'text' ? e.content : ''))).join('\n')
    for (const n of plan.doNotReproduce) expect(allText).not.toContain(n.description)
    expect(validatePostDocument(doc).ok).toBe(true)
  })

  it('condenses a long blueprint to the slide cap and says so', () => {
    const long: Blueprint = { ...bp5368, sections: Array.from({ length: 14 }, (_, i) => ({ ...bp5368.sections[i % bp5368.sections.length], section_number: i + 1, structural_role: i === 0 ? 'opening' : i === 13 ? 'call_to_action' : 'setup' })) }
    const plan = planCarouselFromBlueprint(long, { cap: 8 })
    expect(plan.slides).toHaveLength(8)
    expect(plan.condensedFrom).toBe(14)
    expect(plan.slides[0].sectionNumber).toBe(1)
    expect(plan.slides[7].sectionNumber).toBe(14)
    expect(plan.notes.join(' ')).toMatch(/14 sections; 8 slides/)
    expect(validatePostDocument(carouselFromPlan(plan, long)).ok).toBe(true)
  })
})
