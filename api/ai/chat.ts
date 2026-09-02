import type { VercelRequest, VercelResponse } from '@vercel/node'
import Groq from 'groq-sdk'
import { readServerConfig } from '../../src/lib/config'
import { validateChatMessages, executeChatCompletion } from '../../src/lib/aiChatService'

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
  const groqApiKey = process.env.GROQ_API_KEY || (function() {
    try {
      return readServerConfig().groqApiKey
    } catch {
      return undefined
    }
  })()
  if (!groqApiKey) return res.status(503).json({ error: 'AI assistant is not configured.' })
  const groq = new Groq({ apiKey: groqApiKey })

  try {
    const result = await executeChatCompletion(groq, {
      messages: messages!,
      model: requestedModel,
    })
    return res.json(result)
  } catch (err: any) {
    console.error('[groq error]', err?.message)
    return res.status(500).json({ error: 'AI generation failed.' })
  }
}
