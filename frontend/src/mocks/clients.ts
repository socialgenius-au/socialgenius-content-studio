import type { Client } from '@/types/domain'

// Sample data only — structured so it can be replaced by clientService's
// live API response without touching any component. See services/README.
export const MOCK_CLIENTS: Client[] = [
  {
    id: 'abc-motors',
    name: 'ABC Motors',
    industry: 'Used Cars',
    location: 'Brisbane, QLD',
    logoInitial: 'A',
    color: '#1E3D2A',
    contact: { name: 'Dave Ranford', email: 'dave@abcmotors.example', phone: '0400 111 222' },
    goals: ['Increase qualified enquiries', 'Reduce price-only negotiations', 'Build trust before the yard visit'],
    targetCustomers: 'Families and first-time buyers aged 28-55 who feel anxious about being ripped off buying a used car.',
    capabilitiesSummary: '3-point inspection, 3-month warranty on all stock, in-house finance partner, 4.8★ Google rating (212 reviews).',
    constraintsSummary: 'Small yard (40 cars), 2-person sales team, no service department on-site.',
    servicePlanId: 'plan-abc-motors',
    activeCampaignId: 'camp-buying-confidence',
    positioningStatus: 'pending_approval',
    positioningConfidence: 78,
    positioningAlignment: 64,
    strategicPriority: 'Shift the market\'s perception from "cheapest yard in town" to "the dealer that removes uncertainty."',
  },
  {
    id: 'apni-dukaan',
    name: 'Apni Dukaan',
    industry: 'Grocery & Retail',
    location: 'Logan, QLD',
    logoInitial: 'D',
    color: '#C89A2E',
    contact: { name: 'Priya Nair', email: 'priya@apnidukaan.example', phone: '0400 333 444' },
    goals: ['Grow repeat weekly shoppers', 'Promote fresh-produce range'],
    targetCustomers: 'South Asian households within 8km wanting authentic groceries at fair prices.',
    capabilitiesSummary: 'Daily fresh produce delivery, 3 store locations, loyalty app in pilot.',
    constraintsSummary: 'No dedicated marketing staff, owner-operated.',
    servicePlanId: 'plan-apni-dukaan',
    activeCampaignId: null,
    positioningStatus: 'draft',
    positioningConfidence: 41,
    positioningAlignment: 38,
    strategicPriority: 'Not yet set — Strategic Intelligence audit scheduled next.',
  },
  {
    id: 'smplee-packaging',
    name: 'Smplee Packaging',
    industry: 'B2B Manufacturing — Packaging',
    location: 'Ipswich, QLD',
    logoInitial: 'S',
    color: '#2FD8C8',
    contact: { name: 'Marcus Webb', email: 'marcus@smpleepackaging.example', phone: '0400 555 666' },
    goals: ['Win larger enterprise contracts', 'Reposition away from lowest-cost supplier'],
    targetCustomers: 'Procurement managers at mid-size FMCG brands needing reliable, compliant custom packaging.',
    capabilitiesSummary: 'ISO 9001 certified, 48-hour sample turnaround, sustainable stock options.',
    constraintsSummary: 'Long sales cycles, no case studies published yet.',
    servicePlanId: 'plan-smplee',
    activeCampaignId: null,
    positioningStatus: 'not_started',
    positioningConfidence: 0,
    positioningAlignment: 0,
    strategicPriority: 'Not yet set.',
  },
]

export function getClientById(id: string): Client | undefined {
  return MOCK_CLIENTS.find(c => c.id === id)
}
