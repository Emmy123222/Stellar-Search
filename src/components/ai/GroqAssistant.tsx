import { readBrowserConfig } from '../../lib/config'
import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Bot, Send, X, ChevronDown } from 'lucide-react'
import type { SearchResult } from '../../hooks/useSearch'

interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
  model?: string // Add model info to messages
}

interface LastSearch {
  query: string
  results: SearchResult[]
}

interface Props {
  lastSearch?: LastSearch | null
}

// Available Groq models
const AVAILABLE_MODELS = [
  { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B', description: 'Most capable' },
  { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B', description: 'Fastest' },
  { id: 'mixtral-8x7b-32768', label: 'Mixtral 8x7B', description: 'Balanced' },
] as const

type ModelId = typeof AVAILABLE_MODELS[number]['id']

const SYSTEM_INTRO: Message = {
  role: 'assistant',
  content:
    "Hi! I'm your AI research assistant powered by Groq. I can help you craft better search queries, summarise results, or explain topics. Each search costs 0.001 USDC on Stellar. What would you like to research?",
}

const SERVER_URL = readBrowserConfig().apiBaseUrl

// Parse an SSE stream from `/ai/chat` and invoke `onDelta` for each token.
// Stops cleanly on `event: done` or `event: error`.
async function consumeSSE(
  body: ReadableStream<Uint8Array>,
  onDelta: (delta: string) => void,
  onModel?: (model: string) => void,
): Promise<void> {
  const reader  = body.getReader()
  const decoder = new TextDecoder('utf-8')
  let   buffer  = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    // SSE events are delimited by a blank line.
    let blankLine: number
    while ((blankLine = buffer.indexOf('\n\n')) !== -1) {
      const rawEvent = buffer.slice(0, blankLine)
      buffer = buffer.slice(blankLine + 2)

      let event = 'message'
      let data  = ''
      for (const line of rawEvent.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) data += line.slice(5).trim()
      }
      if (!data) continue

      if (event === 'delta') {
        try {
          const { content } = JSON.parse(data) as { content?: string }
          if (content) onDelta(content)
        } catch { /* malformed chunk; skip */ }
      } else if (event === 'done') {
        try {
          const { model } = JSON.parse(data) as { model?: string }
          if (model && onModel) onModel(model)
        } catch { /* ignore malformed done event */ }
        return
      } else if (event === 'error') {
        try {
          const { error } = JSON.parse(data) as { error?: string }
          throw new Error(error || 'stream error')
        } catch (e) {
          throw e instanceof Error ? e : new Error('stream error')
        }
      }
    }
  }
}

// Build a system message that gives Groq context from the user's most recent
// paid search so follow-up questions can be answered without re-asking.
function buildSearchContextMessage(s: LastSearch): Message {
  const top = s.results.slice(0, 3).map((r, i) =>
    `${i + 1}. ${r.title} — ${r.url}\n   ${r.description}`
  ).join('\n')
  return {
    role: 'system',
    content:
      `Context — the user's most recent search:\n` +
      `Query: "${s.query}"\n` +
      `Top results:\n${top}\n\n` +
      `Use this when answering follow-up questions. Do not repeat the list verbatim.`,
  }
}

