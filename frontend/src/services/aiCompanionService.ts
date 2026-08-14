import { mockDelay } from './_shared'

export interface AICompanionAction {
  id: string
  label: string
  kind: 'add_proof_point' | 'modify_positioning' | 'save_client_library' | 'save_industry_library' | 'create_campaign' | 'create_task' | 'create_content' | 'apply_suggestion'
  requiresApproval: boolean
}

export interface AICompanionReply {
  message: string
  suggestedActions: AICompanionAction[]
}

// TODO(integration): this should call the existing Claude-backed
// backend/app/services/generate_svc.py chat endpoint (see generateApi.chat in
// src/api/client.ts) with a module-context header, rather than a hardcoded
// reply. Kept separate from generateApi today because the companion also
// needs to propose structured actions, not just return text.
export const aiCompanionService = {
  ask: (contextLabel: string, question: string): Promise<AICompanionReply> =>
    mockDelay(
      {
        message: `[${contextLabel}] AI Companion isn't wired to a live model in this context yet — this is a placeholder response to "${question}". Once connected, this panel will reason over the client's actual intelligence, positioning and campaign data.`,
        suggestedActions: [
          { id: 'act-1', label: 'Save this as a proof point', kind: 'add_proof_point', requiresApproval: true },
          { id: 'act-2', label: 'Create a follow-up task', kind: 'create_task', requiresApproval: false },
        ],
      },
      650
    ),
}
