import type { ServicePlan } from '@/types/domain'

export const MOCK_SERVICE_PLANS: Record<string, ServicePlan> = {
  'plan-abc-motors': {
    id: 'plan-abc-motors',
    name: 'Growth — ABC Motors',
    clientId: 'abc-motors',
    entitlements: [
      { key: 'content.reels', label: 'Reels', enabled: true, quantity: 3, frequency: 'weekly', serviceLevel: 'priority', clientFacing: true, usageLimit: null },
      { key: 'content.posts', label: 'Posts', enabled: true, quantity: 1, frequency: 'weekly', serviceLevel: 'standard', clientFacing: true, usageLimit: null },
      { key: 'content.carousels', label: 'Carousels', enabled: true, quantity: 1, frequency: 'weekly', serviceLevel: 'standard', clientFacing: true, usageLimit: null },
      { key: 'content.blog', label: 'Blog', enabled: true, quantity: 1, frequency: 'monthly', serviceLevel: 'standard', clientFacing: true, usageLimit: null },
      { key: 'content.press_release', label: 'Press Releases', enabled: false, quantity: 0, frequency: 'monthly', serviceLevel: 'standard', clientFacing: false, usageLimit: null },
      { key: 'intelligence.macro', label: 'Strategic Intelligence — Macro', enabled: true, quantity: 1, frequency: 'monthly', serviceLevel: 'standard', clientFacing: false, usageLimit: null },
      { key: 'leads.whatsapp', label: 'WhatsApp Nurture', enabled: true, quantity: 1, frequency: 'custom', serviceLevel: 'priority', clientFacing: true, usageLimit: null },
      { key: 'publish.linkedin', label: 'LinkedIn Publishing', enabled: false, quantity: 0, frequency: 'weekly', serviceLevel: 'standard', clientFacing: true, usageLimit: null },
    ],
  },
  'plan-apni-dukaan': {
    id: 'plan-apni-dukaan',
    name: 'Starter — Apni Dukaan',
    clientId: 'apni-dukaan',
    entitlements: [
      { key: 'content.posts', label: 'Posts', enabled: true, quantity: 2, frequency: 'weekly', serviceLevel: 'standard', clientFacing: true, usageLimit: null },
      { key: 'content.reels', label: 'Reels', enabled: false, quantity: 0, frequency: 'weekly', serviceLevel: 'standard', clientFacing: true, usageLimit: null },
    ],
  },
  'plan-smplee': {
    id: 'plan-smplee',
    name: 'Starter — Smplee Packaging',
    clientId: 'smplee-packaging',
    entitlements: [
      { key: 'content.posts', label: 'Posts', enabled: true, quantity: 1, frequency: 'fortnightly', serviceLevel: 'standard', clientFacing: true, usageLimit: null },
    ],
  },
}
