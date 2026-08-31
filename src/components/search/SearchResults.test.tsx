import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SearchResults } from './SearchResults'
import type { SearchResult } from '../../hooks/useSearch'

describe('SearchResults — HTTP(S)-only link security & Safe Diagnostics', () => {
  const sampleResults: SearchResult[] = [
    {
      id: '1',
      title: 'Safe Stellar Docs',
      url: 'https://developers.stellar.org/docs',
      description: 'Official documentation for Stellar developers',
      source: 'developers.stellar.org',
      relevanceScore: 0.95,
    },
    {
      id: '2',
      title: 'Malicious XSS Link',
      url: 'javascript:alert(document.cookie)',
      description: 'Attempted XSS injection link',
      source: 'blocked',
      relevanceScore: 0.8,
      isBlocked: true,
      blockReason: 'non_http_protocol',
    },
    {
      id: '3',
      title: 'Credential Bearing Link',
      url: 'http://admin:secret123@malicious-site.com/login',
      description: 'Credential bearing phishing link',
      source: 'blocked',
      relevanceScore: 0.7,
      isBlocked: true,
      blockReason: 'credential_bearing',
    },
  ]

  it('renders interactive anchor tags ONLY for valid http(s) URLs', () => {
    render(<SearchResults results={sampleResults} query="stellar" />)

    // The safe link should be rendered as an <a> tag with href
    const safeLink = screen.getByRole('article', { name: 'Safe Stellar Docs' })
    expect(safeLink.tagName).toBe('A')
    expect(safeLink).toHaveAttribute('href', 'https://developers.stellar.org/docs')

    // Blocked rows must NOT be rendered as <a> tags and must NOT have an href attribute
    const maliciousRow = screen.getByRole('article', { name: 'Malicious XSS Link' })
    expect(maliciousRow.tagName).toBe('DIV')
    expect(maliciousRow).not.toHaveAttribute('href')

    const credentialRow = screen.getByRole('article', { name: 'Credential Bearing Link' })
    expect(credentialRow.tagName).toBe('DIV')
    expect(credentialRow).not.toHaveAttribute('href')
  })

  it('displays safe diagnostics metadata in the results header', () => {
    render(<SearchResults results={sampleResults} query="stellar" />)
    expect(screen.getByText(/SAFE DIAGNOSTICS: 1 SAFE, 2 BLOCKED/i)).toBeInTheDocument()
  })
})
