import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react'
import { aiCompanionService, type AICompanionAction } from '@/services/aiCompanionService'

export interface AICompanionMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  actions?: AICompanionAction[]
}

interface AICompanionState {
  isOpen: boolean
  contextLabel: string
  messages: AICompanionMessage[]
  loading: boolean
  open: () => void
  close: () => void
  setContextLabel: (label: string) => void
  send: (question: string) => Promise<void>
  applyAction: (messageId: string, actionId: string) => void
}

const AICompanionContext = createContext<AICompanionState | null>(null)

export function AICompanionProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const [contextLabel, setContextLabel] = useState('General')
  const [messages, setMessages] = useState<AICompanionMessage[]>([])
  const [loading, setLoading] = useState(false)

  // Context switch clears the transcript — a new module is a new conversation.
  useEffect(() => {
    setMessages([])
  }, [contextLabel])

  const send = useCallback(
    async (question: string) => {
      const userMsg: AICompanionMessage = { id: crypto.randomUUID(), role: 'user', content: question }
      setMessages(prev => [...prev, userMsg])
      setLoading(true)
      try {
        const reply = await aiCompanionService.ask(contextLabel, question)
        setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'assistant', content: reply.message, actions: reply.suggestedActions }])
      } finally {
        setLoading(false)
      }
    },
    [contextLabel]
  )

  const applyAction = useCallback((messageId: string, actionId: string) => {
    setMessages(prev =>
      prev.map(m =>
        m.id === messageId
          ? { ...m, actions: m.actions?.map(a => (a.id === actionId ? { ...a, label: `✓ ${a.label}` } : a)) }
          : m
      )
    )
  }, [])

  return (
    <AICompanionContext.Provider
      value={{
        isOpen,
        contextLabel,
        messages,
        loading,
        open: () => setIsOpen(true),
        close: () => setIsOpen(false),
        setContextLabel,
        send,
        applyAction,
      }}
    >
      {children}
    </AICompanionContext.Provider>
  )
}

export function useAICompanion(): AICompanionState {
  const ctx = useContext(AICompanionContext)
  if (!ctx) throw new Error('useAICompanion must be used inside AICompanionProvider')
  return ctx
}

/** Call from a page to tell the companion where the user is (e.g. "Positioning • ABC Motors"). */
export function useAICompanionContext(label: string) {
  const { setContextLabel } = useAICompanion()
  useEffect(() => {
    setContextLabel(label)
  }, [label, setContextLabel])
}
