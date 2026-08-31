import type { VercelRequest, VercelResponse } from '@vercel/node'
import Groq from 'groq-sdk'
import {
  executeChatCompletion,
  streamChatCompletion,
  resolveModel,
  validateChatMessages,
  formatAiError,
} from '../../src/lib/aiChatService'

const groq = new Groq({ 
  apiKey: process.env.GROQ_API_KEY || '',
  timeout: 15000,
  maxRetries: 2
})

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { messages, model: requestedModel } = (req.body || {}) as {
    messages?: any[]
    model?: string
  }

  const validationError = validateChatMessages(messages)
  if (validationError) {
    return res.status(400).json({ error: validationError })
  }

  const model = resolveModel(requestedModel)
  const wantsStream =
    (req.headers.accept || '').includes('text/event-stream') ||
    req.query.stream === '1'

  const controller = new AbortController()
  const onReqClose = () => controller.abort()
  req.on('close', onReqClose)

  if (!wantsStream) {
    try {
      const result = await executeChatCompletion(
        groq, 
        {
          messages: messages!,
          model,
        },
        controller.signal
      )
      return res.json(result)
    } catch (err: any) {
      if (controller.signal.aborted) return res.end()
      console.error('[groq error]', err?.message)
      const formatted = formatAiError(err)
      return res.status(500).json({ error: formatted.message })
    } finally {
      req.off('close', onReqClose)
    }
  }

  // SSE streaming path
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  if (typeof (res as any).flushHeaders === 'function') {
    ;(res as any).flushHeaders()
  }

  const sendEvent = (event: string, data: Record<string, unknown>) => {
    res.write(`event: ${event}\n`)
    res.write(`data: ${JSON.stringify(data)}\n\n`)
  }

  try {
    const stream = await streamChatCompletion(
      groq,
      {
        messages: messages!,
        model,
      },
      controller.signal
    )

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content
      if (delta) sendEvent('delta', { content: delta })
    }
    sendEvent('done', { model })
    res.end()
  } catch (err: any) {
    if (controller.signal.aborted) return res.end()
    console.error('[groq stream error]', err?.message)
    const formatted = formatAiError(err)
    sendEvent('error', { error: formatted.message })
    res.end()
  } finally {
    req.off('close', onReqClose)
  }
}
