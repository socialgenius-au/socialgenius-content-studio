import { useState, useRef, useEffect, type CSSProperties, type KeyboardEvent } from 'react'
import { useStudio } from '../../contexts/StudioContext'
import type { ChatMessage } from '../../types'

const SUGGESTIONS = [
  'make scene 2 black and white',
  'add our logo bottom right at 0:10',
  'cut from 0:45 to 1:20',
  'add warm music that ducks when I speak',
  'export for TikTok',
  'generate SEO for Instagram',
  'create a carousel for LinkedIn',
  'add a lower third at current position',
  'make the intro 3 seconds with zoom in',
]

export default function ChatBar() {
  const { chatMessages, chatLoading, sendChatMessage, approveGate, rejectGate, pendingApproval } = useStudio()
  const [input, setInput] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const messagesRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Auto-scroll
  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight
    }
  }, [chatMessages])

  const handleSend = async () => {
    const text = input.trim()
    if (!text || chatLoading) return
    setInput('')
    setShowSuggestions(false)
    await sendChatMessage(text)
  }

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const filteredSuggestions = SUGGESTIONS.filter(s =>
    input && s.toLowerCase().includes(input.toLowerCase())
  )

  return (
    <div style={{ ...s.root, height: expanded ? 380 : 200 }}>
      {/* Expand/collapse toggle */}
      <button style={s.expandBtn} onClick={() => setExpanded(v => !v)}>
        {expanded ? '▼ Collapse chat' : '▲ Expand chat'}
      </button>

      {/* Messages */}
      <div ref={messagesRef} style={s.messages}>
        {chatMessages.map(msg => (
          <MessageBubble
            key={msg.id}
            message={msg}
            onApprove={msg.approvalGate ? () => approveGate(msg.approvalGate!.id) : undefined}
            onReject={msg.approvalGate ? () => rejectGate(msg.approvalGate!.id) : undefined}
          />
        ))}
        {chatLoading && (
          <div style={s.typing}>
            <span style={s.typingDot} />
            <span style={s.typingDot} />
            <span style={s.typingDot} />
          </div>
        )}
      </div>

      {/* Suggestions dropdown */}
      {showSuggestions && filteredSuggestions.length > 0 && (
        <div style={s.suggestions}>
          {filteredSuggestions.map(s2 => (
            <button
              key={s2}
              style={s.suggestionBtn}
              onClick={() => { setInput(s2); setShowSuggestions(false); inputRef.current?.focus() }}
            >
              {s2}
            </button>
          ))}
        </div>
      )}

      {/* Approval gate */}
      {pendingApproval && (
        <div style={s.approvalBar}>
          <span style={s.approvalMsg}>Awaiting approval before proceeding</span>
          <div style={s.approvalActions}>
            <button style={s.rejectBtn} onClick={() => rejectGate(pendingApproval.id)}>
              ✕ Reject
            </button>
            <button style={s.approveBtn} onClick={() => approveGate(pendingApproval.id)}>
              ✓ Approve
            </button>
          </div>
        </div>
      )}

      {/* Input row */}
      <div style={s.inputRow}>
        <textarea
          ref={inputRef}
          style={s.input}
          placeholder='Type an instruction… e.g. "cut from 0:45 to 1:20" or "add warm music"'
          value={input}
          onChange={e => { setInput(e.target.value); setShowSuggestions(true) }}
          onKeyDown={handleKey}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
          rows={2}
        />
        <button
          style={{ ...s.sendBtn, ...(chatLoading ? s.sendBtnDisabled : {}) }}
          onClick={handleSend}
          disabled={chatLoading || !input.trim()}
        >
          {chatLoading ? '⏳' : '↑ Send'}
        </button>
      </div>
    </div>
  )
}

function MessageBubble({ message, onApprove, onReject }: {
  message: ChatMessage
  onApprove?: () => void
  onReject?: () => void
}) {
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'
  const gate = message.approvalGate

  return (
    <div style={{ ...s.bubble, ...(isUser ? s.bubbleUser : isSystem ? s.bubbleSystem : s.bubbleAssistant) }}>
      {!isUser && (
        <span style={s.bubbleRole}>{isSystem ? '⚠ System' : '🤖 Claude'}</span>
      )}
      <span style={s.bubbleText}>{message.content}</span>
      {gate && gate.status === 'waiting' && (
        <div style={s.gateActions}>
          <button style={s.gateReject} onClick={onReject}>✕ Reject</button>
          <button style={s.gateApprove} onClick={onApprove}>✓ Approve</button>
        </div>
      )}
      {gate && gate.status !== 'waiting' && (
        <span style={{ fontSize: 10, color: gate.status === 'approved' ? '#2ecc71' : '#e74c3c', marginTop: 2 }}>
          {gate.status === 'approved' ? '✓ Approved' : '✕ Rejected'}
        </span>
      )}
    </div>
  )
}

