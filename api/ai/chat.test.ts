import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCreate = vi.fn()

vi.mock('groq-sdk', () => {
  return {
    default: class MockGroq {
      chat = {
        completions: {
          create: (...args: any[]) => mockCreate(...args),
        },
      }
    },
  }
})

import vercelAiChatHandler, { AVAILABLE_MODELS } from './chat'

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
    process.env.GROQ_API_KEY = 'test_groq_key'
  })

  it('exports AVAILABLE_MODELS whitelist', () => {
    expect(AVAILABLE_MODELS).toContain('llama-3.3-70b-versatile')
    expect(AVAILABLE_MODELS).toContain('llama-3.1-8b-instant')
    expect(AVAILABLE_MODELS).toContain('mixtral-8x7b-32768')
  })

  it('rejects non-POST requests with 405 Method Not Allowed', async () => {
    const { req, res, getStatusCode, getResponseData } = createMockReqRes({ method: 'GET' })
    await vercelAiChatHandler(req, res)
    expect(getStatusCode()).toBe(405)
    expect(getResponseData()).toEqual({ error: 'Method not allowed' })
  })

  it('rejects requests with missing or empty messages array with 400 Bad Request', async () => {
    const { req, res, getStatusCode, getResponseData } = createMockReqRes({
      method: 'POST',
      body: { messages: [] },
    })
    await vercelAiChatHandler(req, res)
    expect(getStatusCode()).toBe(400)
    expect(getResponseData()).toEqual({ error: 'messages array required' })
  })

  it('honors valid requested model in non-streaming JSON mode', async () => {
    mockCreate.mockResolvedValueOnce({
      model: 'mixtral-8x7b-32768',
      choices: [{ message: { content: 'Mixtral response' } }],
    })

    const { req, res, getStatusCode, getResponseData } = createMockReqRes({
      method: 'POST',
      body: {
        messages: [{ role: 'user', content: 'Tell me about Stellar' }],
        model: 'mixtral-8x7b-32768',
      },
    })

    await vercelAiChatHandler(req, res)

    expect(getStatusCode()).toBe(200)
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'mixtral-8x7b-32768',
      })
    )
    expect(getResponseData()).toEqual({
      content: 'Mixtral response',
      model: 'mixtral-8x7b-32768',
    })
  })

  it('falls back to default model llama-3.3-70b-versatile when model is invalid or unrecognised', async () => {
    mockCreate.mockResolvedValueOnce({
      model: 'llama-3.3-70b-versatile',
      choices: [{ message: { content: 'Fallback model response' } }],
    })

    const { req, res, getStatusCode } = createMockReqRes({
      method: 'POST',
      body: {
        messages: [{ role: 'user', content: 'Test query' }],
        model: 'invalid-unsupported-model-x',
      },
    })

    await vercelAiChatHandler(req, res)

    expect(getStatusCode()).toBe(200)
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'llama-3.3-70b-versatile',
      })
    )
  })

  it('streams SSE events matching contract sequence when Accept header or stream parameter is present', async () => {
    async function* mockStreamGenerator() {
      yield { choices: [{ delta: { content: 'Stellar ' } }] }
      yield { choices: [{ delta: { content: 'network ' } }] }
      yield { choices: [{ delta: { content: 'is fast.' } }] }
    }

    mockCreate.mockResolvedValueOnce(mockStreamGenerator())

    const { req, res, getHeaders, getStreamOutput } = createMockReqRes({
      method: 'POST',
      headers: { accept: 'text/event-stream' },
      body: {
        messages: [{ role: 'user', content: 'What is Stellar?' }],
        model: 'llama-3.1-8b-instant',
      },
    })

    await vercelAiChatHandler(req, res)

    expect(getHeaders()['content-type']).toBe('text/event-stream')

    const output = getStreamOutput()
    expect(output).toContain('event: delta\ndata: {"content":"Stellar "}\n\n')
    expect(output).toContain('event: delta\ndata: {"content":"network "}\n\n')
    expect(output).toContain('event: delta\ndata: {"content":"is fast."}\n\n')
    expect(output).toContain('event: done\ndata: {"model":"llama-3.1-8b-instant"}\n\n')
  })

  it('handles Groq API error in streaming mode by emitting error event', async () => {
    mockCreate.mockRejectedValueOnce(new Error('Groq rate limit exceeded'))

    const { req, res, getStreamOutput } = createMockReqRes({
      method: 'POST',
      body: {
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true,
      },
    })

    await vercelAiChatHandler(req, res)

    const output = getStreamOutput()
    expect(output).toContain('event: error\ndata: {"error":"Groq AI error: Groq rate limit exceeded"}\n\n')
  })
})
