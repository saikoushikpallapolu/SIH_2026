import { useState, useRef, useEffect, useCallback } from 'react'

// ─── Types ───────────────────────────────────────────────────────────────────
type PoseidonExpression = 'welcome' | 'thinking' | 'explaining' | 'excited' | 'warning'

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  expression?: PoseidonExpression
  timestamp: number
}

interface ChatResponse {
  response: string
  expression: PoseidonExpression
  data: Record<string, unknown> | null
}


// ─── Simple markdown renderer ────────────────────────────────────────────────
function renderMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^- (.+)/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
    .replace(/\n/g, '<br/>')
}

// ─── Authentic Poseidon Character Component ─────────────────────────────────────
function PoseidonAvatar({
  expression,
  size = 130,
  isMini = false,
}: {
  expression: PoseidonExpression
  size?: number
  isMini?: boolean
}) {
  if (isMini) {
    return (
      <div className={`poseidon-mini-badge poseidon-expr-${expression}`}>
        <img src="/poseidon.png" alt="Poseidon" className="poseidon-mini-img" />
      </div>
    )
  }

  return (
    <div className={`poseidon-character-card poseidon-expr-${expression}`}>
      <div className="poseidon-aura-glow" />
      <img
        src="/poseidon.png"
        alt="Poseidon - God of the Seas"
        className="poseidon-character-img"
        style={{ height: `${size}px` }}
      />
    </div>
  )
}

// ─── Typing Indicator (Ocean Bubbles) ────────────────────────────────────────
function TypingIndicator() {
  return (
    <div className="poseidon-typing">
      <div className="typing-bubble" style={{ animationDelay: '0ms' }} />
      <div className="typing-bubble" style={{ animationDelay: '200ms' }} />
      <div className="typing-bubble" style={{ animationDelay: '400ms' }} />
    </div>
  )
}

// ─── Main PoseidonChat Component ─────────────────────────────────────────────
export default function PoseidonChat() {
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [expression, setExpression] = useState<PoseidonExpression>('welcome')
  const [hasGreeted, setHasGreeted] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

  // Focus input when chat opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isOpen])

  // Auto-greet on first open
  useEffect(() => {
    if (isOpen && !hasGreeted) {
      setHasGreeted(true)
      setExpression('welcome')
      setMessages([{
        id: 'greeting',
        role: 'assistant',
        content: '🔱 **Greetings, ocean explorer!** I am **Poseidon**, guardian of the Indian Ocean\'s deepest secrets.\n\nI can help you with:\n- 🌡️ **Data queries** — Ask about temperature, salinity, or currents at any location\n- 🗺️ **Navigation** — Learn how to use the globe, dive mode, and analysis tools\n- 🌊 **Ocean science** — Discover fascinating facts about the Indian Ocean\n\nWhat would you like to explore today?',
        expression: 'welcome',
        timestamp: Date.now(),
      }])
    }
  }, [isOpen, hasGreeted])

  const sendMessage = useCallback(async (messageText: string) => {
    if (!messageText.trim() || isLoading) return

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: messageText.trim(),
      timestamp: Date.now(),
    }

    setMessages(prev => [...prev, userMsg])
    setInput('')
    setIsLoading(true)
    setExpression('thinking')

    try {
      // Build history from previous messages (excluding the greeting)
      const history = messages
        .filter(m => m.id !== 'greeting')
        .map(m => ({ role: m.role, content: m.content }))

      const res = await fetch('http://127.0.0.1:8000/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: messageText.trim(),
          history,
        }),
      })

      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const data: ChatResponse = await res.json()

      const assistantMsg: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: data.response,
        expression: data.expression,
        timestamp: Date.now(),
      }

      setMessages(prev => [...prev, assistantMsg])
      setExpression(data.expression || 'explaining')
    } catch {
      const errorMsg: ChatMessage = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: '🌊 The currents of connectivity seem troubled. I could not reach the data engine. Please ensure the backend server is running on `localhost:8000` and try again.',
        expression: 'warning',
        timestamp: Date.now(),
      }
      setMessages(prev => [...prev, errorMsg])
      setExpression('warning')
    } finally {
      setIsLoading(false)
    }
  }, [messages, isLoading])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    sendMessage(input)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input)
    }
  }

  return (
    <>
      {/* Floating Chat Button */}
      <button
        className={`poseidon-fab ${isOpen ? 'poseidon-fab-hidden' : ''}`}
        onClick={() => setIsOpen(true)}
        title="Ask Poseidon"
        aria-label="Open Poseidon chat assistant"
      >
        <img src="/poseidon.png" alt="Poseidon" className="fab-poseidon-img" />
        <div className="fab-ripple" />
        <div className="fab-ripple fab-ripple-2" />
      </button>

      {/* Chat Panel */}
      <div className={`poseidon-panel ${isOpen ? 'poseidon-panel-open' : ''}`}>
        {/* Header */}
        <div className="poseidon-header">
          <div className="poseidon-header-left">
            <PoseidonAvatar expression={expression} size={42} isMini />
            <div className="poseidon-header-info">
              <span className="poseidon-name">Poseidon</span>
              <span className="poseidon-status">
                <span className="status-dot" />
                {isLoading ? 'Consulting the depths...' : 'Ocean Intelligence Active'}
              </span>
            </div>
          </div>
          <button className="poseidon-close" onClick={() => setIsOpen(false)} aria-label="Close chat">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Avatar Display Area */}
        <div className="poseidon-avatar-display">
          <PoseidonAvatar expression={expression} size={150} />
          <div className="avatar-expression-label">{expression}</div>
        </div>

        {/* Messages */}
        <div className="poseidon-messages">
          {messages.map((msg) => (
            <div key={msg.id} className={`poseidon-msg poseidon-msg-${msg.role}`}>
              {msg.role === 'assistant' && (
                <div className="msg-avatar-mini">
                  <img src="/poseidon.png" alt="Poseidon" className="msg-poseidon-mini" />
                </div>
              )}
              <div className="msg-bubble" dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }} />
            </div>
          ))}

          {isLoading && (
            <div className="poseidon-msg poseidon-msg-assistant">
              <div className="msg-avatar-mini">
                <img src="/poseidon.png" alt="Poseidon" className="msg-poseidon-mini" />
              </div>
              <div className="msg-bubble">
                <TypingIndicator />
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <form className="poseidon-input-bar" onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            type="text"
            className="poseidon-input"
            placeholder="Ask Poseidon about the ocean..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
            autoComplete="off"
          />
          <button
            type="submit"
            className="poseidon-send"
            disabled={!input.trim() || isLoading}
            aria-label="Send message"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </form>
      </div>
    </>
  )
}
