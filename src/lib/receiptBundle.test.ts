import { describe, it, expect, vi } from 'vitest'
import {
  BUNDLE_VERSION,
  createReceiptBundle,
  verifyBundleOffline,
  canonicalPayload,
  type SearchReceiptBundle,
} from './receiptBundle'
import { sha256 } from './hashing'
import type { SearchReceipt } from '../types'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const RECEIPT_A: SearchReceipt = {
  txHash: 'tx_alpha_001',
  query: 'Stellar blockchain',
  amount: '0.001',
  timestamp: '2026-08-30T10:00:00.000Z',
  network: 'stellar:testnet',
}

const RECEIPT_B: SearchReceipt = {
  txHash: 'tx_beta_002',
  query: 'Soroban smart contracts',
  amount: '0.002',
  timestamp: '2026-08-31T12:00:00.000Z',
  network: 'stellar:testnet',
}

const RECEIPT_C: SearchReceipt = {
  txHash: 'tx_gamma_003',
  query: 'x402 payments',
  amount: '0.001',
  timestamp: '2026-08-31T14:30:00.000Z',
  network: 'stellar:mainnet',
}

// ---------------------------------------------------------------------------
// canonicalPayload
// ---------------------------------------------------------------------------

describe('canonicalPayload', () => {
  it('produces deterministic output regardless of receipt order', () => {
    const meta = '{"app":"test"}'
    const forward = canonicalPayload(meta, [RECEIPT_A, RECEIPT_B])
    const reversed = canonicalPayload(meta, [RECEIPT_B, RECEIPT_A])
    expect(forward).toBe(reversed)
  })

  it('differs when metadata changes', () => {
    const receipts = [RECEIPT_A]
    const p1 = canonicalPayload('{"a":1}', receipts)
    const p2 = canonicalPayload('{"a":2}', receipts)
    expect(p1).not.toBe(p2)
  })

  it('differs when a receipt field is mutated', () => {
    const meta = '{"app":"test"}'
    const p1 = canonicalPayload(meta, [RECEIPT_A])
    const modified = { ...RECEIPT_A, query: 'tampered query' }
    const p2 = canonicalPayload(meta, [modified])
    expect(p1).not.toBe(p2)
  })
})

// ---------------------------------------------------------------------------
// createReceiptBundle
// ---------------------------------------------------------------------------

