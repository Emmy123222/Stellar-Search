import type { VercelRequest, VercelResponse } from '@vercel/node'
import Groq from 'groq-sdk'
import { readServerConfig } from '../../src/lib/config'
import { executeChatCompletion, formatAiError, streamChatCompletion, validateChatMessages, type ChatMessage } from '../../src/lib/aiChatService'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const body = (req.body || {}) as { messages?: unknown; model?: string; stream?: boolean }
  const validationError = validateChatMessages(body.messages)
  if (validationError) return res.status(400).json({ error: validationError })
  const groqApiKey = readServerConfig().groqApiKey
  if (!groqApiKey) return res.status(503).json({ error: 'AI assistant is not configured.' })
  const groq = new Groq({ apiKey: groqApiKey })
  const messages = body.messages as ChatMessage[]
  const wantsStream = body.stream === true || (req.headers.accept || '').includes('text/event-stream')

  if (!wantsStream) {
    try { return res.json(await executeChatCompletion(groq, { messages, model: body.model })) }
    catch (error) { return res.status(500).json({ error: formatAiError(error).message }) }
  }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  const controller = new AbortController()
  if (typeof (req as { on?: Function }).on === 'function') (req as { on: Function }).on('close', () => controller.abort())
  const send = (event: string, data: Record<string, unknown>) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  try {
    const stream = await streamChatCompletion(groq, { messages, model: body.model }, controller.signal)
    for await (const chunk of stream) {
      const content = chunk.choices?.[0]?.delta?.content
      if (content) send('delta', { content })
    }
    send('done', {})
  } catch (error) {
    if (!controller.signal.aborted) send('error', { error: formatAiError(error).message })
  } finally { res.end() }
}
