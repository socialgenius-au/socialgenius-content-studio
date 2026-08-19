import type { AnalyticsSnapshot } from '@/types/domain'

export const MOCK_ANALYTICS: Record<string, AnalyticsSnapshot> = {
  'abc-motors': {
    clientId: 'abc-motors',
    attention: { views: 48200, watchTime: '312 hrs', retention: 41, completion: 23, engagementRate: 6.8 },
    positioning: { alignmentScore: 64, drift: '58% of last 30 days\' content still price-led vs. desired warranty/trust balance.', sentiment: 'positive', dominantCustomerLanguage: ['trustworthy', 'no pressure', 'honest', 'still a bit pricey'] },
    business: { clicks: 2140, enquiries: 61, qualifiedLeads: 24, appointments: 9, sales: 3, revenue: 71500 },
    previousPeriod: { views: 41500, retention: 37, engagementRate: 5.9, alignmentScore: 57, clicks: 1860, enquiries: 52, qualifiedLeads: 19, appointments: 7, sales: 2 },
  },
  'apni-dukaan': {
    clientId: 'apni-dukaan',
    attention: { views: 0, watchTime: '0 hrs', retention: 0, completion: 0, engagementRate: 0 },
    positioning: { alignmentScore: 0, drift: 'No positioning approved yet — nothing to measure drift against.', sentiment: 'neutral', dominantCustomerLanguage: [] },
    business: { clicks: 0, enquiries: 0, qualifiedLeads: 0, appointments: 0, sales: 0, revenue: null },
    previousPeriod: null,
  },
  'smplee-packaging': {
    clientId: 'smplee-packaging',
    attention: { views: 0, watchTime: '0 hrs', retention: 0, completion: 0, engagementRate: 0 },
    positioning: { alignmentScore: 0, drift: 'No positioning approved yet.', sentiment: 'neutral', dominantCustomerLanguage: [] },
    business: { clicks: 0, enquiries: 0, qualifiedLeads: 0, appointments: 0, sales: 0, revenue: null },
    previousPeriod: null,
  },
}
