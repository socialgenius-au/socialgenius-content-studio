import type { AnalyticsSnapshot } from '@/types/domain'
import { MOCK_ANALYTICS } from '@/mocks/analytics'
import { mockDelay } from './_shared'

// TODO(integration): owned by the shared Knowledge/Learning layer, reading
// connected-platform performance from SocialProFlow.
// GET /clients/:id/analytics
export const analyticsService = {
  get: (clientId: string): Promise<AnalyticsSnapshot | undefined> => mockDelay(MOCK_ANALYTICS[clientId]),
}
