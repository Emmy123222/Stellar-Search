import type { VercelRequest, VercelResponse } from '@vercel/node'
import Groq from 'groq-sdk'
import { readServerConfig } from '../../src/lib/config'

    if (role === "system") {
      return {
        ok: false,
        error: "Client messages may only use user or assistant roles",
      };
    }

    if (role !== "user" && role !== "assistant") {
      return {
        ok: false,
        error: "Client messages must use user or assistant roles",
      };
    }

    if (typeof content !== "string") {
      return { ok: false, error: "Message content must be a string" };
    }

    sanitized.push({ role, content });
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
    sendEvent("done", { model });
    res.end();
  } catch (err: any) {
    if (controller.signal.aborted) return res.end()
    console.error('[groq stream error]', err?.message)
    const formatted = formatAiError(err)
    sendEvent('error', { error: formatted.message })
    res.end()
  }
}
