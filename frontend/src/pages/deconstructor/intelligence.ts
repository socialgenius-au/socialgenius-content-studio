// "How this reference works creatively": the view model behind the New Content panel and the Anatomy additions. Everything here is a plain-language rendering of the server's creative-intelligence record
// (services/creative_intelligence.py): nothing is computed, ranked or invented in the browser, and no AI is called.
import { fmtSeconds } from './viewModel'

export interface EvidenceItem { kind: string; id: number; section: number | null; start_time: number | null; end_time: number | null; reliable: boolean | null; finding_kind?: string }
export interface IntelligenceMechanism {
  mechanism_id: string
  type: string
  other_label: string | null
  purpose: string
  position: string | null
  sections: { number: number; start_time: number; end_time: number }[]
  evidence: { visual: EvidenceItem[]; audio: EvidenceItem[]; text: EvidenceItem[]; editing: EvidenceItem[] }
  evidence_channels: Record<string, number>
  unreliable_channels: string[]
  confidence: string | null
  limitations: string[]
  transferable_principle: string | null
  conditions: { applies_when: string[]; avoid_when: string[]; source: string }
  adaptation_guidance: string[]
  reuse_vs_copy: { reuse: string | null; never_copy: { kind: string; description: string }[] }
  reference_description: { text: string | null }
}
export interface HookProfile {
  window: { start_time: number | null; end_time: number | null }
  classification: { primary_type: string | null; secondary_types: string[]; probable_intent: string | null }
  attention_mechanism: string | null
  channels: Record<string, { present: boolean; element_count: number; reliable: boolean | null; first_seen: number | null }>
  elements: { element_type: string; channels: string[]; start_time: number | null; end_time: number | null; reliability: string; reliability_note: string | null }[]
  relationships: string[]
  contradictions: { topic: string; status: string; note: string }[]
  unsupported: string[]
}
export interface NarrativeProgression { status: string; arc_text: string | null; sections: { section: number; role_label: string | null; basis: string }[]; uncertainty: string[]; unsupported: string[] }
export interface StructureCheck { partition: { scenes: string; beats: string; shots: number }; issues: { code: string; message: string }[]; uncertainty: string[]; reasoning: { beat: { examined: number; accepted: number; rejected: number; undecided: number }; scene: { examined: number; accepted: number; rejected: number; undecided: number } } }
export interface CreativeIntelligence {
  schema: string
  status: 'ready' | 'mechanisms_stale' | 'mechanisms_not_run' | 'mechanisms_unknown'
  hook: HookProfile | null
  narrative: NarrativeProgression | null
  structure: StructureCheck | null
  mechanisms: IntelligenceMechanism[]
  contradictions: { topic: string; status: string; note: string; sections: number[] | null }[]
  audience_effects: { status: string; statement: string }
  reuse_policy: { reuse: string; never_copy: string }
  limitations: string[]
}

export const INTELLIGENCE_HEADING = 'What this reference teaches'
export const REUSE_NOT_COPY = 'Reuse the mechanism, never copy the content.'
export const STATUS_NOTE: Record<CreativeIntelligence['status'], string | null> = {
  ready: null,
  mechanisms_not_run: 'The reference’s mechanisms have not been derived yet (Mechanisms step), so only the opening, progression and structure are shown.',
  mechanisms_stale: 'The mechanisms below are out of date: the reference analysis has changed since they were derived. Derive them again before relying on them.',
  mechanisms_unknown: 'We could not confirm the mechanisms still match the reference analysis.',
}

const title = (s: string) => s.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())
export const typeLabel = (m: Pick<IntelligenceMechanism, 'type' | 'other_label'>) => (m.type === 'other' && m.other_label ? m.other_label : title(m.type))
export const channelLabel = (c: string) => ({ spoken: 'Spoken words', on_screen_text: 'On-screen text', visual: 'Picture', editing_or_framing: 'Editing and framing', unspecified: 'Other' } as Record<string, string>)[c] ?? title(c)
const range = (a: number | null, b: number | null) => (a == null || b == null ? 'time not recorded' : `${fmtSeconds(a)}–${fmtSeconds(b)}`)

/** "Seen in section 1 (0:00–0:02): 2 picture items, 1 spoken (unverified)". */
export function evidenceSummary(m: IntelligenceMechanism): string {
  const parts: string[] = []
  const names: [keyof IntelligenceMechanism['evidence'], string][] = [['visual', 'picture'], ['audio', 'spoken or sound'], ['text', 'on-screen text'], ['editing', 'editing']]
  for (const [k, label] of names) {
    const items = m.evidence[k]
    if (!items.length) continue
    const weak = items.filter(i => i.reliable === false).length
    parts.push(`${items.length} ${label}${items.length === 1 ? ' item' : ' items'}${weak ? ` (${weak} unverified)` : ''}`)
  }
  const where = m.sections.map(s => `section ${s.number} (${range(s.start_time, s.end_time)})`).join(', ')
  return `${where || 'whole video'}: ${parts.join(', ') || 'no evidence items recorded'}`
}

export const hookSummary = (h: HookProfile): string => {
  const c = h.classification
  const kinds = [c.primary_type, ...(c.secondary_types ?? [])].filter(Boolean).map(x => title(x as string))
  return `${kinds.join(' + ') || 'Not classified'} · ${range(h.window.start_time, h.window.end_time)}`
}
