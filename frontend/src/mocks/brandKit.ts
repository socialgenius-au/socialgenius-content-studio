import type { BrandKit } from '@/types/domain'

// Sample data only. ABC Motors has full depth; other clients show an
// honestly-empty kit (no logo asset, undefined voice/commercial fields)
// rather than fabricated content, matching their thinner mock profiles
// elsewhere (positioning, intelligence, audit are similarly sparse for them).
export const MOCK_BRAND_KITS: Record<string, BrandKit> = {
  'abc-motors': {
    clientId: 'abc-motors',
    visual: {
      colors: [
        { label: 'Forest', hex: '#1E3D2A' },
        { label: 'Warranty Gold', hex: '#C89A2E' },
        { label: 'Ivory', hex: '#F5F0E8' },
        { label: 'Trust Lime', hex: '#A8D93B' },
      ],
      fonts: 'Inter (headlines, bold) + Inter (body) — no serif; keeps the brand feeling plain-spoken, not corporate.',
      logoStyle: 'Wordmark + shield icon, always on forest green or ivory background.',
      imageStyle: 'Natural daylight yard photography, real inventory only — no stock cars.',
      videoStyle: 'Handheld walkaround style, inspection report shown on screen, warm colour grade.',
      thumbnailStyle: 'Vehicle hero shot + bold warranty/proof text overlay, gold accent bar.',
      intro: '2s logo sting on forest green, no voiceover.',
      outro: 'Warranty badge + phone number + "Book your inspection" CTA card.',
      lowerThird: 'Gold underline bar, forest text on ivory chip.',
      watermark: 'Small shield logo, bottom-right, 40% opacity.',
      hasLogoAsset: false,
    },
    voice: {
      tone: 'Warm, plain-spoken, quietly confident — never salesy.',
      formality: 'Conversational, first-name friendly, avoids jargon.',
      humour: "Light and dry, used sparingly — never at the buyer's expense.",
      wordsToUse: ['inspected', 'warrantied', 'no surprises', 'proof', 'honest'],
      wordsToAvoid: ['cheapest', 'unbeatable deal', 'today only', 'no haggling needed (implies haggling elsewhere)'],
      ctaStyle: 'Low-pressure, offer-based ("Get your free inspection report") rather than urgency-based.',
      sentenceStyle: 'Short sentences, second person ("you"), concrete numbers over adjectives.',
      personality: 'The mechanic friend who tells you the truth, not the salesperson who wants the close.',
    },
    commercial: {
      services: ['Used vehicle sales', 'In-house finance', 'Pre-purchase inspection', 'Warranty support'],
      offers: ['Free pre-purchase inspection report', 'Finance pre-approval in 60 seconds'],
      targetAudiences: ['Families and first-time buyers, 28-55, anxious about being ripped off'],
      locations: ['Brisbane, QLD'],
      differentiators: ['3-point independent inspection on every car', '3-month included warranty', 'Finance pre-approval before you visit'],
      proof: ['212 Google reviews at 4.8★', '38 warranty claims honoured, zero disputes, last 12 months'],
      certifications: ['Licensed motor dealer, QLD'],
      testimonials: ['"They showed me the inspection report before I even asked." — Grace L.'],
      guarantees: ['3-month warranty on every vehicle sold'],
    },
    content: {
      hashtags: ['#ABCMotors', '#UsedCarsBrisbane', '#BuyingConfidence'],
      ctaPatterns: ['Get your free inspection report', 'Check your finance pre-approval', 'Book a no-pressure walkthrough'],
      handles: ['@abcmotorsbrisbane'],
      links: ['abcmotors.example.com/inspection-report'],
      disclaimers: ['Finance subject to approval. Terms and conditions apply.'],
      mandatoryInclusions: ['Warranty period must be stated in every vehicle post', 'Phone number in every GBP post'],
    },
  },
  'apni-dukaan': emptyKit('apni-dukaan', '#C89A2E'),
  'smplee-packaging': emptyKit('smplee-packaging', '#2FD8C8'),
}

function emptyKit(clientId: string, color: string): BrandKit {
  return {
    clientId,
    visual: {
      colors: [{ label: 'Primary', hex: color }, { label: 'Ivory', hex: '#F5F0E8' }, { label: 'Charcoal', hex: '#232420' }],
      fonts: '', logoStyle: '', imageStyle: '', videoStyle: '', thumbnailStyle: '',
      intro: '', outro: '', lowerThird: '', watermark: '', hasLogoAsset: false,
    },
    voice: { tone: '', formality: '', humour: '', wordsToUse: [], wordsToAvoid: [], ctaStyle: '', sentenceStyle: '', personality: '' },
    commercial: { services: [], offers: [], targetAudiences: [], locations: [], differentiators: [], proof: [], certifications: [], testimonials: [], guarantees: [] },
    content: { hashtags: [], ctaPatterns: [], handles: [], links: [], disclaimers: [], mandatoryInclusions: [] },
  }
}
