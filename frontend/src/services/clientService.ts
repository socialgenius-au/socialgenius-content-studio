import type { Client } from '@/types/domain'
import { MOCK_CLIENTS, getClientById } from '@/mocks/clients'
import { mockDelay } from './_shared'

// TODO(integration): GET /clients, GET /clients/:id — owned by Content Studio
// backend (client is the shared context object every other service keys off).
export const clientService = {
  list: (): Promise<Client[]> => mockDelay(MOCK_CLIENTS),
  get: (id: string): Promise<Client | undefined> => mockDelay(getClientById(id)),
}
