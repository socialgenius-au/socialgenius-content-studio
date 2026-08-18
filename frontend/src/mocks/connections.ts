import type { PlatformConnection, PlatformVersion } from '@/types/domain'

export const MOCK_CONNECTIONS: Record<string, PlatformConnection[]> = {
  'abc-motors': [
    { id: 'conn-1', platform: 'Instagram', status: 'connected', accountName: '@abcmotorsbrisbane', permissions: ['publish', 'insights'], lastSynced: '2026-08-13T07:00:00' },
    { id: 'conn-2', platform: 'Facebook', status: 'connected', accountName: 'ABC Motors', permissions: ['publish', 'insights', 'leadgen'], lastSynced: '2026-08-13T07:00:00' },
    { id: 'conn-3', platform: 'Google Business Profile', status: 'connected', accountName: 'ABC Motors — Brisbane', permissions: ['publish', 'insights'], lastSynced: '2026-08-13T06:30:00' },
    { id: 'conn-4', platform: 'TikTok', status: 'disconnected', accountName: null, permissions: [], lastSynced: null },
    { id: 'conn-5', platform: 'LinkedIn', status: 'disconnected', accountName: null, permissions: [], lastSynced: null },
    { id: 'conn-6', platform: 'YouTube', status: 'warning', accountName: 'ABC Motors', permissions: ['publish'], lastSynced: '2026-07-20T10:00:00' },
    { id: 'conn-7', platform: 'WhatsApp Business', status: 'connected', accountName: '+61 400 111 222', permissions: ['messaging'], lastSynced: '2026-08-13T09:00:00' },
    { id: 'conn-8', platform: 'Google Drive', status: 'disconnected', accountName: null, permissions: [], lastSynced: null },
  ],
  'apni-dukaan': [
    { id: 'conn-9', platform: 'Instagram', status: 'disconnected', accountName: null, permissions: [], lastSynced: null },
    { id: 'conn-10', platform: 'Facebook', status: 'disconnected', accountName: null, permissions: [], lastSynced: null },
  ],
  'smplee-packaging': [],
}

export const MOCK_PLATFORM_VERSIONS: Record<string, PlatformVersion[]> = {
  'ast-1': [
    { id: 'pv-1', platform: 'Instagram Reel', title: 'The cheapest SUV could cost you the most', caption: 'Before you buy on price alone, check these three things. Link in bio for your free inspection report. 🔧', hashtags: '#UsedCars #Brisbane #CarBuyingTips #ABCMotors', cta: 'Get your free inspection report', locked: { title: true, caption: false }, status: 'approved', scheduledFor: '2026-08-16T09:00:00' },
    { id: 'pv-2', platform: 'TikTok', title: 'The cheapest SUV could cost you the most', caption: 'Three things to check before you buy 👀 #UsedCars #CarTok', hashtags: '#UsedCars #CarTok #BrisbaneCars', cta: 'Get your free inspection report', locked: { title: true, caption: false }, status: 'draft', scheduledFor: null },
    { id: 'pv-3', platform: 'Facebook', title: 'The cheapest SUV could cost you the most', caption: 'Before you buy on price alone, check these three things first. We\'ll send you a free inspection report — no obligation.', hashtags: '', cta: 'Get your free inspection report', locked: { title: true, caption: true }, status: 'approved', scheduledFor: '2026-08-16T09:00:00' },
  ],
  'ast-2': [
    { id: 'pv-4', platform: 'Instagram Reel', title: 'Angle B — Family Confidence hook', caption: 'Buying your first family car? Here\'s what actually matters (hint: it\'s not the price tag). 👨‍👩‍👧', hashtags: '#FamilyCars #UsedCars #Brisbane', cta: 'Get your free inspection report', locked: { title: false, caption: false }, status: 'review', scheduledFor: null },
  ],
  'ast-3': [
    { id: 'pv-5', platform: 'Facebook', title: 'Warranty explainer carousel', caption: 'Every car we sell comes with a 3-month warranty. Swipe to see exactly what\'s covered.', hashtags: '#UsedCars #Warranty', cta: 'View our current stock', locked: { title: false, caption: false }, status: 'draft', scheduledFor: null },
  ],
  'ast-4': [
    { id: 'pv-6', platform: 'Google Business Profile', title: 'GBP proof-point post', caption: '212 reviews, 4.8★. Every car gets a 3-point inspection before it hits the yard.', hashtags: '', cta: 'Read our reviews', locked: { title: true, caption: true }, status: 'approved', scheduledFor: '2026-08-20T10:00:00' },
  ],
}
