import type { VercelRequest, VercelResponse } from '@vercel/node'
import Groq from 'groq-sdk'
import { readServerConfig } from '../../src/lib/config'

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

  // Groq is an optional feature: keep paid search deployable without its key.
  const groqApiKey = readServerConfig().groqApiKey
  if (!groqApiKey) return res.status(503).json({ error: 'AI assistant is not configured.' })
  const groq = new Groq({ apiKey: groqApiKey })

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
  }
}
