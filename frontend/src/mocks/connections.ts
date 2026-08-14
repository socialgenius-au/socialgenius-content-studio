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
}
