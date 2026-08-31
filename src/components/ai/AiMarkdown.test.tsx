import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AiMarkdown } from './AiMarkdown'

describe('AiMarkdown', () => {
  it('renders bold, italic, and inline code without leaking raw markup', () => {
    render(<AiMarkdown content="**bold** and *italic* and `code`" />)
    expect(screen.getByText('bold').tagName).toBe('STRONG')
    expect(screen.getByText('italic').tagName).toBe('EM')
    expect(screen.getByText('code').tagName).toBe('CODE')
  })

  it('never injects raw HTML — tags in source are shown as literal text', () => {
    render(<AiMarkdown content='<img src=x onerror="window.__pwned=true">' />)
    expect((window as any).__pwned).toBeUndefined()
    expect(document.querySelector('img')).toBeNull()
    expect(screen.getByText(/<img/)).toBeInTheDocument()
  })

  it('renders lists and headings', () => {
    render(<AiMarkdown content={'## Heading\n- one\n- two'} />)
    expect(screen.getByText('Heading')).toBeInTheDocument()
    expect(screen.getByText('one').closest('li')).toBeInTheDocument()
    expect(screen.getByText('two').closest('li')).toBeInTheDocument()
  })

  it('renders a safe http(s) link', () => {
    render(<AiMarkdown content="[Stellar](https://stellar.org)" />)
    const link = screen.getByText('Stellar')
    expect(link.tagName).toBe('A')
    expect(link.getAttribute('href')).toBe('https://stellar.org')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('turns a valid numbered citation into a clickable control', () => {
    const onCitationClick = vi.fn()
    render(<AiMarkdown content="See [1] for details." citationMax={3} onCitationClick={onCitationClick} />)
    const btn = screen.getByRole('button', { name: /jump to source 1/i })
    fireEvent.click(btn)
    expect(onCitationClick).toHaveBeenCalledWith(1)
  })

  it('leaves an out-of-range citation as plain text', () => {
    render(<AiMarkdown content="See [9] for details." citationMax={3} />)
    expect(screen.queryByRole('button', { name: /jump to source 9/i })).toBeNull()
    expect(screen.getByText(/\[9\]/)).toBeInTheDocument()
  })

  it('falls back to focusing the matching result card when no handler is given', () => {
    const card = document.createElement('div')
    card.id = 'result-card-2'
    card.tabIndex = -1
    document.body.appendChild(card)
    const scrollSpy = vi.fn()
    card.scrollIntoView = scrollSpy

    render(<AiMarkdown content="Backed by [2]." citationMax={2} />)
    fireEvent.click(screen.getByRole('button', { name: /jump to source 2/i }))

    expect(scrollSpy).toHaveBeenCalled()
    expect(document.activeElement).toBe(card)

    document.body.removeChild(card)
  })

  it('renders nothing for empty content', () => {
    const { container } = render(<AiMarkdown content="" />)
    expect(container).toBeEmptyDOMElement()
  })
})
