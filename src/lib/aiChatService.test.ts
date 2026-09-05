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

import { buildResearchPrompt, ResearchSource } from './aiChatService'
import type { ReportFormat } from '../types/index'

describe('buildResearchPrompt', () => {
  const sources: ResearchSource[] = [
    { id: '1', title: 'Stellar Overview', url: 'https://stellar.org', description: 'Stellar is a payment network.' },
    { id: '2', title: 'x402 Protocol', url: 'https://x402.org', description: 'x402 is a payment protocol.' },
    { id: '3', title: 'Serper.dev Docs', url: 'https://serper.dev/docs', description: 'Serper provides Google search API.' },
  ]
  const allIds = ['1', '2', '3', '4']  // '4' was not selected

  const FORMATS: ReportFormat[] = ['bullets', 'narrative', 'table', 'comparison']

  describe('omittedIds computation', () => {
    it('returns ids present in allSourceIds but absent from sources', () => {
      const { omittedIds } = buildResearchPrompt('test query', sources, 'bullets', allIds)
      expect(omittedIds).toEqual(['4'])
    })

    it('returns empty array when all ids are selected', () => {
      const { omittedIds } = buildResearchPrompt('test', sources, 'bullets', ['1', '2', '3'])
      expect(omittedIds).toHaveLength(0)
    })

    it('returns all ids when no sources are selected', () => {
      const { omittedIds } = buildResearchPrompt('test', [], 'bullets', allIds)
      expect(omittedIds).toEqual(allIds)
    })

    it('handles duplicate allSourceIds gracefully', () => {
      const { omittedIds } = buildResearchPrompt('test', [sources[0]], 'bullets', ['1', '1', '2'])
      expect(omittedIds).toContain('2')
      expect(omittedIds).not.toContain('1')
    })
  })

  describe('prompt content', () => {
    it('includes the query in the prompt', () => {
      const { prompt } = buildResearchPrompt('stellar x402', sources, 'bullets', allIds)
      expect(prompt).toContain('stellar x402')
    })

    it('includes all source titles, urls, and descriptions', () => {
      const { prompt } = buildResearchPrompt('stellar', sources, 'bullets', allIds)
      for (const s of sources) {
        expect(prompt).toContain(s.title)
        expect(prompt).toContain(s.url)
        expect(prompt).toContain(s.description)
      }
    })

    it('uses 1-based citation numbers [1], [2], [3] for selected sources', () => {
      const { prompt } = buildResearchPrompt('query', sources, 'bullets', allIds)
      expect(prompt).toContain('[1]')
      expect(prompt).toContain('[2]')
      expect(prompt).toContain('[3]')
    })

    it('includes a "Sources Used" section at the end', () => {
      const { prompt } = buildResearchPrompt('query', sources, 'bullets', allIds)
      expect(prompt).toContain('Sources Used:')
      expect(prompt).toContain('Stellar Overview — https://stellar.org')
    })

    FORMATS.forEach((fmt) => {
      it(`includes format-specific instructions for "${fmt}"`, () => {
        const { prompt } = buildResearchPrompt('query', sources, fmt, allIds)
        const instructions: Record<ReportFormat, string> = {
          bullets: 'bullet-point',
          narrative: 'prose',
          table: 'Markdown table',
          comparison: 'Compare and contrast',
        }
        expect(prompt.toLowerCase()).toContain(instructions[fmt].toLowerCase())
      })
    })

    it('handles zero selected sources without throwing', () => {
      expect(() => buildResearchPrompt('q', [], 'bullets', ['1', '2'])).not.toThrow()
    })

    it('prompt is stable with same inputs', () => {
      const a = buildResearchPrompt('query', sources, 'narrative', allIds)
      const b = buildResearchPrompt('query', sources, 'narrative', allIds)
      expect(a.prompt).toBe(b.prompt)
      expect(a.omittedIds).toEqual(b.omittedIds)
    })
  })

  describe('source ordering', () => {
    it('numbers sources in the order they are provided', () => {
      const reversed = [...sources].reverse()
      const { prompt } = buildResearchPrompt('q', reversed, 'bullets', allIds)
      // [1] should map to the first source in the reversed array (Serper.dev)
      const firstRef = prompt.indexOf('[1]')
      const serperIdx = prompt.indexOf('Serper.dev Docs')
      const stellarIdx = prompt.indexOf('Stellar Overview')
      // [1] appears before the Stellar Overview entry since Serper is first
      expect(serperIdx).toBeLessThan(stellarIdx)
      expect(firstRef).toBeGreaterThan(0)
    })
  })
})
