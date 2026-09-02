import { describe, it, expect, vi } from 'vitest'
import {
  DEFAULT_MODEL,
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_MAX_TOKENS,
  DEFAULT_TEMPERATURE,
  resolveModel,
  validateChatMessages,
  buildChatMessages,
  executeChatCompletion,
  streamChatCompletion,
  formatAiError,
  ChatMessage,
} from './aiChatService'

describe('aiChatService - Shared AI Chat Service', () => {
  describe('resolveModel', () => {
    it('returns requested model if included in AVAILABLE_MODELS', () => {
      expect(resolveModel('llama-3.1-8b-instant')).toBe('llama-3.1-8b-instant')
      expect(resolveModel('mixtral-8x7b-32768')).toBe('mixtral-8x7b-32768')
      expect(resolveModel('llama-3.3-70b-versatile')).toBe('llama-3.3-70b-versatile')
    })

    it('falls back to DEFAULT_MODEL for unknown or missing model', () => {
      expect(resolveModel(undefined)).toBe(DEFAULT_MODEL)
      expect(resolveModel(null)).toBe(DEFAULT_MODEL)
      expect(resolveModel('')).toBe(DEFAULT_MODEL)
      expect(resolveModel('gpt-4')).toBe(DEFAULT_MODEL)
      expect(resolveModel('claude-3-5-sonnet')).toBe(DEFAULT_MODEL)
    })
  })

  describe('validateChatMessages', () => {
    it('returns error when messages is null, undefined, not an array, or empty', () => {
      expect(validateChatMessages(undefined)).toBe('messages array required')
      expect(validateChatMessages(null)).toBe('messages array required')
      expect(validateChatMessages([])).toBe('messages array required')
      expect(validateChatMessages('not-an-array')).toBe('messages array required')
    })

    it('returns error when a message item is invalid or not an object', () => {
      expect(validateChatMessages(['invalid'])).toContain('Invalid message at index 0')
    })

    it('returns error when role is invalid', () => {
      const messages = [{ role: 'invalid_role', content: 'hello' }]
      expect(validateChatMessages(messages)).toContain("must be 'system', 'user', or 'assistant'")
    })

    it('returns error when content is empty or not a string', () => {
      expect(validateChatMessages([{ role: 'user', content: '' }])).toContain('must be a non-empty string')
      expect(validateChatMessages([{ role: 'user', content: '   ' }])).toContain('must be a non-empty string')
      expect(validateChatMessages([{ role: 'user', content: 123 }])).toContain('must be a non-empty string')
    })

    it('returns null for valid messages', () => {
      const valid: ChatMessage[] = [
        { role: 'user', content: 'What is Stellar?' },
        { role: 'assistant', content: 'Stellar is a payment network.' },
      ]
      expect(validateChatMessages(valid)).toBeNull()
    })
  })

  describe('buildChatMessages', () => {
    it('prepends default system prompt when no system message exists', () => {
      const messages: ChatMessage[] = [{ role: 'user', content: 'Search help' }]
      const built = buildChatMessages(messages)
      expect(built).toHaveLength(2)
      expect(built[0]).toEqual({ role: 'system', content: DEFAULT_SYSTEM_PROMPT })
      expect(built[1]).toEqual({ role: 'user', content: 'Search help' })
    })

    it('preserves custom system message if already provided', () => {
      const messages: ChatMessage[] = [
        { role: 'system', content: 'Custom instructions' },
        { role: 'user', content: 'Hello' },
      ]
      const built = buildChatMessages(messages)
      expect(built).toHaveLength(2)
      expect(built[0].content).toBe('Custom instructions')
    })
  })

  describe('executeChatCompletion', () => {
    it('invokes groq chat completions create and returns formatted response', async () => {
      const mockGroq = {
        chat: {
          completions: {
            create: vi.fn().mockResolvedValue({
              model: 'llama-3.3-70b-versatile',
              choices: [{ message: { content: 'Stellar is fast.' } }],
            }),
          },
        },
      }

      const result = await executeChatCompletion(mockGroq, {
        messages: [{ role: 'user', content: 'Tell me about Stellar' }],
        model: 'llama-3.3-70b-versatile',
      })

      expect(mockGroq.chat.completions.create).toHaveBeenCalledWith({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: DEFAULT_SYSTEM_PROMPT },
          { role: 'user', content: 'Tell me about Stellar' },
        ],
        max_tokens: DEFAULT_MAX_TOKENS,
        temperature: DEFAULT_TEMPERATURE,
      })

      expect(result).toEqual({
        content: 'Stellar is fast.',
        model: 'llama-3.3-70b-versatile',
      })
    })

    it('handles empty choices with fallback content', async () => {
      const mockGroq = {
        chat: {
          completions: {
            create: vi.fn().mockResolvedValue({
              model: 'llama-3.3-70b-versatile',
              choices: [],
            }),
          },
        },
      }

      const result = await executeChatCompletion(mockGroq, {
        messages: [{ role: 'user', content: 'Hello' }],
      })

      expect(result.content).toBe('No response.')
    })
  })

  describe('streamChatCompletion', () => {
    it('invokes groq completions create with stream: true and optional signal', async () => {
      const mockStream = { [Symbol.asyncIterator]: vi.fn() }
      const mockGroq = {
        chat: {
          completions: {
            create: vi.fn().mockResolvedValue(mockStream),
          },
        },
      }

      const controller = new AbortController()
      const stream = await streamChatCompletion(
        mockGroq,
        {
          messages: [{ role: 'user', content: 'Stream test' }],
        },
        controller.signal
      )

      expect(mockGroq.chat.completions.create).toHaveBeenCalledWith(
        {
          model: DEFAULT_MODEL,
          messages: [
            { role: 'system', content: DEFAULT_SYSTEM_PROMPT },
            { role: 'user', content: 'Stream test' },
          ],
          max_tokens: DEFAULT_MAX_TOKENS,
          temperature: DEFAULT_TEMPERATURE,
          stream: true,
        },
        { signal: controller.signal }
      )
      expect(stream).toBe(mockStream)
    })
  })

  describe('formatAiError', () => {
    it('formats error objects and strings correctly', () => {
      expect(formatAiError(new Error('Rate limit exceeded'))).toEqual({
        message: 'Groq AI error: Rate limit exceeded',
      })
      expect(formatAiError('Network down')).toEqual({
        message: 'Groq AI error: Network down',
      })
    })
  })
})
