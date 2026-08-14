import type { StrategicInitiative } from '@/types/domain'
import { MOCK_INITIATIVES } from '@/mocks/strategy'
import { mockDelay } from './_shared'

// TODO(integration): owned by Content Studio's strategy layer, reading from
// Strategic Intelligence + Positioning outputs.
// GET /clients/:id/strategy/initiatives?horizon=30|60|90
export const strategyService = {
  list: (clientId: string): Promise<StrategicInitiative[]> => mockDelay(MOCK_INITIATIVES[clientId] ?? []),
}