export function GroqAssistant({ lastSearch }: Props = {}) {
  const [open, setOpen]         = useState(false)
  const [messages, setMessages] = useState<Message[]>([SYSTEM_INTRO])
  const [input, setInput]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [selectedModel, setSelectedModel] = useState<ModelId>('llama-3.3-70b-versatile')
  const [showModelDropdown, setShowModelDropdown] = useState(false)
  const bottomRef               = useRef<HTMLDivElement>(null)
  const contextInjectedFor      = useRef<string | null>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Inject a search-context system message the first time the assistant is
  // opened after a search completes. Re-inject if the query changes.
  useEffect(() => {
    if (!open || !lastSearch || !lastSearch.results.length) return
    if (contextInjectedFor.current === lastSearch.query) return
    contextInjectedFor.current = lastSearch.query
    setMessages(prev => [...prev, buildSearchContextMessage(lastSearch)])
  }, [open, lastSearch])

  const send = async () => {
    if (!input.trim() || loading) return
    const userMsg: Message = { role: 'user', content: input.trim() }
    const history = [...messages, userMsg]
    setMessages(history)
    setInput('')
    setLoading(true)

    // Insert a placeholder assistant message we'll stream tokens into.
    setMessages(prev => [...prev, { role: 'assistant', content: '', model: selectedModel }])

    const payload = JSON.stringify({
      messages: history.map(m => ({ role: m.role, content: m.content })),
      model: selectedModel,
    })

    try {
      const res = await fetch(`${SERVER_URL}/ai/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: payload,
      })
      if (!res.ok) throw new Error(`Server error ${res.status}`)

      const isSSE = res.headers.get('content-type')?.includes('text/event-stream')
      if (isSSE && res.body) {
        await consumeSSE(
          res.body,
          delta => {
            setMessages(prev => {
              const next = [...prev]
              const last = next[next.length - 1]
              if (last?.role === 'assistant') {
                next[next.length - 1] = { ...last, content: last.content + delta }
              }
              return next
            })
          },
          model => {
            // Update the model info in the last message
            setMessages(prev => {
              const next = [...prev]
              const last = next[next.length - 1]
              if (last?.role === 'assistant') {
                next[next.length - 1] = { ...last, model }
              }
              return next
            })
          }
        )
      } else {
        // Non-streaming fallback: server returned JSON.
        const data = await res.json()
        setMessages(prev => {
          const next = [...prev]
          next[next.length - 1] = { 
            role: 'assistant', 
            content: data.content ?? 'No response.',
            model: data.model || selectedModel
          }
          return next
        })
      }
    } catch (err: any) {
      setMessages(prev => {
        const next = [...prev]
        next[next.length - 1] = {
          role: 'assistant',
          content: `⚠️ Could not reach AI server: ${err.message}. Make sure the backend is running with GROQ_API_KEY set.`,
          model: selectedModel,
        }
        return next
      })
    } finally {
      setLoading(false)
    }
  }

  const getModelLabel = (modelId: string) => {
    const model = AVAILABLE_MODELS.find(m => m.id === modelId)
    return model?.label || modelId
  }

  return (
    <>
      {/* Floating button */}
      <motion.button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 w-12 h-12 rounded-full flex items-center justify-center"
        style={{ background: 'rgba(0,245,255,0.15)', border: '1px solid rgba(0,245,255,0.4)' }}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.95 }}
        animate={{
          boxShadow: [
            '0 0 15px rgba(0,245,255,0.3)',
            '0 0 35px rgba(0,245,255,0.6)',
            '0 0 15px rgba(0,245,255,0.3)',
          ],
        }}
        transition={{ duration: 2, repeat: Infinity }}
      >
        <Bot className="w-5 h-5 text-neon-cyan" />
      </motion.button>

      {/* Chat panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className="fixed bottom-20 right-6 z-40 w-96 rounded-2xl overflow-hidden flex flex-col"
            style={{
              height: '480px',
              background: 'rgba(6,13,20,0.96)',
              border: '1px solid rgba(0,245,255,0.2)',
              backdropFilter: 'blur(20px)',
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
              <div className="flex items-center gap-2">
                <Bot className="w-4 h-4 text-neon-cyan" />
                <span className="font-display text-xs text-neon-cyan tracking-wider">GROQ AI</span>
                {/* Model Selector Dropdown */}
                <div className="relative">
                  <button
                    onClick={() => setShowModelDropdown(!showModelDropdown)}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition-colors"
                    style={{
                      background: 'rgba(0,245,255,0.1)',
                      border: '1px solid rgba(0,245,255,0.2)',
                      color: 'rgba(255,255,255,0.8)',
                    }}
                  >
                    <span>{getModelLabel(selectedModel)}</span>
                    <ChevronDown className="w-3 h-3" />
                  </button>
                  
                  {/* Dropdown Menu */}
                  <AnimatePresence>
                    {showModelDropdown && (
                      <motion.div
                        initial={{ opacity: 0, y: -5 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -5 }}
                        className="absolute top-full left-0 mt-1 w-48 rounded-lg overflow-hidden z-50"
                        style={{
                          background: 'rgba(6,13,20,0.98)',
                          border: '1px solid rgba(0,245,255,0.2)',
                        }}
                      >
                        {AVAILABLE_MODELS.map(model => (
                          <button
                            key={model.id}
                            onClick={() => {
                              setSelectedModel(model.id)
                              setShowModelDropdown(false)
                            }}
                            className="w-full px-3 py-2 text-left hover:bg-white/5 transition-colors"
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-xs text-white">{model.label}</span>
                              {selectedModel === model.id && (
                                <span className="text-neon-cyan text-xs">✓</span>
                              )}
                            </div>
                            <div className="text-xs text-white/40 mt-0.5">{model.description}</div>
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="text-white/30 hover:text-white/60 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {messages.filter(m => m.role !== 'system').map((msg, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
                >
                  <div
                    className="max-w-[85%] rounded-xl px-3 py-2 text-xs leading-relaxed"
                    style={{
                      background: msg.role === 'user'
                        ? 'rgba(0,245,255,0.15)'
                        : 'rgba(255,255,255,0.05)',
                      border: msg.role === 'user'
                        ? '1px solid rgba(0,245,255,0.3)'
                        : '1px solid rgba(255,255,255,0.07)',
                      color: msg.role === 'user' ? '#00f5ff' : 'rgba(255,255,255,0.7)',
                    }}
                  >
                    {msg.content}
                  </div>
                  {/* Show model metadata for assistant messages */}
                  {msg.role === 'assistant' && msg.model && (
                    <div className="text-[10px] text-white/30 mt-1 px-1">
                      {getModelLabel(msg.model)}
                    </div>
                  )}
                </motion.div>
              ))}

              {loading && (
                <div className="flex justify-start">
                  <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/5 border border-white/7">
                    {[0, 1, 2].map(j => (
                      <motion.div
                        key={j}
                        className="w-1.5 h-1.5 rounded-full bg-neon-cyan/60"
                        animate={{ opacity: [0.3, 1, 0.3] }}
                        transition={{ duration: 0.8, repeat: Infinity, delay: j * 0.15 }}
                      />
                    ))}
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            {/* Input */}
            <div className="p-3 border-t border-white/5">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
                  placeholder="Ask anything..."
                  disabled={loading}
                  className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder:text-white/25 outline-none focus:border-neon-cyan/30 disabled:opacity-50"
                  style={{ caretColor: '#00f5ff' }}
                />
                <button
                  onClick={send}
                  disabled={!input.trim() || loading}
                  className="w-8 h-8 rounded-lg flex items-center justify-center transition-all disabled:opacity-30"
                  style={{
                    background: 'rgba(0,245,255,0.15)',
                    border: '1px solid rgba(0,245,255,0.3)',
                  }}
                >
                  <Send className="w-3.5 h-3.5 text-neon-cyan" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}