import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockCreate } = vi.hoisted(() => {
  return { mockCreate: vi.fn() }
})

vi.mock('groq-sdk', () => ({
  default: class {
    chat = { completions: { create: mockCreate } }
  },
}))

import handler, { AVAILABLE_MODELS } from './chat'

const vercelAiChatHandler = handler

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
})

// Helper to create mock Express/Vercel req/res objects
function createMockReqRes(options: {
  method?: string
  body?: any
  headers?: Record<string, string>
  query?: Record<string, string>
}) {
  const req: any = {
    method: options.method || 'POST',
    body: options.body || {},
    headers: options.headers || {},
    query: options.query || {},
    on: vi.fn(),
  }

  let statusCode = 200
  let responseData: any = null
  let headers: Record<string, string> = {}
  let streamOutput = ''

  const res: any = {
    status: (code: number) => {
      statusCode = code
      return res
    },
    json: (data: any) => {
      responseData = data
      headers['content-type'] = 'application/json'
      return res
    },
    setHeader: (key: string, value: string) => {
      headers[key.toLowerCase()] = value
      return res
    },
    write: (chunk: string) => {
      streamOutput += chunk
      return true
    },
    end: () => res,
    flushHeaders: vi.fn(),
  }

  return {
    req,
    res,
    getStatusCode: () => statusCode,
    getResponseData: () => responseData,
    getHeaders: () => headers,
    getStreamOutput: () => streamOutput,
  }
}

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