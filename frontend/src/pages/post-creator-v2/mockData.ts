// UI-only placeholder content. Nothing here is wired to a backend yet —
// it exists so every tab renders a realistic, fully-populated screen for
// visual review. Shaped to be easy to swap for real client/API data later.

export const MOCK_CLIENT = {
  name: 'ABC Tiles',
  initials: 'AT',
  industry: 'Building Materials — Tile & Stone',
  brandKitStatus: 'complete' as const,
  researchStatus: 'complete' as const,
  positioningStatus: 'complete' as const,
  competitorIntelStatus: 'needs-refresh' as const,
}

export const REFERENCE_LIBRARY = [
  { id: 'r1', title: 'Modern kitchen porcelain feature wall', views: '2.4M', likes: '38K', tag: 'Library' },
  { id: 'r2', title: 'Dining space large-format grey tile', views: '1.8M', likes: '29K', tag: 'Library' },
  { id: 'r3', title: 'Builder trade-day flat lay', views: '1.2M', likes: '18K', tag: 'Library' },
  { id: 'r4', title: 'Bathroom vanity close-up texture', views: '950K', likes: '14K', tag: 'Library' },
  { id: 'r5', title: 'Showroom hero shot, natural light', views: '870K', likes: '12K', tag: 'Library' },
  { id: 'r6', title: 'Outdoor patio porcelain pavers', views: '620K', likes: '9K', tag: 'Library' },
  { id: 'r7', title: 'Competitor: stock-availability post', views: '410K', likes: '6.1K', tag: 'Competitors' },
  { id: 'r8', title: 'Popular: builder testimonial carousel', views: '3.1M', likes: '54K', tag: 'Popular' },
]

export const REFERENCE_DETAIL = {
  whyItWorked: 'Leads with a specific, verifiable stock claim ("In Stock") rather than a generic quality claim — removes the #1 objection builders raise before quoting.',
  breakdown: 'Hook (bold claim) → proof (image of real inventory) → single CTA. No secondary offers competing for attention.',
  keyElements: ['High-contrast headline over a real product shot', 'Single stock/availability badge', 'One CTA, one action'],
  transferableMechanism: 'Stock-certainty as the primary hook, not price.',
  howToAdapt: 'Swap product + location, keep the badge + single-CTA structure. Works for any SKU currently in stock.',
}

export const INTELLIGENCE_SUBTABS = ['Customer', 'Competitors', 'Positioning', 'Market', 'Content'] as const

