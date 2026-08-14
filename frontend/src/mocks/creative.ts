import type { CreativeOption } from '@/types/domain'

// The Section 74 demo workflow: three angles for the ABC Motors "Buying
// Confidence" campaign, generate-enquiries outcome.
export const MOCK_ANGLE_OPTIONS: CreativeOption[] = [
  {
    id: 'angle-a',
    label: 'A — Risk Avoidance',
    pitch: '"The cheapest SUV could cost you the most."',
    attentionScore: 84,
    positioningScore: 79,
    outcomeScore: 71,
    why: 'Loss-aversion hooks consistently outperform on scroll-stop rate for this audience segment.',
    perceptionCreated: 'ABC Motors understands what can go wrong and protects buyers from it.',
    proofRequired: 'Needs the 3-point inspection shown on screen within first 3 seconds.',
    risk: 'Can read as fear-mongering if overused across the campaign.',
  },
  {
    id: 'angle-b',
    label: 'B — Family Confidence',
    pitch: '"Your family doesn\'t need the newest SUV. It needs the right one."',
    attentionScore: 76,
    positioningScore: 88,
    outcomeScore: 74,
    why: 'Strongest alignment with target-customer research (families, not enthusiasts).',
    perceptionCreated: 'ABC Motors gets what actually matters to a family buyer, not just spec sheets.',
    proofRequired: 'Needs a real family testimonial or reviewer to avoid feeling generic.',
    risk: 'Slightly softer hook — may need a stronger opening 2 seconds to hold attention on Reels.',
  },
  {
    id: 'angle-c',
    label: 'C — Buyer Expertise',
    pitch: '"Before paying $40k for an SUV, check these three things."',
    attentionScore: 88,
    positioningScore: 81,
    outcomeScore: 80,
    why: 'Listicle/utility format performs well for enquiry-generation objective specifically.',
    perceptionCreated: 'ABC Motors positions itself as the informed guide, not just the seller.',
    proofRequired: 'The "three things" must map directly to the actual 3-point inspection to stay honest.',
    risk: 'Highest production complexity — needs clean on-screen text/graphics to land the list format.',
  },
]

export interface StructureOption { id: string; label: string; description: string }
export interface CtaOption { id: string; label: string; description: string }

export const MOCK_STRUCTURE_OPTIONS: StructureOption[] = [
  { id: 'struct-1', label: 'Hook → Problem → Proof → CTA', description: 'Classic direct-response structure. Fastest to produce, proven for enquiry generation.' },
  { id: 'struct-2', label: 'Hook → Story (before/after) → Proof → CTA', description: 'Slightly longer, uses a customer story to carry the proof point emotionally.' },
  { id: 'struct-3', label: 'Hook → Three Checks (listicle) → CTA', description: 'Matches Angle C\'s utility framing — walks through the 3-point inspection live.' },
]

export const MOCK_CTA_OPTIONS: CtaOption[] = [
  { id: 'cta-1', label: 'Get your free inspection report', description: 'Low-friction, matches campaign offer directly.' },
  { id: 'cta-2', label: 'Book a no-pressure walkthrough', description: 'Softer CTA, may suit family-confidence angle better.' },
  { id: 'cta-3', label: 'Check your finance pre-approval', description: 'Routes to the finance funnel instead — higher intent, smaller audience.' },
]
