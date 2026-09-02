import { sha256 } from './hashing'
import type { SearchReceipt } from '../types'

/**
 * BUNDLE_VERSION — incremented when the bundle schema changes.
 * The offline verifier uses this to handle backward-compatible
 * deserialization of older bundles.
 */
export const BUNDLE_VERSION = 1

/**
 * SearchReceiptBundle is the versioned JSON structure that the user downloads.
 * It wraps one or more receipts together with request metadata and a
 * deterministic verification proof so that a third party can audit
 * integrity offline without contacting any server.
 */
export interface SearchReceiptBundle {
  /** Semantic version of the bundle schema. */
  version: number
  /** ISO-8601 timestamp of when the bundle was generated. */
  generatedAt: string
  /** Human-readable application name that produced the receipts. */
  applicationName: string
  /** The Stellar network the receipts belong to (e.g. "stellar:testnet"). */
  network: string
  /** Ordered list of individual receipts. */
  receipts: SearchReceipt[]
  /**
   * JSON-stringified request metadata captured at bundle time.
   * Stored as a string so its hash is stable and deterministic.
   */
  metadata: string
  /** SHA-256 integrity proof computed over (metadata + sorted receipts JSON). */
  proof: string
}

/**
 * VerificationResult returned by the offline verifier.
 * Separates mutation detection from ledger-verifiable fields.
 */
export interface VerificationResult {
  /** True if the bundle has NOT been tampered with. */
  integrityValid: boolean
  /** True if all receipts reference real Stellar transactions (requires network lookup). */
  ledgerValid: boolean
  /** Human-readable list of issues found. */
  findings: string[]
}

// ---------------------------------------------------------------------------
// Bundle creation
// ---------------------------------------------------------------------------

/**
 * Builds the deterministic string that feeds the integrity hash.
 * The receipts are sorted by txHash so ordering does not affect the proof.
 */
export function canonicalPayload(
  metadata: string,
  receipts: SearchReceipt[],
): string {
  const sorted = [...receipts].sort((a, b) => a.txHash.localeCompare(b.txHash))
  return metadata + JSON.stringify(sorted)
}

/**
 * Creates a signed receipt bundle with a SHA-256 integrity proof.
 *
 * The proof is a hex-encoded SHA-256 hash of:
 *   canonicalPayload(metadata, receipts)
 * which means any mutation to metadata or any receipt field will invalidate
 * the proof.
 *
 * @param receipts - Array of search receipts to include.
 * @param network  - Stellar network identifier (e.g. "stellar:testnet").
 * @param extra    - Optional extra metadata key-value pairs to attach.
 * @returns A fully-formed {@link SearchReceiptBundle}.
 */
export async function createReceiptBundle(
  receipts: SearchReceipt[],
  network: string,
  extra?: Record<string, string>,
): Promise<SearchReceiptBundle> {
  if (receipts.length === 0) {
    throw new Error('Cannot create a bundle from zero receipts')
  }

  const metadataObj: Record<string, unknown> = {
    application: 'StellarSearch',
    version: BUNDLE_VERSION,
    generatedAt: new Date().toISOString(),
    receiptCount: receipts.length,
    network,
    ...extra,
  }

  const metadata = JSON.stringify(metadataObj)
  const proof = await sha256(canonicalPayload(metadata, receipts))

  return {
    version: BUNDLE_VERSION,
    generatedAt: metadataObj.generatedAt as string,
    applicationName: 'StellarSearch',
    network,
    receipts,
    metadata,
    proof,
  }
}

// ---------------------------------------------------------------------------
// Offline verifier (zero-network, pure-computation)
// ---------------------------------------------------------------------------

/**
 * Verifies bundle integrity offline (no Stellar network calls).
 *
 * This function checks:
 * 1. Bundle version is supported.
 * 2. Metadata is valid JSON.
 * 3. Proof matches recomputed SHA-256 of canonical payload.
 *
 * Ledger verification (checking that txHash values exist on-chain) is
 * reported separately as `ledgerValid: false` with a note — the caller
 * can perform that check asynchronously via Horizon.
 */
export async function verifyBundleOffline(
  bundle: SearchReceiptBundle,
): Promise<VerificationResult> {
  const findings: string[] = []

  // 1. Version check
  if (bundle.version !== BUNDLE_VERSION) {
    findings.push(
      `Unsupported bundle version ${bundle.version}; expected ${BUNDLE_VERSION}`,
    )
  }

  // 2. Metadata JSON parse
  let metadataObj: Record<string, unknown>
  try {
    metadataObj = JSON.parse(bundle.metadata)
  } catch {
    findings.push('Metadata is not valid JSON')
    return { integrityValid: false, ledgerValid: false, findings }
  }

  // 3. Proof recomputation
  const expectedProof = await sha256(
    canonicalPayload(bundle.metadata, bundle.receipts),
  )
  if (bundle.proof !== expectedProof) {
    findings.push(
      'Integrity proof mismatch — bundle has been modified since creation',
    )
  }

  // 4. Structural checks
  if (!Array.isArray(bundle.receipts) || bundle.receipts.length === 0) {
    findings.push('Bundle contains no receipts')
  }

  if (typeof metadataObj.application !== 'string') {
    findings.push('Metadata missing application field')
  }

  // Ledger validity requires network calls — report as unknown here
  findings.push(
    'Ledger verification requires Stellar Horizon lookup (not performed offline)',
  )

  const integrityValid = findings.length === 1 // only the ledger finding
  return { integrityValid, ledgerValid: false, findings }
}

// ---------------------------------------------------------------------------
// Browser download helper
// ---------------------------------------------------------------------------

/**
 * Triggers a browser file download for the given bundle as a pretty-printed
 * JSON file with a `.stellarsearch-bundle.json` extension.
 */
export function downloadBundle(bundle: SearchReceiptBundle): void {
  const json = JSON.stringify(bundle, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)

  const a = document.createElement('a')
  a.href = url
  a.download = `stellarsearch-bundle-${bundle.generatedAt.slice(0, 10)}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
