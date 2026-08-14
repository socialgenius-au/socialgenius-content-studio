import type { BrandKit } from '@/types/domain'
import { MOCK_BRAND_KITS } from '@/mocks/brandKit'
import { mockDelay } from './_shared'

// TODO(integration): owned by Content Studio. GET/PUT /clients/:id/brand-kit,
// POST /clients/:id/brand-kit/logo (asset upload). Edits in BrandKitPage are
// local-state-only today — wire the PUT here once this endpoint exists.
export const brandKitService = {
  get: (clientId: string): Promise<BrandKit | undefined> => mockDelay(MOCK_BRAND_KITS[clientId]),
}
