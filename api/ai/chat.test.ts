import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockCreate } = vi.hoisted(() => {
  return { mockCreate: vi.fn() }
})

vi.mock('groq-sdk', () => ({
  default: class {
    chat = { completions: { create: mockCreate } }
  },
}))

import handler from './chat'

function mockReqRes(method = 'POST', body: any = {}) {
  const req: any = {
    method,
    body,
    headers: {},
  }
  const res: any = {}
  res.status = vi.fn().mockReturnValue(res)
  res.json = vi.fn().mockReturnValue(res)
  return { req, res }
}

describe('api/ai/chat — Vercel Groq chat handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.GROQ_API_KEY = 'test_groq_key'
  })

  it('rejects non-POST methods with 405', async () => {
    const { req, res } = mockReqRes('GET')
    await handler(req, res)
    expect(res.status).toHaveBeenCalledWith(405)
    expect(res.json).toHaveBeenCalledWith({ error: 'Method not allowed' })
  })

  it('rejects missing or empty messages array with 400', async () => {
    const { req: req1, res: res1 } = mockReqRes('POST', {})
    await handler(req1, res1)
    expect(res1.status).toHaveBeenCalledWith(400)

    const { req: req2, res: res2 } = mockReqRes('POST', { messages: [] })
    await handler(req2, res2)
    expect(res2.status).toHaveBeenCalledWith(400)
  })

  it('returns chat completion on valid request', async () => {
    mockCreate.mockResolvedValue({
      model: 'llama-3.3-70b-versatile',
      choices: [{ message: { content: 'Stellar is a decentralized blockchain network.' } }],
    })

    const { req, res } = mockReqRes('POST', {
      messages: [{ role: 'user', content: 'What is Stellar?' }],
    })

    await handler(req, res)

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 512,
        temperature: 0.7,
      })
    )
    expect(res.json).toHaveBeenCalledWith({
      content: 'Stellar is a decentralized blockchain network.',
      model: 'llama-3.3-70b-versatile',
    })
  })

  it('handles Groq API errors with 500 status', async () => {
    mockCreate.mockRejectedValue(new Error('Rate limit exceeded'))

    const { req, res } = mockReqRes('POST', {
      messages: [{ role: 'user', content: 'Hello' }],
    })

    await handler(req, res)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({
      error: 'Groq AI error: Rate limit exceeded',
    })
  })

  it('returns 503 when Groq API key is missing', async () => {
    const original = process.env.GROQ_API_KEY
    try {
      delete process.env.GROQ_API_KEY
      const { req, res } = mockReqRes('POST', {
        messages: [{ role: 'user', content: 'Hi' }],
      })
      await handler(req, res)
      expect(res.status).toHaveBeenCalledWith(503)
      expect(res.json).toHaveBeenCalledWith({ error: 'AI assistant is not configured.' })
    } finally {
      process.env.GROQ_API_KEY = original
    }
  })

  it('streams response as SSE when text/event-stream header is requested', async () => {
    mockCreate.mockResolvedValue([
      { choices: [{ delta: { content: 'Hello ' } }] },
      { choices: [{ delta: { content: 'world!' } }] },
    ])

    const writtenChunks: string[] = []
    const req: any = {
      method: 'POST',
      headers: { accept: 'text/event-stream' },
      body: { messages: [{ role: 'user', content: 'Hi' }] },
      on: vi.fn(),
    }
    const res: any = {
      setHeader: vi.fn(),
      write: vi.fn((chunk: string) => {
        writtenChunks.push(chunk)
        return true
      }),
      end: vi.fn(),
      flushHeaders: vi.fn(),
    }

    await handler(req, res)

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream')
    expect(res.end).toHaveBeenCalled()
    expect(writtenChunks.some(c => c.includes('Hello '))).toBe(true)
    expect(writtenChunks.some(c => c.includes('world!'))).toBe(true)
    expect(writtenChunks.some(c => c.includes('event: done'))).toBe(true)
  })

  it('handles stream error by sending error SSE event', async () => {
    mockCreate.mockImplementation(() => {
      throw new Error('Stream failed')
    })

    const writtenChunks: string[] = []
    const req: any = {
      method: 'POST',
      headers: { accept: 'text/event-stream' },
      body: { messages: [{ role: 'user', content: 'Hi' }] },
      on: vi.fn(),
    }
    const res: any = {
      setHeader: vi.fn(),
      write: vi.fn((chunk: string) => {
        writtenChunks.push(chunk)
        return true
      }),
      end: vi.fn(),
      flushHeaders: vi.fn(),
    }

    await handler(req, res)

    expect(writtenChunks.some(c => c.includes('event: error'))).toBe(true)
    expect(res.end).toHaveBeenCalled()
  })

  it('handles client disconnect abort during stream error', async () => {
    let closeCb: () => void = () => {}
    const req: any = {
      method: 'POST',
      headers: { accept: 'text/event-stream' },
      body: { messages: [{ role: 'user', content: 'Hi' }] },
      on: vi.fn((event: string, cb: () => void) => {
        if (event === 'close') closeCb = cb
      }),
    }
    mockCreate.mockImplementation(() => {
      closeCb()
      throw new Error('Aborted')
    })

    const res: any = {
      setHeader: vi.fn(),
      write: vi.fn(),
      end: vi.fn(),
      flushHeaders: vi.fn(),
    }

    await handler(req, res)
    expect(res.end).toHaveBeenCalled()
  })
})

describe('AI Chat Serverless & Express Contract Tests (api/ai/chat.ts)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects non-POST requests with 405', async () => {
    const handler = (await import('./chat')).default
    const req: any = { method: 'GET', body: {} }
    const res: any = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    }

    await handler(req, res)
    expect(res.status).toHaveBeenCalledWith(405)
    expect(res.json).toHaveBeenCalledWith({ error: 'Method not allowed' })
  })

  it('validates messages array and rejects invalid payloads with 400', async () => {
    const handler = (await import('./chat')).default
    const req: any = { method: 'POST', body: {} }
    const res: any = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    }

    await handler(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'messages array required' })
  })

  it('returns JSON completion on valid POST', async () => {
    mockCreate.mockResolvedValue({
      model: 'llama-3.3-70b-versatile',
      choices: [{ message: { content: 'AI answer' } }],
    })

    const handler = (await import('./chat')).default
    const req: any = {
      method: 'POST',
      headers: {},
      query: {},
      body: {
        messages: [{ role: 'user', content: 'What is Stellar?' }],
      },
    }
    const res: any = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    }

    await handler(req, res)
    expect(res.json).toHaveBeenCalledWith({
      content: 'AI answer',
      model: 'llama-3.3-70b-versatile',
    })
  })
})