export const INTELLIGENCE_CONTENT: Record<(typeof INTELLIGENCE_SUBTABS)[number], {
  customerInsights: string[]
  painPoints: string[]
  positioningOpportunities: string[]
  competitorInsights: string[]
  whatsWorking: string[]
  recommendedAngles: string[]
  suggestedCta: string
  sourceNote: string
}> = {
  Customer: {
    customerInsights: [
      'Builders value speed, stock availability and consistent quality over lowest price.',
      'Trade accounts prefer clear specs and simple trade pricing up front.',
      'Trust is built through reliability and local support, not brand advertising.',
    ],
    painPoints: [
      'Fear of ordering a batch that is out of stock mid-project.',
      'Colour/spec mismatches between what’s quoted and what arrives on site.',
    ],
    positioningOpportunities: [
      'Own "In Stock + Fast Delivery" as the category shorthand for reliability.',
      'Lead with builder-first language, not homeowner aesthetics language.',
    ],
    competitorInsights: [
      'Metro Auto Group increasing price-led ad spend — a gap opens for a non-price angle.',
    ],
    whatsWorking: [
      'Posts that show real stock/inventory outperform styled lifestyle-only shots by ~2.1x engagement.',
    ],
    recommendedAngles: ['In Stock + Fast Delivery', 'Made for Builders', 'Zero-surprise ordering'],
    suggestedCta: 'Send Your Tile Schedule',
    sourceNote: 'Sourced from Strategic Intelligence audit · last updated 2 days ago',
  },
  Competitors: {
    customerInsights: ['Competitor set is concentrated around 3 regional wholesalers, all price-led.'],
    painPoints: ['Competitors rarely show real stock — mostly stock-photo lifestyle imagery.'],
    positioningOpportunities: ['Differentiate on proof (real inventory) where competitors use stock photography.'],
    competitorInsights: [
      'Metro Auto Group increasing price-led ad spend',
      'Two regional wholesalers cut delivery SLAs from 5 to 3 days this quarter',
    ],
    whatsWorking: ['Competitor carousel ads underperform single-image stock-proof posts.'],
    recommendedAngles: ['Proof over price', 'Delivery-speed comparison'],
    suggestedCta: 'Compare Delivery Times',
    sourceNote: 'Sourced from Competitor Intelligence · needs refresh (14 days old)',
  },
  Positioning: {
    customerInsights: ['ABC Tiles is positioned as the most reliable tile wholesaler in Western Sydney.'],
    painPoints: ['Positioning confidence is high (78%) but market alignment lags at 64%.'],
    positioningOpportunities: ['Shift market perception from "cheapest yard in town" to "the dealer that removes uncertainty".'],
    competitorInsights: ['No competitor currently owns a reliability-first position.'],
    whatsWorking: ['Reliability-led messaging tests well with trade accounts in prior campaigns.'],
    recommendedAngles: ['In Stock + Fast Delivery + Made for Builders'],
    suggestedCta: 'Send Your Tile Schedule',
    sourceNote: 'Sourced from Positioning workspace · last updated 5 days ago',
  },
  Market: {
    customerInsights: ['Used-car and building-supply demand both easing as interest rates hold steady into Q4.'],
    painPoints: ['QLD disclosure rule review may reshape claims builders can make about sourcing.'],
    positioningOpportunities: ['Early move on disclosure-rule change could validate current positioning ahead of competitors.'],
    competitorInsights: ['Industry-wide supply improving, easing the stock-anxiety pain point slightly.'],
    whatsWorking: ['Macro-stable conditions favour steady always-on content over urgency-driven promos.'],
    recommendedAngles: ['Stability + reliability, not urgency'],
    suggestedCta: 'Talk to Our Team',
    sourceNote: 'Sourced from Macro & Industry signals · last updated today',
  },
  Content: {
    customerInsights: ['Highest-performing recent post: builder testimonial carousel (3.1M views).'],
    painPoints: ['Low-performing formats: generic lifestyle-only single images.'],
    positioningOpportunities: ['Double down on real-inventory proof formats.'],
    competitorInsights: ['Competitor carousel ads underperform single-image stock-proof posts.'],
    whatsWorking: ['Real stock photography', 'Single, clear CTA', 'Builder-first language'],
    recommendedAngles: ['In Stock + Fast Delivery + Made for Builders'],
    suggestedCta: 'Send Your Tile Schedule',
    sourceNote: 'Sourced from Content Library performance · last updated 2 days ago',
  },
}

export const AI_TOOLS = [
  { id: 'ai-select', title: 'AI Select', sub: 'Select any part of the design to edit, replace or remove' },
  { id: 'ai-inpaint', title: 'Remove / Inpaint', sub: 'Remove object and fill background intelligently' },
  { id: 'ai-replace', title: 'Replace', sub: 'Replace selected area with AI or client assets' },
  { id: 'ai-similar', title: 'Generate Similar', sub: 'Create something similar to the selected area' },
  { id: 'ai-recreate', title: 'Recreate Text', sub: 'Remove and recreate as editable text' },
  { id: 'ai-magic', title: 'Magic Edit', sub: 'Change style, lighting, colours using AI' },
]

export const REVIEW_SCORES = [
  { label: 'Objective Alignment', value: 94 },
  { label: 'Audience Relevance', value: 90 },
  { label: 'Message Clarity', value: 92 },
  { label: 'Brand Consistency', value: 96 },
  { label: 'Visual Hierarchy', value: 88 },
  { label: 'CTA Strength', value: 91 },
  { label: 'Platform Fit', value: 93 },
  { label: 'Shareability', value: 85 },
  { label: 'SEO / GEO / AEO', value: 80 },
]

export const AI_RECOMMENDATIONS = [
  { id: 'rec1', text: 'Increase headline contrast against the background photo for stronger stop-scroll on mobile.' },
  { id: 'rec2', text: 'Shorten the CTA to 3 words for better tap-through on Stories placements.' },
  { id: 'rec3', text: 'Add an "In Stock" badge earlier in the visual hierarchy — it’s currently below the fold on some crops.' },
]

export const PLATFORMS = ['Instagram Feed', 'Instagram Story', 'Facebook', 'LinkedIn', 'Google Business']
