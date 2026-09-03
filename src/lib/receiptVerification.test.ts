import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  getHorizonUrlForNetwork,
  verifyReceiptAgainstHorizon,
  verifyReceiptsAgainstHorizon,
} from './receiptVerification'
import { HORIZON_TESTNET, HORIZON_MAINNET } from './constants'
import type { SearchReceipt } from '../types'

describe('receiptVerification — Horizon verification engine (Issue #136)', () => {
  const DESTINATION = 'GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3'
  const OTHER_ADDRESS = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'

  const VALID_RECEIPT: SearchReceipt = {
    txHash: 'a1b2c3d4e5f678901234567890abcdef1234567890abcdef1234567890abcdef',
    query: 'stellar smart contracts',
    amount: '0.001',
    asset: 'USDC',
    destination: DESTINATION,
    network: 'stellar:testnet',
    timestamp: '2026-09-01T12:00:00.000Z',
  }

  describe('getHorizonUrlForNetwork', () => {
    it('returns HORIZON_TESTNET for stellar:testnet', () => {
      expect(getHorizonUrlForNetwork('stellar:testnet')).toBe(HORIZON_TESTNET)
    })

    it('returns HORIZON_MAINNET for stellar:mainnet', () => {
      expect(getHorizonUrlForNetwork('stellar:mainnet')).toBe(HORIZON_MAINNET)
    })
  })

  describe('verifyReceiptAgainstHorizon — input validation', () => {
    it('returns mismatched when txHash is missing or empty', async () => {
      const result = await verifyReceiptAgainstHorizon({
        ...VALID_RECEIPT,
        txHash: '',
      })
      expect(result.status).toBe('mismatched')
      expect(result.mismatches).toContain('Missing or empty transaction hash')
    })

    it('returns mismatched when network format is invalid', async () => {
      const result = await verifyReceiptAgainstHorizon({
        ...VALID_RECEIPT,
        network: 'ethereum:mainnet',
      })
      expect(result.status).toBe('mismatched')
      expect(result.mismatches?.[0]).toMatch(/Invalid network identifier/)
    })

    it('returns mismatched when expectedNetwork does not match receipt network', async () => {
      const result = await verifyReceiptAgainstHorizon(VALID_RECEIPT, {
        expectedNetwork: 'stellar:mainnet',
      })
      expect(result.status).toBe('mismatched')
      expect(result.mismatches?.[0]).toMatch(/Network mismatch/)
    })
  })

  describe('verifyReceiptAgainstHorizon — ledger lookups', () => {
    it('returns mismatched when transaction is not found (404)', async () => {
      const fetchFn = vi.fn().mockResolvedValue({
        status: 404,
        ok: false,
        statusText: 'Not Found',
      })

      const result = await verifyReceiptAgainstHorizon(VALID_RECEIPT, { fetchFn })
      expect(result.status).toBe('mismatched')
      expect(result.mismatches).toContain('Transaction not found on Stellar Horizon ledger')
      expect(fetchFn).toHaveBeenCalledWith(
        expect.stringContaining(`/transactions/${VALID_RECEIPT.txHash}`)
      )
    })

    it('returns unverified when Horizon returns a 500 error', async () => {
      const fetchFn = vi.fn().mockResolvedValue({
        status: 500,
        ok: false,
        statusText: 'Internal Server Error',
      })

      const result = await verifyReceiptAgainstHorizon(VALID_RECEIPT, { fetchFn })
      expect(result.status).toBe('unverified')
      expect(result.error).toMatch(/Horizon API error \(500/)
    })

    it('returns unverified on network fetch rejection', async () => {
      const fetchFn = vi.fn().mockRejectedValue(new Error('Connection timed out'))

      const result = await verifyReceiptAgainstHorizon(VALID_RECEIPT, { fetchFn })
      expect(result.status).toBe('unverified')
      expect(result.error).toMatch(/Connection timed out/)
    })

    it('returns mismatched when transaction on ledger has successful=false', async () => {
      const fetchFn = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => ({
          successful: false,
          ledger: 123456,
        }),
      })

      const result = await verifyReceiptAgainstHorizon(VALID_RECEIPT, { fetchFn })
      expect(result.status).toBe('mismatched')
      expect(result.mismatches).toContain('Transaction failed on ledger (successful: false)')
      expect(result.ledgerSequence).toBe(123456)
    })

    it('returns mismatched when transaction contains no operations', async () => {
      const fetchFn = vi.fn()
        .mockResolvedValueOnce({
          status: 200,
          ok: true,
          json: async () => ({ successful: true, ledger: 999 }),
        })
        .mockResolvedValueOnce({
          status: 200,
          ok: true,
          json: async () => ({ _embedded: { records: [] } }),
        })

      const result = await verifyReceiptAgainstHorizon(VALID_RECEIPT, { fetchFn })
      expect(result.status).toBe('mismatched')
      expect(result.mismatches).toContain('Transaction contains no operations')
    })
  })

  describe('verifyReceiptAgainstHorizon — operation validation (amount, asset, destination)', () => {
    it('confirms a valid payment operation with exact matches on amount, asset, destination', async () => {
      const fetchFn = vi.fn()
        .mockResolvedValueOnce({
          status: 200,
          ok: true,
          json: async () => ({ successful: true, ledger: 543210 }),
        })
        .mockResolvedValueOnce({
          status: 200,
          ok: true,
          json: async () => ({
            _embedded: {
              records: [
                {
                  type: 'payment',
                  to: DESTINATION,
                  amount: '0.0010000',
                  asset_code: 'USDC',
                },
              ],
            },
          }),
        })

      const result = await verifyReceiptAgainstHorizon(VALID_RECEIPT, { fetchFn })
      expect(result.status).toBe('confirmed')
      expect(result.ledgerSequence).toBe(543210)
      expect(result.txHash).toBe(VALID_RECEIPT.txHash)
      expect(result.amount).toBe('0.001')
      expect(result.asset).toBe('USDC')
      expect(result.destination).toBe(DESTINATION)
    })

    it('detects amount mismatch on ledger payment operation', async () => {
      const fetchFn = vi.fn()
        .mockResolvedValueOnce({
          status: 200,
          ok: true,
          json: async () => ({ successful: true, ledger: 543210 }),
        })
        .mockResolvedValueOnce({
          status: 200,
          ok: true,
          json: async () => ({
            _embedded: {
              records: [
                {
                  type: 'payment',
                  to: DESTINATION,
                  amount: '0.0005000', // Mismatch!
                  asset_code: 'USDC',
                },
              ],
            },
          }),
        })

      const result = await verifyReceiptAgainstHorizon(VALID_RECEIPT, { fetchFn })
      expect(result.status).toBe('mismatched')
      expect(result.mismatches?.some(m => m.includes('Amount mismatch'))).toBe(true)
    })

    it('detects asset mismatch on ledger payment operation', async () => {
      const fetchFn = vi.fn()
        .mockResolvedValueOnce({
          status: 200,
          ok: true,
          json: async () => ({ successful: true, ledger: 543210 }),
        })
        .mockResolvedValueOnce({
          status: 200,
          ok: true,
          json: async () => ({
            _embedded: {
              records: [
                {
                  type: 'payment',
                  to: DESTINATION,
                  amount: '0.0010000',
                  asset_type: 'native', // XLM instead of USDC
                },
              ],
            },
          }),
        })

      const result = await verifyReceiptAgainstHorizon(VALID_RECEIPT, { fetchFn })
      expect(result.status).toBe('mismatched')
      expect(result.mismatches?.some(m => m.includes('Asset mismatch'))).toBe(true)
    })

    it('detects destination mismatch on ledger payment operation', async () => {
      const fetchFn = vi.fn()
        .mockResolvedValueOnce({
          status: 200,
          ok: true,
          json: async () => ({ successful: true, ledger: 543210 }),
        })
        .mockResolvedValueOnce({
          status: 200,
          ok: true,
          json: async () => ({
            _embedded: {
              records: [
                {
                  type: 'payment',
                  to: OTHER_ADDRESS, // Wrong receiving address
                  amount: '0.0010000',
                  asset_code: 'USDC',
                },
              ],
            },
          }),
        })

      const result = await verifyReceiptAgainstHorizon(VALID_RECEIPT, { fetchFn })
      expect(result.status).toBe('mismatched')
      expect(result.mismatches?.some(m => m.includes('Destination mismatch'))).toBe(true)
    })

    it('confirms Soroban contract invocation (x402 contract execution)', async () => {
      const fetchFn = vi.fn()
        .mockResolvedValueOnce({
          status: 200,
          ok: true,
          json: async () => ({ successful: true, ledger: 778899 }),
        })
        .mockResolvedValueOnce({
          status: 200,
          ok: true,
          json: async () => ({
            _embedded: {
              records: [
                {
                  type: 'invoke_host_function',
                  to: DESTINATION,
                },
              ],
            },
          }),
        })

      const result = await verifyReceiptAgainstHorizon(VALID_RECEIPT, { fetchFn })
      expect(result.status).toBe('confirmed')
      expect(result.ledgerSequence).toBe(778899)
    })
  })

  describe('verifyReceiptsAgainstHorizon — batch verification', () => {
    it('verifies multiple receipts in parallel and returns a map', async () => {
      const receipt1: SearchReceipt = {
        ...VALID_RECEIPT,
        txHash: 'hash_111',
      }
      const receipt2: SearchReceipt = {
        ...VALID_RECEIPT,
        txHash: 'hash_222',
      }

      const fetchFn = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('hash_111/operations')) {
          return {
            status: 200,
            ok: true,
            json: async () => ({
              _embedded: {
                records: [{ type: 'payment', to: DESTINATION, amount: '0.001', asset_code: 'USDC' }],
              },
            }),
          }
        }
        if (url.includes('hash_111')) {
          return { status: 200, ok: true, json: async () => ({ successful: true, ledger: 111 }) }
        }
        if (url.includes('hash_222')) {
          return { status: 404, ok: false, statusText: 'Not Found' }
        }
        return { status: 500, ok: false }
      })

      const results = await verifyReceiptsAgainstHorizon([receipt1, receipt2], { fetchFn })
      expect(results.size).toBe(2)
      expect(results.get('hash_111')?.status).toBe('confirmed')
      expect(results.get('hash_222')?.status).toBe('mismatched')
    })
  })
})
