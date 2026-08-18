import type { KnowledgeItem, KnowledgeScope } from '@/types/domain'
import { MOCK_KNOWLEDGE } from '@/mocks/knowledge'
import { mockDelay } from './_shared'

// TODO(integration): owned by the shared Knowledge/Learning layer.
// GET /knowledge?scope=&industry=&clientId=, POST /knowledge/:id/promote (client -> industry/global, requires staff approval)
export const knowledgeService = {
  list: (scope?: KnowledgeScope, clientId?: string): Promise<KnowledgeItem[]> =>
    mockDelay(
      MOCK_KNOWLEDGE.filter(k => {
        if (scope && k.scope !== scope) return false
        if (clientId !== undefined && k.scope === 'client' && k.clientId !== clientId) return false
        return true
      })
    ),
}
