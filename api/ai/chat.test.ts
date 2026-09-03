import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCreate = vi.fn();

vi.mock('groq-sdk', () => ({
  default: class {
    chat = {
      completions: {
        create: mockCreate,
      },
    }
  },
}))

vi.mock('../../src/lib/aiChatService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/aiChatService')>()
  return {
    ...actual,
    streamChatCompletion: mockStreamChatCompletion,
  }
})

describe('Vercel API: /api/ai/chat handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.GROQ_API_KEY = 'gsk_test'
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

  it('returns 500 with formatted error when JSON completion fails', async () => {
    mockCreate.mockRejectedValueOnce(new Error('upstream down'))

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
    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ error: 'Groq AI error: upstream down' })
  })

  it('streams delta and done events over SSE when Accept is text/event-stream', async () => {
    async function* stream() {
      yield { choices: [{ delta: { content: 'Hello' } }] }
      yield { choices: [{ delta: { content: ' world' } }] }
      yield { choices: [{ delta: {} }] }
    }
    mockCreate.mockResolvedValueOnce(stream())

    const handler = (await import('./chat')).default
    const writes: string[] = []
    const req: any = {
      method: 'POST',
      headers: { accept: 'text/event-stream' },
      query: {},
      body: {
        messages: [{ role: 'user', content: 'What is Stellar?' }],
      },
      on: vi.fn(),
    }
    const res: any = {
      setHeader: vi.fn(),
      flushHeaders: vi.fn(),
      write: (chunk: string) => writes.push(chunk),
      end: vi.fn(),
    }

    await handler(req, res)
    const output = writes.join('')
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream')
    expect(res.flushHeaders).toHaveBeenCalled()
    expect(output).toContain('event: delta')
    expect(output).toContain('Hello')
    expect(output).toContain('world')
    expect(output).toContain('event: done')
    expect(output).toContain('llama-3.3-70b-versatile')
    expect(res.end).toHaveBeenCalled()
  })

  it('sends an error event and ends the stream when SSE streaming fails', async () => {
    mockCreate.mockRejectedValueOnce(new Error('stream broke'))

    const handler = (await import('./chat')).default
    const writes: string[] = []
    const req: any = {
      method: 'POST',
      headers: { accept: 'text/event-stream' },
      query: {},
      body: {
        messages: [{ role: 'user', content: 'What is Stellar?' }],
      },
      on: vi.fn(),
    }
    const res: any = {
      setHeader: vi.fn(),
      write: (chunk: string) => writes.push(chunk),
      end: vi.fn(),
    }

    await handler(req, res)
    const output = writes.join('')
    expect(output).toContain('event: error')
    expect(output).toContain('Groq AI error: stream broke')
    expect(res.end).toHaveBeenCalled()
  })
})
