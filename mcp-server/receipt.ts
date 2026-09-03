/**
 * receipt.ts — x402 receipt formatting for StellarSearch MCP tools.
 *
 * Surfaces verifiable payment receipt metadata (transaction hash,
 * explorer URL, x402 protocol version) from server responses, and
 * explicitly represents missing/unverified receipts.
 */

import { STELLAR_EXPERT_URL, STELLAR_NETWORK } from '../src/lib/constants'

/** Minimal shape of the receipt fields returned by the StellarSearch API. */
export interface PaymentReceiptData {
  /** On-chain transaction hash (hex string), if settlement completed. */
  txHash?: string | null
  /** Amount paid per query. */
  paidAmount?: string | null
  /** Currency code (e.g. "USDC"). */
  currency?: string | null
  /** Network identifier (e.g. "stellar:testnet"). */
  network?: string | null
  /** x402 protocol version used for settlement, if available. */
  x402Version?: number | null
}

export interface ReceiptResult {
  /** Whether the receipt has a verifiable on-chain transaction. */
  verified: boolean
  /** Formatted receipt lines for MCP text output (always ≥1 line). */
  lines: string[]
}

/**
 * Builds the Stellar Expert explorer URL for a given transaction hash.
 * Uses the currently-configured network (testnet/mainnet) from constants.
 */
export function explorerTxUrl(txHash: string): string {
  return `${STELLAR_EXPERT_URL}/tx/${txHash}`
}

/**
 * Formats x402 receipt metadata from a server response into human-readable
 * MCP output lines.
 *
 * When `txHash` is present and non-empty, the receipt is marked as
 * **Verified** with a clickable explorer URL. When the hash is missing,
 * the receipt is explicitly marked as **⚠️ Unverified** so consumers
 * never confuse a missing settlement proof with a confirmed one.
 *
 * @param data - The payment-related fields from the server JSON response.
 * @returns ReceiptResult containing a verified flag and formatted text lines.
 */
export function formatReceipt(data: PaymentReceiptData): ReceiptResult {
  const network = data.network || STELLAR_NETWORK
  const txHash = data.txHash?.trim() || null
  const version = data.x402Version ?? 2

  if (txHash) {
    const url = explorerTxUrl(txHash)
    return {
      verified: true,
      lines: [
        `📄 Receipt: ✅ Verified (x402 v${version})`,
        `   Tx: ${txHash}`,
        `   Explorer: ${url}`,
        `   Network: ${network}`,
      ],
    }
  }

  // Explicitly represent the missing-receipt case rather than
  // silently treating it as a successful paid response.
  return {
    verified: false,
    lines: [
      `📄 Receipt: ⚠️ Unverified — no on-chain settlement proof returned`,
      `   Network: ${network}`,
      ...(data.paidAmount && data.currency
        ? [`   Amount: ${data.paidAmount} ${data.currency}`]
        : []),
    ],
  }
}
