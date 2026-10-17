import { describe, it, expect } from 'vitest'
import { buildResearchPrompt, type ResearchSource } from './aiChatService'
import type { ReportFormat } from '../types/index'

describe('buildResearchPrompt', () => {
  const sources: ResearchSource[] = [
    { id: '1', title: 'Stellar Overview', url: 'https://stellar.org', description: 'Stellar is a payment network.' },
    { id: '2', title: 'x402 Protocol', url: 'https://x402.org', description: 'x402 is a payment protocol.' },
    { id: '3', title: 'Serper.dev Docs', url: 'https://serper.dev/docs', description: 'Serper provides Google search API.' },
  ]
  const allIds = ['1', '2', '3', '4'] // '4' was not selected

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
      const firstRef = prompt.indexOf('[1]')
      const serperIdx = prompt.indexOf('Serper.dev Docs')
      const stellarIdx = prompt.indexOf('Stellar Overview')
      expect(serperIdx).toBeLessThan(stellarIdx)
      expect(firstRef).toBeGreaterThan(0)
    })
  })
})
