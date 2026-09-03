import { describe, it, expect } from 'vitest'
import { formatReceipt, explorerTxUrl, PaymentReceiptData } from './receipt'
import { STELLAR_EXPERT_URL, STELLAR_NETWORK } from '../src/lib/constants'

describe('mcp-server/receipt — x402 receipt metadata', () => {
  describe('explorerTxUrl', () => {
    it('builds a Stellar Expert tx URL using the configured network', () => {
      const hash = 'a1b2c3d4e5f678901234567890abcdef1234567890abcdef1234567890abcdef'
      const url = explorerTxUrl(hash)
      expect(url).toBe(`${STELLAR_EXPERT_URL}/tx/${hash}`)
    })

    it('contains /tx/ path and starts with https', () => {
      const url = explorerTxUrl('deadbeef')
      expect(url).toContain('/tx/deadbeef')
      expect(url.startsWith('https://')).toBe(true)
    })
  })

  describe('formatReceipt — verified receipt (txHash present)', () => {
    const verifiedData: PaymentReceiptData = {
      txHash: 'a1b2c3d4e5f678901234567890abcdef1234567890abcdef1234567890abcdef',
      paidAmount: '0.001',
      currency: 'USDC',
      network: 'stellar:testnet',
      x402Version: 2,
    }

    it('returns verified: true when txHash is present', () => {
      const result = formatReceipt(verifiedData)
      expect(result.verified).toBe(true)
    })

    it('includes the full transaction hash in output', () => {
      const result = formatReceipt(verifiedData)
      const txLine = result.lines.find(l => l.startsWith('   Tx:'))
      expect(txLine).toBe(`   Tx: ${verifiedData.txHash}`)
    })

    it('includes the Stellar Expert explorer URL', () => {
      const result = formatReceipt(verifiedData)
      const explorerLine = result.lines.find(l => l.startsWith('   Explorer:'))
      expect(explorerLine).toContain('stellar.expert')
      expect(explorerLine).toContain(verifiedData.txHash!)
    })

    it('includes the x402 protocol version', () => {
      const result = formatReceipt(verifiedData)
      const receiptLine = result.lines.find(l => l.startsWith('📄 Receipt:'))
      expect(receiptLine).toContain('x402 v2')
    })

    it('includes the network', () => {
      const result = formatReceipt(verifiedData)
      const networkLine = result.lines.find(l => l.startsWith('   Network:'))
      expect(networkLine).toBe('   Network: stellar:testnet')
    })

    it('defaults x402 version to 2 when not provided', () => {
      const data: PaymentReceiptData = {
        txHash: 'abc123',
        network: 'stellar:testnet',
      }
      const result = formatReceipt(data)
      const receiptLine = result.lines.find(l => l.startsWith('📄 Receipt:'))
      expect(receiptLine).toContain('x402 v2')
    })

    it('uses STELLAR_NETWORK when network field is omitted', () => {
      const data: PaymentReceiptData = { txHash: 'abc123' }
      const result = formatReceipt(data)
      const networkLine = result.lines.find(l => l.startsWith('   Network:'))
      expect(networkLine).toBe(`   Network: ${STELLAR_NETWORK}`)
    })
  })

  describe('formatReceipt — unverified receipt (missing txHash)', () => {
    it('returns verified: false when txHash is null', () => {
      const result = formatReceipt({ txHash: null })
      expect(result.verified).toBe(false)
    })

    it('returns verified: false when txHash is undefined', () => {
      const result = formatReceipt({})
      expect(result.verified).toBe(false)
    })

    it('returns verified: false when txHash is empty string', () => {
      const result = formatReceipt({ txHash: '   ' })
      expect(result.verified).toBe(false)
    })

    it('includes an explicit unverified warning', () => {
      const result = formatReceipt({ txHash: null })
      const receiptLine = result.lines.find(l => l.startsWith('📄 Receipt:'))
      expect(receiptLine).toContain('⚠️')
      expect(receiptLine).toContain('Unverified')
      expect(receiptLine).toContain('no on-chain settlement proof returned')
    })

    it('shows amount and currency when available for unverified receipts', () => {
      const data: PaymentReceiptData = {
        txHash: null,
        paidAmount: '0.001',
        currency: 'USDC',
        network: 'stellar:testnet',
      }
      const result = formatReceipt(data)
      const amountLine = result.lines.find(l => l.startsWith('   Amount:'))
      expect(amountLine).toBe('   Amount: 0.001 USDC')
    })

    it('omits amount line when paidAmount or currency is missing', () => {
      const data: PaymentReceiptData = { txHash: null }
      const result = formatReceipt(data)
      const amountLine = result.lines.find(l => l.startsWith('   Amount:'))
      expect(amountLine).toBeUndefined()
    })

    it('always includes at least one line', () => {
      const result = formatReceipt({})
      expect(result.lines.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('formatReceipt — edge cases', () => {
    it('trims whitespace from txHash before deciding verification', () => {
      const result = formatReceipt({ txHash: '  abc123  ' })
      expect(result.verified).toBe(true)
      const txLine = result.lines.find(l => l.startsWith('   Tx:'))
      expect(txLine).toBe('   Tx: abc123')
    })

    it('handles all fields provided with different x402 version', () => {
      const data: PaymentReceiptData = {
        txHash: 'ff00ff00',
        paidAmount: '0.01',
        currency: 'USDC',
        network: 'stellar:mainnet',
        x402Version: 1,
      }
      const result = formatReceipt(data)
      expect(result.verified).toBe(true)
      const receiptLine = result.lines.find(l => l.startsWith('📄 Receipt:'))
      expect(receiptLine).toContain('x402 v1')
      const networkLine = result.lines.find(l => l.startsWith('   Network:'))
      expect(networkLine).toBe('   Network: stellar:mainnet')
    })
  })
})
