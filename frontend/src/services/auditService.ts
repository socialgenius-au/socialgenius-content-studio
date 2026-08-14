import type { AuditDimension } from '@/types/domain'
import { MOCK_AUDIT } from '@/mocks/audit'
import { mockDelay } from './_shared'

// TODO(integration): owned by the Social Audit engine.
// GET /clients/:id/audit
export const auditService = {
  list: (clientId: string): Promise<AuditDimension[]> => mockDelay(MOCK_AUDIT[clientId] ?? []),
}
