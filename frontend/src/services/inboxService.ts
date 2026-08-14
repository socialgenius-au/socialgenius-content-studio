import type { Conversation } from '@/types/domain'
import { MOCK_CONVERSATIONS, MOCK_COMMUNITY_OPPORTUNITIES, type CommunityOpportunity } from '@/mocks/conversations'
import { mockDelay } from './_shared'

// TODO(integration): owned by SocialProFlow (channel messaging) + OpsGenius
// (escalation/SLA). GET /clients/:id/conversations, GET /clients/:id/community-opportunities
export const inboxService = {
  listConversations: (clientId: string): Promise<Conversation[]> => mockDelay(MOCK_CONVERSATIONS[clientId] ?? []),
  listCommunityOpportunities: (clientId: string): Promise<CommunityOpportunity[]> => mockDelay(MOCK_COMMUNITY_OPPORTUNITIES[clientId] ?? []),
}
