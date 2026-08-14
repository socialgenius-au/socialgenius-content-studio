import type { Lead } from '@/types/domain'

export const MOCK_LEADS: Record<string, Lead[]> = {
  'abc-motors': [
    { id: 'lead-1', clientId: 'abc-motors', name: 'Sarah Mitchell', source: 'Instagram', campaignId: 'camp-buying-confidence', contentId: 'ast-1', platform: 'Instagram', positioningTheme: 'Proof, not promises', owner: 'Dave Ranford', value: 28000, stage: 'appointment_quote', outcome: null, createdAt: '2026-08-10' },
    { id: 'lead-2', clientId: 'abc-motors', name: 'James Okafor', source: 'Google Business Profile', campaignId: null, contentId: null, platform: 'GBP', positioningTheme: 'Warranty as standard', owner: 'Dave Ranford', value: 19500, stage: 'qualified', outcome: null, createdAt: '2026-08-11' },
    { id: 'lead-3', clientId: 'abc-motors', name: 'Priya Chandran', source: 'Facebook', campaignId: 'camp-buying-confidence', contentId: 'ast-2', platform: 'Facebook', positioningTheme: 'Family Confidence', owner: 'Sales', value: 24500, stage: 'new', outcome: null, createdAt: '2026-08-12' },
    { id: 'lead-4', clientId: 'abc-motors', name: 'Tom Reeve', source: 'Website', campaignId: null, contentId: null, platform: 'Website', positioningTheme: 'No surprises', owner: 'Sales', value: 15000, stage: 'contacted', outcome: null, createdAt: '2026-08-09' },
    { id: 'lead-5', clientId: 'abc-motors', name: 'Grace Liu', source: 'Referral', campaignId: null, contentId: null, platform: 'Referral', positioningTheme: 'Proof, not promises', owner: 'Dave Ranford', value: 31000, stage: 'won', outcome: 'Purchased 2023 Mazda CX-5', createdAt: '2026-07-28' },
    { id: 'lead-6', clientId: 'abc-motors', name: 'Aiden Foster', source: 'Instagram', campaignId: 'camp-buying-confidence', contentId: 'ast-1', platform: 'Instagram', positioningTheme: 'Proof, not promises', owner: 'Sales', value: 12000, stage: 'lost', outcome: 'Bought cheaper elsewhere, price sensitive', createdAt: '2026-07-30' },
    { id: 'lead-7', clientId: 'abc-motors', name: 'Meg Halvorsen', source: 'Phone', campaignId: null, contentId: null, platform: 'Phone', positioningTheme: 'Warranty as standard', owner: 'Dave Ranford', value: 22000, stage: 'opportunity', outcome: null, createdAt: '2026-08-13' },
  ],
  'apni-dukaan': [],
  'smplee-packaging': [],
}

export const LEAD_STAGES: { id: Lead['stage']; label: string }[] = [
  { id: 'new', label: 'New' },
  { id: 'contacted', label: 'Contacted' },
  { id: 'qualified', label: 'Qualified' },
  { id: 'opportunity', label: 'Opportunity' },
  { id: 'appointment_quote', label: 'Appointment / Quote' },
  { id: 'won', label: 'Won' },
  { id: 'lost', label: 'Lost' },
]
