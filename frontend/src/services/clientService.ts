import type { Client } from '@/types/domain'
import { MOCK_CLIENTS, getClientById } from '@/mocks/clients'
import { mockDelay } from './_shared'

export interface NewClientInput {
  name: string
  industry: string
  location: string
  contact: { name: string; email: string; phone: string }
  goals: string[]
  targetCustomers: string
  capabilitiesSummary: string
  constraintsSummary: string
}

const PALETTE = ['#8B5CF6', '#EC5A9C', '#F2793C', '#F0B429', '#2FD8C8', '#1E3D2A', '#C89A2E']

function slugify(name: string): string {
  const base = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'client'
  let id = base
  let suffix = 2
  while (getClientById(id)) {
    id = `${base}-${suffix}`
    suffix++
  }
  return id
}

// TODO(integration): GET /clients, GET /clients/:id, POST /clients — owned by
// Content Studio backend (client is the shared context object every other
// service keys off).
export const clientService = {
  list: (): Promise<Client[]> => mockDelay(MOCK_CLIENTS),
  get: (id: string): Promise<Client | undefined> => mockDelay(getClientById(id)),
  create: (input: NewClientInput): Promise<Client> => {
    const id = slugify(input.name)
    const client: Client = {
      id,
      name: input.name,
      industry: input.industry,
      location: input.location,
      logoInitial: input.name.trim().charAt(0).toUpperCase() || '?',
      color: PALETTE[MOCK_CLIENTS.length % PALETTE.length],
      contact: input.contact,
      goals: input.goals,
      targetCustomers: input.targetCustomers,
      capabilitiesSummary: input.capabilitiesSummary,
      constraintsSummary: input.constraintsSummary,
      servicePlanId: `plan-${id}`,
      activeCampaignId: null,
      positioningStatus: 'not_started',
      positioningConfidence: 0,
      positioningAlignment: 0,
      strategicPriority: 'Not yet set — Strategic Intelligence audit scheduled next.',
    }
    MOCK_CLIENTS.push(client)
    return mockDelay(client)
  },
}
