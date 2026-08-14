import type { IntelligenceFinding } from '@/types/domain'
import { MOCK_INTELLIGENCE } from '@/mocks/intelligence'
import { mockDelay } from './_shared'

// TODO(integration): owned by Strategic Intelligence engine.
// GET /clients/:id/intelligence?area=..., POST /clients/:id/intelligence/ask
export const intelligenceService = {
  list: (clientId: string): Promise<IntelligenceFinding[]> => mockDelay(MOCK_INTELLIGENCE[clientId] ?? []),
  ask: (_clientId: string, question: string): Promise<string> =>
    mockDelay(`This is a placeholder AI response — Ask Intelligence isn't connected to a live research engine yet. Your question was: "${question}"`, 500),
}
