import type { CreativeOption, PositioningGateCheck } from '@/types/domain'
import { MOCK_ANGLE_OPTIONS, MOCK_MORE_ANGLE_OPTIONS, MOCK_STRUCTURE_OPTIONS, MOCK_CTA_OPTIONS, type StructureOption, type CtaOption } from '@/mocks/creative'
import { mockDelay } from './_shared'

const PRICE_LED_PATTERN = /\b(cheap(est)?|lowest price|discount|bargain|deal of the (day|week)|clearance)\b/i

// TODO(integration): owned by Content Studio's AI generation service
// (backend/app/services/generate_svc.py already does Claude-backed generation
// for plans/chat — this would extend that to angle/hook/CTA alternatives).
// POST /clients/:id/create/alternatives { stage: 'angle'|'structure'|'cta', campaignId }
export const contentService = {
  getAngleOptions: (): Promise<CreativeOption[]> => mockDelay(MOCK_ANGLE_OPTIONS, 600),
  getMoreAngleOptions: (excludeIds: string[]): Promise<CreativeOption[]> =>
    mockDelay(MOCK_MORE_ANGLE_OPTIONS.filter(a => !excludeIds.includes(a.id)), 900),
  getStructureOptions: (): Promise<StructureOption[]> => mockDelay(MOCK_STRUCTURE_OPTIONS, 400),
  getCtaOptions: (): Promise<CtaOption[]> => mockDelay(MOCK_CTA_OPTIONS, 400),
  checkPositioningGate: (optionId: string, pitchText?: string): Promise<PositioningGateCheck> => {
    // Deterministic mock so the demo workflow is reproducible, not random —
    // the angle-a case is fixed for the section 74 walkthrough; anything else
    // is evaluated with a simple keyword heuristic so custom/modified pitches
    // (from "Write my own" / "Modify") still get a believable, non-random result.
    let result: PositioningGateCheck
    if (optionId === 'angle-a') {
      result = {
        result: 'amber',
        reason: 'Fear-based framing serves attention well but leans harder on risk than the approved "Family Confidence" pillar.',
        corrections: ['Soften the opening line', 'Pair with a proof point within the first 3 seconds', 'Approve as a tactical exception if attention is the priority this week'],
      }
    } else if (pitchText && PRICE_LED_PATTERN.test(pitchText)) {
      result = {
        result: 'red',
        reason: 'This leads with price, which contradicts the approved "Proof, not promises" positioning — the market would learn the wrong lesson about this business.',
        corrections: ['Replace the price mention with a proof point (inspection, warranty, reviews)', 'Reframe the hook around certainty rather than cost', 'Route this to a dedicated price-led campaign instead, if one is needed'],
      }
    } else {
      result = {
        result: 'green',
        reason: 'Aligned with the approved positioning statement and messaging pillars.',
        corrections: [],
      }
    }
    return mockDelay(result, 500)
  },
}
