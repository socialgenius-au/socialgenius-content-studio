import type { OpsTask } from '@/types/domain'
import { MOCK_TASKS } from '@/mocks/tasks'
import { mockDelay } from './_shared'

// TODO(integration): owned by OpsGenius.
// GET /clients/:id/tasks, PATCH /tasks/:id { status }
export const opsService = {
  list: (clientId: string): Promise<OpsTask[]> => mockDelay(MOCK_TASKS[clientId] ?? []),
}
