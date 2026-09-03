import { describe, it, expect, vi, beforeEach } from 'vitest'
import { validateStartupConfig, maskSecret, maskAddress } from './startupConfig'

describe('maskSecret — safe secret redaction', () => {
  it('masks full API keys preserving first 4 and last 4', () => {
    expect(maskSecret('gsk_abc123def456ghi789')).toBe('gsk_****i789')
  })

  it('masks short values as ****', () => {
    expect(maskSecret('short')).toBe('****')
  })

  it('masks empty string as ****', () => {
    expect(maskSecret('')).toBe('****')
  })

  it('masks exactly 8-char string as ****', () => {
    expect(maskSecret('12345678')).toBe('****')
  })

  it('masks 9-char string preserving first 4 and last 4', () => {
    expect(maskSecret('123456789')).toBe('1234****6789')
  })
})

describe('maskAddress — safe Stellar address redaction', () => {
  it('masks full Stellar address preserving first 6 and last 4', () => {
    const addr = 'GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3'
    expect(maskAddress(addr)).toBe('GAAZI4****ZOM3')
  })

  it('masks short values as ****', () => {
    expect(maskAddress('short')).toBe('****')
  })

  it('masks empty string as ****', () => {
    expect(maskAddress('')).toBe('****')
  })

  it('masks 10-char string as ****', () => {
    expect(maskAddress('1234567890')).toBe('****')
  })

  it('masks 11-char string preserving first 6 and last 4', () => {
    expect(maskAddress('12345678901')).toBe('123456****8901')
  })
})

