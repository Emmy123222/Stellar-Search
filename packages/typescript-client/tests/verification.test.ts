import { describe, it, expect, vi } from 'vitest'
import {
  verifyReceiptAgainstHorizon,
  verifyReceiptsAgainstHorizon,
  getHorizonUrlForNetwork,
  HORIZON_TESTNET,
  HORIZON_MAINNET,
} from '../src/verification'
import type { SearchReceipt } from '../src/types'

describe('@stellar-search/client — Receipt Verification Engine', () => {
  const DESTINATION = 'GAAZI4TCR3TY5OJHCTJC2A4AFL5MNSF3GAKGOWG5W2LBBGCS2TDPZOM3'
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
    it('maps testnet and mainnet networks to correct Horizon endpoints', () => {
      expect(getHorizonUrlForNetwork('stellar:testnet')).toBe(HORIZON_TESTNET)
      expect(getHorizonUrlForNetwork('stellar:mainnet')).toBe(HORIZON_MAINNET)
      expect(getHorizonUrlForNetwork('unknown')).toBe(HORIZON_TESTNET)
    })
  })

  describe('verifyReceiptAgainstHorizon — validation', () => {
    it('returns mismatched when txHash is missing or blank', async () => {
      const res = await verifyReceiptAgainstHorizon({ ...VALID_RECEIPT, txHash: '' })
      expect(res.status).toBe('mismatched')
      expect(res.mismatches).toContain('Missing or empty transaction hash')
    })

    it('returns mismatched when network does not start with stellar:', async () => {
      const res = await verifyReceiptAgainstHorizon({ ...VALID_RECEIPT, network: 'eth:mainnet' })
      expect(res.status).toBe('mismatched')
      expect(res.mismatches?.[0]).toMatch(/Invalid network identifier/)
    })

    it('returns mismatched when network does not match expectedNetwork', async () => {
      const res = await verifyReceiptAgainstHorizon(VALID_RECEIPT, {
        expectedNetwork: 'stellar:mainnet',
      })
      expect(res.status).toBe('mismatched')
      expect(res.mismatches?.[0]).toMatch(/Network mismatch/)
    })
  })

  describe('verifyReceiptAgainstHorizon — on-chain ledger queries', () => {
    it('returns mismatched when transaction returns 404 from Horizon', async () => {
      const fetchFn = vi.fn().mockResolvedValue({
        status: 404,
        ok: false,
        statusText: 'Not Found',
      })

      const res = await verifyReceiptAgainstHorizon(VALID_RECEIPT, { fetchFn })
      expect(res.status).toBe('mismatched')
      expect(res.mismatches).toContain('Transaction not found on Stellar Horizon ledger')
    })

    it('returns unverified on Horizon 500 error or network failure', async () => {
      const fetchFn = vi.fn().mockResolvedValue({
        status: 500,
        ok: false,
        statusText: 'Internal Error',
      })

      const res = await verifyReceiptAgainstHorizon(VALID_RECEIPT, { fetchFn })
      expect(res.status).toBe('unverified')
      expect(res.error).toMatch(/Horizon API error \(500/)
    })

    it('returns mismatched when ledger transaction successful flag is false', async () => {
      const fetchFn = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => ({ successful: false, ledger: 12345 }),
      })

      const res = await verifyReceiptAgainstHorizon(VALID_RECEIPT, { fetchFn })
      expect(res.status).toBe('mismatched')
      expect(res.mismatches).toContain('Transaction failed on ledger (successful: false)')
    })

    it('returns confirmed when transaction and payment operation match', async () => {
      const fetchFn = vi.fn()
        // 1. Transaction response
        .mockResolvedValueOnce({
          status: 200,
          ok: true,
          json: async () => ({ successful: true, ledger: 54321 }),
        })
        // 2. Operations response
        .mockResolvedValueOnce({
          status: 200,
          ok: true,
          json: async () => ({
            _embedded: {
              records: [
                {
                  type: 'payment',
                  amount: '0.001',
                  asset_code: 'USDC',
                  to: DESTINATION,
                },
              ],
            },
          }),
        })

      const res = await verifyReceiptAgainstHorizon(VALID_RECEIPT, { fetchFn })
      expect(res.status).toBe('confirmed')
      expect(res.ledgerSequence).toBe(54321)
      expect(res.asset).toBe('USDC')
      expect(res.destination).toBe(DESTINATION)
    })

    it('returns confirmed for Soroban contract invocation touching destination', async () => {
      const fetchFn = vi.fn()
        .mockResolvedValueOnce({
          status: 200,
          ok: true,
          json: async () => ({ successful: true, ledger: 65432 }),
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

      const res = await verifyReceiptAgainstHorizon(VALID_RECEIPT, { fetchFn })
      expect(res.status).toBe('confirmed')
      expect(res.ledgerSequence).toBe(65432)
    })

    it('returns mismatched when operation amount does not match receipt amount', async () => {
      const fetchFn = vi.fn()
        .mockResolvedValueOnce({
          status: 200,
          ok: true,
          json: async () => ({ successful: true, ledger: 54321 }),
        })
        .mockResolvedValueOnce({
          status: 200,
          ok: true,
          json: async () => ({
            _embedded: {
              records: [
                {
                  type: 'payment',
                  amount: '0.005', // Mismatched amount
                  asset_code: 'USDC',
                  to: DESTINATION,
                },
              ],
            },
          }),
        })

      const res = await verifyReceiptAgainstHorizon(VALID_RECEIPT, { fetchFn })
      expect(res.status).toBe('mismatched')
      expect(res.mismatches?.[0]).toMatch(/Amount mismatch/)
    })
  })

  describe('verifyReceiptsAgainstHorizon — batch verification', () => {
    it('verifies multiple receipts concurrently and returns a Map', async () => {
      const fetchFn = vi.fn()
        .mockResolvedValue({
          status: 200,
          ok: true,
          json: async () => ({
            successful: true,
            ledger: 100,
            _embedded: {
              records: [{ type: 'payment', amount: '0.001', asset_code: 'USDC', to: DESTINATION }],
            },
          }),
        })

      const receipts: SearchReceipt[] = [
        VALID_RECEIPT,
        { ...VALID_RECEIPT, txHash: 'b2c3d4e5f678901234567890abcdef1234567890abcdef1234567890abcdef12' },
      ]

      const results = await verifyReceiptsAgainstHorizon(receipts, { fetchFn })
      expect(results.size).toBe(2)
      expect(results.get(VALID_RECEIPT.txHash)?.status).toBe('confirmed')
      expect(results.get(receipts[1].txHash)?.status).toBe('confirmed')
    })
  })
})
