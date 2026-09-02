import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCreate = vi.fn()

vi.mock('groq-sdk', () => ({
  default: class {
    chat = {
      completions: {
        create: mockCreate,
      },
    }
  },
}))

describe('Vercel API: /api/ai/chat handler', () => {
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