describe('validateStartupConfig — configuration validation', () => {
  it('returns full config with defaults when env is empty', () => {
    const result = validateStartupConfig({})
    expect(result.searchApiUrl).toBe('http://localhost:3001')
    expect(result.facilitatorUrl).toBe('https://www.x402.org/facilitator')
    expect(result.mcpReceiptsOptIn).toBe(false)
  })

  it('uses provided SEARCH_API_URL', () => {
    const result = validateStartupConfig({ SEARCH_API_URL: 'https://api.example.com' })
    expect(result.searchApiUrl).toBe('https://api.example.com')
  })

  it('marks webSearch unavailable when GROQ_API_KEY is missing', () => {
    const result = validateStartupConfig({})
    // webSearch depends on searchApiUrl (default valid), stellarReceivingAddress (missing), and facilitatorUrl (default valid)
    expect(result.capabilities.webSearch.available).toBe(false)
    expect(result.capabilities.webSearch.reason).toContain('STELLAR_RECEIVING_ADDRESS')
  })

  it('marks aiSummarize unavailable when GROQ_API_KEY is missing', () => {
    const result = validateStartupConfig({})
    expect(result.capabilities.aiSummarize.available).toBe(false)
    expect(result.capabilities.aiSummarize.reason).toContain('GROQ_API_KEY')
  })

  it('marks aiSummarize available with valid GROQ_API_KEY', () => {
    const result = validateStartupConfig({ GROQ_API_KEY: 'gsk_real_key_12345' })
    expect(result.capabilities.aiSummarize.available).toBe(true)
  })

  it('marks aiSummarize unavailable with placeholder key', () => {
    const result = validateStartupConfig({ GROQ_API_KEY: 'your_groq_api_key_here' })
    expect(result.capabilities.aiSummarize.available).toBe(false)
    expect(result.capabilities.aiSummarize.reason).toContain('placeholder')
  })

  it('marks webSearch available with all required config', () => {
    const result = validateStartupConfig({
      SEARCH_API_URL: 'https://api.example.com',
      STELLAR_RECEIVING_ADDRESS: 'GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3',
      FACILITATOR_URL: 'https://x402.org/facilitator',
    })
    expect(result.capabilities.webSearch.available).toBe(true)
    expect(result.capabilities.webSearch.reason).toBeUndefined()
  })

  it('marks webSearch unavailable with invalid SEARCH_API_URL', () => {
    const result = validateStartupConfig({
      SEARCH_API_URL: 'not-a-url',
      STELLAR_RECEIVING_ADDRESS: 'GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3',
    })
    expect(result.capabilities.webSearch.available).toBe(false)
    expect(result.capabilities.webSearch.reason).toContain('SEARCH_API_URL')
  })

  it('marks webSearch unavailable with invalid STELLAR_RECEIVING_ADDRESS', () => {
    const result = validateStartupConfig({
      STELLAR_RECEIVING_ADDRESS: 'INVALID_ADDRESS',
    })
    expect(result.capabilities.webSearch.available).toBe(false)
    expect(result.capabilities.webSearch.reason).toContain('STELLAR_RECEIVING_ADDRESS')
  })

  it('marks webSearch unavailable with invalid FACILITATOR_URL', () => {
    const result = validateStartupConfig({
      SEARCH_API_URL: 'https://api.example.com',
      STELLAR_RECEIVING_ADDRESS: 'GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3',
      FACILITATOR_URL: 'ftp://invalid',
    })
    expect(result.capabilities.webSearch.available).toBe(false)
    expect(result.capabilities.webSearch.reason).toContain('FACILITATOR_URL')
  })

  it('imageSearch and newsSearch share same dependencies as webSearch', () => {
    const result = validateStartupConfig({})
    expect(result.capabilities.imageSearch.available).toBe(result.capabilities.webSearch.available)
    expect(result.capabilities.newsSearch.available).toBe(result.capabilities.webSearch.available)
  })

  it('checkBalance is always available (uses Horizon from constants)', () => {
    const result = validateStartupConfig({})
    expect(result.capabilities.checkBalance.available).toBe(true)
  })

  it('getSearchStats follows SEARCH_API_URL availability', () => {
    const resultOk = validateStartupConfig({ SEARCH_API_URL: 'https://api.example.com' })
    expect(resultOk.capabilities.getSearchStats.available).toBe(true)

    const resultBad = validateStartupConfig({ SEARCH_API_URL: 'invalid' })
    expect(resultBad.capabilities.getSearchStats.available).toBe(false)
  })

  it('receipts capability follows opt-in flag', () => {
    const resultOff = validateStartupConfig({})
    expect(resultOff.capabilities.receipts.available).toBe(false)

    const resultOn1 = validateStartupConfig({ MCP_ENABLE_RECEIPTS: '1' })
    expect(resultOn1.capabilities.receipts.available).toBe(true)

    const resultOn2 = validateStartupConfig({ MCP_RECEIPTS_OPT_IN: '1' })
    expect(resultOn2.capabilities.receipts.available).toBe(true)
  })

  it('does not print secrets to stderr', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const testKey = 'gsk_supersecretapikey1234567890'
    validateStartupConfig({ GROQ_API_KEY: testKey })

    // Check that stderr output never contains the full key
    const allOutput = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n')
    expect(allOutput).not.toContain(testKey)
    expect(allOutput).toContain(maskSecret(testKey))
    consoleSpy.mockRestore()
  })

  it('does not print full wallet address to stderr', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const testAddr = 'GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3'
    validateStartupConfig({ STELLAR_RECEIVING_ADDRESS: testAddr })

    const allOutput = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n')
    expect(allOutput).not.toContain(testAddr)
    expect(allOutput).toContain(maskAddress(testAddr))
    consoleSpy.mockRestore()
  })

  it('prints warnings to stderr for missing config', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    validateStartupConfig({})

    const allOutput = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n')
    expect(allOutput).toContain('Startup Warnings')
    expect(allOutput).toContain('GROQ_API_KEY')
    expect(allOutput).toContain('STELLAR_RECEIVING_ADDRESS')
    consoleSpy.mockRestore()
  })

  it('prints capability summary to stderr', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    validateStartupConfig({})

    const allOutput = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n')
    expect(allOutput).toContain('[startup] Enabled capabilities:')
    expect(allOutput).toContain('[startup] Degraded/disabled:')
    consoleSpy.mockRestore()
  })

  it('accepts http:// URLs as valid', () => {
    const result = validateStartupConfig({
      SEARCH_API_URL: 'http://localhost:3001',
      STELLAR_RECEIVING_ADDRESS: 'GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3',
    })
    expect(result.capabilities.webSearch.available).toBe(true)
  })

  it('rejects ftp:// and other protocols', () => {
    const result = validateStartupConfig({
      SEARCH_API_URL: 'ftp://files.example.com',
    })
    expect(result.capabilities.webSearch.available).toBe(false)
    expect(result.capabilities.getSearchStats.available).toBe(false)
  })
})
