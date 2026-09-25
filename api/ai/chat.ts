import type { VercelRequest, VercelResponse } from '@vercel/node'
import Groq from 'groq-sdk'
import { readServerConfig } from '../../src/lib/config'
import { applyServerlessHeaders } from '../../src/lib/serverlessHeaders'
import {
  validateChatMessages,
  executeChatCompletion,
  streamChatCompletion,
  formatAiError,
  resolveModel,
  type ChatMessage,
} from '../../src/lib/aiChatService'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyServerlessHeaders(res)

  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'POST, OPTIONS')
    return res.status(204).end()
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const body = req.body || {}
  const { messages: rawMessages, model: requestedModel, stream: streamFlag } = body as {
    messages?: unknown
    model?: string
    stream?: unknown
  }

  // Validate messages via shared schema — reports the offending index, never echoes content
  const validationError = validateChatMessages(rawMessages)
  if (validationError) {
    return res.status(400).json({ error: validationError })
  }

  // Groq is an optional feature: keep paid search deployable without its key.
  const groqApiKey = process.env.GROQ_API_KEY || (function () {
    try {
      return readServerConfig().groqApiKey
    } catch {
      return undefined
    }
  })()
  if (!groqApiKey) return res.status(503).json({ error: 'AI assistant is not configured.' })

  const groq = new Groq({ apiKey: groqApiKey })
  const messages = rawMessages as ChatMessage[]
  const model = resolveModel(requestedModel)
  const wantsStream =
    streamFlag === true ||
    (req.headers.accept || '').includes('text/event-stream')

  if (!wantsStream) {
    try {
      return res.json(await executeChatCompletion(groq, { messages, model }))
    } catch (error) {
      return res.status(500).json({ error: formatAiError(error).message })
    }
  }

  // SSE streaming path
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  // VercelResponse does not always expose flushHeaders; guard it
  if (typeof (res as any).flushHeaders === 'function') {
    (res as any).flushHeaders()
  }

  const controller = new AbortController()
  if (typeof (req as any).on === 'function') {
    (req as any).on('close', () => controller.abort())
  }

  const send = (event: string, data: Record<string, unknown>) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  try {
    const stream = await streamChatCompletion(groq, { messages, model }, controller.signal)
    for await (const chunk of stream) {
      const content = chunk.choices?.[0]?.delta?.content
      if (content) send('delta', { content })
    }
    send('done', { model })
  } catch (error) {
    if (!controller.signal.aborted) {
      send('error', { error: formatAiError(error).message })
    }
  } finally {
    res.end()
  }
}
