import { useState, useRef, useEffect, type CSSProperties, type KeyboardEvent } from 'react'
import {
  Sparkles, TriangleAlert, Check, X, Loader2, ArrowUp, Captions, Hash, Wand2, Maximize2, ChevronUp,
} from 'lucide-react'
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

// Quick actions (spec section 8/15). Presentational only — like the timeline toolbar's
// Split/Duplicate/etc, they're visually represented but not wired to any behaviour yet, since
// this pass rebuilds the shell without adding new editing/chat functionality.
const QUICK_ACTIONS = [
  { icon: Captions, label: 'Generate captions' },
  { icon: Hash, label: 'Suggest hashtags' },
  { icon: Wand2, label: 'Improve this video' },
  { icon: Maximize2, label: 'Resize for other platforms' },
]

// Docked beside the timeline (spec section 8) — not a floating overlay any more. It keeps a
// collapse control (per "it may later collapse"), defaulting to expanded for this visual pass.
// All chat logic below (messages, approval gate, suggestions, send) is unchanged from before.
export default function ChatBar() {
  const { chatMessages, chatLoading, sendChatMessage, approveGate, rejectGate, pendingApproval } = useStudio()
  const [input, setInput] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [expanded, setExpanded] = useState(true)
  const messagesRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

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

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const filteredSuggestions = SUGGESTIONS.filter(s =>
    input && s.toLowerCase().includes(input.toLowerCase())
  )

  if (!expanded) {
    return (
      <button style={s.collapsedStrip} onClick={() => setExpanded(true)} title="Open AI assistant">
        <Sparkles size={16} color="var(--sg-green)" />
        <span style={s.collapsedLabel}>AI Assistant</span>
        {pendingApproval && <span style={s.fabBadge} title="Awaiting your approval" />}
      </button>
    )
  }

  return (
    <aside style={s.root}>
      <div style={s.header}>
        <Sparkles size={15} color="var(--sg-green)" />
        <span style={s.headerTitle}>AI Assistant</span>
        <button style={s.collapseBtn} onClick={() => setExpanded(false)} title="Collapse" aria-label="Collapse AI Assistant">
          <ChevronUp size={16} />
        </button>
      </div>

      {/* Quick actions — inert placeholders, full-width rows per the locked reference */}
      <div style={s.quickActions}>
        {QUICK_ACTIONS.map(qa => {
          const Icon = qa.icon
          return (
            <button key={qa.label} style={s.quickActionRow} disabled title={`${qa.label} — coming soon`}>
              <Icon size={13} /> {qa.label}
            </button>
          )
        })}
      </div>

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
            <Loader2 size={14} className="sgv-spin" color="var(--sg-text-muted)" />
          </div>
        )}
      </div>

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

      {pendingApproval && (
        <div style={s.approvalBar}>
          <span style={s.approvalMsg}>Awaiting approval before proceeding</span>
          <div style={s.approvalActions}>
            <button style={s.rejectBtn} onClick={() => rejectGate(pendingApproval.id)}>
              <X size={12} /> Reject
            </button>
            <button style={s.approveBtn} onClick={() => approveGate(pendingApproval.id)}>
              <Check size={12} /> Approve
            </button>
          </div>
        </div>
      )}

      <div style={s.inputRow}>
        <input
          ref={inputRef}
          className="sgv-input"
          style={s.input}
          placeholder="Ask me anything…"
          value={input}
          onChange={e => { setInput(e.target.value); setShowSuggestions(true) }}
          onKeyDown={handleKey}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
        />
        <button
          className="sgv-btn sgv-btn--icon"
          style={{ ...s.sendBtn, ...(chatLoading || !input.trim() ? {} : s.sendBtnActive) }}
          onClick={handleSend}
          disabled={chatLoading || !input.trim()}
        >
          {chatLoading ? <Loader2 size={16} className="sgv-spin" /> : <ArrowUp size={16} />}
        </button>
      </div>
    </aside>
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
        <span style={s.bubbleRole}>
          {isSystem ? <><TriangleAlert size={10} /> System</> : <><Sparkles size={10} /> Claude</>}
        </span>
      )}
      <span style={s.bubbleText}>{message.content}</span>
      {gate && gate.status === 'waiting' && (
        <div style={s.gateActions}>
          <button style={s.gateReject} onClick={onReject}><X size={11} /> Reject</button>
          <button style={s.gateApprove} onClick={onApprove}><Check size={11} /> Approve</button>
        </div>
      )}
      {gate && gate.status !== 'waiting' && (
        <span style={{ fontSize: 10, color: gate.status === 'approved' ? 'var(--sg-green)' : 'var(--sg-error)', marginTop: 2 }}>
          {gate.status === 'approved' ? 'Approved' : 'Rejected'}
        </span>
      )}
    </div>
  )
}

