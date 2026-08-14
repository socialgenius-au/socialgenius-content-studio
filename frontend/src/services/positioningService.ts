import type { PositioningProfile, PositioningFramework, CapabilityMapItem, ExperienceStage } from '@/types/domain'
import { MOCK_POSITIONING, MOCK_FRAMEWORKS, MOCK_CAPABILITY_MAP, MOCK_EXPERIENCE_MAP } from '@/mocks/positioning'
import { mockDelay } from './_shared'

// TODO(integration): owned by the Positioning Tool engine.
// GET /clients/:id/positioning, POST /clients/:id/positioning/approve,
// GET /frameworks?type=positioning, GET /clients/:id/capability-map,
// GET /clients/:id/experience-map
export const positioningService = {
  get: (clientId: string): Promise<PositioningProfile | undefined> => mockDelay(MOCK_POSITIONING[clientId]),
  listFrameworks: (): Promise<PositioningFramework[]> => mockDelay(MOCK_FRAMEWORKS),
  capabilityMap: (clientId: string): Promise<CapabilityMapItem[]> => mockDelay(MOCK_CAPABILITY_MAP[clientId] ?? []),
  experienceMap: (clientId: string): Promise<ExperienceStage[]> => mockDelay(MOCK_EXPERIENCE_MAP[clientId] ?? []),
}
