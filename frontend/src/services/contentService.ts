import type { CreativeOption, PositioningGateCheck } from '@/types/domain'
import { MOCK_ANGLE_OPTIONS, MOCK_STRUCTURE_OPTIONS, MOCK_CTA_OPTIONS, type StructureOption, type CtaOption } from '@/mocks/creative'
import { mockDelay } from './_shared'

// TODO(integration): owned by Content Studio's AI generation service
// (backend/app/services/generate_svc.py already does Claude-backed generation
// for plans/chat — this would extend that to angle/hook/CTA alternatives).
// POST /clients/:id/create/alternatives { stage: 'angle'|'structure'|'cta', campaignId }
export const contentService = {
  getAngleOptions: (): Promise<CreativeOption[]> => mockDelay(MOCK_ANGLE_OPTIONS, 600),
  getStructureOptions: (): Promise<StructureOption[]> => mockDelay(MOCK_STRUCTURE_OPTIONS, 400),
  getCtaOptions: (): Promise<CtaOption[]> => mockDelay(MOCK_CTA_OPTIONS, 400),
  checkPositioningGate: (optionId: string): Promise<PositioningGateCheck> => {
    // Deterministic mock so the demo workflow is reproducible, not random.
    const result: PositioningGateCheck =
      optionId === 'angle-a'
        ? { result: 'amber', reason: 'Fear-based framing serves attention well but leans harder on risk than the approved "Family Confidence" pillar.', corrections: ['Soften the opening line', 'Pair with a proof point within the first 3 seconds', 'Approve as a tactical exception if attention is the priority this week'] }
        : { result: 'green', reason: 'Aligned with the approved positioning statement and messaging pillars.', corrections: [] }
    return mockDelay(result, 500)
  },
}
