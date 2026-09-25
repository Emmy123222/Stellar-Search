import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCreate = vi.fn()

vi.mock('groq-sdk', () => ({
  default: class {
    chat = { completions: { create: mockCreate } }
  },
}))

// Spread the real aiChatService so validateChatMessages and other helpers
// work as-is; the Groq mock above intercepts the actual network calls.
vi.mock('../../src/lib/aiChatService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/aiChatService')>()
  return { ...actual }
})

describe('Vercel API: /api/ai/chat handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    process.env.GROQ_API_KEY = 'gsk_test'
  })

  it('rejects non-POST requests with 405', async () => {
    const handler = (await import('./chat')).default
    const req: any = { method: 'GET', body: {} }
    const res: any = {
      setHeader: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    }

    await handler(req, res)
    expect(res.status).toHaveBeenCalledWith(405)
    expect(res.json).toHaveBeenCalledWith({ error: 'Method not allowed' })
  })

  it('handles OPTIONS preflight with 204', async () => {
    const handler = (await import('./chat')).default
    const req: any = { method: 'OPTIONS', body: {} }
    const res: any = {
      setHeader: vi.fn(),
      status: vi.fn().mockReturnThis(),
      end: vi.fn(),
    }

    await handler(req, res)
    expect(res.status).toHaveBeenCalledWith(204)
    expect(res.end).toHaveBeenCalled()
  })

  // ── Missing / empty messages ──────────────────────────────────────────────

  it('validates messages array and rejects missing body with 400', async () => {
    const handler = (await import('./chat')).default
    const req: any = { method: 'POST', body: {} }
    const res: any = {
      setHeader: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    }

    await handler(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'messages array required' })
  })

  it('rejects an empty messages array with 400', async () => {
    const handler = (await import('./chat')).default
    const req: any = { method: 'POST', body: { messages: [] } }
    const res: any = {
      setHeader: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    }

    await handler(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'messages array required' })
  })

  // ── Per-index structural errors — content is never echoed ─────────────────

  it('rejects a sparse / non-object element and reports its index without echoing content', async () => {
    const handler = (await import('./chat')).default
    const req: any = {
      method: 'POST',
      body: {
        messages: [
          { role: 'user', content: 'Good message' },
          'this is a string, not an object',       // index 1
        ],
      },
    }
    const res: any = {
      setHeader: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    }

    await handler(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
    const errBody = res.json.mock.calls[0][0]
    expect(errBody.error).toMatch(/index 1/)
    // Must not echo the offending content back in the error body
    expect(errBody.error).not.toContain('this is a string, not an object')
  })

  it('rejects an invalid role and reports its index without echoing content', async () => {
    const handler = (await import('./chat')).default
    const req: any = {
      method: 'POST',
      body: {
        messages: [
          { role: 'user', content: 'First message' },
          { role: 'superuser', content: 'Second message' },  // index 1, bad role
        ],
      },
    }
    const res: any = {
      setHeader: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    }

    await handler(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
    const errBody = res.json.mock.calls[0][0]
    expect(errBody.error).toMatch(/index 1/)
    expect(errBody.error).toMatch(/system.*user.*assistant/i)
    // Must not echo the bad role value
    expect(errBody.error).not.toContain('superuser')
  })

  it('rejects non-string content and reports its index without echoing content', async () => {
    const handler = (await import('./chat')).default
    const req: any = {
      method: 'POST',
      body: {
        messages: [
          { role: 'user', content: 42 },  // index 0, bad content type
        ],
      },
    }
    const res: any = {
      setHeader: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    }

    await handler(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
    const errBody = res.json.mock.calls[0][0]
    expect(errBody.error).toMatch(/index 0/)
    expect(errBody.error).toMatch(/non-empty string/i)
    // Must not echo the content value
    expect(errBody.error).not.toContain('42')
  })

  it('rejects empty-string content and reports its index without echoing content', async () => {
    const handler = (await import('./chat')).default
    const req: any = {
      method: 'POST',
      body: {
        messages: [
          { role: 'user', content: 'Good first message' },
          { role: 'assistant', content: '   ' },  // index 1, whitespace-only
        ],
      },
    }
    const res: any = {
      setHeader: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    }

    await handler(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
    const errBody = res.json.mock.calls[0][0]
    expect(errBody.error).toMatch(/index 1/)
    expect(errBody.error).toMatch(/non-empty string/i)
    expect(errBody.error).not.toContain('   ')
  })

  it('reports the first offending index when multiple messages are invalid', async () => {
    const handler = (await import('./chat')).default
    const req: any = {
      method: 'POST',
      body: {
        messages: [
          { role: 'user', content: 'Valid' },
          { role: 'bad_role', content: 'Also valid text' },  // index 1 fails first
          { role: 'user', content: '' },                     // index 2 also bad
        ],
      },
    }
    const res: any = {
      setHeader: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    }

    await handler(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
    const errBody = res.json.mock.calls[0][0]
    // First error wins — index 1
    expect(errBody.error).toMatch(/index 1/)
  })

  // ── Happy path ────────────────────────────────────────────────────────────

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
      setHeader: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    }

    await handler(req, res)
    expect(res.json).toHaveBeenCalledWith({
      content: 'AI answer',
      model: 'llama-3.3-70b-versatile',
    })
  })

  it('returns 503 when GROQ_API_KEY is missing', async () => {
    delete process.env.GROQ_API_KEY

    const handler = (await import('./chat')).default
    const req: any = {
      method: 'POST',
      headers: {},
      query: {},
      body: { messages: [{ role: 'user', content: 'Hello' }] },
    }
    const res: any = {
      setHeader: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    }

    await handler(req, res)
    expect(res.status).toHaveBeenCalledWith(503)
    expect(res.json).toHaveBeenCalledWith({ error: 'AI assistant is not configured.' })
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
      setHeader: vi.fn(),
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
