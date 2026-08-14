import type { PlatformConnection, PlatformVersion } from '@/types/domain'
import { MOCK_CONNECTIONS, MOCK_PLATFORM_VERSIONS } from '@/mocks/connections'
import { mockDelay } from './_shared'

// TODO(integration): owned by SocialProFlow (OAuth + account connections).
// GET /clients/:id/connections, GET /content/:id/platform-versions
export const connectionService = {
  list: (clientId: string): Promise<PlatformConnection[]> => mockDelay(MOCK_CONNECTIONS[clientId] ?? []),
  platformVersions: (contentId: string): Promise<PlatformVersion[]> => mockDelay(MOCK_PLATFORM_VERSIONS[contentId] ?? []),
}