const s: Record<string, CSSProperties> = {
  // Collapsed: a slim docked strip (still part of the layout, not floating) with a vertical
  // label — clicking re-expands. Keeps a re-open affordance always reachable.
  collapsedStrip: {
    width: 56, flexShrink: 0, background: 'var(--sg-bg-2)', border: 'none', borderLeft: '1px solid var(--sg-border)',
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10,
    cursor: 'pointer', position: 'relative',
  },
  collapsedLabel: { writingMode: 'vertical-rl', fontSize: 12, fontWeight: 600, color: 'var(--sg-text-secondary)' },
  fabBadge: {
    width: 8, height: 8, borderRadius: '50%', background: 'var(--sg-gold)',
    position: 'absolute', top: 12, right: 12,
  },

  // Expanded: docked panel beside the timeline (spec section 8) — a normal flex child, not
  // position:fixed, so it participates in the layout instead of overlaying it.
  root: {
    width: 320, flexShrink: 0, background: 'var(--sg-bg-2)', borderLeft: '1px solid var(--sg-border)',
    display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative',
  },
  header: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '0 14px', height: 44,
    borderBottom: '1px solid var(--sg-border)', flexShrink: 0,
  },
  headerTitle: { fontSize: 13, fontWeight: 600, color: 'var(--sg-text-primary)' },
  collapseBtn: {
    marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--sg-text-muted)',
    cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 4, borderRadius: 6,
  },
  quickActions: { display: 'flex', flexDirection: 'column', gap: 4, padding: '10px 12px', flexShrink: 0 },
  quickActionRow: {
    display: 'flex', alignItems: 'center', gap: 8, width: '100%',
    background: 'var(--sg-bg-3)', border: '1px solid var(--sg-border)', borderRadius: 8,
    color: 'var(--sg-text-secondary)', fontSize: 12, fontWeight: 500, padding: '8px 10px',
    cursor: 'not-allowed', opacity: 0.7, textAlign: 'left',
  },
  messages: {
    flex: 1, overflowY: 'auto', padding: '4px 12px', minHeight: 60,
    display: 'flex', flexDirection: 'column', gap: 6,
  },

  bubble: {
    maxWidth: '90%', padding: '7px 11px', borderRadius: 10,
    display: 'flex', flexDirection: 'column', gap: 3,
  },
  bubbleUser: { alignSelf: 'flex-end', background: 'var(--sg-green-dark)', borderBottomRightRadius: 3 },
  bubbleAssistant: { alignSelf: 'flex-start', background: 'var(--sg-bg-3)', borderBottomLeftRadius: 3 },
  bubbleSystem: { alignSelf: 'center', background: 'var(--sg-gold-soft)', borderRadius: 6 },
  bubbleRole: {
    fontSize: 10, fontWeight: 700, color: 'var(--sg-gold)', textTransform: 'uppercase', letterSpacing: 0.5,
    display: 'flex', alignItems: 'center', gap: 4,
  },
  bubbleText: { fontSize: 13, color: 'var(--sg-text-primary)', lineHeight: 1.5, whiteSpace: 'pre-wrap' },

  gateActions: { display: 'flex', gap: 6, marginTop: 4 },
  gateReject: { display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px', background: 'var(--sg-error)', border: 'none', borderRadius: 4, color: '#fff', fontSize: 11, cursor: 'pointer' },
  gateApprove: { display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px', background: 'var(--sg-green)', border: 'none', borderRadius: 4, color: 'var(--sg-bg-0)', fontSize: 11, fontWeight: 700, cursor: 'pointer' },

  typing: { display: 'flex', gap: 5, alignSelf: 'flex-start', padding: '8px 12px', background: 'var(--sg-bg-3)', borderRadius: 10 },

  suggestions: {
    position: 'absolute', bottom: 60, left: 12, right: 12,
    background: 'var(--sg-bg-3)', border: '1px solid var(--sg-border)', borderRadius: 8,
    overflow: 'hidden', zIndex: 50, boxShadow: '0 6px 24px rgba(0,0,0,0.24)',
  },
  suggestionBtn: {
    display: 'block', width: '100%', padding: '8px 12px', background: 'transparent',
    border: 'none', color: 'var(--sg-text-secondary)', fontSize: 12, cursor: 'pointer', textAlign: 'left',
    borderBottom: '1px solid var(--sg-border)',
  },

  approvalBar: {
    background: 'var(--sg-gold-soft)', borderTop: '1px solid var(--sg-border)',
    padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
  },
  approvalMsg: { flex: 1, color: 'var(--sg-gold)', fontSize: 11 },
  approvalActions: { display: 'flex', gap: 6 },
  rejectBtn: {
    display: 'flex', alignItems: 'center', gap: 4,
    padding: '4px 10px', background: '#8B0000', border: 'none',
    borderRadius: 5, color: '#fff', fontSize: 11, cursor: 'pointer',
  },
  approveBtn: {
    display: 'flex', alignItems: 'center', gap: 4,
    padding: '4px 10px', background: 'var(--sg-green)', border: 'none',
    borderRadius: 5, color: 'var(--sg-bg-0)', fontSize: 11, fontWeight: 700, cursor: 'pointer',
  },

  inputRow: {
    display: 'flex', gap: 8, padding: '10px 12px', borderTop: '1px solid var(--sg-border)', flexShrink: 0,
  },
  input: { flex: 1, height: 40 },
  sendBtn: { background: 'var(--sg-bg-3)', color: 'var(--sg-text-muted)', flexShrink: 0 },
  sendBtnActive: { background: 'var(--sg-green)', color: 'var(--sg-bg-0)' },
}
