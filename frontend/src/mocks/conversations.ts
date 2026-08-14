import type { Conversation } from '@/types/domain'

export const MOCK_CONVERSATIONS: Record<string, Conversation[]> = {
  'abc-motors': [
    { id: 'conv-1', clientId: 'abc-motors', channel: 'whatsapp', contactName: 'Sarah Mitchell', lastMessage: 'Is the CX-5 still available for viewing Saturday?', automationLevel: 'L3_qualify', aiConfidence: 91, escalationTrigger: null, lastResponseAt: '2026-08-13T09:12:00', slaMinutesRemaining: 38, responsibleStaff: 'Dave Ranford' },
    { id: 'conv-2', clientId: 'abc-motors', channel: 'email', contactName: 'James Okafor', lastMessage: 'Can you send the inspection report for the Corolla?', automationLevel: 'L2_info', aiConfidence: 96, escalationTrigger: null, lastResponseAt: '2026-08-13T08:40:00', slaMinutesRemaining: 110, responsibleStaff: 'Dave Ranford' },
    { id: 'conv-3', clientId: 'abc-motors', channel: 'social', contactName: 'Priya Chandran', lastMessage: 'Do you guys negotiate on price at all?', automationLevel: 'L4_nurture', aiConfidence: 62, escalationTrigger: 'Price objection detected — below AI confidence threshold', lastResponseAt: '2026-08-13T07:55:00', slaMinutesRemaining: 5, responsibleStaff: 'Sales' },
    { id: 'conv-4', clientId: 'abc-motors', channel: 'website', contactName: 'Anonymous visitor', lastMessage: 'What warranty comes with the finance option?', automationLevel: 'L5_human', aiConfidence: 34, escalationTrigger: 'Complex finance + warranty combo question, escalated to human', lastResponseAt: '2026-08-13T06:20:00', slaMinutesRemaining: -22, responsibleStaff: 'Dave Ranford' },
  ],
  'apni-dukaan': [],
  'smplee-packaging': [],
}

export interface CommunityOpportunity {
  id: string
  group: string
  audienceRelevance: 'high' | 'medium' | 'low'
  topic: string
  groupRules: string
  promotionAllowed: boolean
  suggestedContribution: string
}

export const MOCK_COMMUNITY_OPPORTUNITIES: Record<string, CommunityOpportunity[]> = {
  'abc-motors': [
    { id: 'comm-1', group: 'Brisbane Families Buy & Swap', audienceRelevance: 'high', topic: 'Member asking for a trustworthy used-car recommendation', groupRules: 'No direct selling, helpful answers only', promotionAllowed: false, suggestedContribution: 'Answer with general inspection advice (what to check), mention nothing promotional.' },
    { id: 'comm-2', group: 'QLD First Car Buyers', audienceRelevance: 'high', topic: 'Weekly "what should I look for" thread', groupRules: 'Business replies allowed if clearly disclosed', promotionAllowed: true, suggestedContribution: 'Share the 3-point inspection checklist as a genuinely useful resource, disclose affiliation.' },
  ],
  'apni-dukaan': [],
  'smplee-packaging': [],
}
