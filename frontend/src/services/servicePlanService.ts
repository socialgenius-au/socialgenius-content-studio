import type { ServicePlan } from '@/types/domain'
import { MOCK_SERVICE_PLANS } from '@/mocks/servicePlans'
import { mockDelay } from './_shared'

// TODO(integration): owned by Content Studio (entitlements are the
// commercial contract driving what every other module shows/hides).
// GET /clients/:id/service-plan, PUT /clients/:id/service-plan
export const servicePlanService = {
  get: (planId: string): Promise<ServicePlan | undefined> => mockDelay(MOCK_SERVICE_PLANS[planId]),
}
