import type { AuditDimension } from '@/types/domain'

export const MOCK_AUDIT: Record<string, AuditDimension[]> = {
  'abc-motors': [
    { id: 'aud-1', name: 'Website & SEO Presence', currentScore: 58, strategicImportance: 'high', gap: 'No inspection reports published per-listing; weak local SEO for "used car dealer + suburb" terms.', evidence: 'Site crawl + Search Console, Jul 2026', recommendedAction: 'Publish inspection PDFs and add suburb-specific landing content.', impact: 'high', owner: 'Content Creator', timeline: '30 days' },
    { id: 'aud-2', name: 'Google Business Profile', currentScore: 81, strategicImportance: 'high', gap: 'Strong reviews, but posts still price-led.', evidence: 'GBP post history, last 90 days', recommendedAction: 'Shift GBP post mix to warranty/proof angles.', impact: 'medium', owner: 'Content Creator', timeline: '14 days' },
    { id: 'aud-3', name: 'Social Presence (Instagram/Facebook)', currentScore: 47, strategicImportance: 'high', gap: 'Posting inconsistent, no clear content pillars, mostly inventory listings.', evidence: 'Channel audit, Jul 2026', recommendedAction: 'Introduce messaging-pillar-based content calendar.', impact: 'high', owner: 'Content Creator', timeline: '30 days' },
    { id: 'aud-4', name: 'Reputation & Reviews', currentScore: 88, strategicImportance: 'high', gap: 'Excellent rating, but reviews aren\'t surfaced anywhere off-platform.', evidence: 'Google Reviews export', recommendedAction: 'Feature review excerpts in ad creative and on-site.', impact: 'medium', owner: 'Strategist', timeline: '14 days' },
    { id: 'aud-5', name: 'Paid Advertising', currentScore: 39, strategicImportance: 'medium', gap: 'No structured campaign, ad-hoc boosted posts only.', evidence: 'Meta Ads Manager review', recommendedAction: 'Build Buying Confidence campaign with proper audience/objective structure.', impact: 'high', owner: 'Strategist', timeline: '30 days' },
    { id: 'aud-6', name: 'Website Conversion Path', currentScore: 52, strategicImportance: 'medium', gap: 'No clear enquiry CTA above the fold, finance pre-approval buried.', evidence: 'UX heuristic review', recommendedAction: 'Add finance pre-approval CTA to homepage and listings.', impact: 'medium', owner: 'Operations', timeline: '21 days' },
    { id: 'aud-7', name: 'Local / Directory Listings', currentScore: 64, strategicImportance: 'low', gap: 'Listed but inconsistent NAP data across directories.', evidence: 'Directory scan', recommendedAction: 'Standardise business listings.', impact: 'low', owner: 'Operations', timeline: '14 days' },
    { id: 'aud-8', name: 'Video / Visual Content', currentScore: 33, strategicImportance: 'high', gap: 'No walkaround videos published — a stated differentiator isn\'t being shown.', evidence: 'Asset library review', recommendedAction: 'Produce walkaround video template and shoot backlog of current stock.', impact: 'high', owner: 'Content Creator', timeline: '30 days' },
    { id: 'aud-9', name: 'Email / Newsletter', currentScore: 21, strategicImportance: 'low', gap: 'No newsletter list or cadence exists.', evidence: 'No Beehiiv activity found', recommendedAction: 'Defer — low priority relative to social/paid gaps.', impact: 'low', owner: 'Strategist', timeline: '90 days' },
  ],
  'apni-dukaan': [],
  'smplee-packaging': [],
}
