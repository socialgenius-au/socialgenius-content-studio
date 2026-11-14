// M7 -- "Learning from Previous Videos": the model behind the lessons panel in New Content. Lessons are the person's OWN accepted recommendations from earlier videos (Learn stage). They are guidance, never verified
// performance improvements, and nothing is applied unless the person selects it. Ranking, classification and conflicts are computed on the server (services/learning_guidance.py); this file only shapes the request and the selection.
import type { IntentForm } from './intentForm'
import { splitLines } from './intentForm'

export interface LessonRelevance { score: number; relevant: boolean; reasons: string[]; conflicts: string[] }
export interface LessonCandidate {
  lesson_id: number
  text: string
  basis: 'evidence' | 'hypothesis'
  classification: string
  classification_label: string
  qualifier_labels: string[]
  confidence: { level: string; source: string }
  evidence: string[]
  caveat: string | null
  user_note: string | null
  source: { draft_id: number | null; draft_name: string; blueprint_id: string | null; platform: string | null; accepted_at: string | null }
  relevance: LessonRelevance | null
  notice: string
}
export interface LessonBrief { product: string | null; audience: string | null; objective: string | null; platform: string | null; duration_seconds: number | null; cta: boolean; tone: string[]; mandatory: string[]; prohibited: string[] }

export const LESSONS_HEADING = 'Learning from Previous Videos'
export const LESSONS_NOTICE = 'These are recommendations you accepted on earlier videos. They are guidance for design decisions, not verified performance improvements: nothing here says any change raised reach, engagement, conversions or retention.'

const clean = (s: string) => s.replace(/\s+/g, ' ').trim()

/** The part of the form that decides which lessons are relevant. Whatever is blank stays blank (nothing is invented). */
export function briefFromForm(f: IntentForm): LessonBrief {
  const n = Number(clean(f.durationSeconds))
  return {
    product: clean(f.product) || null, audience: clean(f.audience) || null, objective: clean(f.objective) || null, platform: clean(f.platform) || null,
    duration_seconds: clean(f.durationSeconds) && Number.isFinite(n) && n >= 0 && n <= 600 ? n : null, cta: !!clean(f.cta),
    tone: splitLines(f.tone).slice(0, 20), mandatory: splitLines(f.mandatory).slice(0, 20), prohibited: splitLines(f.prohibited).slice(0, 20),
  }
}

export const briefKey = (b: LessonBrief) => JSON.stringify(b)

/** Lessons worth suggesting: relevant to this brief and not in conflict with it. */
export const suggestedIds = (lessons: LessonCandidate[]): number[] => lessons.filter(l => l.relevance?.relevant && !(l.relevance?.conflicts.length)).map(l => l.lesson_id)

/** A selection can only contain lessons that are still on offer (the list changes as the brief changes). */
export const prune = (selected: ReadonlySet<number>, lessons: LessonCandidate[]): Set<number> => {
  const on = new Set(lessons.map(l => l.lesson_id))
  return new Set([...selected].filter(id => on.has(id)))
}

export const toggle = (selected: ReadonlySet<number>, id: number): Set<number> => {
  const next = new Set(selected)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

/** What is actually sent with the blueprint request: nothing when the person turned lessons off. */
export const idsToSend = (useLessons: boolean, selected: ReadonlySet<number>): number[] => (useLessons ? [...selected].sort((a, b) => a - b) : [])

export const confidenceText = (c: { level: string; source: string }) => (c.level === 'unknown' ? 'confidence not recorded' : `confidence ${c.level} (${c.source.startsWith('documented') ? 'from the rule, not measured' : c.source})`)
