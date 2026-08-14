import type { PositioningProfile, PositioningFramework, CapabilityMapItem, ExperienceStage, FrameworkComparison } from '@/types/domain'
import { MOCK_POSITIONING, MOCK_FRAMEWORKS, MOCK_CAPABILITY_MAP, MOCK_EXPERIENCE_MAP, buildFrameworkComparison } from '@/mocks/positioning'
import { mockDelay } from './_shared'

// TODO(integration): owned by the Positioning Tool engine.
// GET /clients/:id/positioning, POST /clients/:id/positioning/approve,
// GET /frameworks?type=positioning, GET /clients/:id/capability-map,
// GET /clients/:id/experience-map, POST /clients/:id/positioning/compare-framework,
// POST /clients/:id/positioning/switch-framework { frameworkId, reason }
export const positioningService = {
  get: (clientId: string): Promise<PositioningProfile | undefined> => mockDelay(MOCK_POSITIONING[clientId]),
  listFrameworks: (): Promise<PositioningFramework[]> => mockDelay(MOCK_FRAMEWORKS),
  capabilityMap: (clientId: string): Promise<CapabilityMapItem[]> => mockDelay(MOCK_CAPABILITY_MAP[clientId] ?? []),
  experienceMap: (clientId: string): Promise<ExperienceStage[]> => mockDelay(MOCK_EXPERIENCE_MAP[clientId] ?? []),
  compareFrameworks: (clientId: string, frameworkBId: string): Promise<FrameworkComparison | undefined> => {
    const profile = MOCK_POSITIONING[clientId]
    if (!profile) return mockDelay(undefined)
    const frameworkA = MOCK_FRAMEWORKS.find(f => f.id === profile.frameworkId)
    const frameworkB = MOCK_FRAMEWORKS.find(f => f.id === frameworkBId)
    if (!frameworkA || !frameworkB) return mockDelay(undefined)
    return mockDelay(buildFrameworkComparison(profile, frameworkA, frameworkB), 550)
  },
}
