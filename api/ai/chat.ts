import type { VercelRequest, VercelResponse } from '@vercel/node'
import Groq from 'groq-sdk'

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY! })

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // ─── Method handling ───────────────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'POST, OPTIONS')
    return res.status(200).end()
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { messages } = req.body as {
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
  }

  if (!messages?.length) {
    return res.status(400).json({ error: 'messages array required' })
  }

  try {
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'system',
          content:
            'You are StellarSearch AI, a concise research assistant. Help users craft better search queries and understand results. Keep responses under 200 words.',
        },
        ...messages,
      ],
      max_tokens: 512,
      temperature: 0.7,
    })

    const content = completion.choices[0]?.message?.content || 'No response.'
    return res.json({ content, model: completion.model })
  } catch (err: any) {
    console.error('[groq error]', err.message)
    return res.status(500).json({ error: `Groq AI error: ${err.message}` })
  }
}