import { describe, it, expect, vi } from 'vitest'

vi.mock('groq-sdk', () => ({
  default: class { chat = { completions: { create: vi.fn() } } },
}))
vi.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: class { setRequestHandler() {} connect() {} },
}))
vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: class {},
}))
vi.mock('@modelcontextprotocol/sdk/types.js', () => ({
  CallToolRequestSchema: {},
  ListToolsRequestSchema: {},
  ListResourcesRequestSchema: {},
  ReadResourceRequestSchema: {},
  ListPromptsRequestSchema: {},
  GetPromptRequestSchema: {},
}))
vi.mock('dotenv', () => ({ default: { config: vi.fn() } }))

import { clampCount } from './index'

describe('clampCount — web_search count clamping (#168)', () => {
  const opts = { min: 1, max: 10, defaultValue: 5 } as const

  it('returns default when value is undefined', () => {
    expect(clampCount(undefined, opts)).toBe(5)
  })

  it('returns default when value is null', () => {
    expect(clampCount(null, opts)).toBe(5)
  })

  it('returns default when value is NaN', () => {
    expect(clampCount(NaN, opts)).toBe(5)
  })

  it('returns default when value is Infinity', () => {
    expect(clampCount(Infinity, opts)).toBe(5)
  })

  it('returns default when value is -Infinity', () => {
    expect(clampCount(-Infinity, opts)).toBe(5)
  })

  it('returns default when value is a non-numeric string', () => {
    expect(clampCount('abc', opts)).toBe(5)
  })

  it('returns default for negative numbers', () => {
    expect(clampCount(-1, opts)).toBe(5)
    expect(clampCount(-100, opts)).toBe(5)
  })

  it('returns default for zero', () => {
    expect(clampCount(0, opts)).toBe(5)
  })

  it('floors fractional values within range', () => {
    expect(clampCount(1.5, opts)).toBe(1)
    expect(clampCount(3.7, opts)).toBe(3)
  })

  it('clamps fractional values above max', () => {
    expect(clampCount(10.9, opts)).toBe(10)
  })

  it('clamps huge values to max', () => {
    expect(clampCount(1000, opts)).toBe(10)
    expect(clampCount(999999, opts)).toBe(10)
  })

  it('accepts valid integers within range', () => {
    expect(clampCount(1, opts)).toBe(1)
    expect(clampCount(5, opts)).toBe(5)
    expect(clampCount(10, opts)).toBe(10)
  })

  it('accepts numeric strings that parse to valid values', () => {
    expect(clampCount('3', opts)).toBe(3)
    expect(clampCount('10', opts)).toBe(10)
  })

  it('clamps numeric strings above max', () => {
    expect(clampCount('20', opts)).toBe(10)
  })

  it('returns default for empty string', () => {
    expect(clampCount('', opts)).toBe(5)
  })

  it('handles boolean true (coerces to 1)', () => {
    expect(clampCount(true, opts)).toBe(1)
  })

  it('returns default for boolean false (coerces to 0)', () => {
    expect(clampCount(false, opts)).toBe(5)
  })

  it('works with news_search range (1-20, default 10)', () => {
    const newsOpts = { min: 1, max: 20, defaultValue: 10 }
    expect(clampCount(15, newsOpts)).toBe(15)
    expect(clampCount(25, newsOpts)).toBe(20)
    expect(clampCount(undefined, newsOpts)).toBe(10)
  })
})