describe('createReceiptBundle', () => {
  it('throws when receipts array is empty', async () => {
    await expect(createReceiptBundle([], 'stellar:testnet')).rejects.toThrow(
      'Cannot create a bundle from zero receipts',
    )
  })

  it('creates a bundle with correct version and application name', async () => {
    const bundle = await createReceiptBundle([RECEIPT_A], 'stellar:testnet')
    expect(bundle.version).toBe(BUNDLE_VERSION)
    expect(bundle.applicationName).toBe('StellarSearch')
  })

  it('stores all receipts in the bundle', async () => {
    const bundle = await createReceiptBundle(
      [RECEIPT_A, RECEIPT_B, RECEIPT_C],
      'stellar:testnet',
    )
    expect(bundle.receipts).toHaveLength(3)
    expect(bundle.receipts).toContainEqual(RECEIPT_A)
    expect(bundle.receipts).toContainEqual(RECEIPT_B)
    expect(bundle.receipts).toContainEqual(RECEIPT_C)
  })

  it('computes a valid SHA-256 proof', async () => {
    const bundle = await createReceiptBundle([RECEIPT_A], 'stellar:testnet')
    const expectedProof = await sha256(
      canonicalPayload(bundle.metadata, bundle.receipts),
    )
    expect(bundle.proof).toBe(expectedProof)
    expect(bundle.proof).toMatch(/^[a-f0-9]{64}$/)
  })

  it('proof changes when extra metadata is provided', async () => {
    const b1 = await createReceiptBundle([RECEIPT_A], 'stellar:testnet')
    const b2 = await createReceiptBundle([RECEIPT_A], 'stellar:testnet', {
      customField: 'value',
    })
    expect(b1.proof).not.toBe(b2.proof)
  })

  it('metadata includes receipt count and network', async () => {
    const bundle = await createReceiptBundle(
      [RECEIPT_A, RECEIPT_B],
      'stellar:mainnet',
    )
    const meta = JSON.parse(bundle.metadata)
    expect(meta.receiptCount).toBe(2)
    expect(meta.network).toBe('stellar:mainnet')
    expect(meta.application).toBe('StellarSearch')
  })

  it('sets generatedAt to a recent ISO timestamp', async () => {
    const before = new Date().toISOString()
    const bundle = await createReceiptBundle([RECEIPT_A], 'stellar:testnet')
    const after = new Date().toISOString()
    expect(bundle.generatedAt >= before).toBe(true)
    expect(bundle.generatedAt <= after).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// verifyBundleOffline
// ---------------------------------------------------------------------------

describe('verifyBundleOffline', () => {
  it('returns integrityValid=true for a freshly created bundle', async () => {
    const bundle = await createReceiptBundle([RECEIPT_A, RECEIPT_B], 'stellar:testnet')
    const result = await verifyBundleOffline(bundle)
    expect(result.integrityValid).toBe(true)
  })

  it('reports ledgerValid=false (requires Horizon lookup)', async () => {
    const bundle = await createReceiptBundle([RECEIPT_A], 'stellar:testnet')
    const result = await verifyBundleOffline(bundle)
    expect(result.ledgerValid).toBe(false)
    expect(result.findings.some((f) => f.includes('Ledger verification'))).toBe(
      true,
    )
  })

  it('detects tampered receipt field', async () => {
    const bundle = await createReceiptBundle([RECEIPT_A], 'stellar:testnet')
    // Mutate a receipt
    bundle.receipts[0] = { ...bundle.receipts[0], query: 'TAMPERED' }
    const result = await verifyBundleOffline(bundle)
    expect(result.integrityValid).toBe(false)
    expect(
      result.findings.some((f) => f.includes('Integrity proof mismatch')),
    ).toBe(true)
  })

  it('detects tampered proof string', async () => {
    const bundle = await createReceiptBundle([RECEIPT_A], 'stellar:testnet')
    bundle.proof = '0'.repeat(64) // All zeros
    const result = await verifyBundleOffline(bundle)
    expect(result.integrityValid).toBe(false)
  })

  it('detects tampered metadata', async () => {
    const bundle = await createReceiptBundle([RECEIPT_A], 'stellar:testnet')
    // Change metadata but keep original proof
    bundle.metadata = JSON.stringify({ application: 'HackedApp' })
    const result = await verifyBundleOffline(bundle)
    expect(result.integrityValid).toBe(false)
  })

  it('detects invalid metadata JSON', async () => {
    const bundle = await createReceiptBundle([RECEIPT_A], 'stellar:testnet')
    bundle.metadata = 'not-valid-json{{'
    const result = await verifyBundleOffline(bundle)
    expect(result.integrityValid).toBe(false)
    expect(result.findings.some((f) => f.includes('not valid JSON'))).toBe(true)
  })

  it('detects unsupported bundle version', async () => {
    const bundle = await createReceiptBundle([RECEIPT_A], 'stellar:testnet')
    bundle.version = 999
    const result = await verifyBundleOffline(bundle)
    expect(result.integrityValid).toBe(false)
    expect(result.findings.some((f) => f.includes('Unsupported bundle version'))).toBe(
      true,
    )
  })

  it('detects empty receipts array', async () => {
    const bundle = await createReceiptBundle([RECEIPT_A], 'stellar:testnet')
    bundle.receipts = []
    bundle.proof = await sha256(bundle.metadata + '[]')
    const result = await verifyBundleOffline(bundle)
    expect(result.integrityValid).toBe(false)
    expect(result.findings.some((f) => f.includes('no receipts'))).toBe(true)
  })

  it('succeeds after round-tripping through JSON serialization', async () => {
    const bundle = await createReceiptBundle(
      [RECEIPT_A, RECEIPT_B, RECEIPT_C],
      'stellar:testnet',
    )
    const serialized = JSON.stringify(bundle)
    const deserialized: SearchReceiptBundle = JSON.parse(serialized)
    const result = await verifyBundleOffline(deserialized)
    expect(result.integrityValid).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// BUNDLE_VERSION
// ---------------------------------------------------------------------------

describe('BUNDLE_VERSION', () => {
  it('is a positive integer', () => {
    expect(Number.isInteger(BUNDLE_VERSION)).toBe(true)
    expect(BUNDLE_VERSION).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// downloadBundle (browser API mock)
// ---------------------------------------------------------------------------

describe('downloadBundle', () => {
  it('creates a download link and triggers click', async () => {
    const { downloadBundle } = await import('./receiptBundle')
    const bundle = await createReceiptBundle([RECEIPT_A], 'stellar:testnet')

    // Mock DOM APIs
    const clickMock = vi.fn()
    const createElementSpy = vi.spyOn(document, 'createElement').mockReturnValue({
      href: '',
      download: '',
      click: clickMock,
    } as unknown as HTMLAnchorElement)
    const appendChildSpy = vi
      .spyOn(document.body, 'appendChild')
      .mockImplementation((node: Node) => node)
    const removeChildSpy = vi
      .spyOn(document.body, 'removeChild')
      .mockImplementation((node: Node) => node)
    const revokeObjectURLSpy = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => {})
    const createObjectURLSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:mock-url')

    downloadBundle(bundle)

    expect(createElementSpy).toHaveBeenCalledWith('a')
    expect(clickMock).toHaveBeenCalled()
    expect(createObjectURLSpy).toHaveBeenCalled()
    expect(revokeObjectURLSpy).toHaveBeenCalled()

    // Verify download filename
    const anchor = createElementSpy.mock.results[0].value
    expect(anchor.download).toMatch(/^stellarsearch-bundle-\d{4}-\d{2}-\d{2}\.json$/)

    createElementSpy.mockRestore()
    appendChildSpy.mockRestore()
    removeChildSpy.mockRestore()
    revokeObjectURLSpy.mockRestore()
    createObjectURLSpy.mockRestore()
  })
})
