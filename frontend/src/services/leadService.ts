import type { Lead } from '@/types/domain'
import { MOCK_LEADS } from '@/mocks/leads'
import { mockDelay } from './_shared'

// TODO(integration): owned by Content Studio's Leads & Sales module, likely
// backed by OpsGenius or a dedicated CRM service.
// GET /clients/:id/leads, PATCH /leads/:id { stage }
export const leadService = {
  list: (clientId: string): Promise<Lead[]> => mockDelay(MOCK_LEADS[clientId] ?? []),
}
