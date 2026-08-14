import type { PositioningFramework, PositioningProfile, CapabilityMapItem, ExperienceStage } from '@/types/domain'

export const MOCK_FRAMEWORKS: PositioningFramework[] = [
  { id: 'fw-local-service-v1', name: 'Local Service v1', version: '1.2', status: 'active', createdAt: '2026-03-01', changeSummary: 'Added proof-point weighting to differentiation score.', applicableIndustries: ['Used Cars', 'Trades', 'Local Retail'] },
  { id: 'fw-sme-general-v1', name: 'SME General v1', version: '1.0', status: 'active', createdAt: '2026-01-15', changeSummary: 'Initial release.', applicableIndustries: ['General SME'] },
  { id: 'fw-retail-v1', name: 'Retail v1', version: '0.9', status: 'draft', createdAt: '2026-06-20', changeSummary: 'Draft — awaiting a second client pilot before promoting to active.', applicableIndustries: ['Grocery & Retail', 'Ecommerce'] },
  { id: 'fw-b2b-v1', name: 'B2B v1', version: '1.0', status: 'active', createdAt: '2026-02-10', changeSummary: 'Initial release for longer sales-cycle clients.', applicableIndustries: ['B2B Manufacturing', 'Professional Services'] },
  { id: 'fw-experimental', name: 'Experimental Framework', version: '0.1', status: 'experimental', createdAt: '2026-07-01', changeSummary: 'Testing a jobs-to-be-done variant.', applicableIndustries: ['General SME'] },
]

export const MOCK_POSITIONING: Record<string, PositioningProfile> = {
  'abc-motors': {
    clientId: 'abc-motors',
    frameworkId: 'fw-local-service-v1',
    currentPosition: '"One of many used-car yards on the strip" — undifferentiated on price.',
    targetPosition: 'The transparent used-car dealer who removes uncertainty from buying.',
    desiredPerception: 'Buying here feels safer and more honest than buying from a stranger or a bigger yard.',
    targetCustomer: 'Families and first-time buyers, 28-55, anxious about being ripped off, value certainty over the lowest price.',
    categoryExpectations: ['Roadworthy certificate', 'Some room to negotiate', 'Pushy sales approach expected'],
    competitorPositions: [
      { name: 'Metro Auto Group', position: 'Biggest range, lowest advertised price' },
      { name: 'Private sellers (Facebook Marketplace)', position: 'Cheapest, but "buyer beware"' },
      { name: 'Certified Dealer Network', position: 'Premium, expensive, corporate' },
    ],
    differentiators: ['3-point independent inspection on every car', '3-month included warranty (most yards offer none)', 'Finance pre-approval before you visit'],
    proofPoints: ['212 Google reviews at 4.8★', 'Inspection report handed over at first visit, not requested', '38 warranty claims honoured in the last 12 months, zero disputes'],
    capabilities: ['In-house finance partner', 'Same-day inspection turnaround', 'Small enough that the owner meets every buyer'],
    constraints: ['No on-site service department — warranty repairs go to a partner workshop', 'Only 40 cars in stock at a time — cannot compete on range'],
    promise: 'Every car is independently inspected, warrantied, and explained in plain English before you commit.',
    reasonsToBelieve: ['Inspection report is public/shareable, not just verbal', 'Warranty terms are on the website, not "ask in store"', 'Video walkaround published for every car'],
    positioningStatement: 'For families who\'ve been burned before, ABC Motors is the used-car dealer that replaces guesswork with proof — an independent inspection, a real warranty, and no surprises.',
    messagingPillars: ['Proof, not promises', 'Warranty as standard, not upsell', 'Explained in plain English'],
    approvedClaims: ['3-month warranty on every vehicle', '3-point independent inspection', '4.8★ from 212 verified Google reviews'],
    claimsNotYetDeliverable: ['12-month warranty (under review with finance partner)', '"Best price guarantee" (no price-matching process exists yet)'],
    scores: { desirability: 82, differentiation: 74, deliverability: 88, sustainability: 69, note: 'Sustainability capped by warranty-claim costs at current margin — revisit if claim rate rises above 5%.' },
    approvalStatus: 'pending_approval',
    approvalHistory: [
      { date: '2026-07-02', actor: 'Strategist (Amelia R.)', action: 'Drafted positioning from Social Audit findings' },
      { date: '2026-07-18', actor: 'Dave Ranford (Client)', action: 'Reviewed', note: 'Loves the warranty angle, wants to double check claim numbers before sign-off.' },
    ],
  },
}