const s: Record<string, CSSProperties> = {
  root: {
    background: '#1a1a1a', display: 'flex', flexDirection: 'column',
    transition: 'height 0.2s', position: 'relative', flexShrink: 0,
  },
  expandBtn: {
    background: 'transparent', border: 'none', color: '#888',
    fontSize: 10, cursor: 'pointer', padding: '3px 12px', alignSelf: 'flex-start',
    borderBottom: '1px solid #2a2a2a', width: '100%', textAlign: 'left',
  },
  messages: {
    flex: 1, overflowY: 'auto', padding: '8px 12px',
    display: 'flex', flexDirection: 'column', gap: 6,
  },

  bubble: {
    maxWidth: '75%', padding: '7px 11px', borderRadius: 10,
    display: 'flex', flexDirection: 'column', gap: 3,
  },
  bubbleUser: { alignSelf: 'flex-end', background: '#1E3D2A', borderBottomRightRadius: 3 },
  bubbleAssistant: { alignSelf: 'flex-start', background: '#2a2a2a', borderBottomLeftRadius: 3 },
  bubbleSystem: { alignSelf: 'center', background: '#3a2a1a', borderRadius: 6 },
  bubbleRole: { fontSize: 9, fontWeight: 700, color: '#C89A2E', textTransform: 'uppercase', letterSpacing: 0.5 },
  bubbleText: { fontSize: 13, color: '#F5F0E8', lineHeight: 1.5, whiteSpace: 'pre-wrap' },

  gateActions: { display: 'flex', gap: 6, marginTop: 4 },
  gateReject: { padding: '3px 8px', background: '#e74c3c', border: 'none', borderRadius: 4, color: '#fff', fontSize: 11, cursor: 'pointer' },
  gateApprove: { padding: '3px 8px', background: '#2ecc71', border: 'none', borderRadius: 4, color: '#1E3D2A', fontSize: 11, fontWeight: 700, cursor: 'pointer' },

  typing: { display: 'flex', gap: 5, alignSelf: 'flex-start', padding: '8px 12px', background: '#2a2a2a', borderRadius: 10 },
  typingDot: {
    width: 6, height: 6, background: '#888', borderRadius: '50%',
    animation: 'bounce 1.2s infinite',
  },

  suggestions: {
    position: 'absolute', bottom: 72, left: 12, right: 12,
    background: '#2a2a2a', border: '1px solid #3a3a3a', borderRadius: 8,
    overflow: 'hidden', zIndex: 50,
  },
  suggestionBtn: {
    display: 'block', width: '100%', padding: '8px 12px', background: 'transparent',
    border: 'none', color: '#ddd', fontSize: 12, cursor: 'pointer', textAlign: 'left',
    borderBottom: '1px solid #3a3a3a',
  },

  approvalBar: {
    background: '#2a1a00', borderTop: '1px solid #C89A2E44',
    padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 12,
  },
  approvalMsg: { flex: 1, color: '#C89A2E', fontSize: 11 },
  approvalActions: { display: 'flex', gap: 6 },
  rejectBtn: {
    padding: '4px 10px', background: '#8B0000', border: 'none',
    borderRadius: 5, color: '#fff', fontSize: 11, cursor: 'pointer',
  },
  approveBtn: {
    padding: '4px 10px', background: '#2ecc71', border: 'none',
    borderRadius: 5, color: '#1E3D2A', fontSize: 11, fontWeight: 700, cursor: 'pointer',
  },

  inputRow: {
    display: 'flex', gap: 8, padding: '8px 12px', borderTop: '1px solid #2a2a2a',
  },
  input: {
    flex: 1, background: '#2a2a2a', border: '1px solid #3a3a3a',
    borderRadius: 8, color: '#F5F0E8', fontSize: 13, padding: '8px 12px',
    resize: 'none', fontFamily: 'inherit', outline: 'none', lineHeight: 1.4,
  },
  sendBtn: {
    background: '#1E3D2A', border: 'none', borderRadius: 8, color: '#C89A2E',
    padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
    flexShrink: 0,
  },
  sendBtnDisabled: { opacity: 0.5, cursor: 'not-allowed' },
}
