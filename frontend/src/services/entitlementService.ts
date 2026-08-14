import type { EntitlementKey } from '@/types/domain'
import { MOCK_SERVICE_PLANS } from '@/mocks/servicePlans'
import { mockDelay } from './_shared'

// TODO(integration): owned by Content Studio. In production this resolves
// from the client's active ServicePlan (see servicePlanService) rather than
// scanning all mock plans.
export const entitlementService = {
  forClient: (servicePlanId: string): Promise<Record<EntitlementKey, { enabled: boolean; limit: number | null }>> => {
    const plan = MOCK_SERVICE_PLANS[servicePlanId]
    const map: Record<EntitlementKey, { enabled: boolean; limit: number | null }> = {}
    for (const e of plan?.entitlements ?? []) {
      map[e.key] = { enabled: e.enabled, limit: e.usageLimit }
    }
    return mockDelay(map)
  },
}
