import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SearchResults } from './SearchResults'
import { describe, it, expect, vi } from 'vitest'

describe('SearchResults', () => {
  const mockResults = [
    {
      id: '1',
      title: 'Stellar Docs',
      url: 'https://developers.stellar.org',
      description: 'The Stellar documentation.',
      source: 'web',
      relevanceScore: 0.95
    }
  ]

  it('renders results', () => {
    render(<SearchResults results={mockResults} query="stellar" />)
    expect(screen.getByText('Stellar Docs')).toBeTruthy()
  })

  it('exports JSON and CSV', async () => {
    global.URL.createObjectURL = vi.fn()
    global.URL.revokeObjectURL = vi.fn()
    
    render(<SearchResults results={mockResults} query="stellar" />)
    
    const exportBtn = screen.getByRole('button', { name: /Export/i })
    fireEvent.click(exportBtn)
    
    const jsonBtn = screen.getByText('JSON Format')
    fireEvent.click(jsonBtn)
    
    // Simulate re-opening and exporting CSV
    fireEvent.click(screen.getByRole('button', { name: /Export/i }))
    const csvBtn = screen.getByText('CSV Format')
    fireEvent.click(csvBtn)
  })

  it('copies to clipboard', async () => {
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    })
    
    render(<SearchResults results={mockResults} query="stellar" />)
    const copyBtn = screen.getByTitle('Copy URL')
    fireEvent.click(copyBtn)
    
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://developers.stellar.org')
    })
  })
})
