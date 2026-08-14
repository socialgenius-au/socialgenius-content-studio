import type { Campaign } from '@/types/domain'
import { MOCK_CAMPAIGNS } from '@/mocks/campaigns'
import { mockDelay } from './_shared'

// TODO(integration): owned by Content Studio.
// GET /clients/:id/campaigns, GET /campaigns/:id
export const campaignService = {
  list: (clientId: string): Promise<Campaign[]> => mockDelay(MOCK_CAMPAIGNS[clientId] ?? []),
  get: (clientId: string, campaignId: string): Promise<Campaign | undefined> =>
    mockDelay((MOCK_CAMPAIGNS[clientId] ?? []).find(c => c.id === campaignId)),
}