export const MOCK_CAPABILITY_MAP: Record<string, CapabilityMapItem[]> = {
  'abc-motors': [
    { id: 'cap-1', area: 'Proof', status: 'ready', note: 'Inspection reports and warranty terms already documented and shareable.' },
    { id: 'cap-2', area: 'Customer Service', status: 'ready', note: 'Owner personally handles escalations; response time under 2 hours.' },
    { id: 'cap-3', area: 'Product/Service', status: 'needs_improvement', note: 'Warranty claims process is manual — needs a documented SLA before it becomes a headline claim.' },
    { id: 'cap-4', area: 'Technology', status: 'needs_improvement', note: 'No CRM — leads currently tracked in a spreadsheet, risks slow follow-up.' },
    { id: 'cap-5', area: 'Capacity', status: 'not_deliverable', note: 'Cannot promise same-day delivery yet — no logistics partner in place.' },
    { id: 'cap-6', area: 'Pricing/Economics', status: 'ready', note: 'Margin supports current warranty cost at present claim rate.' },
    { id: 'cap-7', area: 'Management Commitment', status: 'ready', note: 'Owner has approved warranty-forward messaging and budget for it.' },
  ],
}

export const MOCK_EXPERIENCE_MAP: Record<string, ExperienceStage[]> = {
  'abc-motors': [
    { stage: 'Discover', promisedExperience: 'Sees a warranty-led ad, not a price-led one', currentReality: 'Most recent ads are still price-led', evidence: 'Last 6 GBP posts: 4 price-led, 2 warranty-led', gap: 'major', requiredAction: 'Shift campaign content mix toward proof/warranty angles' },
    { stage: 'Research', promisedExperience: 'Finds inspection report and reviews easily on site', currentReality: 'Reviews linked, but inspection reports not published per-vehicle', evidence: 'Website audit, July 2026', gap: 'major', requiredAction: 'Publish inspection PDF per listing' },
    { stage: 'Enquire', promisedExperience: 'Fast, warm, plain-English response', currentReality: 'Average response time 4 hours via Facebook', evidence: 'Inbox log sample, last 30 days', gap: 'minor', requiredAction: 'Set 1-hour response SLA during business hours' },
    { stage: 'Visit/Consult', promisedExperience: 'Walked through inspection report in person', currentReality: 'Already happens consistently', evidence: 'Mystery-shop visit, June 2026', gap: 'none', requiredAction: 'Maintain — no change needed' },
    { stage: 'Buy', promisedExperience: 'Finance pre-approval before final decision', currentReality: 'Finance offered but not pre-approved until after handshake', evidence: 'Sales process walkthrough', gap: 'minor', requiredAction: 'Move finance conversation earlier in the visit' },
    { stage: 'Receive', promisedExperience: 'Warranty pack physically handed over, explained', currentReality: 'Warranty pack given, rarely explained verbally', evidence: 'Staff interview', gap: 'minor', requiredAction: 'Add warranty walkthrough to handover checklist' },
    { stage: 'Support', promisedExperience: 'Warranty claims handled within 48 hours', currentReality: 'No documented SLA', evidence: 'Capability Map: cap-3', gap: 'major', requiredAction: 'Document and publish claims SLA' },
    { stage: 'Review', promisedExperience: 'Asked for a review referencing the warranty experience', currentReality: 'Generic review request sent', evidence: 'Review request template', gap: 'minor', requiredAction: 'Update review request copy to prompt warranty/inspection mentions' },
    { stage: 'Refer', promisedExperience: 'Easy way to refer a friend, tied to trust story', currentReality: 'No referral mechanism exists', evidence: 'No referral program found', gap: 'major', requiredAction: 'Design simple referral incentive' },
  ],
}
